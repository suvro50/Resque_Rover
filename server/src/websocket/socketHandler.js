// ============================================================================
// GridZero Server — WebSocket Handler (Socket.IO)
// ============================================================================
// Manages real-time bidirectional communication between:
//   - Server ↔ Dashboard UI (telemetry updates, alerts, rover control)
//   - Server ↔ ESP32 (commands, mode changes)
//
// Events Emitted (Server → Client):
//   telemetry:update    — New sensor data received
//   rover:status        — Rover status change
//   rover:command       — Motor command sent
//   rover:mode          — Operation mode changed
//   alert:new           — New alert triggered
//   alert:acknowledged  — Alert was acknowledged
//   victim:detected     — New victim detection
//   mission:started     — Mission started
//   mission:completed   — Mission completed
//
// Events Received (Client → Server):
//   rover:send-command  — Dashboard sends motor command
//   rover:set-mode      — Dashboard changes rover mode
//   alert:acknowledge   — Dashboard acknowledges an alert
// ============================================================================

const { pool } = require('../config/database');
const { getRoverState, setRoverActive, setRoverCommand } = require('../utils/roverState');

/**
 * Initialize WebSocket event handlers for a Socket.IO server instance.
 * @param {import('socket.io').Server} io - The Socket.IO server instance
 */
function initializeWebSocket(io) {
    // Track connected clients
    let connectedClients = 0;

    io.on('connection', (socket) => {
        connectedClients++;
        console.log(`🔌 Client connected: ${socket.id} (Total: ${connectedClients})`);

        // Send initial data to newly connected client
        sendInitialData(socket);

        // ── Handle incoming events from dashboard ─────────────────────

        /**
         * Dashboard starts or stops rover operation.
         * { rover_id: "GZ-ROVER-01", start: true|false }
         */
        socket.on('rover:start-stop', async (data) => {
            try {
                const { rover_id = 'GZ-ROVER-01', start = true } = data;
                const state = setRoverActive(rover_id, start);

                await pool.query(
                    'UPDATE rover_status SET operation_mode = ?, motor_left_speed = 0, motor_right_speed = 0 WHERE rover_id = ?',
                    [state.operation_mode, rover_id]
                );

                io.emit('rover:start-stop', {
                    rover_id,
                    is_active: state.is_active,
                    operation_mode: state.operation_mode,
                    command: 'stop',
                    timestamp: new Date().toISOString()
                });

                io.emit('rover:command', {
                    rover_id,
                    command: 'stop',
                    speed: 0,
                    motor_left: 0,
                    motor_right: 0,
                    is_active: state.is_active,
                    timestamp: new Date().toISOString()
                });

                console.log(`⚡ WebSocket Rover ${rover_id} ${start ? 'STARTED (Active)' : 'STOPPED (Locked)'}`);
            } catch (error) {
                console.error('❌ WebSocket start-stop error:', error.message);
                socket.emit('error', { message: error.message });
            }
        });

        /**
         * Dashboard sends a motor control command (forward/backward/left/right/stop).
         * { command: "forward"|"backward"|"left"|"right"|"stop", speed: 0-255 }
         */
        socket.on('rover:send-command', async (data) => {
            try {
                const { rover_id = 'GZ-ROVER-01', command = 'stop', speed = 200 } = data;

                const result = setRoverCommand(rover_id, command, speed);
                if (!result.success) {
                    console.log(`⚠️ Ignored command '${command}': ${result.error}`);
                    socket.emit('rover:command-rejected', { reason: result.error });
                    return;
                }

                const state = result.state;

                await pool.query(
                    'UPDATE rover_status SET motor_left_speed = ?, motor_right_speed = ? WHERE rover_id = ?',
                    [state.motor_left_speed, state.motor_right_speed, rover_id]
                );

                // Broadcast to all clients (including ESP32 if connected)
                io.emit('rover:command', {
                    rover_id,
                    command: state.command,
                    speed: state.speed,
                    motor_left: state.motor_left_speed,
                    motor_right: state.motor_right_speed,
                    is_active: state.is_active,
                    timestamp: new Date().toISOString()
                });

                console.log(`🎮 Command: ${command} (L: ${state.motor_left_speed}, R: ${state.motor_right_speed})`);
            } catch (error) {
                console.error('❌ WebSocket command error:', error.message);
                socket.emit('error', { message: error.message });
            }
        });

        /**
         * Dashboard changes rover operation mode.
         * { mode: "idle"|"autonomous"|"manual"|"returning"|"emergency_stop" }
         */
        socket.on('rover:set-mode', async (data) => {
            try {
                const { rover_id = 'GZ-ROVER-01', mode = 'idle' } = data;
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
                        `UPDATE rover_status SET operation_mode = 'emergency_stop', 
                         motor_left_speed = 0, motor_right_speed = 0 WHERE rover_id = ?`,
                        [rover_id]
                    );
                } else {
                    await pool.query(
                        'UPDATE rover_status SET operation_mode = ? WHERE rover_id = ?',
                        [mode, rover_id]
                    );
                }

                io.emit('rover:mode', {
                    rover_id,
                    mode,
                    is_active: state.is_active,
                    timestamp: new Date().toISOString()
                });
                console.log(`⚙️ Mode changed: ${mode}`);
            } catch (error) {
                console.error('❌ WebSocket mode error:', error.message);
                socket.emit('error', { message: error.message });
            }
        });

        /**
         * Dashboard acknowledges an alert.
         * { alert_id: 123, acknowledged_by: "Operator" }
         */
        socket.on('alert:acknowledge', async (data) => {
            try {
                const { alert_id, acknowledged_by = 'Operator' } = data;

                await pool.query(
                    `UPDATE alerts SET is_acknowledged = TRUE, acknowledged_at = NOW(), 
                     acknowledged_by = ? WHERE id = ?`,
                    [acknowledged_by, alert_id]
                );

                io.emit('alert:acknowledged', {
                    alert_id, acknowledged_by,
                    timestamp: new Date().toISOString()
                });
            } catch (error) {
                console.error('❌ WebSocket ack error:', error.message);
            }
        });

        // ── Handle disconnect ─────────────────────────────────────────

        socket.on('disconnect', () => {
            connectedClients--;
            console.log(`🔌 Client disconnected: ${socket.id} (Total: ${connectedClients})`);
        });
    });

    // ── Heartbeat monitor — check rover connection every 15 seconds ────

    setInterval(async () => {
        try {
            const [rovers] = await pool.query(
                `SELECT rover_id FROM rover_status 
                 WHERE is_online = TRUE 
                 AND last_heartbeat < NOW() - INTERVAL 30 SECOND`
            );

            for (const rover of rovers) {
                await pool.query('CALL sp_rover_offline(?)', [rover.rover_id]);
                io.emit('rover:status', {
                    rover_id: rover.rover_id,
                    is_online: false,
                    timestamp: new Date().toISOString()
                });
                console.log(`⚠️ Rover ${rover.rover_id} marked offline (no heartbeat)`);
            }
        } catch (error) {
            // Silently handle — heartbeat check is non-critical
        }
    }, 15000);

    console.log('✅ WebSocket (Socket.IO) initialized');
}

/**
 * Send initial dashboard data to a newly connected client.
 */
async function sendInitialData(socket) {
    try {
        const [dashboard] = await pool.query(
            'SELECT * FROM v_realtime_dashboard WHERE rover_id = ?',
            ['GZ-ROVER-01']
        );

        const [alerts] = await pool.query(
            'SELECT * FROM v_active_alerts WHERE rover_id = ? LIMIT 20',
            ['GZ-ROVER-01']
        );

        const [mission] = await pool.query(
            `SELECT * FROM mission_logs WHERE rover_id = 'GZ-ROVER-01' 
             AND status = 'active' LIMIT 1`
        );

        socket.emit('initial:data', {
            dashboard: dashboard[0] || null,
            active_alerts: alerts,
            active_mission: mission[0] || null,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ Initial data error:', error.message);
    }
}

module.exports = { initializeWebSocket };
