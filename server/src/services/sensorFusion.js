// ============================================================================
// GridZero — AI Sensor Fusion Engine
// ============================================================================
// Multi-sensor fusion algorithm that combines thermal, gas, and ultrasonic
// data to detect victims and classify hazards with confidence scoring.
//
// This is the CORE AI logic of GridZero — what makes it a champion project!
//
// Fusion Pipeline:
//   1. Thermal Analysis    → Body heat detection (35-38°C)
//   2. Gas Classification  → Hazard level (safe/warning/danger/critical)
//   3. Distance Context    → Proximity analysis
//   4. Multi-Sensor Fusion → Combined victim probability
//   5. Confidence Scoring  → Detection accuracy percentage
//   6. Alert Rule Engine   → When to trigger which alert
const { pool } = require('../config/database');

// ============================================================================
// 4.1 — THERMAL ANALYSIS MODULE
// ============================================================================

/**
 * Analyzes thermal sensor data to detect potential body heat signatures.
 * 
 * Human body surface temp: 33-37°C (varies with ambient conditions)
 * Key indicator: Temperature DELTA (object - ambient) is more reliable
 * than absolute temperature alone.
 * 
 * @param {number} objectTemp  - Object temperature from MLX90614 (°C)
 * @param {number} ambientTemp - Ambient temperature from MLX90614 (°C)
 * @returns {Object} Thermal analysis result
 */
function analyzeThermal(objectTemp, ambientTemp) {
    const delta = objectTemp - ambientTemp;

    // Classification thresholds (calibrated for rescue scenarios)
    const BODY_TEMP_MIN = 33.0;     // Minimum body surface temp (hypothermia possible)
    const BODY_TEMP_MAX = 40.0;     // Maximum body surface temp (fever)
    const BODY_TEMP_IDEAL = 36.5;   // Ideal body surface temp
    const DELTA_ALIVE_MIN = 5.0;    // Minimum delta for alive detection
    const DELTA_WARM_MIN = 3.0;     // Warm object threshold
    const DECEASED_TEMP_MAX = 30.0; // Below this + small delta = likely deceased
    const DECEASED_DELTA_MAX = 2.0; // Dead body cools, small delta from ambient

    let classification = 'no_detection';
    let confidence = 0;
    let isBodyHeat = false;
    let details = '';

    // ── Case 1: Strong body heat signature (ALIVE) ────────────────────
    if (objectTemp >= BODY_TEMP_MIN && objectTemp <= BODY_TEMP_MAX && delta >= DELTA_ALIVE_MIN) {
        classification = 'alive';
        isBodyHeat = true;

        // Confidence based on how close to ideal body temp
        const tempProximity = 1 - Math.abs(objectTemp - BODY_TEMP_IDEAL) / 5;
        const deltaStrength = Math.min(delta / 10, 1);
        confidence = Math.round((tempProximity * 0.6 + deltaStrength * 0.4) * 100);
        confidence = Math.max(40, Math.min(98, confidence));

        details = `Body heat detected: ${objectTemp.toFixed(1)}°C (Δ${delta.toFixed(1)}°C from ambient)`;
    }
    // ── Case 2: Moderate warmth (POSSIBLE victim — uncertain) ─────────
    else if (objectTemp >= 30 && objectTemp < BODY_TEMP_MIN && delta >= DELTA_WARM_MIN) {
        classification = 'uncertain';
        isBodyHeat = true;

        const tempFactor = (objectTemp - 28) / (BODY_TEMP_MIN - 28);
        const deltaFactor = Math.min(delta / 8, 1);
        confidence = Math.round((tempFactor * 0.5 + deltaFactor * 0.5) * 70);
        confidence = Math.max(20, Math.min(65, confidence));

        details = `Moderate warmth: ${objectTemp.toFixed(1)}°C — could be body at distance or heat source`;
    }
    // ── Case 3: Cooling body (DECEASED) ───────────────────────────────
    else if (objectTemp >= ambientTemp + 1.5 && objectTemp <= DECEASED_TEMP_MAX && delta <= DECEASED_DELTA_MAX && delta > 0.5) {
        classification = 'deceased';
        isBodyHeat = false;

        confidence = Math.round(30 + (delta / DECEASED_DELTA_MAX) * 25);
        confidence = Math.max(15, Math.min(55, confidence));

        details = `Cooling heat source: ${objectTemp.toFixed(1)}°C (Δ${delta.toFixed(1)}°C) — possible deceased`;
    }
    // ── Case 4: No significant heat signature ─────────────────────────
    else {
        classification = 'no_detection';
        isBodyHeat = false;
        confidence = 0;
        details = `Normal reading: ${objectTemp.toFixed(1)}°C (Δ${delta.toFixed(1)}°C)`;
    }

    return {
        classification,
        confidence,
        isBodyHeat,
        objectTemp,
        ambientTemp,
        delta: parseFloat(delta.toFixed(2)),
        details
    };
}

// ============================================================================
// 4.2 — GAS HAZARD CLASSIFICATION MODULE
// ============================================================================

/**
 * Classifies gas sensor readings into hazard levels.
 * Based on OSHA/NIOSH exposure limits for rescue scenarios.
 * 
 * Dangerous thresholds:
 *   CO:      >35 PPM (8hr TWA), >200 PPM (IDLH — Immediately Dangerous)
 *   Methane: >5% vol (~50,000 PPM) = explosive, but sensor detects leaks early
 *   LPG:     >2% vol (~20,000 PPM) = explosive
 * 
 * For MQ-9 sensor (limited precision), we use conservative thresholds.
 * 
 * @param {number} coPpm      - Carbon monoxide in PPM
 * @param {number} methanePpm - Methane in PPM
 * @param {number} lpgPpm     - LPG/Propane in PPM
 * @returns {Object} Gas hazard classification
 */
function classifyGasHazard(coPpm, methanePpm, lpgPpm) {
    // Individual gas danger scores (0-100)
    const coScore = calculateGasScore(coPpm, [
        { threshold: 0,   level: 'safe',     score: 0 },
        { threshold: 9,   level: 'low',      score: 20 },
        { threshold: 25,  level: 'moderate',  score: 40 },
        { threshold: 50,  level: 'high',     score: 70 },
        { threshold: 100, level: 'critical',  score: 90 },
        { threshold: 200, level: 'deadly',   score: 100 }
    ]);

    const methaneScore = calculateGasScore(methanePpm, [
        { threshold: 0,   level: 'safe',     score: 0 },
        { threshold: 5,   level: 'low',      score: 15 },
        { threshold: 15,  level: 'moderate',  score: 35 },
        { threshold: 50,  level: 'high',     score: 65 },
        { threshold: 100, level: 'critical',  score: 85 },
        { threshold: 500, level: 'explosive', score: 100 }
    ]);

    const lpgScore = calculateGasScore(lpgPpm, [
        { threshold: 0,  level: 'safe',     score: 0 },
        { threshold: 3,  level: 'low',      score: 15 },
        { threshold: 10, level: 'moderate',  score: 35 },
        { threshold: 30, level: 'high',     score: 60 },
        { threshold: 80, level: 'critical',  score: 85 },
        { threshold: 200, level: 'explosive', score: 100 }
    ]);

    // Combined hazard score (weighted: CO is most dangerous to rescuers)
    const combinedScore = (coScore.score * 0.5) + (methaneScore.score * 0.3) + (lpgScore.score * 0.2);

    // Overall hazard level
    let hazardLevel, rescuerSafety, recommendations;

    if (combinedScore >= 80) {
        hazardLevel = 'critical';
        rescuerSafety = 'UNSAFE — DO NOT ENTER';
        recommendations = 'Evacuate immediately. Full SCBA required. Gas concentrations are life-threatening.';
    } else if (combinedScore >= 60) {
        hazardLevel = 'high';
        rescuerSafety = 'DANGEROUS — SCBA Required';
        recommendations = 'Entry only with full breathing apparatus. Monitor continuously.';
    } else if (combinedScore >= 35) {
        hazardLevel = 'moderate';
        rescuerSafety = 'CAUTION — Mask Recommended';
        recommendations = 'Use gas mask. Ventilate area if possible. Monitor for changes.';
    } else if (combinedScore >= 15) {
        hazardLevel = 'low';
        rescuerSafety = 'LOW RISK — Monitor';
        recommendations = 'Elevated readings detected. Continue monitoring.';
    } else {
        hazardLevel = 'safe';
        rescuerSafety = 'SAFE — Normal Levels';
        recommendations = 'Gas levels within normal range. Safe for entry.';
    }

    return {
        hazardLevel,
        combinedScore: parseFloat(combinedScore.toFixed(1)),
        rescuerSafety,
        recommendations,
        gases: {
            co: { ppm: coPpm, level: coScore.level, score: coScore.score },
            methane: { ppm: methanePpm, level: methaneScore.level, score: methaneScore.score },
            lpg: { ppm: lpgPpm, level: lpgScore.level, score: lpgScore.score }
        }
    };
}

/**
 * Helper: Calculate gas danger score using threshold table.
 */
function calculateGasScore(ppm, thresholds) {
    let result = { level: 'safe', score: 0 };
    for (let i = thresholds.length - 1; i >= 0; i--) {
        if (ppm >= thresholds[i].threshold) {
            result = { level: thresholds[i].level, score: thresholds[i].score };
            // Interpolate between this and next threshold
            if (i < thresholds.length - 1) {
                const range = thresholds[i + 1].threshold - thresholds[i].threshold;
                const progress = (ppm - thresholds[i].threshold) / range;
                const scoreRange = thresholds[i + 1].score - thresholds[i].score;
                result.score = Math.round(thresholds[i].score + progress * scoreRange);
            }
            break;
        }
    }
    return result;
}

// ============================================================================
// 4.3 — MULTI-SENSOR FUSION ALGORITHM
// ============================================================================

/**
 * Combines all sensor data to produce a unified victim detection result.
 * 
 * Fusion Strategy:
 *   - Thermal data is the PRIMARY indicator (highest weight)
 *   - Camera AI provides VISUAL CONFIRMATION (shape detection)
 *   - Gas data provides CONTEXT (is it safe to send rescuers?)
 *   - Distance data provides PROXIMITY (closer = more reliable)
 *   - Combined score determines final classification
 * 
 * @param {Object} thermal      - { objectTemp, ambientTemp }
 * @param {Object} gas          - { co_ppm, methane_ppm, lpg_ppm }
 * @param {Object} ultrasonic   - { front_cm, side_cm }
 * @param {Object|null} vision  - { detected, personCount, maxConfidence, cameraOnline }
 * @returns {Object} Fusion result with classification and confidence
 */
function fuseSensorData(thermal, gas, ultrasonic, vision = null) {
    // Step 1: Individual analyses
    const thermalResult = analyzeThermal(
        parseFloat(thermal.objectTemp) || 0,
        parseFloat(thermal.ambientTemp) || 0
    );

    const gasResult = classifyGasHazard(
        parseFloat(gas.co_ppm) || 0,
        parseFloat(gas.methane_ppm) || 0,
        parseFloat(gas.lpg_ppm) || 0
    );

    const frontDist = parseFloat(ultrasonic.front_cm) || 999;
    const sideDist = parseFloat(ultrasonic.side_cm) || 999;

    // Step 2: Distance-based confidence modifier
    // Closer detection = more reliable thermal reading
    let distanceModifier = 1.0;
    if (frontDist < 50) {
        distanceModifier = 1.25;  // Very close — high confidence boost
    } else if (frontDist < 100) {
        distanceModifier = 1.1;   // Medium range — slight boost
    } else if (frontDist > 200) {
        distanceModifier = 0.7;   // Far away — reduce confidence
    } else if (frontDist > 300) {
        distanceModifier = 0.5;   // Very far — low confidence
    }

    // Step 3: Gas context modifier
    // If area is safe, thermal readings are more reliable
    // If area is hazardous, thermal readings could be from fire/machinery
    let gasModifier = 1.0;
    if (gasResult.hazardLevel === 'safe') {
        gasModifier = 1.1;  // Safe area — thermal more likely to be a person
    } else if (gasResult.hazardLevel === 'critical' || gasResult.hazardLevel === 'high') {
        gasModifier = 0.8;  // Hazardous — heat could be from gas/fire source
    }

    // Step 4: Camera AI Vision modifier (NEW — Multi-Modal Fusion)
    // When camera confirms a human shape, it dramatically increases confidence.
    // When camera sees nothing, it may reduce confidence (but not always —
    // victim could be hidden under rubble where camera can't see).
    let visionModifier = 1.0;
    let visionConfirmed = false;
    let cameraStatus = 'offline';  // offline | no_person | person_detected

    if (vision && vision.cameraOnline) {
        if (vision.detected && vision.maxConfidence >= 40) {
            // Camera detected a person!
            visionConfirmed = true;
            cameraStatus = 'person_detected';

            // Scale boost based on camera confidence (40-99%)
            const camConfNormalized = Math.min(vision.maxConfidence / 100, 1.0);
            visionModifier = 1.2 + (camConfNormalized * 0.3);  // 1.2x to 1.5x boost
        } else {
            // Camera is online but no person detected
            cameraStatus = 'no_person';

            if (thermalResult.isBodyHeat) {
                // Thermal says body heat but camera doesn't see anyone —
                // could be hidden under debris, don't penalize too much
                visionModifier = 0.85;
            } else {
                // Neither camera nor thermal see anything — normal
                visionModifier = 1.0;
            }
        }
    }
    // If camera is offline, visionModifier stays 1.0 (no effect)

    // Step 5: Compute fused confidence
    let fusedConfidence = thermalResult.confidence * distanceModifier * gasModifier * visionModifier;
    fusedConfidence = Math.max(0, Math.min(99, Math.round(fusedConfidence)));

    // Step 6: Special case — Camera sees person but thermal doesn't detect body heat
    // This could be a cold/hypothermic victim or someone at a distance
    if (visionConfirmed && !thermalResult.isBodyHeat && thermalResult.classification === 'no_detection') {
        fusedConfidence = Math.max(fusedConfidence, Math.round(vision.maxConfidence * 0.5));
        // Upgrade classification since camera is quite reliable for shape detection
        if (fusedConfidence >= 30) {
            thermalResult.classification = 'uncertain';
            thermalResult.details += ' (Camera AI detected human shape but no body heat — possible hypothermia or distance)';
        }
    }

    // Step 7: Final classification
    let finalClassification = thermalResult.classification;
    let priorityLevel = 'low';

    if (finalClassification === 'alive' && fusedConfidence >= 60) {
        priorityLevel = 'critical';
    } else if (finalClassification === 'alive' && fusedConfidence >= 40) {
        priorityLevel = 'high';
        finalClassification = 'uncertain';  // Downgrade if low confidence
    } else if (finalClassification === 'uncertain') {
        priorityLevel = 'medium';
    } else if (finalClassification === 'deceased') {
        priorityLevel = 'medium';
    } else {
        priorityLevel = 'low';
    }

    // If both camera AND thermal confirm — upgrade to critical
    if (visionConfirmed && thermalResult.isBodyHeat && fusedConfidence >= 50) {
        priorityLevel = 'critical';
        if (finalClassification === 'uncertain') {
            finalClassification = 'alive';
        }
    }

    // Step 8: Generate action recommendation
    const detectionMethod = visionConfirmed && thermalResult.isBodyHeat
        ? '🎥 Camera + 🌡️ Thermal CONFIRMED'
        : visionConfirmed
            ? '🎥 Camera detected (thermal unconfirmed)'
            : thermalResult.isBodyHeat
                ? '🌡️ Thermal detected (camera unconfirmed)'
                : 'No detection';

    let action = '';
    if (finalClassification === 'alive') {
        action = `PRIORITY RESCUE: Victim likely alive at ~${frontDist.toFixed(0)}cm. ` +
                 `${detectionMethod}. ${gasResult.rescuerSafety}. Deploy rescue team immediately.`;
    } else if (finalClassification === 'uncertain') {
        action = `INVESTIGATE: Possible victim at ~${frontDist.toFixed(0)}cm. ` +
                 `${detectionMethod}. Confidence: ${fusedConfidence}%. Send rover closer for confirmation.`;
    } else if (finalClassification === 'deceased') {
        action = `MARK LOCATION: Possible deceased at ~${frontDist.toFixed(0)}cm. ` +
                 `Continue searching for survivors.`;
    } else {
        action = 'No victim detected. Continue scanning.';
    }

    return {
        classification: finalClassification,
        confidence: fusedConfidence,
        priorityLevel,
        action,
        detectionMethod,
        fusion: {
            thermal: thermalResult,
            gas: gasResult,
            distance: { front: frontDist, side: sideDist, modifier: distanceModifier },
            vision: vision ? {
                detected: vision.detected,
                personCount: vision.personCount,
                maxConfidence: vision.maxConfidence,
                cameraOnline: vision.cameraOnline,
                confirmed: visionConfirmed,
                status: cameraStatus,
                modifier: visionModifier
            } : { cameraOnline: false, status: 'offline', modifier: 1.0 },
            modifiers: { distance: distanceModifier, gas: gasModifier, vision: visionModifier }
        },
        timestamp: new Date().toISOString()
    };
}

// ============================================================================
// 4.4 — ALERT RULE ENGINE
// ============================================================================

/**
 * Evaluates all sensor data against alert rules and triggers appropriate alerts.
 * Called after every telemetry update.
 * 
 * Alert Types:
 *   - victim_detected_alive    (critical)
 *   - victim_detected_deceased (danger)
 *   - gas_leak_critical        (critical)
 *   - gas_leak_warning         (warning)
 *   - battery_low              (warning)
 *   - battery_critical         (critical)
 *   - obstacle_detected        (info)
 *   - connection_lost          (danger)
 *   - high_temperature         (warning)
 * 
 * @param {Object} sensorData  - Complete sensor data package
 * @param {Object} io          - Socket.IO instance for broadcasting
 * @returns {Array} List of alerts generated
 */
async function evaluateAlertRules(sensorData, io) {
    const alerts = [];
    const roverId = sensorData.rover_id || 'GZ-ROVER-01';

    // Run fusion analysis
    const fusionResult = fuseSensorData(
        { objectTemp: sensorData.thermal?.object, ambientTemp: sensorData.thermal?.ambient },
        { co_ppm: sensorData.gas?.co_ppm, methane_ppm: sensorData.gas?.methane_ppm, lpg_ppm: sensorData.gas?.lpg_ppm },
        { front_cm: sensorData.ultrasonic?.front, side_cm: sensorData.ultrasonic?.side }
    );

    // ── Rule 1: Victim Detection ──────────────────────────────────────
    if (fusionResult.classification === 'alive' && fusionResult.confidence >= 55) {
        const alert = {
            rover_id: roverId,
            alert_type: 'victim_detected_alive',
            severity: 'critical',
            title: `🚨 VICTIM DETECTED — ALIVE (${fusionResult.confidence}% confidence)`,
            message: fusionResult.action,
            context_data: JSON.stringify(fusionResult.fusion)
        };
        alerts.push(alert);
    } else if (fusionResult.classification === 'uncertain' && fusionResult.confidence >= 35) {
        alerts.push({
            rover_id: roverId,
            alert_type: 'victim_detected_uncertain',
            severity: 'warning',
            title: `⚠️ Possible Victim (${fusionResult.confidence}% confidence)`,
            message: fusionResult.action,
            context_data: JSON.stringify(fusionResult.fusion)
        });
    }

    // ── Rule 2: Gas Hazard ────────────────────────────────────────────
    const gasHazard = fusionResult.fusion.gas.hazardLevel;
    if (gasHazard === 'critical' || gasHazard === 'high') {
        alerts.push({
            rover_id: roverId,
            alert_type: 'gas_leak_critical',
            severity: 'critical',
            title: `💨 GAS HAZARD: ${gasHazard.toUpperCase()}`,
            message: fusionResult.fusion.gas.recommendations,
            context_data: JSON.stringify(fusionResult.fusion.gas.gases)
        });
    } else if (gasHazard === 'moderate') {
        alerts.push({
            rover_id: roverId,
            alert_type: 'gas_leak_warning',
            severity: 'warning',
            title: '💨 Elevated Gas Levels Detected',
            message: fusionResult.fusion.gas.recommendations,
            context_data: JSON.stringify(fusionResult.fusion.gas.gases)
        });
    }

    // ── Rule 3: Battery ───────────────────────────────────────────────
    const batteryPercent = sensorData.battery?.percent;
    if (batteryPercent !== null && batteryPercent !== undefined) {
        if (batteryPercent <= 10) {
            alerts.push({
                rover_id: roverId,
                alert_type: 'battery_critical',
                severity: 'critical',
                title: '🔋 BATTERY CRITICAL — Return to Base!',
                message: `Battery at ${batteryPercent}%. Rover must return immediately or risk stranding.`
            });
        } else if (batteryPercent <= 25) {
            alerts.push({
                rover_id: roverId,
                alert_type: 'battery_low',
                severity: 'warning',
                title: `🔋 Battery Low (${batteryPercent}%)`,
                message: 'Consider returning to base soon.'
            });
        }
    }

    // ── Rule 4: Obstacle Proximity ────────────────────────────────────
    const frontDist = sensorData.ultrasonic?.front;
    if (frontDist !== null && frontDist !== undefined && frontDist < 15) {
        alerts.push({
            rover_id: roverId,
            alert_type: 'obstacle_critical',
            severity: 'warning',
            title: `🚧 Obstacle Very Close (${parseFloat(frontDist).toFixed(0)}cm)`,
            message: 'Rover is very close to an obstacle. Adjust path.'
        });
    }

    // ── Store alerts in database and broadcast ────────────────────────
    for (const alert of alerts) {
        try {
            const [result] = await pool.query(
                `INSERT INTO alerts (rover_id, alert_type, severity, title, message, context_data)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [alert.rover_id, alert.alert_type, alert.severity, alert.title, alert.message, alert.context_data || null]
            );
            alert.id = result.insertId;
            alert.triggered_at = new Date().toISOString();

            if (io) {
                io.emit('alert:new', alert);
            }
        } catch (err) {
            // Avoid duplicate alerts flooding — silent fail
        }
    }

    return { fusionResult, alerts };
}

// ============================================================================
// 4.5 — CONFIDENCE SCORING SYSTEM
// ============================================================================

/**
 * Calculates an overall system confidence score considering all factors.
 * Used by the dashboard to show "AI Confidence" meter.
 * 
 * Factors:
 *   - Sensor data quality (are readings within expected ranges?)
 *   - Number of confirming sensors (multi-sensor agreement)
 *   - Reading stability (consistent readings vs noisy data)
 *   - Distance to target (closer = more accurate)
 * 
 * @param {Array} recentReadings - Last N sensor readings for stability check
 * @returns {Object} Confidence assessment
 */
function calculateSystemConfidence(recentReadings = []) {
    if (recentReadings.length === 0) {
        return { overall: 0, factors: {}, assessment: 'No data available' };
    }

    // Factor 1: Data quality (are values in expected ranges?)
    let qualityScore = 100;
    const latest = recentReadings[recentReadings.length - 1];
    
    if (latest.thermal?.object < -10 || latest.thermal?.object > 100) qualityScore -= 30;
    if (latest.gas?.co_ppm < 0 || latest.gas?.co_ppm > 1000) qualityScore -= 20;
    if (latest.ultrasonic?.front < 2 || latest.ultrasonic?.front > 400) qualityScore -= 15;

    // Factor 2: Reading stability (standard deviation of last 5 readings)
    let stabilityScore = 100;
    if (recentReadings.length >= 3) {
        const temps = recentReadings.slice(-5).map(r => r.thermal?.object || 0);
        const stdDev = calculateStdDev(temps);
        if (stdDev > 5) stabilityScore -= 40;       // Very noisy
        else if (stdDev > 2) stabilityScore -= 20;   // Somewhat noisy
        // Stable readings are good
    }

    // Factor 3: Sensor agreement
    let agreementScore = 100;
    // If thermal says body heat but gas says fire hazard, lower confidence
    if (latest.thermal?.object > 35 && latest.gas?.co_ppm > 50) {
        agreementScore -= 30; // Could be fire, not a person
    }

    // Combined confidence
    const overall = Math.round(
        qualityScore * 0.35 + stabilityScore * 0.35 + agreementScore * 0.30
    );

    let assessment;
    if (overall >= 80) assessment = 'HIGH — Sensors operating optimally';
    else if (overall >= 60) assessment = 'MODERATE — Some sensor noise detected';
    else if (overall >= 40) assessment = 'LOW — Check sensor connections';
    else assessment = 'POOR — Sensor data unreliable';

    return {
        overall: Math.max(0, Math.min(100, overall)),
        factors: {
            dataQuality: qualityScore,
            readingStability: stabilityScore,
            sensorAgreement: agreementScore
        },
        assessment
    };
}

/**
 * Helper: Calculate standard deviation.
 */
function calculateStdDev(values) {
    const n = values.length;
    if (n === 0) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / n;
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / n;
    return Math.sqrt(variance);
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
    analyzeThermal,
    classifyGasHazard,
    fuseSensorData,
    evaluateAlertRules,
    calculateSystemConfidence,
    calculateStdDev
};

// Note: fuseSensorData() now accepts an optional 4th parameter 'vision'
// for camera AI integration. See function signature for details.
// When vision is null/undefined, the function behaves exactly as before.
