// ============================================================================
// GridZero Server — Telemetry Routes
// ============================================================================
// Handles incoming sensor data from ESP32 rover.
// This is the PRIMARY data ingestion endpoint — every sensor reading from
// the rover flows through here.
//
// Endpoints:
//   POST /api/telemetry       — Receive bulk sensor data from ESP32
//   GET  /api/telemetry/latest — Get latest readings for dashboard
//   GET  /api/telemetry/history — Get historical readings with time range
// ============================================================================

const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { fuseSensorData, evaluateAlertRules } = require('../services/sensorFusion');
const { getLatestDetection } = require('../services/visionDetector');

/**
 * POST /api/telemetry
 * 
 * Receives sensor data from ESP32 and stores in database.
 * This endpoint is called by the ESP32 every ~2 seconds with all sensor readings.
 * Uses the stored procedure sp_insert_telemetry for atomic insertion.
 * 
 * Request Body:
 * {
 *   "rover_id": "GZ-ROVER-01",
 *   "thermal": { "ambient": 25.5, "object": 36.8 },
 *   "gas": { "raw_adc": 1024, "voltage": 1.65, "co_ppm": 5.2, "methane_ppm": 0.8, "lpg_ppm": 0.3, "hazard": "safe" },
 *   "ultrasonic": { "front": 45.5, "side": 120.3, "side_position": "left" },
 *   "battery": { "voltage": 11.2, "percent": 85 },
 *   "wifi_rssi": -45
 * }
 */
router.post('/', async (req, res) => {
    try {
        const {
            rover_id = 'GZ-ROVER-01',
            thermal = {},
            gas = {},
            ultrasonic = {},
            battery = {},
            wifi_rssi = null
        } = req.body;

        // Validate required fields
        if (!thermal.ambient && thermal.ambient !== 0) {
            return res.status(400).json({
                success: false,
                error: 'Missing thermal data (ambient temperature required)'
            });
        }

        // Call stored procedure for atomic insertion + auto-alert generation
        await pool.query('CALL sp_insert_telemetry(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
            rover_id,
            thermal.ambient || 0,
            thermal.object || 0,
            gas.raw_adc || 0,
            gas.voltage || 0,
            gas.co_ppm || 0,
            gas.methane_ppm || 0,
            gas.lpg_ppm || 0,
            gas.hazard || 'safe',
            ultrasonic.front || 0,
            ultrasonic.side || null,
            ultrasonic.side_position || 'left',
            battery.voltage || null,
            battery.percent || null,
            wifi_rssi
        ]);

        // Run AI Sensor Fusion analysis on incoming data
        // Include camera AI vision data for multi-modal fusion
        const visionResult = getLatestDetection();
        const fusionResult = fuseSensorData(
            { objectTemp: thermal.object, ambientTemp: thermal.ambient },
            { co_ppm: gas.co_ppm, methane_ppm: gas.methane_ppm, lpg_ppm: gas.lpg_ppm },
            { front_cm: ultrasonic.front, side_cm: ultrasonic.side },
            visionResult.cameraOnline ? visionResult : null
        );

        // Evaluate alert rules (auto-generates alerts for hazards/victims)
        const alertResult = await evaluateAlertRules({
            rover_id,
            thermal, gas, ultrasonic, battery, wifi_rssi
        }, req.app.get('io'));

        // Get the latest data to broadcast via WebSocket
        const [latestData] = await pool.query(
            'SELECT * FROM v_realtime_dashboard WHERE rover_id = ?',
            [rover_id]
        );

        // Emit real-time update via Socket.IO (if io is attached to app)
        if (req.app.get('io')) {
            req.app.get('io').emit('telemetry:update', {
                rover_id,
                thermal: { ambient: thermal.ambient, object: thermal.object },
                gas: { co_ppm: gas.co_ppm, methane_ppm: gas.methane_ppm, lpg_ppm: gas.lpg_ppm, hazard: gas.hazard },
                ultrasonic: { front: ultrasonic.front, side: ultrasonic.side },
                battery: { voltage: battery.voltage, percent: battery.percent },
                wifi_rssi,
                ai: fusionResult,
                vision: {
                    detected: visionResult.detected,
                    personCount: visionResult.personCount,
                    maxConfidence: visionResult.maxConfidence,
                    cameraOnline: visionResult.cameraOnline
                },
                dashboard: latestData[0] || null,
                timestamp: new Date().toISOString()
            });
        }

        res.status(201).json({
            success: true,
            message: 'Telemetry data received and stored',
            rover_id,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Telemetry Error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to store telemetry data',
            details: error.message
        });
    }
});


/**
 * GET /api/telemetry/latest
 * 
 * Returns the latest sensor readings for a rover.
 * Used by the dashboard to get initial data on page load.
 * 
 * Query Params:
 *   ?rover_id=GZ-ROVER-01 (optional, defaults to GZ-ROVER-01)
 */
router.get('/latest', async (req, res) => {
    try {
        const roverId = req.query.rover_id || 'GZ-ROVER-01';

        // Get complete dashboard view data
        const [dashboard] = await pool.query(
            'SELECT * FROM v_realtime_dashboard WHERE rover_id = ?',
            [roverId]
        );

        // Get latest 20 thermal readings for chart
        const [thermalHistory] = await pool.query(
            `SELECT object_temp_c, ambient_temp_c, temp_delta, recorded_at 
             FROM thermal_readings 
             WHERE rover_id = ? 
             ORDER BY recorded_at DESC LIMIT 20`,
            [roverId]
        );

        // Get latest 20 gas readings for chart
        const [gasHistory] = await pool.query(
            `SELECT co_ppm, methane_ppm, lpg_ppm, hazard_level, recorded_at 
             FROM gas_readings 
             WHERE rover_id = ? 
             ORDER BY recorded_at DESC LIMIT 20`,
            [roverId]
        );

        // Get latest 20 ultrasonic readings for chart
        const [ultrasonicHistory] = await pool.query(
            `SELECT sensor_position, distance_cm, is_obstacle, recorded_at 
             FROM ultrasonic_readings 
             WHERE rover_id = ? 
             ORDER BY recorded_at DESC LIMIT 20`,
            [roverId]
        );

        res.json({
            success: true,
            data: {
                dashboard: dashboard[0] || null,
                history: {
                    thermal: thermalHistory.reverse(),
                    gas: gasHistory.reverse(),
                    ultrasonic: ultrasonicHistory.reverse()
                }
            }
        });

    } catch (error) {
        console.error('❌ Latest Telemetry Error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});


/**
 * GET /api/telemetry/history
 * 
 * Returns historical sensor data within a time range.
 * Used for trend analysis and mission review.
 * 
 * Query Params:
 *   ?rover_id=GZ-ROVER-01
 *   ?sensor=thermal|gas|ultrasonic  (required)
 *   ?minutes=60                     (last N minutes, default 60)
 *   ?limit=100                      (max records, default 100)
 */
router.get('/history', async (req, res) => {
    try {
        const roverId = req.query.rover_id || 'GZ-ROVER-01';
        const sensor = req.query.sensor || 'thermal';
        const minutes = parseInt(req.query.minutes) || 60;
        const limit = Math.min(parseInt(req.query.limit) || 100, 500);

        let query = '';
        switch (sensor) {
            case 'thermal':
                query = `SELECT id, ambient_temp_c, object_temp_c, temp_delta, 
                         is_body_heat, confidence, reading_quality, recorded_at
                         FROM thermal_readings 
                         WHERE rover_id = ? AND recorded_at >= NOW() - INTERVAL ? MINUTE
                         ORDER BY recorded_at DESC LIMIT ?`;
                break;
            case 'gas':
                query = `SELECT id, raw_adc_value, sensor_voltage, co_ppm, methane_ppm, 
                         lpg_ppm, hazard_level, reading_quality, recorded_at
                         FROM gas_readings 
                         WHERE rover_id = ? AND recorded_at >= NOW() - INTERVAL ? MINUTE
                         ORDER BY recorded_at DESC LIMIT ?`;
                break;
            case 'ultrasonic':
                query = `SELECT id, sensor_position, distance_cm, is_obstacle, 
                         reading_quality, recorded_at
                         FROM ultrasonic_readings 
                         WHERE rover_id = ? AND recorded_at >= NOW() - INTERVAL ? MINUTE
                         ORDER BY recorded_at DESC LIMIT ?`;
                break;
            default:
                return res.status(400).json({
                    success: false,
                    error: 'Invalid sensor type. Use: thermal, gas, or ultrasonic'
                });
        }

        const [rows] = await pool.query(query, [roverId, minutes, limit]);

        res.json({
            success: true,
            sensor,
            count: rows.length,
            data: rows.reverse()
        });

    } catch (error) {
        console.error('❌ History Error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
