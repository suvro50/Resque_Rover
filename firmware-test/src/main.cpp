// ============================================================================
// GridZero — Motor Test Firmware
// ============================================================================
// Purpose: Test 4x TT motors using L298N + ESP32 via phone WiFi
// Control: Open ESP32's IP in phone browser → touch buttons to drive
//
// Wiring:
//   L298N Channel A (OUT1, OUT2) → Left Motor 1 + Left Motor 2 (parallel)
//   L298N Channel B (OUT3, OUT4) → Right Motor 3 + Right Motor 4 (parallel)
//   ENA → GPIO 4 (PWM speed control)
//   ENB → GPIO 5 (PWM speed control)
//   IN1 → GPIO 16, IN2 → GPIO 17
//   IN3 → GPIO 18, IN4 → GPIO 19
//   L298N 12V → Battery 8.4V (2S LiPo)
//   L298N GND → Battery (-) + ESP32 GND
// ============================================================================

#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>

// ============================================================================
// 📍 PIN DEFINITIONS (Same as your main firmware)
// ============================================================================
#define MOTOR_LEFT_IN1    16   // Left motor direction pin 1
#define MOTOR_LEFT_IN2    17   // Left motor direction pin 2
#define MOTOR_RIGHT_IN3   18   // Right motor direction pin 1
#define MOTOR_RIGHT_IN4   19   // Right motor direction pin 2
#define MOTOR_LEFT_ENA    4    // Left motor PWM (speed)
#define MOTOR_RIGHT_ENB   5    // Right motor PWM (speed)

// PWM Config
#define PWM_CHANNEL_LEFT  0
#define PWM_CHANNEL_RIGHT 1
#define PWM_FREQUENCY     1000
#define PWM_RESOLUTION    8    // 0-255

// ============================================================================
// 🔧 CONFIGURATION — CHANGE YOUR WIFI HERE!
// ============================================================================
const char* WIFI_SSID     = "Falcon";       // ← তোমার WiFi নাম
const char* WIFI_PASSWORD = "falcon.9c";    // ← তোমার WiFi পাসওয়ার্ড

// ============================================================================
// 📦 GLOBALS
// ============================================================================
WebServer server(80);
int currentSpeed = 200;  // Default speed (0-255)

// ============================================================================
// 🏎️ MOTOR FUNCTIONS
// ============================================================================

void stopMotors() {
    digitalWrite(MOTOR_LEFT_IN1, LOW);
    digitalWrite(MOTOR_LEFT_IN2, LOW);
    digitalWrite(MOTOR_RIGHT_IN3, LOW);
    digitalWrite(MOTOR_RIGHT_IN4, LOW);
    ledcWrite(PWM_CHANNEL_LEFT, 0);
    ledcWrite(PWM_CHANNEL_RIGHT, 0);
    Serial.println("⏹ STOP");
}

void moveForward() {
    digitalWrite(MOTOR_LEFT_IN1, HIGH);
    digitalWrite(MOTOR_LEFT_IN2, LOW);
    digitalWrite(MOTOR_RIGHT_IN3, HIGH);
    digitalWrite(MOTOR_RIGHT_IN4, LOW);
    ledcWrite(PWM_CHANNEL_LEFT, currentSpeed);
    ledcWrite(PWM_CHANNEL_RIGHT, currentSpeed);
    Serial.printf("⬆ FORWARD (speed: %d)\n", currentSpeed);
}

void moveBackward() {
    digitalWrite(MOTOR_LEFT_IN1, LOW);
    digitalWrite(MOTOR_LEFT_IN2, HIGH);
    digitalWrite(MOTOR_RIGHT_IN3, LOW);
    digitalWrite(MOTOR_RIGHT_IN4, HIGH);
    ledcWrite(PWM_CHANNEL_LEFT, currentSpeed);
    ledcWrite(PWM_CHANNEL_RIGHT, currentSpeed);
    Serial.printf("⬇ BACKWARD (speed: %d)\n", currentSpeed);
}

void turnLeft() {
    digitalWrite(MOTOR_LEFT_IN1, LOW);
    digitalWrite(MOTOR_LEFT_IN2, HIGH);   // Left backward
    digitalWrite(MOTOR_RIGHT_IN3, HIGH);
    digitalWrite(MOTOR_RIGHT_IN4, LOW);   // Right forward
    ledcWrite(PWM_CHANNEL_LEFT, currentSpeed);
    ledcWrite(PWM_CHANNEL_RIGHT, currentSpeed);
    Serial.printf("⬅ LEFT (speed: %d)\n", currentSpeed);
}

void turnRight() {
    digitalWrite(MOTOR_LEFT_IN1, HIGH);
    digitalWrite(MOTOR_LEFT_IN2, LOW);    // Left forward
    digitalWrite(MOTOR_RIGHT_IN3, LOW);
    digitalWrite(MOTOR_RIGHT_IN4, HIGH);  // Right backward
    ledcWrite(PWM_CHANNEL_LEFT, currentSpeed);
    ledcWrite(PWM_CHANNEL_RIGHT, currentSpeed);
    Serial.printf("➡ RIGHT (speed: %d)\n", currentSpeed);
}

void initMotors() {
    pinMode(MOTOR_LEFT_IN1, OUTPUT);
    pinMode(MOTOR_LEFT_IN2, OUTPUT);
    pinMode(MOTOR_RIGHT_IN3, OUTPUT);
    pinMode(MOTOR_RIGHT_IN4, OUTPUT);

    ledcSetup(PWM_CHANNEL_LEFT, PWM_FREQUENCY, PWM_RESOLUTION);
    ledcSetup(PWM_CHANNEL_RIGHT, PWM_FREQUENCY, PWM_RESOLUTION);
    ledcAttachPin(MOTOR_LEFT_ENA, PWM_CHANNEL_LEFT);
    ledcAttachPin(MOTOR_RIGHT_ENB, PWM_CHANNEL_RIGHT);

    stopMotors();
    Serial.println("✅ Motors initialized");
}

// ============================================================================
// 🌐 WEB PAGE — Phone Controller UI
// ============================================================================

const char HTML_PAGE[] PROGMEM = R"rawliteral(
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
<title>GridZero Tank Controller</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  
  body {
    background: #0a0e17;
    color: #f1f5f9;
    font-family: 'Segoe UI', system-ui, sans-serif;
    height: 100vh;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    user-select: none;
    -webkit-user-select: none;
  }

  h1 {
    font-size: 1.4rem;
    color: #00f0ff;
    text-shadow: 0 0 20px rgba(0,240,255,0.4);
    margin-bottom: 8px;
    letter-spacing: 2px;
  }

  .status {
    font-size: 0.85rem;
    color: #64748b;
    margin-bottom: 20px;
  }
  .status span { color: #22c55e; }

  /* Speed Control */
  .speed-box {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 24px;
    background: rgba(255,255,255,0.05);
    padding: 10px 20px;
    border-radius: 12px;
    border: 1px solid rgba(0,240,255,0.15);
  }
  .speed-box label { font-size: 0.9rem; color: #94a3b8; }
  .speed-val {
    font-size: 1.2rem;
    font-weight: bold;
    color: #00f0ff;
    min-width: 40px;
    text-align: center;
  }
  input[type="range"] {
    -webkit-appearance: none;
    width: 160px;
    height: 6px;
    border-radius: 3px;
    background: linear-gradient(90deg, #1e293b, #00f0ff);
    outline: none;
  }
  input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: #00f0ff;
    box-shadow: 0 0 10px rgba(0,240,255,0.5);
    cursor: pointer;
  }

  /* D-Pad Layout */
  .controls {
    display: grid;
    grid-template-columns: 90px 90px 90px;
    grid-template-rows: 90px 90px 90px;
    gap: 8px;
  }

  .btn {
    width: 90px;
    height: 90px;
    border: 2px solid rgba(0,240,255,0.3);
    border-radius: 16px;
    background: rgba(0,240,255,0.08);
    color: #00f0ff;
    font-size: 2rem;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: all 0.1s;
    position: relative;
    overflow: hidden;
  }

  .btn::after {
    content: '';
    position: absolute;
    inset: 0;
    background: radial-gradient(circle, rgba(0,240,255,0.3), transparent);
    opacity: 0;
    transition: opacity 0.15s;
  }

  .btn:active, .btn.active {
    background: rgba(0,240,255,0.25);
    border-color: #00f0ff;
    box-shadow: 0 0 25px rgba(0,240,255,0.4);
    transform: scale(0.95);
  }
  .btn:active::after, .btn.active::after { opacity: 1; }

  .btn-stop {
    border-color: rgba(239,68,68,0.4);
    background: rgba(239,68,68,0.1);
    color: #ef4444;
    font-size: 1.2rem;
    font-weight: bold;
  }
  .btn-stop:active, .btn-stop.active {
    background: rgba(239,68,68,0.3);
    border-color: #ef4444;
    box-shadow: 0 0 25px rgba(239,68,68,0.4);
  }

  .empty { visibility: hidden; }

  /* Current Action Display */
  .action {
    margin-top: 20px;
    font-size: 1rem;
    color: #64748b;
    height: 24px;
  }
  .action.moving { color: #22c55e; font-weight: bold; }

  /* Info */
  .info {
    position: fixed;
    bottom: 12px;
    font-size: 0.7rem;
    color: #334155;
  }
</style>
</head>
<body>

<h1>⚡ GRIDZERO TANK</h1>
<div class="status">WiFi Connected • <span>●</span> Online</div>

<div class="speed-box">
  <label>Speed</label>
  <input type="range" id="speed" min="80" max="255" value="200" oninput="setSpeed(this.value)">
  <div class="speed-val" id="speedVal">200</div>
</div>

<div class="controls">
  <div class="empty"></div>
  <div class="btn" id="btnFwd" data-cmd="forward">▲</div>
  <div class="empty"></div>
  
  <div class="btn" id="btnLeft" data-cmd="left">◄</div>
  <div class="btn btn-stop" id="btnStop" data-cmd="stop">STOP</div>
  <div class="btn" id="btnRight" data-cmd="right">►</div>
  
  <div class="empty"></div>
  <div class="btn" id="btnBack" data-cmd="backward">▼</div>
  <div class="empty"></div>
</div>

<div class="action" id="action">Ready to drive!</div>

<div class="info">GridZero Motor Test • Touch & Hold to drive</div>

<script>
  const actionEl = document.getElementById('action');
  const labels = {
    forward: '⬆ Moving Forward',
    backward: '⬇ Moving Backward',
    left: '⬅ Turning Left',
    right: '➡ Turning Right',
    stop: '⏹ Stopped'
  };

  function sendCmd(cmd) {
    fetch('/' + cmd).catch(() => {});
    actionEl.textContent = labels[cmd] || cmd;
    actionEl.className = cmd === 'stop' ? 'action' : 'action moving';
  }

  function setSpeed(val) {
    document.getElementById('speedVal').textContent = val;
    fetch('/speed?val=' + val).catch(() => {});
  }

  // Touch & Hold — motors run while touching, stop on release
  document.querySelectorAll('.btn').forEach(btn => {
    const cmd = btn.dataset.cmd;

    // Touch events (mobile)
    btn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      btn.classList.add('active');
      sendCmd(cmd);
    });
    btn.addEventListener('touchend', (e) => {
      e.preventDefault();
      btn.classList.remove('active');
      if (cmd !== 'stop') sendCmd('stop');
    });
    btn.addEventListener('touchcancel', (e) => {
      e.preventDefault();
      btn.classList.remove('active');
      if (cmd !== 'stop') sendCmd('stop');
    });

    // Mouse events (desktop testing)
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      btn.classList.add('active');
      sendCmd(cmd);
    });
    btn.addEventListener('mouseup', (e) => {
      e.preventDefault();
      btn.classList.remove('active');
      if (cmd !== 'stop') sendCmd('stop');
    });
    btn.addEventListener('mouseleave', (e) => {
      if (btn.classList.contains('active')) {
        btn.classList.remove('active');
        if (cmd !== 'stop') sendCmd('stop');
      }
    });
  });

  // Keyboard controls (for testing on PC)
  const keyMap = {
    'ArrowUp': 'forward', 'w': 'forward', 'W': 'forward',
    'ArrowDown': 'backward', 's': 'backward', 'S': 'backward',
    'ArrowLeft': 'left', 'a': 'left', 'A': 'left',
    'ArrowRight': 'right', 'd': 'right', 'D': 'right',
    ' ': 'stop'
  };

  document.addEventListener('keydown', (e) => {
    if (keyMap[e.key] && !e.repeat) sendCmd(keyMap[e.key]);
  });
  document.addEventListener('keyup', (e) => {
    if (keyMap[e.key] && keyMap[e.key] !== 'stop') sendCmd('stop');
  });
</script>

</body>
</html>
)rawliteral";

// ============================================================================
// 🌐 WEB SERVER HANDLERS
// ============================================================================

void handleRoot()     { server.send(200, "text/html", HTML_PAGE); }
void handleForward()  { moveForward();  server.send(200, "text/plain", "OK"); }
void handleBackward() { moveBackward(); server.send(200, "text/plain", "OK"); }
void handleLeft()     { turnLeft();     server.send(200, "text/plain", "OK"); }
void handleRight()    { turnRight();    server.send(200, "text/plain", "OK"); }
void handleStop()     { stopMotors();   server.send(200, "text/plain", "OK"); }

void handleSpeed() {
    if (server.hasArg("val")) {
        currentSpeed = constrain(server.arg("val").toInt(), 0, 255);
        Serial.printf("🎚 Speed set to: %d\n", currentSpeed);
    }
    server.send(200, "text/plain", "OK");
}

// ============================================================================
// 🚀 SETUP
// ============================================================================

void setup() {
    Serial.begin(115200);
    delay(1000);

    Serial.println("\n");
    Serial.println("═══════════════════════════════════════════════");
    Serial.println("   GridZero — Motor Test (L298N + WiFi)");
    Serial.println("   4x TT Motor Control via Phone Browser");
    Serial.println("═══════════════════════════════════════════════\n");

    // Initialize motors
    initMotors();

    // Connect to WiFi
    Serial.printf("📡 Connecting to WiFi: %s\n", WIFI_SSID);
    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

    int attempts = 0;
    while (WiFi.status() != WL_CONNECTED && attempts < 20) {
        delay(500);
        Serial.print(".");
        attempts++;
    }

    if (WiFi.status() == WL_CONNECTED) {
        Serial.println("\n✅ WiFi Connected!");
        Serial.print("   IP Address: ");
        Serial.println(WiFi.localIP());
    } else {
        Serial.println("\n❌ WiFi Failed! Restarting...");
        delay(3000);
        ESP.restart();
    }

    // Setup web server routes
    server.on("/", handleRoot);
    server.on("/forward", handleForward);
    server.on("/backward", handleBackward);
    server.on("/left", handleLeft);
    server.on("/right", handleRight);
    server.on("/stop", handleStop);
    server.on("/speed", handleSpeed);
    server.begin();

    Serial.println("\n═══════════════════════════════════════════════");
    Serial.printf("   🎮 Open in phone browser:\n");
    Serial.printf("   http://%s\n", WiFi.localIP().toString().c_str());
    Serial.println("   \n   Touch & Hold buttons to drive!");
    Serial.println("═══════════════════════════════════════════════\n");
}

// ============================================================================
// 🔄 MAIN LOOP
// ============================================================================

void loop() {
    server.handleClient();

    // Auto-reconnect WiFi
    if (WiFi.status() != WL_CONNECTED) {
        Serial.println("⚠️ WiFi lost — reconnecting...");
        stopMotors();  // Safety: stop motors if WiFi drops
        WiFi.reconnect();
        delay(5000);
    }
}
