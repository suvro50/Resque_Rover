// ============================================================================
// GridZero Dashboard — Main Application Logic
// ============================================================================
// Real-time dashboard with WebSocket, live charts, and rover control.
// Connects to the Node.js backend via Socket.IO for instant updates.
// ============================================================================

// ── State ────────────────────────────────────────────────────────────────────
const API_BASE = window.location.origin;
let socket = null;
let liveChart = null;
let currentChartType = 'thermal';
let simulatorRunning = false;
let missionTimer = null;
let missionStartTime = null;
let activeMissionId = null;

// Chart data buffers (max 30 points)
const MAX_POINTS = 30;
const chartData = {
    labels: [],
    thermal: { ambient: [], object: [] },
    gas: { co: [], methane: [], lpg: [] },
    distance: { front: [], side: [] }
};

// ── Initialize ───────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    initClock();
    initWebSocket();
    initChart();
    initKeyboardControls();
    initSensorPolling();
    initCameraStream();
    loadInitialData();
    console.log('🚀 GridZero Dashboard initialized');
});

// ── Clock ────────────────────────────────────────────────────────────────────
function initClock() {
    function updateClock() {
        const now = new Date();
        const time = now.toLocaleTimeString('en-US', { hour12: false });
        const date = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        document.getElementById('headerClock').textContent = `${date} • ${time}`;
    }
    updateClock();
    setInterval(updateClock, 1000);
}

// ── WebSocket Connection ─────────────────────────────────────────────────────
function initWebSocket() {
    socket = io(API_BASE, {
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionAttempts: Infinity
    });

    socket.on('connect', () => {
        console.log('🔌 WebSocket connected');
        addMissionLog('🔌 Dashboard connected to server', 'info');
    });

    socket.on('disconnect', () => {
        console.log('🔌 WebSocket disconnected');
        addMissionLog('⚠️ Dashboard disconnected from server', 'warning');
    });

    // ── Telemetry Update (main data stream) ────
    socket.on('telemetry:update', (data) => {
        updateThermalCard(data.thermal);
        updateGasCard(data.gas);
        updateUltrasonicCard(data.ultrasonic);
        updateBattery(data.battery);
        updateWifi(data.wifi_rssi);
        updateRoverStatus(true);
        updateChartData(data);
        incrementMissionReadings();

        // Update vision fusion display with AI results
        if (data.ai) {
            updateVisionFusion(data.ai, data.vision);
        }
    });

    // ── Rover Status ────
    socket.on('rover:status', (data) => {
        updateRoverStatus(data.is_online);
        if (data.battery_voltage) updateBattery(data);
    });

    // ── Rover Start/Stop Toggle Event ────
    socket.on('rover:start-stop', (data) => {
        applyStartStopUI(data.is_active);
        addMissionLog(data.is_active ? '⚡ Rover STARTED (Controls Ready)' : '🔒 Rover STOPPED (Controls Locked)', data.is_active ? 'info' : 'warning');
    });

    // ── Rover Command Broadcast ────
    socket.on('rover:command', (data) => {
        if (data.command) {
            updateCenterState(data.command);
        }
    });

    // ── Rover Mode Change ────
    socket.on('rover:mode', (data) => {
        updateModeButtons(data.mode);
        addMissionLog(`⚙️ Mode: ${data.mode.toUpperCase()}`, 'info');
    });

    // ── New Alert ────
    socket.on('alert:new', (alert) => {
        addAlertToPanel(alert);
        addMissionLog(`🔔 Alert: ${alert.title}`, alert.severity);
    });

    // ── Victim Detected ────
    socket.on('victim:detected', (data) => {
        addVictimDetection(data);
        addMissionLog(`🎯 Victim detected: ${data.detection_type} (${data.confidence_score?.toFixed(1)}%)`, 'critical');
    });

    // ── Mission Events ────
    socket.on('mission:started', () => addMissionLog('▶ Mission started', 'info'));
    socket.on('mission:completed', () => addMissionLog('⏹ Mission completed', 'info'));

    // ── Vision Detection Events (Camera AI) ────
    socket.on('vision:detection', (data) => {
        updateVisionDetectionBar(data);
    });

    socket.on('vision:status', (data) => {
        updateVisionBadge(data);
    });

    socket.on('vision:person_detected', (data) => {
        addMissionLog(`🧠 Camera AI: Person detected (${data.confidence.toFixed(1)}% confidence)`, 'critical');
    });

    // ── Initial Data ────
    socket.on('initial:data', (data) => {
        if (data.dashboard) {
            updateRoverStatus(data.dashboard.is_online === 1);
            if (data.dashboard.battery_percent) {
                updateBattery({ percent: data.dashboard.battery_percent });
            }
        }
        if (data.active_alerts) {
            data.active_alerts.forEach(a => addAlertToPanel(a));
        }
        if (data.active_mission) {
            activeMissionId = data.active_mission.id;
            document.getElementById('missionName').textContent = data.active_mission.mission_name;
            document.getElementById('missionCode').textContent = data.active_mission.mission_code;
        }
    });
}

// ── Load Initial Data via REST ───────────────────────────────────────────────
async function loadInitialData() {
    try {
        // ── 1. Latest telemetry (dashboard view + history) ──────────────────
        const res = await fetch(`${API_BASE}/api/telemetry/latest?rover_id=GZ-ROVER-01`);
        const json = await res.json();

        if (json.success && json.data) {
            const { dashboard, history } = json.data;

            // Populate sensor cards with last known real values from DB
            if (dashboard) {
                // Thermal card — prefer last NON-ZERO reading from history (avoids stale zeros in DB)
                if (history && history.thermal && history.thermal.length > 0) {
                    const lastNonZeroThermal = [...history.thermal].reverse()
                        .find(t => parseFloat(t.object_temp_c) > 0);
                    if (lastNonZeroThermal) {
                        updateThermalCard({
                            object: parseFloat(lastNonZeroThermal.object_temp_c),
                            ambient: parseFloat(lastNonZeroThermal.ambient_temp_c)
                        });
                    } else if (parseFloat(dashboard.thermal_object_c) > 0) {
                        updateThermalCard({
                            object: parseFloat(dashboard.thermal_object_c),
                            ambient: parseFloat(dashboard.thermal_ambient_c)
                        });
                    }
                }
                // Gas card — prefer last NON-ZERO reading from history
                if (history && history.gas && history.gas.length > 0) {
                    const lastNonZeroGas = [...history.gas].reverse()
                        .find(g => parseFloat(g.co_ppm) > 0 || parseFloat(g.methane_ppm) > 0);
                    const latestGas = lastNonZeroGas || history.gas[history.gas.length - 1];
                    updateGasCard({
                        co_ppm: parseFloat(latestGas.co_ppm),
                        methane_ppm: parseFloat(latestGas.methane_ppm),
                        lpg_ppm: parseFloat(latestGas.lpg_ppm),
                        raw_adc: latestGas.raw_adc_value || 0,
                        hazard: latestGas.hazard_level || 'safe'
                    });
                }
                // Ultrasonic card — get from latest ultrasonic history entries
                if (history && history.ultrasonic && history.ultrasonic.length > 0) {
                    const ultraArr = history.ultrasonic;
                    // Find the most recent front and side readings
                    const frontEntry = [...ultraArr].reverse().find(u => u.sensor_position === 'front');
                    const sideEntry = [...ultraArr].reverse().find(u => u.sensor_position !== 'front');
                    if (frontEntry || sideEntry) {
                        updateUltrasonicCard({
                            front: frontEntry ? parseFloat(frontEntry.distance_cm) : 0,
                            side: sideEntry ? parseFloat(sideEntry.distance_cm) : 0
                        });
                    }
                }
                // Battery from dashboard view (no voltage in view, that comes via socket)
                if (dashboard.battery_percent !== null && dashboard.battery_percent !== undefined) {
                    updateBattery({ percent: parseInt(dashboard.battery_percent), voltage: 0 });
                }
                // Rover online status
                updateRoverStatus(dashboard.is_online === 1 || dashboard.is_online === true);
                // Operation mode
                if (dashboard.operation_mode) {
                    updateModeButtons(dashboard.operation_mode);
                }
                // Active alert count from DB
                if (dashboard.active_alerts !== undefined && dashboard.active_alerts !== null) {
                    document.getElementById('missionAlerts').textContent = dashboard.active_alerts;
                    document.getElementById('alertCount').textContent = dashboard.active_alerts;
                    alertCounter = parseInt(dashboard.active_alerts) || 0;
                }
            }

            // ── Load thermal chart history ──────────────────────────────────
            if (history && history.thermal) {
                history.thermal.forEach(t => {
                    addChartPoint(
                        new Date(t.recorded_at).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }),
                        { thermal: { ambient: parseFloat(t.ambient_temp_c), object: parseFloat(t.object_temp_c) } }
                    );
                });
            }

            // ── Load gas chart history ──────────────────────────────────────
            if (history && history.gas) {
                history.gas.forEach(g => {
                    const time = new Date(g.recorded_at).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
                    chartData.labels.push(time);
                    if (chartData.labels.length > MAX_POINTS) chartData.labels.shift();
                    chartData.gas.co.push(parseFloat(g.co_ppm) || 0);
                    chartData.gas.methane.push(parseFloat(g.methane_ppm) || 0);
                    chartData.gas.lpg.push(parseFloat(g.lpg_ppm) || 0);
                    if (chartData.gas.co.length > MAX_POINTS) chartData.gas.co.shift();
                    if (chartData.gas.methane.length > MAX_POINTS) chartData.gas.methane.shift();
                    if (chartData.gas.lpg.length > MAX_POINTS) chartData.gas.lpg.shift();
                });
                if (liveChart) liveChart.update('none');
            }

            // ── Load ultrasonic chart history ───────────────────────────────
            if (history && history.ultrasonic) {
                // Group by time pairs (front + side at same timestamp)
                const byTime = {};
                history.ultrasonic.forEach(u => {
                    const t = new Date(u.recorded_at).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
                    if (!byTime[t]) byTime[t] = {};
                    if (u.sensor_position === 'front') byTime[t].front = parseFloat(u.distance_cm);
                    else byTime[t].side = parseFloat(u.distance_cm);
                });
                Object.entries(byTime).forEach(([time, vals]) => {
                    if (!chartData.labels.includes(time)) chartData.labels.push(time);
                    chartData.distance.front.push(vals.front || 0);
                    chartData.distance.side.push(vals.side || 0);
                    if (chartData.distance.front.length > MAX_POINTS) chartData.distance.front.shift();
                    if (chartData.distance.side.length > MAX_POINTS) chartData.distance.side.shift();
                });
                if (liveChart) liveChart.update('none');
            }
        }

        // ── 2. Victim stats + list ──────────────────────────────────────────
        const vicRes = await fetch(`${API_BASE}/api/victims/stats?rover_id=GZ-ROVER-01`);
        const vicJson = await vicRes.json();
        if (vicJson.success && vicJson.data) {
            document.getElementById('victimsAlive').textContent = vicJson.data.alive_count || 0;
            document.getElementById('victimsDeceased').textContent = vicJson.data.deceased_count || 0;
            document.getElementById('victimsUncertain').textContent = vicJson.data.uncertain_count || 0;
            const total = (vicJson.data.alive_count || 0) + (vicJson.data.deceased_count || 0) + (vicJson.data.uncertain_count || 0);
            document.getElementById('victimCount').textContent = `${total} FOUND`;
            document.getElementById('missionVictims').textContent = total;
        }

        // Load actual victim entries into the victim list panel
        const vicListRes = await fetch(`${API_BASE}/api/victims?rover_id=GZ-ROVER-01&limit=20`);
        const vicListJson = await vicListRes.json();
        if (vicListJson.success && vicListJson.data && vicListJson.data.length > 0) {
            const list = document.getElementById('victimList');
            const empty = list.querySelector('.empty-state');
            if (empty) empty.remove();
            // Show most recent 10 victims
            vicListJson.data.slice(0, 10).forEach(v => {
                const iconMap = { alive: '💚', deceased: '💀', uncertain: '❓', false_positive: '❌' };
                const confidence = parseFloat(v.confidence_score) || 0;
                const time = v.detected_at
                    ? new Date(v.detected_at).toLocaleTimeString('en-US', { hour12: false })
                    : '--:--:--';
                const div = document.createElement('div');
                div.className = 'victim-card';
                div.innerHTML = `
                    <div class="victim-status-icon ${v.detection_type}">
                        ${iconMap[v.detection_type] || '❓'}
                    </div>
                    <div class="victim-info">
                        <div class="victim-type" style="color: ${v.detection_type === 'alive' ? 'var(--accent-green)' : v.detection_type === 'deceased' ? 'var(--accent-red)' : 'var(--accent-yellow)'}">
                            ${v.detection_type.toUpperCase()}
                        </div>
                        <div class="victim-details">
                            ${v.thermal_temp_c ? `Temp: ${parseFloat(v.thermal_temp_c).toFixed(1)}°C` : 'DB Record'} • ${time}
                        </div>
                    </div>
                    <div class="victim-confidence">${confidence.toFixed(1)}%</div>
                `;
                list.appendChild(div);
            });
        }

        // ── 3. Rover status (wifi + battery voltage) ────────────────────────
        const roverRes = await fetch(`${API_BASE}/api/rover/status?rover_id=GZ-ROVER-01`);
        const roverJson = await roverRes.json();
        if (roverJson.success && roverJson.data) {
            const r = roverJson.data;
            if (r.wifi_rssi !== null && r.wifi_rssi !== undefined) updateWifi(r.wifi_rssi);
            if (r.battery_voltage !== null && r.battery_percent !== null && r.battery_percent !== undefined) {
                updateBattery({ percent: parseInt(r.battery_percent), voltage: parseFloat(r.battery_voltage) });
            }
        }

        // ── 4. Recent active alerts (top 5 in panel) ───────────────────────
        const alertRes = await fetch(`${API_BASE}/api/alerts/active?rover_id=GZ-ROVER-01`);
        const alertJson = await alertRes.json();
        if (alertJson.success && alertJson.data && alertJson.data.length > 0) {
            // Only show 5 most recent in the panel (there may be 274 total!)
            const recentAlerts = alertJson.data.slice(0, 5);
            // Reset counter to actual total before adding
            alertCounter = 0;
            document.getElementById('alertCount').textContent = alertJson.total || alertJson.data.length;
            document.getElementById('missionAlerts').textContent = alertJson.total || alertJson.data.length;
            alertCounter = alertJson.total || alertJson.data.length;
            const list = document.getElementById('alertList');
            const empty = list.querySelector('.empty-state');
            if (empty) empty.remove();
            recentAlerts.forEach(a => {
                const iconMap = { critical: '🔴', danger: '🟠', warning: '🟡', info: '🔵' };
                const time = a.triggered_at
                    ? new Date(a.triggered_at).toLocaleTimeString('en-US', { hour12: false })
                    : new Date().toLocaleTimeString('en-US', { hour12: false });
                const div = document.createElement('div');
                div.className = `alert-item ${a.severity || 'info'}`;
                div.innerHTML = `
                    <span class="alert-icon">${iconMap[a.severity] || '🔵'}</span>
                    <div class="alert-content">
                        <div class="alert-title">${a.title || 'Alert'}</div>
                        <div class="alert-message">${a.message || ''}</div>
                    </div>
                    <div class="alert-time">${time}</div>
                `;
                list.appendChild(div);
            });
        }

        addMissionLog('📡 Loaded real data from database', 'info');

    } catch (err) {
        console.log('Initial data load skipped:', err.message);
    }
}

// (Thermal Card function moved to line 567)
// ── Update Gas Card ──────────────────────────────────────────────────────────
let lastDirectGasMs = 0;

function updateGasCard(gas, isDirect = false) {
    if (!gas) return;

    if (isDirect) {
        lastDirectGasMs = Date.now();
    } else if (Date.now() - lastDirectGasMs < 2000) {
        return;
    }

    const co      = parseFloat(gas.co_ppm) || 0;
    const methane = parseFloat(gas.methane_ppm) || 0;
    const lpg     = parseFloat(gas.lpg_ppm) || 0;
    const hazard  = gas.hazard || 'safe';
    const rawADC  = parseInt(gas.raw_adc) || 0;

    document.getElementById('gasRawADC').textContent = rawADC;

    // Warm-up detection: ADC is reading but PPMs still 0
    const isWarmingUp = rawADC > 0 && co === 0 && methane === 0 && lpg === 0;

    const display = document.getElementById('gasHazardDisplay');
    const bar     = document.getElementById('gasHazardBar');
    const status  = document.getElementById('gasStatus');

    if (isWarmingUp) {
        // Show warm-up state
        document.getElementById('gasCO').textContent      = '--- PPM';
        document.getElementById('gasMethane').textContent = '--- PPM';
        document.getElementById('gasLPG').textContent     = '--- PPM';
        display.textContent = 'WARMING UP...';
        display.className = 'big-number yellow';
        bar.className = 'hazard-bar-fill low';
        status.textContent = 'WARM-UP';
        status.className = 'card-status warning';
        document.getElementById('gasCO').style.color = 'var(--accent-yellow)';
        return;
    }

    document.getElementById('gasCO').textContent      = `${co.toFixed(2)} PPM`;
    document.getElementById('gasMethane').textContent = `${methane.toFixed(2)} PPM`;
    document.getElementById('gasLPG').textContent     = `${lpg.toFixed(2)} PPM`;

    // Hazard display
    display.textContent = hazard.toUpperCase();
    bar.className = `hazard-bar-fill ${hazard}`;

    const hazardColors  = { safe: 'green', low: 'yellow', moderate: 'yellow', high: 'red', critical: 'red' };
    const statusClasses = { safe: 'active', low: 'warning', moderate: 'warning', high: 'danger', critical: 'danger' };
    display.className   = `big-number ${hazardColors[hazard] || 'green'}`;
    status.textContent  = hazard.toUpperCase();
    status.className    = `card-status ${statusClasses[hazard] || 'active'}`;

    // Color CO on danger
    const coEl = document.getElementById('gasCO');
    coEl.style.color = co > 50 ? 'var(--accent-red)' : co > 25 ? 'var(--accent-yellow)' : 'var(--text-primary)';
}

// ── Update Ultrasonic Card ────────────────────────────────────────────────────
// OBJECT_ALERT_CM: show alert banner if object is within this range
const OBJECT_ALERT_CM = 13;     // 13 cm

let lastDirectSensorMs = 0;

function updateUltrasonicCard(ultrasonic, isDirect = false) {
    if (!ultrasonic) return;
    
    if (isDirect) {
        lastDirectSensorMs = Date.now();
    } else if (Date.now() - lastDirectSensorMs < 2000) {
        // If we have received direct ESP32 data recently, ignore the Socket.IO (simulator) data
        return;
    }

    const front = parseFloat(ultrasonic.front) || 0;
    const back  = parseFloat(ultrasonic.side  ?? ultrasonic.rear) || 0;

    // ── Distance text display ────────────────────────────────────────────────
    const fmtCm = v => v >= 900 ? '--- cm' : `${v.toFixed(1)} cm`;
    const fmtLabel = v => {
        if (v >= 900) return '--- cm';
        return v >= 100 ? `${(v/100).toFixed(2)} m` : `${v.toFixed(0)} cm`;
    };

    document.getElementById('ultraFront').textContent = fmtCm(front);
    document.getElementById('ultraSide').textContent  = fmtCm(back);
    document.getElementById('distFrontLabel').textContent = fmtLabel(front);
    document.getElementById('distBackLabel').textContent  = fmtLabel(back);

    // ── Visual distance bars (scale: 1300cm → 60px max) ──────────────────────
    const scale = 60 / OBJECT_ALERT_CM;
    document.getElementById('distFrontLine').style.height = `${Math.min(60, Math.max(3, front * scale))}px`;
    document.getElementById('distBackLine').style.height  = `${Math.min(60, Math.max(3, back  * scale))}px`;

    // ── Object detection (within 13m = 1300cm, ignore 0 = no echo) ───────────
    const frontObj = front > 0 && front < OBJECT_ALERT_CM;
    const backObj  = back  > 0 && back  < OBJECT_ALERT_CM;

    // Front alert banner
    const frontBanner = document.getElementById('frontAlertBanner');
    const backBanner  = document.getElementById('backAlertBanner');
    if (frontBanner) {
        frontBanner.classList.toggle('hidden', !frontObj);
        if (frontObj) {
            document.getElementById('frontAlertDist').textContent =
                front >= 100 ? `${(front/100).toFixed(2)} m ahead` : `${front.toFixed(0)} cm ahead`;
        }
    }
    if (backBanner) {
        backBanner.classList.toggle('hidden', !backObj);
        if (backObj) {
            document.getElementById('backAlertDist').textContent =
                back >= 100 ? `${(back/100).toFixed(2)} m behind` : `${back.toFixed(0)} cm behind`;
        }
    }

    // ── Object status row & card badge ───────────────────────────────────────
    const obsEl    = document.getElementById('ultraObstacle');
    const statusEl = document.getElementById('ultraStatus');

    if (frontObj && backObj) {
        obsEl.textContent = '🔴 FRONT + BACK OBJECT!';
        obsEl.style.color = 'var(--accent-red)';
        statusEl.textContent = 'BOTH!';
        statusEl.className = 'card-status danger';
    } else if (frontObj) {
        obsEl.textContent = '🔴 FRONT OBJECT!';
        obsEl.style.color = 'var(--accent-red)';
        statusEl.textContent = 'FRONT!';
        statusEl.className = 'card-status danger';
    } else if (backObj) {
        obsEl.textContent = '🔴 BACK OBJECT!';
        obsEl.style.color = 'var(--accent-red)';
        statusEl.textContent = 'BACK!';
        statusEl.className = 'card-status danger';
    } else {
        obsEl.textContent = '🟢 ALL CLEAR';
        obsEl.style.color = 'var(--accent-green)';
        statusEl.textContent = 'CLEAR';
        statusEl.className = 'card-status active';
    }
}

let lastDirectThermalMs = 0;

function updateThermalCard(thermal, isDirect = false) {
    if (!thermal) return;

    if (isDirect) {
        lastDirectThermalMs = Date.now();
    } else if (Date.now() - lastDirectThermalMs < 2000) {
        // Ignore socket.io simulator data if real direct data is arriving
        return;
    }

    const ambient = parseFloat(thermal.ambient) || 0;
    const object = parseFloat(thermal.object) || 0;
    const delta = object - ambient;

    document.getElementById('thermalAmbient').textContent = `${ambient.toFixed(1)} °C`;
    document.getElementById('thermalObject').textContent = `${object.toFixed(1)} °C`;
    document.getElementById('thermalDelta').textContent = `${delta > 0 ? '+' : ''}${delta.toFixed(1)} °C`;

    // Gauge logic
    const tempFill = document.getElementById('thermalGauge');
    const tempVal = document.getElementById('thermalObjectTemp');
    
    // Scale: 0°C to 50°C mapping to gauge stroke
    const maxTemp = 50;
    const percentage = Math.max(0, Math.min(100, (object / maxTemp) * 100));
    const offset = 314 - (314 * percentage) / 100;
    
    tempFill.style.strokeDashoffset = offset;
    tempVal.textContent = object.toFixed(1);

    // Color scaling based on temperature
    let color = 'var(--accent-cyan)';
    if (object > 37.5) color = 'var(--accent-red)';
    else if (object > 35) color = 'var(--accent-yellow)';
    
    tempFill.style.stroke = color;
    tempVal.style.color = color;

    // Body heat detection (Human body surface temp usually 32-35°C, clothed)
    const isBodyHeat = object >= 31.0 && object <= 37.5 && delta >= 2.0;
    const bodyHeatEl = document.getElementById('thermalBodyHeat');
    
    if (isBodyHeat) {
        bodyHeatEl.innerHTML = '<span class="status-badge danger">DETECTED!</span>';
    } else {
        bodyHeatEl.textContent = 'NO';
        bodyHeatEl.style.color = 'var(--text-muted)';
    }
}

// ── Direct ESP32 /sensors polling (runs every 300ms) ─────────────────────────
// Supplements Socket.IO data with live readings directly from the rover
function initSensorPolling() {
    setInterval(async () => {
        const ip = (document.getElementById('roverIpInput')?.value?.trim()) || '192.168.4.1';
        try {
            const res = await fetch(`http://${ip}/sensors`, {
                cache: 'no-store',
                signal: AbortSignal.timeout(2000)
            });
            if (!res.ok) return;
            const d = await res.json();
            // Convert to the same format updateUltrasonicCard expects:
            // ESP32 returns { front: X, rear: Y } but card uses { front, side }
            updateUltrasonicCard({ front: d.front, side: d.rear }, true);
            
            // Thermal sensor processing
            if (d.thermal_ambient !== undefined) {
                updateThermalCard({ ambient: d.thermal_ambient, object: d.thermal_object }, true);
            }
            
            // Gas sensor processing
            if (d.gas !== undefined) {
                const raw = d.gas;
                let co = 0, ch4 = 0, lpg = 0;
                let hazard = 'safe';
                
                if (raw > 200) { // arbitrary baseline
                    const excess = raw - 200;
                    co = excess * 0.05;
                    ch4 = excess * 0.02;
                    lpg = excess * 0.01;
                }
                
                if (co > 50) hazard = 'critical';
                else if (co > 25) hazard = 'high';
                else if (co > 9) hazard = 'moderate';
                else if (co > 0) hazard = 'low';

                updateGasCard({
                    co_ppm: co,
                    methane_ppm: ch4,
                    lpg_ppm: lpg,
                    raw_adc: raw,
                    hazard: hazard
                }, true);
            }
        } catch (_) {
            // Silently ignore — Socket.IO data still updates the card
        }
    }, 300);
}


function initCameraStream() {
    const camImg = document.getElementById('videoStream');
    const overlay = document.getElementById('videoOverlay');
    const status = document.getElementById('videoStatus');
    
    // We assume the camera gets 192.168.4.2 from the tank AP
    const streamUrl = 'http://192.168.4.2:81/stream';
    document.getElementById('camUrl').textContent = streamUrl;

    camImg.onload = () => {
        overlay.style.display = 'none';
        camImg.style.display = 'block';
        status.textContent = 'LIVE';
        status.className = 'card-status active';
    };

    camImg.onerror = () => {
        overlay.style.display = 'flex';
        camImg.style.display = 'none';
        status.textContent = 'OFFLINE';
        status.className = 'card-status danger';
        // Try again in 5 seconds
        setTimeout(() => {
            camImg.src = streamUrl + '?t=' + new Date().getTime();
        }, 5000);
    };

    camImg.src = streamUrl;
}

// ── Update Battery ───────────────────────────────────────────────────────────
function updateBattery(battery) {
    if (!battery) return;
    const percent = parseInt(battery.percent) || 0;
    const voltage = parseFloat(battery.voltage) || 0;
    
    const fill = document.getElementById('batteryFill');
    const text = document.getElementById('batteryText');
    
    fill.style.width = `${percent}%`;
    text.textContent = `${percent}% ${voltage > 0 ? `(${voltage.toFixed(1)}V)` : ''}`;

    if (percent > 50) {
        fill.style.background = 'var(--accent-green)';
    } else if (percent > 20) {
        fill.style.background = 'var(--accent-yellow)';
    } else {
        fill.style.background = 'var(--accent-red)';
    }
}

// ── Update Wi-Fi ─────────────────────────────────────────────────────────────
function updateWifi(rssi) {
    if (rssi === null || rssi === undefined) return;
    const val = parseInt(rssi);
    document.getElementById('wifiRssi').textContent = `${val} dBm`;
}

// ── Update Rover Status ──────────────────────────────────────────────────────
function updateRoverStatus(isOnline) {
    const badge = document.getElementById('roverStatusBadge');
    const text = document.getElementById('roverStatusText');
    if (isOnline) {
        badge.className = 'status-badge online';
        text.textContent = 'ONLINE';
    } else {
        badge.className = 'status-badge offline';
        text.textContent = 'OFFLINE';
    }
}

// ── Chart System ─────────────────────────────────────────────────────────────
function initChart() {
    const ctx = document.getElementById('liveChart').getContext('2d');
    
    Chart.defaults.color = '#94a3b8';
    Chart.defaults.borderColor = 'rgba(255,255,255,0.06)';
    Chart.defaults.font.family = "'Inter', sans-serif";

    liveChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: chartData.labels,
            datasets: [
                {
                    label: 'Object °C',
                    data: chartData.thermal.object,
                    borderColor: '#00f0ff',
                    backgroundColor: 'rgba(0, 240, 255, 0.1)',
                    borderWidth: 2,
                    pointRadius: 0,
                    tension: 0.4,
                    fill: true
                },
                {
                    label: 'Ambient °C',
                    data: chartData.thermal.ambient,
                    borderColor: '#8b5cf6',
                    backgroundColor: 'rgba(139, 92, 246, 0.05)',
                    borderWidth: 1.5,
                    pointRadius: 0,
                    tension: 0.4,
                    fill: true
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 300 },
            interaction: { intersect: false, mode: 'index' },
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    labels: { boxWidth: 12, padding: 12, font: { size: 10 } }
                }
            },
            scales: {
                x: {
                    display: true,
                    ticks: { maxTicksLimit: 6, font: { size: 9 } },
                    grid: { display: false }
                },
                y: {
                    display: true,
                    ticks: { font: { size: 10 } },
                    grid: { color: 'rgba(255,255,255,0.04)' }
                }
            }
        }
    });

    // Highlight active chart button
    document.getElementById('chartBtnThermal').classList.add('btn-primary');
}

function switchChart(type) {
    currentChartType = type;
    
    // Update button styles
    ['chartBtnThermal', 'chartBtnGas', 'chartBtnDist'].forEach(id => {
        document.getElementById(id).classList.remove('btn-primary');
    });

    const btnMap = { thermal: 'chartBtnThermal', gas: 'chartBtnGas', distance: 'chartBtnDist' };
    document.getElementById(btnMap[type]).classList.add('btn-primary');

    // Update chart datasets
    if (type === 'thermal') {
        liveChart.data.datasets = [
            { label: 'Object °C', data: chartData.thermal.object, borderColor: '#00f0ff', backgroundColor: 'rgba(0,240,255,0.1)', borderWidth: 2, pointRadius: 0, tension: 0.4, fill: true },
            { label: 'Ambient °C', data: chartData.thermal.ambient, borderColor: '#8b5cf6', backgroundColor: 'rgba(139,92,246,0.05)', borderWidth: 1.5, pointRadius: 0, tension: 0.4, fill: true }
        ];
    } else if (type === 'gas') {
        liveChart.data.datasets = [
            { label: 'CO (PPM)', data: chartData.gas.co, borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.1)', borderWidth: 2, pointRadius: 0, tension: 0.4, fill: true },
            { label: 'CH₄ (PPM)', data: chartData.gas.methane, borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.05)', borderWidth: 1.5, pointRadius: 0, tension: 0.4, fill: true },
            { label: 'LPG (PPM)', data: chartData.gas.lpg, borderColor: '#f97316', backgroundColor: 'rgba(249,115,22,0.05)', borderWidth: 1.5, pointRadius: 0, tension: 0.4, fill: true }
        ];
    } else if (type === 'distance') {
        liveChart.data.datasets = [
            { label: 'Front (cm)', data: chartData.distance.front, borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.1)', borderWidth: 2, pointRadius: 0, tension: 0.4, fill: true },
            { label: 'Side (cm)', data: chartData.distance.side, borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.05)', borderWidth: 1.5, pointRadius: 0, tension: 0.4, fill: true }
        ];
    }

    liveChart.update('none');
}

function updateChartData(data) {
    const time = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    addChartPoint(time, data);
}

function addChartPoint(time, data) {
    chartData.labels.push(time);
    if (chartData.labels.length > MAX_POINTS) chartData.labels.shift();

    if (data.thermal) {
        chartData.thermal.ambient.push(parseFloat(data.thermal.ambient) || 0);
        chartData.thermal.object.push(parseFloat(data.thermal.object) || 0);
        if (chartData.thermal.ambient.length > MAX_POINTS) chartData.thermal.ambient.shift();
        if (chartData.thermal.object.length > MAX_POINTS) chartData.thermal.object.shift();
    }
    if (data.gas) {
        chartData.gas.co.push(parseFloat(data.gas.co_ppm) || 0);
        chartData.gas.methane.push(parseFloat(data.gas.methane_ppm) || 0);
        chartData.gas.lpg.push(parseFloat(data.gas.lpg_ppm) || 0);
        if (chartData.gas.co.length > MAX_POINTS) chartData.gas.co.shift();
        if (chartData.gas.methane.length > MAX_POINTS) chartData.gas.methane.shift();
        if (chartData.gas.lpg.length > MAX_POINTS) chartData.gas.lpg.shift();
    }
    if (data.ultrasonic) {
        chartData.distance.front.push(parseFloat(data.ultrasonic.front) || 0);
        chartData.distance.side.push(parseFloat(data.ultrasonic.side) || 0);
        if (chartData.distance.front.length > MAX_POINTS) chartData.distance.front.shift();
        if (chartData.distance.side.length > MAX_POINTS) chartData.distance.side.shift();
    }

    if (liveChart) liveChart.update('none');
}

// ── Rover Control Box — Tank Grid (direct to ESP32) ──────────────────────────
let isRoverStarted   = false;
let tankCmdTimer     = null;   // repeating timer while button held
let activeCmd        = null;   // current held command

// All 9 button IDs
const ALL_TANK_BTNS = ['btnFL','btnForward','btnFR','btnLeft','btnStop','btnRight','btnBL','btnBackward','btnBR'];

// Map keyboard keys → ESP32 command codes
const KEY_CMD_MAP = {
    w: 'F', arrowup:    'F',
    s: 'B', arrowdown:  'B',
    a: 'L', arrowleft:  'L',
    d: 'R', arrowright: 'R',
    ' ': 'S', escape: 'S'
};

// ── Get rover IP from input ───────────────────────────────────────────────────
function getRoverIP() {
    const inp = document.getElementById('roverIpInput');
    return (inp ? inp.value.trim() : null) || '192.168.4.1';
}

// ── Send one HTTP GET to ESP32 ───────────────────────────────────────────────
function sendToESP32(cmd) {
    const ip = getRoverIP();
    const url = `http://${ip}/cmd?d=${cmd}`;
    fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(400) })
        .then(() => setConnBadge(true))
        .catch(() => setConnBadge(false));
}

function setConnBadge(ok) {
    const badge = document.getElementById('roverConnStatus');
    if (!badge) return;
    badge.textContent = ok ? 'ONLINE' : 'OFFLINE';
    badge.className   = 'rover-conn-badge ' + (ok ? 'online' : 'offline');
}

// ── Start repeating send while a button is held ──────────────────────────────
function startHold(cmd) {
    if (!isRoverStarted) { showLockedWarning(); return; }
    stopHold();
    activeCmd = cmd;
    updateStatusText(cmd);
    sendToESP32(cmd);
    tankCmdTimer = setInterval(() => sendToESP32(cmd), 150);
}

function stopHold() {
    if (tankCmdTimer) { clearInterval(tankCmdTimer); tankCmdTimer = null; }
    if (activeCmd && activeCmd !== 'S') {
        activeCmd = null;
        updateStatusText('S');
        sendToESP32('S');
    }
    // Remove active highlight from all buttons
    ALL_TANK_BTNS.forEach(id => {
        const b = document.getElementById(id);
        if (b) b.classList.remove('active');
    });
}

// ── Single-click for STOP button ─────────────────────────────────────────────
function clickStop() {
    if (!isRoverStarted) { showLockedWarning(); return; }
    stopHold();
    activeCmd = 'S';
    updateStatusText('S');
    sendToESP32('S');
}

// ── Update center status label ───────────────────────────────────────────────
const CMD_LABEL = {
    'F':'▲ FORWARD','B':'▼ BACKWARD','L':'◄ LEFT','R':'► RIGHT',
    'FL':'↖ FWD-LEFT','FR':'↗ FWD-RIGHT','BL':'↙ BWD-LEFT','BR':'↘ BWD-RIGHT',
    'S':'● READY'
};
function updateStatusText(cmd) {
    const el = document.getElementById('centerStateText');
    if (!el) return;
    if (!isRoverStarted) {
        el.textContent = 'LOCKED'; el.className = 'center-state-text locked'; return;
    }
    el.textContent = CMD_LABEL[cmd] || '● READY';
    el.className   = 'center-state-text ' + (cmd === 'S' ? 'ready' : 'moving');
}

// ── Bind pointer events to all 9 tank buttons ────────────────────────────────
function initTankButtons() {
    ALL_TANK_BTNS.forEach(id => {
        const btn = document.getElementById(id);
        if (!btn) return;
        const cmd = btn.dataset.cmd;

        btn.addEventListener('pointerdown', e => {
            e.preventDefault();
            btn.setPointerCapture(e.pointerId);
            btn.classList.add('active');
            if (cmd === 'S') { clickStop(); } else { startHold(cmd); }
        });
        ['pointerup','pointercancel','pointerleave'].forEach(ev => {
            btn.addEventListener(ev, () => {
                btn.classList.remove('active');
                if (cmd !== 'S') stopHold();
            });
        });
    });
}

// ── Keyboard support ─────────────────────────────────────────────────────────
function initKeyboardControls() {
    const pressedKeys = new Set();

    document.addEventListener('keydown', e => {
        if (e.repeat) return;
        const key = e.key.toLowerCase();
        if (!(key in KEY_CMD_MAP)) return;
        e.preventDefault();
        if (pressedKeys.has(key)) return;
        pressedKeys.add(key);

        const cmd = KEY_CMD_MAP[key];
        // Highlight matching button
        const btnIdByCmd = { F:'btnForward',B:'btnBackward',L:'btnLeft',R:'btnRight',S:'btnStop' };
        if (btnIdByCmd[cmd]) document.getElementById(btnIdByCmd[cmd])?.classList.add('active');

        if (cmd === 'S') clickStop();
        else             startHold(cmd);
    });

    document.addEventListener('keyup', e => {
        const key = e.key.toLowerCase();
        if (!(key in KEY_CMD_MAP)) return;
        e.preventDefault();
        pressedKeys.delete(key);

        const cmd = KEY_CMD_MAP[key];
        const btnIdByCmd = { F:'btnForward',B:'btnBackward',L:'btnLeft',R:'btnRight',S:'btnStop' };
        if (btnIdByCmd[cmd]) document.getElementById(btnIdByCmd[cmd])?.classList.remove('active');

        if (cmd !== 'S') stopHold();
    });

    // Stop if tab hidden
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) { pressedKeys.clear(); stopHold(); }
    });
}

// ── Enable / disable 9 buttons based on rover started state ──────────────────
function setTankButtonsEnabled(enabled) {
    ALL_TANK_BTNS.forEach(id => {
        const b = document.getElementById(id);
        if (!b) return;
        b.disabled = !enabled;
        if (!enabled) b.classList.remove('active');
    });
}

// ── START / STOP toggle ───────────────────────────────────────────────────────
function toggleStartStop() {
    isRoverStarted = !isRoverStarted;
    applyStartStopUI(isRoverStarted);

    // Also inform server via Socket.IO (for telemetry / mode tracking)
    if (socket) {
        socket.emit('rover:start-stop', { rover_id: 'GZ-ROVER-01', start: isRoverStarted });
    }

    if (!isRoverStarted) {
        stopHold();
        sendToESP32('S');   // immediate stop
    }
}

function applyStartStopUI(started) {
    isRoverStarted = Boolean(started);
    const btn     = document.getElementById('btnStartStop');
    const icon    = document.getElementById('startStopIcon');
    const text    = document.getElementById('startStopText');
    const caption = document.getElementById('startStopCaption');
    const badge   = document.getElementById('roverMasterStatusBadge');

    if (isRoverStarted) {
        if (btn)     btn.className = 'master-start-stop-btn is-started';
        if (icon)    icon.textContent = '⏹';
        if (text)    text.textContent = 'STOP ROVER';
        if (caption) { caption.textContent = '⚡ ROVER ACTIVE — CONTROLS UNLOCKED (Ready to Run)'; caption.className = 'master-status-caption active'; }
        if (badge)   { badge.textContent = 'READY'; badge.className = 'card-status active'; }
        setTankButtonsEnabled(true);
        updateStatusText('S');
    } else {
        if (btn)     btn.className = 'master-start-stop-btn is-stopped';
        if (icon)    icon.textContent = '▶';
        if (text)    text.textContent = 'START ROVER';
        if (caption) { caption.textContent = '🔒 ROVER STOPPED — CONTROLS LOCKED (Click START to Run)'; caption.className = 'master-status-caption locked'; }
        if (badge)   { badge.textContent = 'STOPPED'; badge.className = 'card-status danger'; }
        setTankButtonsEnabled(false);
        updateStatusText('S');
    }
}

function showLockedWarning() {
    const caption = document.getElementById('startStopCaption');
    if (caption) {
        caption.classList.add('shake');
        setTimeout(() => caption.classList.remove('shake'), 500);
    }
}

function updateModeButtons(mode) {
    if (mode === 'emergency_stop' || mode === 'idle' || mode === 'stopped') applyStartStopUI(false);
    else if (mode === 'manual' || mode === 'autonomous')                    applyStartStopUI(true);
}

// Legacy stubs kept so existing socket handlers don't break
function handleOperateDown(dir) {}
function handleOperateUp()      {}
function handleOperateClick(dir){}
function sendCommand(cmd)       { sendToESP32(cmd === 'forward' ? 'F' : cmd === 'backward' ? 'B' : cmd === 'left' ? 'L' : cmd === 'right' ? 'R' : 'S'); }
function setMode(mode)          { if (socket) socket.emit('rover:set-mode', { rover_id: 'GZ-ROVER-01', mode }); }
function updateCenterState(dir) { updateStatusText(dir === 'forward' ? 'F' : dir === 'backward' ? 'B' : dir === 'left' ? 'L' : dir === 'right' ? 'R' : 'S'); }

// ── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    initTankButtons();
    initSensorPolling();
    initCameraStream();
});


// ── Alert Panel ──────────────────────────────────────────────────────────────

let alertCounter = 0;

function addAlertToPanel(alert) {
    alertCounter++;
    document.getElementById('alertCount').textContent = alertCounter;

    const list = document.getElementById('alertList');
    // Remove empty state if present
    const empty = list.querySelector('.empty-state');
    if (empty) empty.remove();

    const iconMap = {
        critical: '🔴', danger: '🟠', warning: '🟡', info: '🔵'
    };

    const time = alert.triggered_at
        ? new Date(alert.triggered_at).toLocaleTimeString('en-US', { hour12: false })
        : new Date().toLocaleTimeString('en-US', { hour12: false });

    const div = document.createElement('div');
    div.className = `alert-item ${alert.severity || 'info'}`;
    div.innerHTML = `
        <span class="alert-icon">${iconMap[alert.severity] || '🔵'}</span>
        <div class="alert-content">
            <div class="alert-title">${alert.title || 'Alert'}</div>
            <div class="alert-message">${alert.message || ''}</div>
        </div>
        <div class="alert-time">${time}</div>
    `;
    div.onclick = () => {
        div.style.opacity = '0.4';
        if (alert.id) acknowledgeAlert(alert.id);
    };

    list.insertBefore(div, list.firstChild);

    // Keep max 50 alerts in panel
    while (list.children.length > 50) {
        list.removeChild(list.lastChild);
    }

    // Update mission alert count
    const missionAlerts = document.getElementById('missionAlerts');
    missionAlerts.textContent = alertCounter;
}

async function acknowledgeAlert(id) {
    try {
        await fetch(`${API_BASE}/api/alerts/${id}/ack`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ acknowledged_by: 'Dashboard Operator' })
        });
    } catch (err) { /* silent */ }
}

async function acknowledgeAllAlerts() {
    try {
        await fetch(`${API_BASE}/api/alerts/ack-all`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rover_id: 'GZ-ROVER-01', acknowledged_by: 'Dashboard Operator' })
        });
        // Dim all alert items
        document.querySelectorAll('.alert-item').forEach(el => el.style.opacity = '0.4');
    } catch (err) { /* silent */ }
}

function clearAlertList() {
    const list = document.getElementById('alertList');
    list.innerHTML = `<div class="empty-state"><div class="empty-state-icon">🔕</div><div class="empty-state-text">Alerts cleared</div></div>`;
    alertCounter = 0;
    document.getElementById('alertCount').textContent = '0';
}

// ── Victim Detections ────────────────────────────────────────────────────────
function addVictimDetection(data) {
    const list = document.getElementById('victimList');
    const empty = list.querySelector('.empty-state');
    if (empty) empty.remove();

    const iconMap = { alive: '💚', deceased: '💀', uncertain: '❓', false_positive: '❌' };
    const confidence = parseFloat(data.confidence_score) || 0;
    const time = new Date().toLocaleTimeString('en-US', { hour12: false });

    const div = document.createElement('div');
    div.className = 'victim-card';
    div.innerHTML = `
        <div class="victim-status-icon ${data.detection_type}">
            ${iconMap[data.detection_type] || '❓'}
        </div>
        <div class="victim-info">
            <div class="victim-type" style="color: ${data.detection_type === 'alive' ? 'var(--accent-green)' : data.detection_type === 'deceased' ? 'var(--accent-red)' : 'var(--accent-yellow)'}">
                ${data.detection_type.toUpperCase()}
            </div>
            <div class="victim-details">
                ${data.thermal_temp_c ? `Temp: ${data.thermal_temp_c}°C` : ''} • ${time}
            </div>
        </div>
        <div class="victim-confidence">${confidence.toFixed(1)}%</div>
    `;

    list.insertBefore(div, list.firstChild);

    // Update counts
    const type = data.detection_type;
    if (type === 'alive') {
        const el = document.getElementById('victimsAlive');
        el.textContent = parseInt(el.textContent) + 1;
    } else if (type === 'deceased') {
        const el = document.getElementById('victimsDeceased');
        el.textContent = parseInt(el.textContent) + 1;
    } else if (type === 'uncertain') {
        const el = document.getElementById('victimsUncertain');
        el.textContent = parseInt(el.textContent) + 1;
    }

    const total = parseInt(document.getElementById('victimsAlive').textContent) +
                  parseInt(document.getElementById('victimsDeceased').textContent) +
                  parseInt(document.getElementById('victimsUncertain').textContent);
    document.getElementById('victimCount').textContent = `${total} FOUND`;
    document.getElementById('missionVictims').textContent = total;
}

// ── Mission Management ───────────────────────────────────────────────────────
let missionReadingsCount = 0;

function incrementMissionReadings() {
    missionReadingsCount++;
    document.getElementById('missionReadings').textContent = missionReadingsCount;
}

async function startMission() {
    try {
        const res = await fetch(`${API_BASE}/api/mission`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                rover_id: 'GZ-ROVER-01',
                mission_name: `Rescue Op — ${new Date().toLocaleString()}`
            })
        });
        const json = await res.json();
        if (json.success) {
            activeMissionId = json.data.id;

            // Start mission
            await fetch(`${API_BASE}/api/mission/${activeMissionId}/start`, { method: 'PUT' });

            document.getElementById('missionName').textContent = json.data.mission_name;
            document.getElementById('missionCode').textContent = json.data.mission_code;
            document.getElementById('btnStartMission').style.display = 'none';
            document.getElementById('btnStopMission').style.display = 'flex';

            // Start duration timer
            missionStartTime = Date.now();
            missionReadingsCount = 0;
            missionTimer = setInterval(() => {
                const elapsed = Math.floor((Date.now() - missionStartTime) / 1000);
                const h = String(Math.floor(elapsed / 3600)).padStart(2, '0');
                const m = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0');
                const s = String(elapsed % 60).padStart(2, '0');
                document.getElementById('missionDuration').textContent = `${h}:${m}:${s}`;
            }, 1000);

            addMissionLog('▶ New mission started', 'info');
        }
    } catch (err) {
        console.error('Mission start error:', err);
    }
}

async function completeMission() {
    if (!activeMissionId) return;
    try {
        await fetch(`${API_BASE}/api/mission/${activeMissionId}/complete`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ notes: `Completed with ${missionReadingsCount} readings` })
        });

        clearInterval(missionTimer);
        document.getElementById('btnStartMission').style.display = 'flex';
        document.getElementById('btnStopMission').style.display = 'none';
        document.getElementById('missionName').textContent = 'MISSION COMPLETED';
        addMissionLog('⏹ Mission completed successfully', 'info');
        activeMissionId = null;
    } catch (err) {
        console.error('Mission complete error:', err);
    }
}

// ── Mission Log ──────────────────────────────────────────────────────────────
function addMissionLog(message, type = 'info') {
    const log = document.getElementById('missionLog');
    const empty = log.querySelector('.empty-state');
    if (empty) empty.remove();

    const time = new Date().toLocaleTimeString('en-US', { hour12: false });
    const colors = { info: 'var(--accent-cyan)', warning: 'var(--accent-yellow)', critical: 'var(--accent-red)' };

    const div = document.createElement('div');
    div.style.cssText = `padding:6px 0; border-bottom:1px solid var(--border-subtle); font-size:0.78rem; display:flex; gap:8px; animation: slideInAlert 0.3s ease;`;
    div.innerHTML = `
        <span style="font-family:var(--font-mono); font-size:0.7rem; color:var(--text-muted); white-space:nowrap;">${time}</span>
        <span style="color:${colors[type] || colors.info};">${message}</span>
    `;

    log.insertBefore(div, log.firstChild);
    while (log.children.length > 50) log.removeChild(log.lastChild);
}

// ── Simulator Toggle ─────────────────────────────────────────────────────────
async function toggleSimulator() {
    const btn = document.getElementById('btnStartSim');
    try {
        if (!simulatorRunning) {
            await fetch(`${API_BASE}/api/simulator/start`, { method: 'POST' });
            simulatorRunning = true;
            btn.textContent = '⏹ Stop Sim';
            btn.className = 'btn btn-danger';
            addMissionLog('🧪 Data simulator STARTED', 'info');
        } else {
            await fetch(`${API_BASE}/api/simulator/stop`, { method: 'POST' });
            simulatorRunning = false;
            btn.textContent = '▶ Simulator';
            btn.className = 'btn btn-primary';
            addMissionLog('🧪 Data simulator STOPPED', 'info');
        }
    } catch (err) {
        console.error('Simulator toggle error:', err);
    }
}

// ============================================================================
// 🧠 Camera AI Vision Detection UI
// ============================================================================

/**
 * Update the AI Vision badge in the header.
 * Shows whether the COCO-SSD model is loaded and camera is active.
 */
function updateVisionBadge(status) {
    const badge = document.getElementById('visionBadge');
    const text = document.getElementById('visionStatusText');

    if (!badge || !text) return;

    if (status.cameraOnline && status.modelLoaded) {
        text.textContent = 'AI ON';
        badge.style.borderColor = 'var(--accent-green)';
        badge.style.color = 'var(--accent-green)';
    } else if (status.modelLoaded && !status.cameraOnline) {
        text.textContent = 'NO CAM';
        badge.style.borderColor = 'var(--accent-yellow)';
        badge.style.color = 'var(--accent-yellow)';
    } else {
        text.textContent = 'AI OFF';
        badge.style.borderColor = 'var(--text-muted)';
        badge.style.color = 'var(--text-muted)';
    }
}

/**
 * Update the vision detection status bar under the video feed.
 * Shows camera AI detection result + person count.
 */
function updateVisionDetectionBar(data) {
    const camStatus = document.getElementById('visionCamStatus');
    if (!camStatus) return;

    if (!data.cameraOnline) {
        camStatus.textContent = 'OFFLINE';
        camStatus.style.color = 'var(--text-muted)';
    } else if (data.detected) {
        camStatus.textContent = `${data.personCount} PERSON${data.personCount > 1 ? 'S' : ''} (${data.maxConfidence.toFixed(0)}%)`;
        camStatus.style.color = 'var(--accent-green)';
    } else {
        camStatus.textContent = 'NO PERSON';
        camStatus.style.color = 'var(--accent-yellow)';
    }

    // Also update the header badge
    updateVisionBadge({
        cameraOnline: data.cameraOnline,
        modelLoaded: true,
        analysisRunning: true
    });
}

/**
 * Update the combined fusion result display (Camera + Thermal).
 * Called when telemetry arrives with AI fusion data.
 */
function updateVisionFusion(aiResult, visionData) {
    const thermalStatus = document.getElementById('visionThermalStatus');
    const fusionResult = document.getElementById('visionFusionResult');

    if (!thermalStatus || !fusionResult) return;

    // Update thermal status
    if (aiResult.fusion && aiResult.fusion.thermal) {
        const thermal = aiResult.fusion.thermal;
        if (thermal.isBodyHeat) {
            thermalStatus.textContent = `BODY HEAT (${thermal.objectTemp.toFixed(1)}°C)`;
            thermalStatus.style.color = 'var(--accent-green)';
        } else {
            thermalStatus.textContent = `${thermal.objectTemp.toFixed(1)}°C`;
            thermalStatus.style.color = 'var(--text-muted)';
        }
    }

    // Update combined fusion result
    const classification = aiResult.classification || 'no_detection';
    const confidence = aiResult.confidence || 0;
    const method = aiResult.detectionMethod || '';

    if (classification === 'alive') {
        fusionResult.textContent = `🟢 ALIVE ${confidence}%`;
        fusionResult.style.color = 'var(--accent-green)';
    } else if (classification === 'uncertain') {
        fusionResult.textContent = `🟡 UNCERTAIN ${confidence}%`;
        fusionResult.style.color = 'var(--accent-yellow)';
    } else if (classification === 'deceased') {
        fusionResult.textContent = `🔴 DECEASED ${confidence}%`;
        fusionResult.style.color = 'var(--accent-red)';
    } else {
        fusionResult.textContent = 'No Detection';
        fusionResult.style.color = 'var(--text-muted)';
    }

    // Update camera AI status from vision data
    if (visionData) {
        updateVisionDetectionBar(visionData);
    }
}
