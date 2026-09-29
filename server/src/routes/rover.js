// ============================================================================
// GridZero Server — Rover Status & Control Routes
// ============================================================================
// Manages rover operational state, START/STOP toggle, and 4-way direction control.
//
// Endpoints:
//   GET  /api/rover/status     — Get complete rover status (includes speeds & active state)
//   GET  /api/rover/command    — Fast lightweight endpoint for ESP32 polling
//   POST /api/rover/status     — Update rover status (heartbeat from ESP32)
//   POST /api/rover/start-stop — Start or stop rover operation
//   POST /api/rover/command    — Send 4-direction command (forward/backward/left/right/stop)
//   POST /api/rover/mode       — Change rover operation mode
// ============================================================================

const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { getRoverState, setRoverActive, setRoverCommand } = require('../utils/roverState');

/**
 * GET /api/rover/status
 * Returns current status of a rover including connection quality,
 * motor speeds, active state, and current command.
 */
router.get('/status', async (req, res) => {
    try {
        const roverId = req.query.rover_id || 'GZ-ROVER-01';
        const memState = getRoverState(roverId);

        const [rows] = await pool.query(
            `SELECT rs.*,
                    TIMESTAMPDIFF(SECOND, rs.last_heartbeat, NOW()) AS seconds_since_heartbeat,
                    CASE 
                        WHEN TIMESTAMPDIFF(SECOND, rs.last_heartbeat, NOW()) > 30 THEN 'disconnected'
                        WHEN TIMESTAMPDIFF(SECOND, rs.last_heartbeat, NOW()) > 10 THEN 'unstable'
                        ELSE 'connected'
                    END AS connection_quality
             FROM rover_status rs WHERE rs.rover_id = ?`,
            [roverId]
        );

        if (rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: `Rover '${roverId}' not found`
            });
        }

        const dbRow = rows[0];

        // Merge DB data with memory state (speed, active state, command)
        const mergedData = {
            ...dbRow,
            is_active: memState.is_active,
            command: memState.command,
            motor_left_speed: memState.motor_left_speed,
            motor_right_speed: memState.motor_right_speed,
            operation_mode: memState.operation_mode || dbRow.operation_mode
        };

        res.json({ success: true, data: mergedData });

    } catch (error) {
        console.error('❌ Rover Status Error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});


/**
 * GET /api/rover/command
 * Fast lightweight endpoint specifically for ESP32 polling.
 */
router.get('/command', (req, res) => {
    const roverId = req.query.rover_id || 'GZ-ROVER-01';
    const state = getRoverState(roverId);
    res.json({
        success: true,
        data: {
            rover_id: state.rover_id,
            is_active: state.is_active,
            command: state.command,
            speed: state.speed,
            motor_left_speed: state.motor_left_speed,
            motor_right_speed: state.motor_right_speed,
            operation_mode: state.operation_mode
        }
    });
});


/**
 * GET /api/rover/list
 * Returns all registered rovers.
 */
router.get('/list', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM rover_status');
        res.json({ success: true, count: rows.length, data: rows });
    } catch (error) {
        console.error('❌ Rover List Error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});


/**
 * POST /api/rover/status
 * Updates rover status — used as heartbeat from ESP32.
 * 
 * Body: { rover_id, ip_address, battery_voltage, battery_percent, wifi_rssi }
 */
router.post('/status', async (req, res) => {
    try {
        const {
            rover_id = 'GZ-ROVER-01',
            ip_address = null,
            battery_voltage = null,
            battery_percent = null,
            wifi_rssi = null
        } = req.body;

        await pool.query(
            `UPDATE rover_status SET 
                is_online = TRUE,
                ip_address = COALESCE(?, ip_address),
                battery_voltage = COALESCE(?, battery_voltage),
                battery_percent = COALESCE(?, battery_percent),
                wifi_rssi = COALESCE(?, wifi_rssi),
                last_heartbeat = NOW()
             WHERE rover_id = ?`,
            [ip_address, battery_voltage, battery_percent, wifi_rssi, rover_id]
        );

        // Broadcast status update via WebSocket
        if (req.app.get('io')) {
            req.app.get('io').emit('rover:status', {
                rover_id,
                is_online: true,
                battery_voltage,
                battery_percent,
                wifi_rssi,
                timestamp: new Date().toISOString()
            });
        }

        res.json({ success: true, message: 'Rover status updated' });

    } catch (error) {
        console.error('❌ Rover Update Error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});


/**
 * POST /api/rover/start-stop
 * Starts or Stops the rover.
 * If stopped: all motors immediately halt, buttons lock, commands ignored.
 * If started: rover is ready for run, directional buttons unlocked.
 * 
 * Body: { rover_id, start: true|false }
 */
router.post('/start-stop', async (req, res) => {
    try {
        const { rover_id = 'GZ-ROVER-01', start = true } = req.body;
        const state = setRoverActive(rover_id, start);

        // Persist mode & zero motors in DB
        await pool.query(
            `UPDATE rover_status SET 
                operation_mode = ?,
                motor_left_speed = 0,
                motor_right_speed = 0
             WHERE rover_id = ?`,
            [state.operation_mode, rover_id]
        );

        // Broadcast to WebSocket clients
        if (req.app.get('io')) {
            req.app.get('io').emit('rover:start-stop', {
                rover_id,
                is_active: state.is_active,
                operation_mode: state.operation_mode,
                command: 'stop',
                timestamp: new Date().toISOString()
            });

            req.app.get('io').emit('rover:command', {
                rover_id,
                command: 'stop',
                speed: 0,
                motor_left: 0,
                motor_right: 0,
                is_active: state.is_active,
                timestamp: new Date().toISOString()
            });
        }

        console.log(`⚡ Rover ${rover_id} ${start ? 'STARTED (Armed)' : 'STOPPED (Locked)'}`);

        res.json({
            success: true,
            message: start ? 'Rover started & ready for run' : 'Rover stopped & controls locked',
            data: state
        });
    } catch (error) {
        console.error('❌ Rover Start-Stop Error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});


/**
 * POST /api/rover/command
 * Sends a motor control command to the rover (forward, backward, left, right, stop).
 * 
 * Body: { rover_id, command: "forward"|"backward"|"left"|"right"|"stop", speed: 0-255 }
 */
router.post('/command', async (req, res) => {
    try {
        const {
            rover_id = 'GZ-ROVER-01',
            command = 'stop',
            speed = 200
        } = req.body;

        const validCommands = ['forward', 'backward', 'left', 'right', 'stop'];
        if (!validCommands.includes(command)) {
            return res.status(400).json({
                success: false,
                error: `Invalid command. Use: ${validCommands.join(', ')}`
            });
        }

        const result = setRoverCommand(rover_id, command, speed);
        if (!result.success) {
            return res.status(403).json({
                success: false,
                error: result.error
            });
        }

        const state = result.state;

        // Update database
        await pool.query(
            `UPDATE rover_status SET 
                motor_left_speed = ?,
                motor_right_speed = ?
             WHERE rover_id = ?`,
            [state.motor_left_speed, state.motor_right_speed, rover_id]
        );

        // Broadcast command via WebSocket
        if (req.app.get('io')) {
            req.app.get('io').emit('rover:command', {
                rover_id,
                command,
                speed: state.speed,
                motor_left: state.motor_left_speed,
                motor_right: state.motor_right_speed,
                is_active: state.is_active,
                timestamp: new Date().toISOString()
            });
        }

        res.json({
            success: true,
            message: `Command '${command}' applied`,
            motor: { left: state.motor_left_speed, right: state.motor_right_speed }
        });

    } catch (error) {
        console.error('❌ Rover Command Error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});


/**
 * POST /api/rover/mode
 * Changes the rover's operation mode.
 * 
 * Body: { rover_id, mode: "idle"|"autonomous"|"manual"|"returning"|"emergency_stop" }
 */
router.post('/mode', async (req, res) => {
    try {
        const { rover_id = 'GZ-ROVER-01', mode = 'idle' } = req.body;

        const validModes = ['idle', 'autonomous', 'manual', 'returning', 'emergency_stop'];
        if (!validModes.includes(mode)) {
            return res.status(400).json({
                success: false,
                error: `Invalid mode. Use: ${validModes.join(', ')}`
            });
        }

        const state = getRoverState(rover_id);
        state.operation_mode = mode;

        if (mode === 'emergency_stop' || mode === 'idle') {
            state.is_active = false;
            state.command = 'stop';
            state.motor_left_speed = 0;
            state.motor_right_speed = 0;
        } else if (mode === 'manual' || mode === 'autonomous') {
            state.is_active = true;
        }

        if (mode === 'emergency_stop') {
            await pool.query(
                `UPDATE rover_status SET 
                    operation_mode = 'emergency_stop',
                    motor_left_speed = 0,
                    motor_right_speed = 0
                 WHERE rover_id = ?`,
                [rover_id]
            );

            await pool.query(
                `INSERT INTO alerts (rover_id, alert_type, severity, title, message)
                 VALUES (?, 'emergency_stop', 'critical', 'EMERGENCY STOP ACTIVATED', 
                         'Rover motors halted immediately by operator command.')`,
                [rover_id]
            );
        } else {
            await pool.query(
                'UPDATE rover_status SET operation_mode = ? WHERE rover_id = ?',
                [mode, rover_id]
            );
        }

        // Broadcast mode change
        if (req.app.get('io')) {
            req.app.get('io').emit('rover:mode', {
                rover_id,
                mode,
                is_active: state.is_active,
                timestamp: new Date().toISOString()
            });
        }

        res.json({
            success: true,
            message: `Rover mode changed to '${mode}'`
        });

    } catch (error) {
        console.error('❌ Mode Change Error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
