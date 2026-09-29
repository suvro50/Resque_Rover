// ============================================================================
// GridZero Server — Data Simulator
// ============================================================================
// Generates realistic fake sensor data for testing the entire system
// WITHOUT any hardware connected. Simulates:
//   - Thermal readings (with occasional "victim" heat signatures)
//   - Gas levels (with occasional hazard spikes)
//   - Ultrasonic distances (with obstacle encounters)
//   - Battery drain over time
//   - Periodic victim detections
//
// Usage:
//   Start: POST /api/simulator/start
//   Stop:  POST /api/simulator/stop
//   Status: GET /api/simulator/status
// ============================================================================

const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');

let simulatorInterval = null;
let simulationTick = 0;
let isRunning = false;

// Simulation parameters
const SIM_CONFIG = {
    intervalMs: 2000,        // Send data every 2 seconds (matches real ESP32)
    roverId: 'GZ-ROVER-01',
    
    // Battery simulation (4S LiPo: 16.4V full → 12.0V empty)
    battery: { voltage: 16.4, percent: 100, drainRate: 0.15 },
    
    // Baseline sensor values (randomized around these)
    thermal: { ambientBase: 28, objectBase: 29 },
    gas: { coBase: 2, methaneBase: 0.5, lpgBase: 0.2 },
    ultrasonic: { frontBase: 150, sideBase: 200 },
    
    // Event probabilities (per tick)
    victimProbability: 0.03,       // 3% chance per tick to detect a "victim"
    gasSpikeProbability: 0.02,     // 2% chance per tick for gas spike
    obstacleProbability: 0.08      // 8% chance per tick for obstacle
};

/**
 * Generate a random number with gaussian-like distribution around a center.
 */
function randomAround(center, spread) {
    const u1 = Math.random();
    const u2 = Math.random();
    const gaussian = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return parseFloat((center + gaussian * spread).toFixed(2));
}

/**
 * Generate one tick of simulated sensor data.
 */
function generateTelemetry() {
    simulationTick++;
    const cfg = SIM_CONFIG;
    
    // Battery drain (4S LiPo: 16.4V full, 12.0V cutoff)
    cfg.battery.voltage = Math.max(12.0, cfg.battery.voltage - (cfg.battery.drainRate * 0.01));
    cfg.battery.percent = Math.max(0, Math.round(((cfg.battery.voltage - 12.0) / (16.4 - 12.0)) * 100));
    
    // Detect if this tick has a "victim" nearby
    const isVictimNearby = Math.random() < cfg.victimProbability;
    const isGasSpike = Math.random() < cfg.gasSpikeProbability;
    const isObstacle = Math.random() < cfg.obstacleProbability;
    
    // Thermal data
    const ambientTemp = randomAround(cfg.thermal.ambientBase, 1.5);
    let objectTemp = randomAround(cfg.thermal.objectBase, 2.0);
    if (isVictimNearby) {
        // Simulate human body heat (35-38°C)
        objectTemp = randomAround(36.5, 1.0);
    }
    
    // Gas data
    let coPpm = randomAround(cfg.gas.coBase, 1.0);
    let methanePpm = randomAround(cfg.gas.methaneBase, 0.3);
    let lpgPpm = randomAround(cfg.gas.lpgBase, 0.1);
    let gasHazard = 'safe';
    
    if (isGasSpike) {
        coPpm = randomAround(80, 20);      // Dangerous CO level
        methanePpm = randomAround(15, 5);
        lpgPpm = randomAround(8, 3);
        gasHazard = coPpm > 100 ? 'critical' : coPpm > 50 ? 'high' : 'moderate';
    } else if (coPpm > 25) {
        gasHazard = 'low';
    }
    
    // Ensure non-negative values
    coPpm = Math.max(0, coPpm);
    methanePpm = Math.max(0, methanePpm);
    lpgPpm = Math.max(0, lpgPpm);
    
    const rawAdc = Math.round((coPpm / 200) * 4095);
    const sensorVoltage = parseFloat(((rawAdc / 4095) * 3.3).toFixed(3));
    
    // Ultrasonic data
    let frontDist = randomAround(cfg.ultrasonic.frontBase, 20);
    let sideDist = randomAround(cfg.ultrasonic.sideBase, 30);
    
    if (isObstacle) {
        frontDist = randomAround(15, 5);   // Close obstacle
    }
    
    frontDist = Math.max(2, Math.min(400, frontDist));
    sideDist = Math.max(2, Math.min(400, sideDist));
    
    return {
        rover_id: cfg.roverId,
        thermal: {
            ambient: ambientTemp,
            object: objectTemp
        },
        gas: {
            raw_adc: rawAdc,
            voltage: sensorVoltage,
            co_ppm: parseFloat(coPpm.toFixed(2)),
            methane_ppm: parseFloat(methanePpm.toFixed(2)),
            lpg_ppm: parseFloat(lpgPpm.toFixed(2)),
            hazard: gasHazard
        },
        ultrasonic: {
            front: parseFloat(frontDist.toFixed(2)),
            side: parseFloat(sideDist.toFixed(2)),
            side_position: 'left'
        },
        battery: {
            voltage: parseFloat(cfg.battery.voltage.toFixed(2)),
            percent: cfg.battery.percent
        },
        wifi_rssi: randomAround(-55, 10),
        _meta: {
            tick: simulationTick,
            isVictimNearby,
            isGasSpike,
            isObstacle
        }
    };
}

/**
 * Process one simulation tick — generate data, store, and broadcast.
 */
async function simulationStep(io) {
    try {
        const telemetry = generateTelemetry();
        
        // Call stored procedure to insert data (same as real ESP32 would)
        await pool.query('CALL sp_insert_telemetry(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
            telemetry.rover_id,
            telemetry.thermal.ambient,
            telemetry.thermal.object,
            telemetry.gas.raw_adc,
            telemetry.gas.voltage,
            telemetry.gas.co_ppm,
            telemetry.gas.methane_ppm,
            telemetry.gas.lpg_ppm,
            telemetry.gas.hazard,
            telemetry.ultrasonic.front,
            telemetry.ultrasonic.side,
            telemetry.ultrasonic.side_position,
            telemetry.battery.voltage,
            telemetry.battery.percent,
            telemetry.wifi_rssi
        ]);
        
        // Get dashboard view for broadcast
        const [dashData] = await pool.query(
            'SELECT * FROM v_realtime_dashboard WHERE rover_id = ?',
            [telemetry.rover_id]
        );
        
        // Broadcast via WebSocket
        if (io) {
            io.emit('telemetry:update', {
                ...telemetry,
                dashboard: dashData[0] || null,
                timestamp: new Date().toISOString()
            });
        }
        
        // Simulate victim detection on special ticks
        if (telemetry._meta.isVictimNearby && telemetry.thermal.object >= 34) {
            const confidence = randomAround(78, 12);
            const detectionType = confidence > 70 ? 'alive' : 'uncertain';
            
            await pool.query(
                `INSERT INTO victim_detections 
                 (rover_id, detection_type, confidence_score, thermal_temp_c, thermal_delta,
                  gas_hazard_level, front_distance_cm, fusion_method, priority_level)
                 VALUES (?, ?, ?, ?, ?, ?, ?, 'multi_sensor', ?)`,
                [
                    telemetry.rover_id,
                    detectionType,
                    Math.min(99, Math.max(10, confidence)),
                    telemetry.thermal.object,
                    parseFloat((telemetry.thermal.object - telemetry.thermal.ambient).toFixed(2)),
                    telemetry.gas.hazard,
                    telemetry.ultrasonic.front,
                    detectionType === 'alive' ? 'critical' : 'medium'
                ]
            );
            
            if (io) {
                io.emit('victim:detected', {
                    rover_id: telemetry.rover_id,
                    detection_type: detectionType,
                    confidence_score: Math.min(99, Math.max(10, confidence)),
                    thermal_temp_c: telemetry.thermal.object,
                    timestamp: new Date().toISOString()
                });
            }
            
            console.log(`🎯 Simulated victim detection: ${detectionType} (${confidence.toFixed(1)}%)`);
        }
        
        // Log every 10th tick
        if (simulationTick % 10 === 0) {
            console.log(`📡 Sim tick #${simulationTick} | Temp: ${telemetry.thermal.object}°C | CO: ${telemetry.gas.co_ppm}ppm | Front: ${telemetry.ultrasonic.front}cm | Battery: ${telemetry.battery.percent}%`);
        }
        
    } catch (error) {
        console.error('❌ Simulation step error:', error.message);
    }
}


// ── API Routes ───────────────────────────────────────────────────────────

/**
 * POST /api/simulator/start
 * Start the data simulator.
 */
router.post('/start', (req, res) => {
    if (isRunning) {
        return res.json({ success: false, message: 'Simulator already running' });
    }
    
    const io = req.app.get('io');
    
    // Reset simulation state
    simulationTick = 0;
    SIM_CONFIG.battery.voltage = 16.4;
    SIM_CONFIG.battery.percent = 100;
    isRunning = true;
    
    simulatorInterval = setInterval(() => simulationStep(io), SIM_CONFIG.intervalMs);
    
    console.log('🚀 Data Simulator STARTED (sending data every 2s)');
    
    res.json({
        success: true,
        message: 'Simulator started — sending data every 2 seconds',
        config: {
            interval: SIM_CONFIG.intervalMs,
            rover_id: SIM_CONFIG.roverId
        }
    });
});

/**
 * POST /api/simulator/stop
 * Stop the data simulator.
 */
router.post('/stop', (req, res) => {
    if (!isRunning) {
        return res.json({ success: false, message: 'Simulator is not running' });
    }
    
    clearInterval(simulatorInterval);
    simulatorInterval = null;
    isRunning = false;
    
    console.log(`⏹️ Data Simulator STOPPED (${simulationTick} ticks completed)`);
    
    res.json({
        success: true,
        message: `Simulator stopped after ${simulationTick} ticks`,
        total_ticks: simulationTick
    });
});

/**
 * GET /api/simulator/status
 * Check simulator status.
 */
router.get('/status', (req, res) => {
    res.json({
        success: true,
        is_running: isRunning,
        tick_count: simulationTick,
        battery: SIM_CONFIG.battery,
        interval_ms: SIM_CONFIG.intervalMs
    });
});

module.exports = router;
