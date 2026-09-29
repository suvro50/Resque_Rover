// ============================================================================
// GridZero Server — Victim Detection Routes
// ============================================================================
// Manages AI-driven victim detection results from multi-sensor fusion.
//
// Endpoints:
//   GET  /api/victims          — List all detections
//   GET  /api/victims/stats    — Detection statistics
//   POST /api/victims          — Record new detection
//   PUT  /api/victims/:id/review — Human review of a detection
// ============================================================================

const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');

/**
 * GET /api/victims
 * List victim detections with optional filters.
 */
router.get('/', async (req, res) => {
    try {
        const roverId = req.query.rover_id || 'GZ-ROVER-01';
        const type = req.query.type; // alive, deceased, uncertain
        const reviewed = req.query.reviewed;
        const limit = Math.min(parseInt(req.query.limit) || 50, 200);

        let query = 'SELECT * FROM victim_detections WHERE rover_id = ?';
        const params = [roverId];

        if (type) {
            query += ' AND detection_type = ?';
            params.push(type);
        }
        if (reviewed !== undefined) {
            query += ' AND is_reviewed = ?';
            params.push(reviewed === 'true' ? 1 : 0);
        }

        query += ' ORDER BY detected_at DESC LIMIT ?';
        params.push(limit);

        const [rows] = await pool.query(query, params);
        res.json({ success: true, count: rows.length, data: rows });

    } catch (error) {
        console.error('❌ Victims Error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});


/**
 * GET /api/victims/stats
 * Returns detection statistics for the dashboard.
 */
router.get('/stats', async (req, res) => {
    try {
        const roverId = req.query.rover_id || 'GZ-ROVER-01';

        const [stats] = await pool.query(
            `SELECT 
                COUNT(*) AS total_detections,
                SUM(detection_type = 'alive') AS alive_count,
                SUM(detection_type = 'deceased') AS deceased_count,
                SUM(detection_type = 'uncertain') AS uncertain_count,
                SUM(detection_type = 'false_positive') AS false_positive_count,
                SUM(is_reviewed = FALSE) AS pending_review,
                AVG(confidence_score) AS avg_confidence,
                MAX(detected_at) AS last_detection
             FROM victim_detections
             WHERE rover_id = ?`,
            [roverId]
        );

        res.json({ success: true, data: stats[0] });

    } catch (error) {
        console.error('❌ Victim Stats Error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});


/**
 * POST /api/victims
 * Record a new victim detection (from AI sensor fusion).
 * 
 * Body: {
 *   rover_id, detection_type, confidence_score,
 *   thermal_temp_c, thermal_delta, gas_hazard_level,
 *   front_distance_cm, fusion_method, fusion_details,
 *   snapshot_url, priority_level
 * }
 */
router.post('/', async (req, res) => {
    try {
        const {
            rover_id = 'GZ-ROVER-01',
            detection_type,
            confidence_score = 0,
            thermal_temp_c = null,
            thermal_delta = null,
            gas_hazard_level = null,
            front_distance_cm = null,
            fusion_method = 'multi_sensor',
            fusion_details = null,
            snapshot_url = null,
            priority_level = 'medium'
        } = req.body;

        if (!detection_type) {
            return res.status(400).json({
                success: false,
                error: 'detection_type is required (alive, deceased, uncertain, false_positive)'
            });
        }

        const [result] = await pool.query(
            `INSERT INTO victim_detections 
             (rover_id, detection_type, confidence_score, thermal_temp_c, thermal_delta,
              gas_hazard_level, front_distance_cm, fusion_method, fusion_details,
              snapshot_url, priority_level)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [rover_id, detection_type, confidence_score, thermal_temp_c, thermal_delta,
             gas_hazard_level, front_distance_cm, fusion_method,
             fusion_details ? JSON.stringify(fusion_details) : null,
             snapshot_url, priority_level]
        );

        // Update mission stats
        await pool.query(
            `UPDATE mission_logs SET 
                victims_found = victims_found + 1,
                victims_alive = victims_alive + IF(? = 'alive', 1, 0)
             WHERE rover_id = ? AND status = 'active'`,
            [detection_type, rover_id]
        );

        // Auto-create alert for victim detection
        const severityMap = {
            'alive': 'critical',
            'deceased': 'danger',
            'uncertain': 'warning',
            'false_positive': 'info'
        };

        const alertTypeMap = {
            'alive': 'victim_detected_alive',
            'deceased': 'victim_detected_deceased',
            'uncertain': 'victim_detected_uncertain'
        };

        if (alertTypeMap[detection_type]) {
            await pool.query(
                `INSERT INTO alerts (rover_id, alert_type, severity, title, message, 
                 victim_detection_id, context_data)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [
                    rover_id,
                    alertTypeMap[detection_type],
                    severityMap[detection_type],
                    `Victim Detected — ${detection_type.toUpperCase()} (${confidence_score}% confidence)`,
                    `Sensor fusion detected a ${detection_type} victim. Temperature: ${thermal_temp_c || 'N/A'}°C, Delta: ${thermal_delta || 'N/A'}°C, Distance: ${front_distance_cm || 'N/A'}cm`,
                    result.insertId,
                    JSON.stringify({ thermal_temp_c, thermal_delta, gas_hazard_level, front_distance_cm, confidence_score })
                ]
            );
        }

        const detection = {
            id: result.insertId,
            rover_id,
            detection_type,
            confidence_score,
            priority_level,
            detected_at: new Date().toISOString()
        };

        // Broadcast victim detection via WebSocket
        if (req.app.get('io')) {
            req.app.get('io').emit('victim:detected', detection);
        }

        res.status(201).json({ success: true, message: 'Victim detection recorded', data: detection });

    } catch (error) {
        console.error('❌ Victim Detection Error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});


/**
 * PUT /api/victims/:id/review
 * Human operator reviews and confirms/denies a detection.
 * 
 * Body: { reviewer_notes, confirmed_type: "alive"|"deceased"|"false_positive" }
 */
router.put('/:id/review', async (req, res) => {
    try {
        const detectionId = req.params.id;
        const { reviewer_notes = '', confirmed_type = null } = req.body;

        const updates = ['is_reviewed = TRUE', 'reviewed_at = NOW()'];
        const params = [];

        if (reviewer_notes) {
            updates.push('reviewer_notes = ?');
            params.push(reviewer_notes);
        }
        if (confirmed_type) {
            updates.push('detection_type = ?');
            params.push(confirmed_type);
        }

        params.push(detectionId);

        await pool.query(
            `UPDATE victim_detections SET ${updates.join(', ')} WHERE id = ?`,
            params
        );

        // Broadcast review update
        if (req.app.get('io')) {
            req.app.get('io').emit('victim:reviewed', {
                detection_id: parseInt(detectionId),
                confirmed_type,
                timestamp: new Date().toISOString()
            });
        }

        res.json({ success: true, message: 'Detection reviewed' });

    } catch (error) {
        console.error('❌ Review Error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
