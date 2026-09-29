// ============================================================================
// GridZero — AI Vision Detector Service
// ============================================================================
// Uses TensorFlow.js COCO-SSD model to detect humans in camera frames
// from the ESP32-CAM module. Works alongside the thermal sensor for
// multi-modal victim identification.
//
// Pipeline:
//   1. Fetch JPEG snapshot from ESP32-CAM /capture endpoint
//   2. Decode image using canvas
//   3. Run COCO-SSD object detection
//   4. Filter for "person" class detections
//   5. Return bounding boxes + confidence scores
//   6. Broadcast results via Socket.IO
//
// The model detects 80 object classes (COCO dataset), but we only care
// about the "person" class for rescue operations.
//
// Note: Uses pure JS TensorFlow (@tensorflow/tfjs) instead of native
// (@tensorflow/tfjs-node) for maximum compatibility — no C++ build tools
// required. The 'canvas' package provides image decoding in Node.js.
//
// Register canvas backend for tf.js image decoding in Node.js
const canvas = require('canvas');
const tf = require('@tensorflow/tfjs');
const cocoSsd = require('@tensorflow-models/coco-ssd');
const axios = require('axios');

// ============================================================================
// State
// ============================================================================

let model = null;
let isModelLoaded = false;
let isAnalysisRunning = false;
let analysisInterval = null;
let ioInstance = null;

// Latest detection result (shared with other modules)
let latestDetection = {
    detected: false,
    persons: [],
    personCount: 0,
    maxConfidence: 0,
    frameTimestamp: null,
    analysisTimeMs: 0,
    cameraOnline: false,
    error: null
};

// Statistics
let stats = {
    totalFramesAnalyzed: 0,
    totalPersonsDetected: 0,
    modelLoadTimeMs: 0,
    avgAnalysisTimeMs: 0,
    lastError: null,
    startedAt: null
};

// Configuration
const CONFIG = {
    captureUrl: process.env.ESP32_CAM_CAPTURE_URL || 'http://192.168.1.100:81/capture',
    intervalMs: parseInt(process.env.VISION_ANALYSIS_INTERVAL_MS) || 3000,
    confidenceThreshold: parseFloat(process.env.VISION_CONFIDENCE_THRESHOLD) || 0.4,
    captureTimeoutMs: 5000,  // HTTP timeout for fetching frame
    maxRetries: 3            // Retries before marking camera offline
};

let consecutiveFailures = 0;

// ============================================================================
// Model Loading
// ============================================================================

/**
 * Initialize the COCO-SSD model.
 * This should be called once at server startup.
 * Model download happens automatically on first load (~20MB).
 */
async function initVisionDetector() {
    try {
        console.log('🧠 Loading TensorFlow.js COCO-SSD model...');
        console.log('   Runtime: @tensorflow/tfjs (pure JavaScript)');
        const startTime = Date.now();

        model = await cocoSsd.load({
            base: 'lite_mobilenet_v2'  // Lighter model, faster inference
        });

        stats.modelLoadTimeMs = Date.now() - startTime;
        isModelLoaded = true;

        console.log(`✅ COCO-SSD model loaded in ${stats.modelLoadTimeMs}ms`);
        console.log('   Model: lite_mobilenet_v2 (optimized for speed)');
        console.log('   Classes: 80 (using "person" class for victim detection)');

        return true;
    } catch (error) {
        console.error('❌ Failed to load COCO-SSD model:', error.message);
        isModelLoaded = false;
        return false;
    }
}

// ============================================================================
// Frame Capture
// ============================================================================

/**
 * Fetch a JPEG snapshot from the ESP32-CAM /capture endpoint.
 * Returns the image as a Buffer, or null if camera is offline.
 */
async function captureFrame() {
    try {
        const response = await axios.get(CONFIG.captureUrl, {
            responseType: 'arraybuffer',
            timeout: CONFIG.captureTimeoutMs,
            headers: {
                'Accept': 'image/jpeg'
            }
        });

        consecutiveFailures = 0;
        latestDetection.cameraOnline = true;
        return Buffer.from(response.data);

    } catch (error) {
        consecutiveFailures++;
        latestDetection.cameraOnline = false;

        if (consecutiveFailures <= 3) {
            // Only log first few failures to avoid spam
            console.warn(`⚠️ Camera capture failed (attempt ${consecutiveFailures}): ${error.message}`);
        }

        stats.lastError = {
            message: error.message,
            timestamp: new Date().toISOString()
        };

        return null;
    }
}

// ============================================================================
// Frame Analysis
// ============================================================================

/**
 * Decode a JPEG buffer into a TensorFlow.js 3D tensor using node-canvas.
 * @param {Buffer} imageBuffer - JPEG image as Buffer
 * @returns {tf.Tensor3D} - 3D tensor [height, width, 3]
 */
function decodeImage(imageBuffer) {
    const img = new canvas.Image();
    img.src = imageBuffer;

    // Create an offscreen canvas and draw the image
    const cvs = canvas.createCanvas(img.width, img.height);
    const ctx = cvs.getContext('2d');
    ctx.drawImage(img, 0, 0);

    // Extract pixel data and create tensor
    const imageData = ctx.getImageData(0, 0, img.width, img.height);
    // imageData.data is RGBA (4 channels), we need RGB (3 channels)
    const { data, width, height } = imageData;
    const rgbData = new Uint8Array(width * height * 3);
    for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
        rgbData[j] = data[i];       // R
        rgbData[j + 1] = data[i + 1]; // G
        rgbData[j + 2] = data[i + 2]; // B
    }

    return tf.tensor3d(rgbData, [height, width, 3], 'int32');
}

/**
 * Analyze a JPEG image buffer for human detection.
 * Runs COCO-SSD inference and filters for "person" class.
 *
 * @param {Buffer} imageBuffer - JPEG image as Buffer
 * @returns {Object} Detection result with person bounding boxes and confidence
 */
async function analyzeFrame(imageBuffer) {
    if (!isModelLoaded || !model) {
        return {
            detected: false,
            persons: [],
            personCount: 0,
            maxConfidence: 0,
            error: 'Model not loaded'
        };
    }

    const startTime = Date.now();

    try {
        // Decode JPEG buffer into a 3D tensor [height, width, 3]
        const imageTensor = decodeImage(imageBuffer);

        // Run COCO-SSD detection
        const predictions = await model.detect(imageTensor);

        // Clean up tensor to prevent memory leak
        imageTensor.dispose();

        // Filter for "person" class only, above confidence threshold
        const persons = predictions
            .filter(p => p.class === 'person' && p.score >= CONFIG.confidenceThreshold)
            .map(p => ({
                confidence: parseFloat((p.score * 100).toFixed(1)),
                bbox: {
                    x: Math.round(p.bbox[0]),
                    y: Math.round(p.bbox[1]),
                    width: Math.round(p.bbox[2]),
                    height: Math.round(p.bbox[3])
                }
            }))
            .sort((a, b) => b.confidence - a.confidence);  // Highest confidence first

        const analysisTimeMs = Date.now() - startTime;

        // Also extract any other interesting objects for context
        const otherObjects = predictions
            .filter(p => p.class !== 'person' && p.score >= 0.5)
            .map(p => ({
                class: p.class,
                confidence: parseFloat((p.score * 100).toFixed(1))
            }));

        return {
            detected: persons.length > 0,
            persons,
            personCount: persons.length,
            maxConfidence: persons.length > 0 ? persons[0].confidence : 0,
            otherObjects,
            analysisTimeMs,
            error: null
        };

    } catch (error) {
        console.error('❌ Frame analysis error:', error.message);
        return {
            detected: false,
            persons: [],
            personCount: 0,
            maxConfidence: 0,
            analysisTimeMs: Date.now() - startTime,
            error: error.message
        };
    }
}

// ============================================================================
// Analysis Loop
// ============================================================================

/**
 * Start the periodic camera analysis loop.
 * Captures a frame every N seconds and runs detection.
 *
 * @param {Object} io - Socket.IO instance for broadcasting results
 */
function startCameraAnalysis(io) {
    if (isAnalysisRunning) {
        console.log('⚠️ Camera analysis is already running');
        return;
    }

    if (!isModelLoaded) {
        console.error('❌ Cannot start analysis — model not loaded');
        return;
    }

    ioInstance = io;
    isAnalysisRunning = true;
    stats.startedAt = new Date().toISOString();

    console.log(`🎥 Starting camera analysis loop (every ${CONFIG.intervalMs}ms)`);
    console.log(`   Capture URL: ${CONFIG.captureUrl}`);
    console.log(`   Confidence threshold: ${CONFIG.confidenceThreshold * 100}%`);

    // Run analysis loop
    analysisInterval = setInterval(async () => {
        try {
            // Step 1: Capture frame from ESP32-CAM
            const frameBuffer = await captureFrame();

            if (!frameBuffer) {
                // Camera offline — update status but don't stop loop
                latestDetection = {
                    ...latestDetection,
                    detected: false,
                    persons: [],
                    personCount: 0,
                    maxConfidence: 0,
                    cameraOnline: false,
                    frameTimestamp: new Date().toISOString()
                };

                // Broadcast camera offline status
                if (ioInstance) {
                    ioInstance.emit('vision:status', {
                        cameraOnline: false,
                        modelLoaded: true,
                        analysisRunning: true
                    });
                }
                return;
            }

            // Step 2: Analyze the frame
            const result = await analyzeFrame(frameBuffer);

            // Step 3: Update latest detection
            latestDetection = {
                ...result,
                cameraOnline: true,
                frameTimestamp: new Date().toISOString()
            };

            // Step 4: Update statistics
            stats.totalFramesAnalyzed++;
            if (result.detected) {
                stats.totalPersonsDetected += result.personCount;
            }
            stats.avgAnalysisTimeMs = Math.round(
                (stats.avgAnalysisTimeMs * (stats.totalFramesAnalyzed - 1) + result.analysisTimeMs) /
                stats.totalFramesAnalyzed
            );

            // Step 5: Broadcast detection result via Socket.IO
            if (ioInstance) {
                ioInstance.emit('vision:detection', {
                    detected: result.detected,
                    personCount: result.personCount,
                    maxConfidence: result.maxConfidence,
                    persons: result.persons,
                    otherObjects: result.otherObjects || [],
                    cameraOnline: true,
                    analysisTimeMs: result.analysisTimeMs,
                    timestamp: latestDetection.frameTimestamp
                });

                // If person detected, emit a special high-priority event
                if (result.detected && result.maxConfidence >= 60) {
                    ioInstance.emit('vision:person_detected', {
                        confidence: result.maxConfidence,
                        count: result.personCount,
                        timestamp: latestDetection.frameTimestamp
                    });
                }
            }

        } catch (error) {
            console.error('❌ Analysis loop error:', error.message);
            stats.lastError = {
                message: error.message,
                timestamp: new Date().toISOString()
            };
        }
    }, CONFIG.intervalMs);
}

/**
 * Stop the camera analysis loop.
 */
function stopCameraAnalysis() {
    if (analysisInterval) {
        clearInterval(analysisInterval);
        analysisInterval = null;
    }
    isAnalysisRunning = false;
    console.log('🛑 Camera analysis loop stopped');
}

// ============================================================================
// Getters
// ============================================================================

/**
 * Get the latest vision detection result.
 * Used by sensorFusion.js to combine with thermal data.
 */
function getLatestDetection() {
    return { ...latestDetection };
}

/**
 * Get vision detector status and statistics.
 */
function getVisionStatus() {
    return {
        modelLoaded: isModelLoaded,
        analysisRunning: isAnalysisRunning,
        cameraOnline: latestDetection.cameraOnline,
        config: {
            captureUrl: CONFIG.captureUrl,
            intervalMs: CONFIG.intervalMs,
            confidenceThreshold: CONFIG.confidenceThreshold
        },
        stats: {
            ...stats,
            totalFramesAnalyzed: stats.totalFramesAnalyzed,
            totalPersonsDetected: stats.totalPersonsDetected,
            avgAnalysisTimeMs: stats.avgAnalysisTimeMs
        },
        latestDetection: {
            detected: latestDetection.detected,
            personCount: latestDetection.personCount,
            maxConfidence: latestDetection.maxConfidence,
            cameraOnline: latestDetection.cameraOnline,
            frameTimestamp: latestDetection.frameTimestamp
        }
    };
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
    initVisionDetector,
    analyzeFrame,
    startCameraAnalysis,
    stopCameraAnalysis,
    getLatestDetection,
    getVisionStatus
};
