// ============================================================================
// GridZero Server — Mission Routes
// ============================================================================
// Manages rescue mission lifecycle: create, start, pause, complete, abort.
//
// Endpoints:
//   GET  /api/mission          — List all missions
//   GET  /api/mission/:id      — Get specific mission details
//   POST /api/mission          — Create a new mission
//   PUT  /api/mission/:id/start — Start a mission
//   PUT  /api/mission/:id/pause — Pause a mission
//   PUT  /api/mission/:id/complete — Complete a mission
//   PUT  /api/mission/:id/abort — Abort a mission
// ============================================================================

const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');

/**
 * GET /api/mission
 * List all missions with summary data.
 */
router.get('/', async (req, res) => {
    try {
        const roverId = req.query.rover_id || 'GZ-ROVER-01';
        const status = req.query.status;

        let query = 'SELECT * FROM v_mission_summary WHERE rover_id = ?';
        const params = [roverId];

        if (status) {
            query = `SELECT * FROM mission_logs WHERE rover_id = ? AND status = ? ORDER BY created_at DESC`;
            params.push(status);
        }

        const [rows] = await pool.query(query, params);
        res.json({ success: true, count: rows.length, data: rows });

    } catch (error) {
        console.error('❌ Mission List Error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});


/**
 * GET /api/mission/active
 * Get the currently active mission.
 */
router.get('/active', async (req, res) => {
    try {
        const roverId = req.query.rover_id || 'GZ-ROVER-01';

        const [rows] = await pool.query(
            `SELECT * FROM mission_logs 
             WHERE rover_id = ? AND status = 'active' 
             LIMIT 1`,
            [roverId]
        );

        res.json({
            success: true,
            has_active_mission: rows.length > 0,
            data: rows[0] || null
        });

    } catch (error) {
        console.error('❌ Active Mission Error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});


/**
 * POST /api/mission
 * Create a new mission.
 * 
 * Body: { rover_id, mission_name, notes }
 */
router.post('/', async (req, res) => {
    try {
        const {
            rover_id = 'GZ-ROVER-01',
            mission_name = 'Rescue Operation',
            notes = null
        } = req.body;

        // Generate unique mission code
        const timestamp = Date.now().toString(36).toUpperCase();
        const missionCode = `MISSION-${new Date().getFullYear()}-${timestamp}`;

        const [result] = await pool.query(
            `INSERT INTO mission_logs (rover_id, mission_code, mission_name, status, notes)
             VALUES (?, ?, ?, 'planning', ?)`,
            [rover_id, missionCode, mission_name, notes]
        );

        const mission = {
            id: result.insertId,
            mission_code: missionCode,
            mission_name,
            status: 'planning',
            rover_id
        };

        // Broadcast mission creation
        if (req.app.get('io')) {
            req.app.get('io').emit('mission:created', mission);
        }

        res.status(201).json({ success: true, data: mission });

    } catch (error) {
        console.error('❌ Create Mission Error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});


/**
 * PUT /api/mission/:id/start
 * Start a mission — changes status to 'active'.
 */
router.put('/:id/start', async (req, res) => {
    try {
        const missionId = req.params.id;

        // Check no other active mission exists for this rover
        const [existing] = await pool.query(
            `SELECT rover_id FROM mission_logs WHERE id = ?`, [missionId]
        );
        if (existing.length === 0) {
            return res.status(404).json({ success: false, error: 'Mission not found' });
        }

        const roverId = existing[0].rover_id;

        const [active] = await pool.query(
            `SELECT id FROM mission_logs WHERE rover_id = ? AND status = 'active' AND id != ?`,
            [roverId, missionId]
        );
        if (active.length > 0) {
            return res.status(409).json({
                success: false,
                error: 'Another mission is already active. Complete or abort it first.'
            });
        }

        await pool.query(
            `UPDATE mission_logs SET status = 'active', started_at = NOW() WHERE id = ?`,
            [missionId]
        );

        // Create mission started alert
        await pool.query(
            `INSERT INTO alerts (rover_id, alert_type, severity, title, message)
             VALUES (?, 'mission_started', 'info', 'Mission Started', 
                     CONCAT('Mission #', ?, ' is now active.'))`,
            [roverId, missionId]
        );

        // Broadcast
        if (req.app.get('io')) {
            req.app.get('io').emit('mission:started', { mission_id: parseInt(missionId), rover_id: roverId });
        }

        res.json({ success: true, message: 'Mission started' });

    } catch (error) {
        console.error('❌ Start Mission Error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});


/**
 * PUT /api/mission/:id/complete
 * Complete a mission — saves final statistics.
 */
router.put('/:id/complete', async (req, res) => {
    try {
        const missionId = req.params.id;
        const { notes = null } = req.body;

        await pool.query(
            `UPDATE mission_logs SET 
                status = 'completed', 
                ended_at = NOW(),
                notes = COALESCE(?, notes)
             WHERE id = ?`,
            [notes, missionId]
        );

        const [mission] = await pool.query('SELECT * FROM mission_logs WHERE id = ?', [missionId]);

        // Create completion alert
        if (mission.length > 0) {
            await pool.query(
                `INSERT INTO alerts (rover_id, alert_type, severity, title, message)
                 VALUES (?, 'mission_completed', 'info', 'Mission Completed', 
                         CONCAT('Mission completed. Victims found: ', ?, ', Alerts: ', ?))`,
                [mission[0].rover_id, mission[0].victims_found, mission[0].alerts_triggered]
            );

            if (req.app.get('io')) {
                req.app.get('io').emit('mission:completed', mission[0]);
            }
        }

        res.json({ success: true, message: 'Mission completed', data: mission[0] || null });

    } catch (error) {
        console.error('❌ Complete Mission Error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});


/**
 * PUT /api/mission/:id/abort
 * Abort a mission.
 */
router.put('/:id/abort', async (req, res) => {
    try {
        const missionId = req.params.id;
        const { notes = 'Mission aborted by operator' } = req.body;

        await pool.query(
            `UPDATE mission_logs SET status = 'aborted', ended_at = NOW(), notes = ? WHERE id = ?`,
            [notes, missionId]
        );

        res.json({ success: true, message: 'Mission aborted' });

    } catch (error) {
        console.error('❌ Abort Mission Error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
