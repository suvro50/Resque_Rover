// ============================================================================
// GridZero Server — Alert Routes
// ============================================================================
// Manages real-time alerts for gas leaks, victim detection, battery warnings,
// connection loss, and other critical events.
//
// Endpoints:
//   GET  /api/alerts          — Get all alerts (with filters)
//   GET  /api/alerts/active   — Get unacknowledged alerts only
//   POST /api/alerts          — Create a new alert manually
//   PUT  /api/alerts/:id/ack  — Acknowledge an alert
//   PUT  /api/alerts/ack-all  — Acknowledge all alerts for a rover
// ============================================================================

const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');

/**
 * GET /api/alerts
 * Returns alerts with optional filtering.
 * 
 * Query Params:
 *   ?rover_id=GZ-ROVER-01
 *   ?severity=critical|danger|warning|info
 *   ?type=gas_leak_critical|victim_detected_alive|...
 *   ?acknowledged=true|false
 *   ?limit=50
 */
router.get('/', async (req, res) => {
    try {
        const roverId = req.query.rover_id || 'GZ-ROVER-01';
        const severity = req.query.severity;
        const type = req.query.type;
        const acknowledged = req.query.acknowledged;
        const limit = Math.min(parseInt(req.query.limit) || 50, 200);

        let query = 'SELECT * FROM alerts WHERE rover_id = ?';
        const params = [roverId];

        if (severity) {
            query += ' AND severity = ?';
            params.push(severity);
        }
        if (type) {
            query += ' AND alert_type = ?';
            params.push(type);
        }
        if (acknowledged !== undefined) {
            query += ' AND is_acknowledged = ?';
            params.push(acknowledged === 'true' ? 1 : 0);
        }

        query += ' ORDER BY triggered_at DESC LIMIT ?';
        params.push(limit);

        const [rows] = await pool.query(query, params);

        res.json({
            success: true,
            count: rows.length,
            data: rows
        });

    } catch (error) {
        console.error('❌ Alerts Error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});


/**
 * GET /api/alerts/active
 * Returns only unacknowledged alerts, sorted by severity.
 * Used by the dashboard alert panel.
 */
router.get('/active', async (req, res) => {
    try {
        const roverId = req.query.rover_id || 'GZ-ROVER-01';

        const [rows] = await pool.query(
            `SELECT * FROM v_active_alerts WHERE rover_id = ?`,
            [roverId]
        );

        // Count by severity
        const counts = {
            critical: rows.filter(r => r.severity === 'critical').length,
            danger: rows.filter(r => r.severity === 'danger').length,
            warning: rows.filter(r => r.severity === 'warning').length,
            info: rows.filter(r => r.severity === 'info').length
        };

        res.json({
            success: true,
            total: rows.length,
            counts,
            data: rows
        });

    } catch (error) {
        console.error('❌ Active Alerts Error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});


/**
 * POST /api/alerts
 * Create a new alert manually (e.g., from dashboard operator).
 * 
 * Body: { rover_id, alert_type, severity, title, message, context_data }
 */
router.post('/', async (req, res) => {
    try {
        const {
            rover_id = 'GZ-ROVER-01',
            alert_type,
            severity = 'info',
            title,
            message,
            context_data = null
        } = req.body;

        if (!alert_type || !title || !message) {
            return res.status(400).json({
                success: false,
                error: 'alert_type, title, and message are required'
            });
        }

        const [result] = await pool.query(
            `INSERT INTO alerts (rover_id, alert_type, severity, title, message, context_data)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [rover_id, alert_type, severity, title, message,
             context_data ? JSON.stringify(context_data) : null]
        );

        const newAlert = {
            id: result.insertId,
            rover_id,
            alert_type,
            severity,
            title,
            message,
            context_data,
            triggered_at: new Date().toISOString()
        };

        // Broadcast new alert via WebSocket
        if (req.app.get('io')) {
            req.app.get('io').emit('alert:new', newAlert);
        }

        res.status(201).json({
            success: true,
            message: 'Alert created',
            data: newAlert
        });

    } catch (error) {
        console.error('❌ Create Alert Error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});


/**
 * PUT /api/alerts/:id/ack
 * Acknowledge a specific alert.
 * 
 * Body: { acknowledged_by: "Operator Name" }
 */
router.put('/:id/ack', async (req, res) => {
    try {
        const alertId = req.params.id;
        const { acknowledged_by = 'Operator' } = req.body;

        const [result] = await pool.query(
            `UPDATE alerts SET 
                is_acknowledged = TRUE,
                acknowledged_at = NOW(),
                acknowledged_by = ?
             WHERE id = ? AND is_acknowledged = FALSE`,
            [acknowledged_by, alertId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                error: 'Alert not found or already acknowledged'
            });
        }

        // Broadcast acknowledgement
        if (req.app.get('io')) {
            req.app.get('io').emit('alert:acknowledged', {
                alert_id: parseInt(alertId),
                acknowledged_by,
                timestamp: new Date().toISOString()
            });
        }

        res.json({ success: true, message: 'Alert acknowledged' });

    } catch (error) {
        console.error('❌ Acknowledge Error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});


/**
 * PUT /api/alerts/ack-all
 * Acknowledge ALL active alerts for a rover.
 * 
 * Body: { rover_id, acknowledged_by }
 */
router.put('/ack-all', async (req, res) => {
    try {
        const { rover_id = 'GZ-ROVER-01', acknowledged_by = 'Operator' } = req.body;

        const [result] = await pool.query(
            `UPDATE alerts SET 
                is_acknowledged = TRUE,
                acknowledged_at = NOW(),
                acknowledged_by = ?
             WHERE rover_id = ? AND is_acknowledged = FALSE`,
            [acknowledged_by, rover_id]
        );

        // Broadcast bulk acknowledgement
        if (req.app.get('io')) {
            req.app.get('io').emit('alert:all-acknowledged', {
                rover_id,
                count: result.affectedRows,
                timestamp: new Date().toISOString()
            });
        }

        res.json({
            success: true,
            message: `${result.affectedRows} alerts acknowledged`
        });

    } catch (error) {
        console.error('❌ Acknowledge All Error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
