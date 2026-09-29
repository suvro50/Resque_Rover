// ============================================================================
// GridZero Server — AI Sensor Fusion & Vision API Routes
// ============================================================================
// Exposes the AI sensor fusion engine and camera vision detector via REST API
// for on-demand analysis and dashboard integration.
//
// Endpoints:
//   POST /api/ai/analyze        — Analyze sensor data on demand
//   GET  /api/ai/status         — Get AI engine status (includes vision)
//   GET  /api/ai/thresholds     — Get current detection thresholds
//   GET  /api/ai/vision/status  — Get camera AI vision detector status
//   POST /api/ai/vision/start   — Start camera analysis loop
//   POST /api/ai/vision/stop    — Stop camera analysis loop
//   GET  /api/ai/vision/latest  — Get latest camera detection result
// ============================================================================

const express = require('express');
const router = express.Router();
const {
    analyzeThermal,
    classifyGasHazard,
    fuseSensorData,
    calculateSystemConfidence
} = require('../services/sensorFusion');
const {
    initVisionDetector,
    startCameraAnalysis,
    stopCameraAnalysis,
    getLatestDetection,
    getVisionStatus
} = require('../services/visionDetector');

/**
 * POST /api/ai/analyze
 * Run AI sensor fusion on provided data.
 * Useful for testing the AI engine with custom values.
 * 
 * Body: {
 *   thermal: { objectTemp, ambientTemp },
 *   gas: { co_ppm, methane_ppm, lpg_ppm },
 *   ultrasonic: { front_cm, side_cm }
 * }
 */
router.post('/analyze', (req, res) => {
    try {
        const { thermal = {}, gas = {}, ultrasonic = {} } = req.body;

        // Include latest vision data in the analysis if available
        const visionResult = getLatestDetection();
        const result = fuseSensorData(thermal, gas, ultrasonic, visionResult.cameraOnline ? visionResult : null);

        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error('❌ AI Analysis Error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/ai/thermal
 * Analyze thermal data only.
 * 
 * Body: { objectTemp, ambientTemp }
 */
router.post('/thermal', (req, res) => {
    try {
        const { objectTemp = 25, ambientTemp = 25 } = req.body;
        const result = analyzeThermal(parseFloat(objectTemp), parseFloat(ambientTemp));
        res.json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/ai/gas
 * Classify gas hazard level.
 * 
 * Body: { co_ppm, methane_ppm, lpg_ppm }
 */
router.post('/gas', (req, res) => {
    try {
        const { co_ppm = 0, methane_ppm = 0, lpg_ppm = 0 } = req.body;
        const result = classifyGasHazard(
            parseFloat(co_ppm), parseFloat(methane_ppm), parseFloat(lpg_ppm)
        );
        res.json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/ai/status
 * Returns AI engine status and configuration (includes vision module).
 */
router.get('/status', (req, res) => {
    const visionStatus = getVisionStatus();

    res.json({
        success: true,
        data: {
            engine: 'GridZero Sensor Fusion AI v2.0 (Multi-Modal)',
            status: 'active',
            modules: {
                thermalAnalysis: 'active',
                gasClassification: 'active',
                multiSensorFusion: 'active',
                alertRuleEngine: 'active',
                confidenceScoring: 'active',
                cameraVisionAI: visionStatus.modelLoaded ? 'active' : 'loading'
            },
            fusion_method: 'Weighted Multi-Sensor with Distance, Gas & Camera Vision Modifiers',
            vision: visionStatus,
            thresholds: {
                thermal: {
                    body_temp_range: '33-40°C',
                    alive_delta_min: '5°C',
                    warm_delta_min: '3°C',
                    deceased_temp_max: '30°C'
                },
                gas: {
                    co_warning: '25 PPM',
                    co_danger: '50 PPM',
                    co_critical: '100 PPM',
                    methane_warning: '15 PPM',
                    methane_danger: '50 PPM'
                },
                distance: {
                    close_boost: '< 50 cm (+25% confidence)',
                    medium_range: '50-200 cm (normal)',
                    far_penalty: '> 200 cm (-30% confidence)'
                },
                vision: {
                    person_confidence_min: '40% (minimum to consider)',
                    boost_range: '1.2x to 1.5x confidence boost when person detected',
                    model: 'COCO-SSD lite_mobilenet_v2'
                }
            }
        }
    });
});

// ============================================================================
// 📷 Vision Detection Endpoints
// ============================================================================

/**
 * GET /api/ai/vision/status
 * Returns camera AI vision detector status, config, and statistics.
 */
router.get('/vision/status', (req, res) => {
    res.json({
        success: true,
        data: getVisionStatus()
    });
});

/**
 * POST /api/ai/vision/start
 * Start the camera analysis loop (captures + analyzes frames periodically).
 */
router.post('/vision/start', (req, res) => {
    try {
        const io = req.app.get('io');
        startCameraAnalysis(io);
        res.json({
            success: true,
            message: 'Camera AI analysis loop started',
            data: getVisionStatus()
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/ai/vision/stop
 * Stop the camera analysis loop.
 */
router.post('/vision/stop', (req, res) => {
    try {
        stopCameraAnalysis();
        res.json({
            success: true,
            message: 'Camera AI analysis loop stopped',
            data: getVisionStatus()
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/ai/vision/latest
 * Returns the latest camera detection result.
 */
router.get('/vision/latest', (req, res) => {
    res.json({
        success: true,
        data: getLatestDetection()
    });
});

module.exports = router;

