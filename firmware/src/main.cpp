// Autonomous Cyber-Physical Rescue Rover — Main Controller
// Target: ESP32 Dev Board (38-pin)
// Modules:
//   1. WiFiManager    — Connect + auto-reconnect to Wi-Fi
//   2. ThermalSensor  — MLX90614 I2C temperature reading
//   3. GasSensor      — MQ-9 ADC reading + gas concentration estimation
//   4. UltrasonicSensor — HC-SR04 x2 (front + side) distance measurement
//   5. MotorControl   — L298N H-Bridge dual motor control with PWM
//   6. Telemetry      — HTTP POST sensor data to server
//   7. CommandReceiver — Receive motor commands from server
//   8. Autonomous Nav  — Ultrasonic-based obstacle avoidance

#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <cmath>

// Forward declarations
void stopMotors();
void connectWiFi();
void checkWiFi();
void fetchServerCommands();
// ============================================================================
// 📍 PIN DEFINITIONS
// ============================================================================

// ── MLX90614 Thermal Sensor (I2C) — [DISABLED: Not connected yet] ──────────
// NOTE: GPIO 21 & 22 are now used by L298N #2. If you later add MLX90614,
//       use GPIO 4 (SDA) and GPIO 15 (SCL) — free safe pins.

// ── MQ-9 Gas Sensor (ADC) ─────────────────────────────────────────────────
// ⚠️ Connect MQ-9: VCC→3.3V, GND→GND, AO→GPIO34 (no resistor needed with 3.3V)
#define MQ9_ANALOG_PIN 34   // ADC1 Channel 6

// ── HC-SR04 Ultrasonic Sensor #1 (Front) ──────────────────────────────────
#define US_FRONT_TRIG  25
#define US_FRONT_ECHO  26

// ── HC-SR04 Ultrasonic Sensor #2 (Back) ───────────────────────────────────
#define US_SIDE_TRIG   27
#define US_SIDE_ECHO   14

// ── L298N #1 — LEFT side motors (Front-Left + Rear-Left) ──────────────────
// ⚠️ ENA and ENB have JUMPER CAPS → always enabled. No PWM needed.
// Channel A (OUT1/OUT2) → Front-Left motor
// Channel B (OUT3/OUT4) → Rear-Left motor
//   Wiring: IN1→G16 | IN2→G17 | IN3→G18 | IN4→G19
#define L1_IN1  16   // L298N#1 IN1 — Left Front  FORWARD
#define L1_IN2  17   // L298N#1 IN2 — Left Front  BACKWARD
#define L1_IN3  18   // L298N#1 IN3 — Left Rear   FORWARD
#define L1_IN4  19   // L298N#1 IN4 — Left Rear   BACKWARD

// ── L298N #2 — RIGHT side motors (Front-Right + Rear-Right) ───────────────
// ⚠️ ENA and ENB have JUMPER CAPS → always enabled. No PWM needed.
// Channel A (OUT1/OUT2) → Front-Right motor
// Channel B (OUT3/OUT4) → Rear-Right motor
//   Wiring: IN1→G21 | IN2→G22 | IN3→G23 | IN4→G32
#define L2_IN1  21   // L298N#2 IN1 — Right Front FORWARD
#define L2_IN2  22   // L298N#2 IN2 — Right Front BACKWARD
#define L2_IN3  23   // L298N#2 IN3 — Right Rear  FORWARD
#define L2_IN4  32   // L298N#2 IN4 — Right Rear  BACKWARD

// ── Battery Voltage Monitor ───────────────────────────────────────────────
// ⚠️ REQUIRES voltage divider (30kΩ + 10kΩ) to be safe. If no resistor,
//    battery readings will be inaccurate but won't damage the ESP32.
#define BATTERY_PIN      35   // ADC1 Channel 7 (voltage divider)

// ── Buzzer (Alerts) ───────────────────────────────────────────────────────
#define BUZZER_PIN       13   // Buzzer for ultrasonic obstacle detection

// ============================================================================
// 🔧 CONFIGURATION
// ============================================================================

// ── Wi-Fi Credentials (Active Network) ────────────────────────────────────
const char* WIFI_SSID     = "RescueTank";           // ← ESP32-CAM hotspot
const char* WIFI_PASSWORD = "12345678";             // ← WiFi password

// ── Server Configuration ──────────────────────────────────────────────────
const char* SERVER_URL = "http://[IP_ADDRESS]"; // ← PC's active IP on PL_507
const int   SERVER_PORT = 3000;

// ── Rover Identity ────────────────────────────────────────────────────────
const char* ROVER_ID = "GZ-ROVER-01";

// ── Timing ────────────────────────────────────────────────────────────────
#define TELEMETRY_INTERVAL_MS   2000   // Send data every 2 seconds
#define HEARTBEAT_INTERVAL_MS   5000   // Heartbeat every 5 seconds
#define COMMAND_CHECK_INTERVAL  150    // Check for commands every 150ms for snappy response
#define WIFI_RECONNECT_DELAY    5000   // Retry Wi-Fi every 5 seconds

// ── Autonomous Navigation Thresholds ──────────────────────────────────────
#define OBSTACLE_DISTANCE_CM    30     // Distance to trigger avoidance (cm)
#define SAFE_DISTANCE_CM        60     // Resume forward when clear (cm)
#define SIDE_CLEAR_DISTANCE_CM  40     // Side must be clear to turn
#define DEFAULT_SPEED           180    // Default motor speed (0-255)
#define TURN_SPEED              150    // Speed during turns

// ── Gas Sensor Calibration ────────────────────────────────────────────────
#define MQ9_RL        10.0     // Load resistance in kΩ
#define MQ9_RO_CLEAN  9.83     // Sensor resistance in clean air (calibrate!)
#define VOLTAGE_REF   3.3      // ESP32 ADC reference voltage

// ============================================================================
// 📦 GLOBAL OBJECTS & VARIABLES
// ============================================================================

bool isThermalSensorAvailable = false;

// ── Sensor Data Structure ─────────────────────────────────────────────────
struct SensorData {
    // Thermal
    float ambientTemp;
    float objectTemp;
    
    // Gas
    int   gasRawADC;
    float gasVoltage;
    float coPPM;
    float methanePPM;
    float lpgPPM;
    String hazardLevel;
    
    // Ultrasonic
    float frontDistance;
    float sideDistance;
    
    // Battery
    float batteryVoltage;
    int   batteryPercent;
    
    // Wi-Fi
    int   wifiRSSI;
};

SensorData currentData;

// ── Operation State ───────────────────────────────────────────────────────
enum OperationMode {
    MODE_IDLE,
    MODE_MANUAL,
    MODE_AUTONOMOUS,
    MODE_RETURNING,
    MODE_EMERGENCY_STOP
};

OperationMode currentMode = MODE_IDLE;
bool isConnected = false;

// ── Timing Variables ──────────────────────────────────────────────────────
unsigned long lastTelemetry = 0;
unsigned long lastHeartbeat = 0;
unsigned long lastCommandCheck = 0;

// ============================================================================
// 🔌 MODULE 1: Wi-Fi Manager
// ============================================================================

/**
 * Connect to Wi-Fi with retry logic and auto-reconnect.
 */
void connectWiFi() {
    Serial.println("\n╔══════════════════════════════════════╗");
    Serial.println("║   GridZero — Connecting to Wi-Fi...  ║");
    Serial.println("╚══════════════════════════════════════╝");
    
    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    
    int attempts = 0;
    while (WiFi.status() != WL_CONNECTED && attempts < 20) {
        delay(500);
        Serial.print(".");
        attempts++;
    }
    
    if (WiFi.status() == WL_CONNECTED) {
        isConnected = true;
        Serial.println("\n✅ Wi-Fi Connected!");
        Serial.print("   IP Address: ");
        Serial.println(WiFi.localIP());
        Serial.print("   RSSI: ");
        Serial.print(WiFi.RSSI());
        Serial.println(" dBm");
    } else {
        isConnected = false;
        Serial.println("\n❌ Wi-Fi Connection Failed!");
        Serial.println("   Will retry in 5 seconds...");
    }
}

/**
 * Check Wi-Fi and reconnect if needed.
 */
void checkWiFi() {
    if (WiFi.status() != WL_CONNECTED) {
        isConnected = false;
        Serial.println("⚠️ Wi-Fi disconnected — reconnecting...");
        connectWiFi();
    } else {
        isConnected = true;
    }
}

// ============================================================================
// 🌡️ MODULE 2: Thermal Sensor (MLX90614)
// ============================================================================

// ============================================================================
// 🌡️ MODULE 2: Thermal Sensor (MLX90614) — [BYPASSED: Not connected yet]
// ============================================================================

/**
 * Thermal sensor initialization (bypassed until hardware is connected).
 */
bool initThermalSensor() {
    Serial.println("ℹ️ Thermal Sensor: DISABLED (hardware not connected, will add later)");
    isThermalSensorAvailable = false;
    return false;
}

/**
 * Read ambient and object temperatures (returns safe room temperature baseline).
 */
void readThermalSensor() {
    currentData.ambientTemp = 26.5;
    currentData.objectTemp = 27.0;
}

// ============================================================================
// 💨 MODULE 3: Gas Sensor (MQ-9)
// ============================================================================

/**
 * Initialize MQ-9 gas sensor ADC pin.
 */
void initGasSensor() {
    pinMode(MQ9_ANALOG_PIN, INPUT);
    analogSetAttenuation(ADC_11db);  // Full range: 0-3.3V
    Serial.println("✅ MQ-9 Gas Sensor initialized (ADC pin " + String(MQ9_ANALOG_PIN) + ")");
}

/**
 * Read MQ-9 sensor and estimate gas concentrations.
 * MQ-9 needs 20-30 seconds warm-up — ADC will be low during this period.
 */
void readGasSensor() {
    // Read raw ADC value (12-bit: 0-4095)
    currentData.gasRawADC = analogRead(MQ9_ANALOG_PIN);
    
    // Convert to voltage
    currentData.gasVoltage = (currentData.gasRawADC / 4095.0) * VOLTAGE_REF;
    
    // Guard: if voltage too low, sensor is warming up or not connected
    if (currentData.gasVoltage < 0.1 || currentData.gasRawADC < 200) {
        // Sensor warming up — set PPM to 0, dashboard will show warm-up
        currentData.coPPM     = 0;
        currentData.methanePPM = 0;
        currentData.lpgPPM    = 0;
        currentData.hazardLevel = "safe";
        return;  // Skip calculation
    }
    
    // Calculate sensor resistance (Rs)
    // Rs = ((Vc * RL) / Vout) - RL
    float rs = ((VOLTAGE_REF * MQ9_RL) / currentData.gasVoltage) - MQ9_RL;
    if (rs <= 0) rs = 0.1;  // prevent negative/zero Rs
    
    float ratio = rs / MQ9_RO_CLEAN;
    if (ratio <= 0) ratio = 0.1;  // prevent log of zero
    
    float logRatio = std::log10(ratio);
    
    // CO: Rs/Ro curve (MQ-9 datasheet approximation)
    currentData.coPPM = std::pow(10, ((logRatio - 0.37) / -0.44));
    if (std::isnan(currentData.coPPM) || currentData.coPPM < 0) currentData.coPPM = 0;
    if (currentData.coPPM > 1000) currentData.coPPM = 1000;
    
    // Methane
    currentData.methanePPM = std::pow(10, ((logRatio - 0.46) / -0.37));
    if (std::isnan(currentData.methanePPM) || currentData.methanePPM < 0) currentData.methanePPM = 0;
    if (currentData.methanePPM > 500) currentData.methanePPM = 500;
    
    // LPG
    currentData.lpgPPM = std::pow(10, ((logRatio - 0.42) / -0.45));
    if (std::isnan(currentData.lpgPPM) || currentData.lpgPPM < 0) currentData.lpgPPM = 0;
    if (currentData.lpgPPM > 500) currentData.lpgPPM = 500;
    
    // Determine hazard level
    if (currentData.coPPM > 100 || currentData.methanePPM > 50) {
        currentData.hazardLevel = "critical";
    } else if (currentData.coPPM > 50 || currentData.methanePPM > 15) {
        currentData.hazardLevel = "high";
    } else if (currentData.coPPM > 25 || currentData.methanePPM > 5) {
        currentData.hazardLevel = "moderate";
    } else if (currentData.coPPM > 9) {
        currentData.hazardLevel = "low";
    } else {
        currentData.hazardLevel = "safe";
    }
}

// ============================================================================
// 📡 MODULE 4: Ultrasonic Sensors (HC-SR04 x2)
// ============================================================================

/**
 * Initialize ultrasonic sensor pins.
 */
void initUltrasonicSensors() {
    pinMode(US_FRONT_TRIG, OUTPUT);
    pinMode(US_FRONT_ECHO, INPUT);
    pinMode(US_SIDE_TRIG, OUTPUT);
    pinMode(US_SIDE_ECHO, INPUT);
    pinMode(BUZZER_PIN, OUTPUT);
    digitalWrite(BUZZER_PIN, LOW);
    Serial.println("✅ HC-SR04 Ultrasonic Sensors & Buzzer initialized");
}

/**
 * Measure distance from a single ultrasonic sensor.
 * Returns distance in centimeters.
 */
float measureDistance(int trigPin, int echoPin) {
    // Ensure pins are correctly set before ping
    pinMode(trigPin, OUTPUT);
    pinMode(echoPin, INPUT);
    
    // Ensure trigger is LOW before starting
    digitalWrite(trigPin, LOW);
    delayMicroseconds(5);
    
    // Send 10μs trigger pulse
    digitalWrite(trigPin, HIGH);
    delayMicroseconds(10);
    digitalWrite(trigPin, LOW);
    
    // Manual pulse measurement to avoid pulseIn hanging bugs
    unsigned long max_wait = 25000; // 25ms timeout
    unsigned long start_time = micros();
    
    // Wait for echo pin to go HIGH
    while (digitalRead(echoPin) == LOW) {
        if (micros() - start_time > max_wait) return 400.0;
    }
    
    unsigned long echo_start = micros();
    
    // Wait for echo pin to go LOW
    while (digitalRead(echoPin) == HIGH) {
        if (micros() - echo_start > max_wait) return 400.0;
    }
    
    unsigned long duration = micros() - echo_start;
    
    // Speed of sound: 343 m/s = 0.0343 cm/μs
    // Distance = duration * 0.0343 / 2 (round trip)
    float distance = (duration * 0.0343) / 2.0;
    
    return constrain(distance, 2.0, 400.0);
}

/**
 * Read both ultrasonic sensors and trigger buzzer if object < 20cm.
 */
void readUltrasonicSensors() {
    currentData.frontDistance = measureDistance(US_FRONT_TRIG, US_FRONT_ECHO);
    delay(40);  // Delay between readings to avoid acoustic interference
    currentData.sideDistance = measureDistance(US_SIDE_TRIG, US_SIDE_ECHO);

    // Obstacle detection — threshold: 30cm (matches dashboard display threshold)
    // Buzzer sounds for BOTH front AND side obstacles
    bool frontObstacle = currentData.frontDistance < 30.0 && currentData.frontDistance > 2.0;
    bool sideObstacle  = currentData.sideDistance  < 30.0 && currentData.sideDistance  > 2.0;

    if (frontObstacle || sideObstacle) {
        digitalWrite(BUZZER_PIN, HIGH);  // Continuous buzz for any obstacle
    } else {
        digitalWrite(BUZZER_PIN, LOW);
    }
}

// ============================================================================
// 🔋 MODULE 5: Battery Monitor
// ============================================================================

/**
 * Read battery voltage through voltage divider.
 * 
 * Voltage divider: 11.1V battery → divider (30k + 10k) → max ~2.78V to GPIO
 * Multiply ADC reading by divider ratio to get actual voltage.
 */
void readBattery() {
    int rawADC = analogRead(BATTERY_PIN);
    float adcVoltage = (rawADC / 4095.0) * VOLTAGE_REF;
    
    // Voltage divider ratio: (40k + 10k) / 10k = 5.0 (UPDATED FOR 16.4V BATTERY)
    // ⚠️ IMPORTANT: If using 30k+10k, change the ratio below to 4.0, but ESP32 max input is 3.3V!
    currentData.batteryVoltage = adcVoltage * 5.0; 
    
    // 4S LiPo: 12.0V (empty) to 16.8V (full)
    currentData.batteryPercent = map(
        constrain(currentData.batteryVoltage * 100, 1200, 1680),
        1200, 1680, 0, 100
    );
    
    currentData.wifiRSSI = WiFi.RSSI();
}

// ============================================================================
// 🏎️ MODULE 6: Motor Control (L298N — 4-Pin Direct Control)
// ============================================================================
// Note: ENA and ENB have hardware jumpers to 5V (always enabled).
// Direction and movement are controlled purely by HIGH/LOW on IN1..IN4.

/**
 * Initialize ALL motor driver pins (2× L298N, 8 pins total) as digital outputs.
 */
void initMotors() {
    // L298N #1 — Left side
    pinMode(L1_IN1, OUTPUT);
    pinMode(L1_IN2, OUTPUT);
    pinMode(L1_IN3, OUTPUT);
    pinMode(L1_IN4, OUTPUT);
    // L298N #2 — Right side
    pinMode(L2_IN1, OUTPUT);
    pinMode(L2_IN2, OUTPUT);
    pinMode(L2_IN3, OUTPUT);
    pinMode(L2_IN4, OUTPUT);
    
    stopMotors();
    Serial.println("✅ Dual L298N Motor Driver initialized (4 TT motors)");
    Serial.println("   L298N#1 (LEFT):  IN1→G16 | IN2→G17 | IN3→G18 | IN4→G19");
    Serial.println("   L298N#2 (RIGHT): IN1→G21 | IN2→G22 | IN3→G23 | IN4→G32");
    Serial.println("   ENA & ENB: Jumper caps on both boards (always HIGH)");
}

// ── Dual L298N 4-Motor Logic ───────────────────────────────────────────────
// LEFT  side: L1_IN1=H,L1_IN2=L,L1_IN3=H,L1_IN4=L  → Forward (both left motors)
//             L1_IN1=L,L1_IN2=H,L1_IN3=L,L1_IN4=H  → Backward
// RIGHT side: L2_IN1=H,L2_IN2=L,L2_IN3=H,L2_IN4=L  → Forward (both right motors)
//             L2_IN1=L,L2_IN2=H,L2_IN3=L,L2_IN4=H  → Backward

inline void setLeftMotors(bool fwd) {
    digitalWrite(L1_IN1, fwd ? HIGH : LOW);
    digitalWrite(L1_IN2, fwd ? LOW  : HIGH);
    digitalWrite(L1_IN3, fwd ? HIGH : LOW);
    digitalWrite(L1_IN4, fwd ? LOW  : HIGH);
}

inline void setRightMotors(bool fwd) {
    digitalWrite(L2_IN1, fwd ? HIGH : LOW);
    digitalWrite(L2_IN2, fwd ? LOW  : HIGH);
    digitalWrite(L2_IN3, fwd ? HIGH : LOW);
    digitalWrite(L2_IN4, fwd ? LOW  : HIGH);
}

void moveForward() {
    setLeftMotors(true);
    setRightMotors(true);
}

void moveBackward() {
    setLeftMotors(false);
    setRightMotors(false);
}

void turnLeft() {
    // Left side backward, Right side forward → pivot left in place
    setLeftMotors(false);
    setRightMotors(true);
}

void turnRight() {
    // Left side forward, Right side backward → pivot right in place
    setLeftMotors(true);
    setRightMotors(false);
}

void stopMotors() {
    // All inputs LOW → both L298N channels coast to stop
    digitalWrite(L1_IN1, LOW); digitalWrite(L1_IN2, LOW);
    digitalWrite(L1_IN3, LOW); digitalWrite(L1_IN4, LOW);
    digitalWrite(L2_IN1, LOW); digitalWrite(L2_IN2, LOW);
    digitalWrite(L2_IN3, LOW); digitalWrite(L2_IN4, LOW);
}

// ============================================================================
// 📤 MODULE 7: Telemetry (HTTP POST to Server)
// ============================================================================

/**
 * Send all sensor data to the server as JSON via HTTP POST.
 */
void sendTelemetry() {
    if (!isConnected) return;
    
    // Build JSON payload
    JsonDocument doc;
    doc["rover_id"] = ROVER_ID;
    
    doc["thermal"]["ambient"] = std::round(currentData.ambientTemp * 100) / 100.0;
    doc["thermal"]["object"] = std::round(currentData.objectTemp * 100) / 100.0;
    
    doc["gas"]["raw_adc"] = currentData.gasRawADC;
    doc["gas"]["voltage"] = std::round(currentData.gasVoltage * 1000) / 1000.0;
    doc["gas"]["co_ppm"] = std::round(currentData.coPPM * 100) / 100.0;
    doc["gas"]["methane_ppm"] = std::round(currentData.methanePPM * 100) / 100.0;
    doc["gas"]["lpg_ppm"] = std::round(currentData.lpgPPM * 100) / 100.0;
    doc["gas"]["hazard"] = currentData.hazardLevel;
    
    doc["ultrasonic"]["front"] = std::round(currentData.frontDistance * 100) / 100.0;
    doc["ultrasonic"]["side"] = std::round(currentData.sideDistance * 100) / 100.0;
    doc["ultrasonic"]["side_position"] = "left";
    
    doc["battery"]["voltage"] = std::round(currentData.batteryVoltage * 100) / 100.0;
    doc["battery"]["percent"] = currentData.batteryPercent;
    
    doc["wifi_rssi"] = currentData.wifiRSSI;
    
    String jsonPayload;
    serializeJson(doc, jsonPayload);
    
    // Send HTTP POST
    HTTPClient http;
    String url = String(SERVER_URL) + "/api/telemetry";
    http.begin(url);
    http.addHeader("Content-Type", "application/json");
    
    int httpCode = http.POST(jsonPayload);
    
    if (httpCode == 201) {
        // Success — silent
    } else {
        Serial.print("⚠️ Telemetry send failed: ");
        Serial.println(httpCode);
    }
    
    http.end();
}

/**
 * Send heartbeat to keep rover status "online" on server.
 */
void sendHeartbeat() {
    if (!isConnected) return;
    
    JsonDocument doc;
    doc["rover_id"] = ROVER_ID;
    doc["ip_address"] = WiFi.localIP().toString();
    doc["battery_voltage"] = currentData.batteryVoltage;
    doc["battery_percent"] = currentData.batteryPercent;
    doc["wifi_rssi"] = currentData.wifiRSSI;
    
    String jsonPayload;
    serializeJson(doc, jsonPayload);
    
    String url = String(SERVER_URL) + "/api/rover/status";
    HTTPClient http;
    http.begin(url);
    http.addHeader("Content-Type", "application/json");
    http.POST(jsonPayload);
    http.end();
}

// ============================================================================
// 📥 MODULE 8: Command Receiver
// ============================================================================

/**
 * Check server for motor commands and operation mode changes.
 * Uses the dedicated /api/rover/command endpoint for fast, lightweight polling.
 * Returns: is_active, command, operation_mode, motor_left_speed, motor_right_speed
 */
void fetchServerCommands() {
    if (!isConnected) return;
    
    // Throttle checks
    static unsigned long lastCheck = 0;
    if (millis() - lastCheck < COMMAND_CHECK_INTERVAL) return;
    lastCheck = millis();

    // ── Use the fast dedicated command endpoint (no DB join, pure in-memory) ──
    String url = String(SERVER_URL) + "/api/rover/command?rover_id=" + String(ROVER_ID);
    HTTPClient http;
    http.setTimeout(500);   // 500ms timeout — don't block the loop
    http.begin(url);
    int httpCode = http.GET();
    
    if (httpCode == 200) {
        String payload = http.getString();
        
        JsonDocument doc;
        DeserializationError error = deserializeJson(doc, payload);
        
        if (!error && doc["success"] == true) {
            String modeStr   = doc["data"]["operation_mode"].as<String>();
            bool   isActive  = doc["data"]["is_active"]  | false;
            String cmd       = doc["data"]["command"].as<String>();
            int    leftSpeed = doc["data"]["motor_left_speed"]  | 0;
            int    rightSpeed= doc["data"]["motor_right_speed"] | 0;
            
            // 1. Rover not started / emergency stop → halt immediately
            if (!isActive || modeStr == "emergency_stop" || modeStr == "idle" || modeStr == "stopped") {
                currentMode = (modeStr == "emergency_stop") ? MODE_EMERGENCY_STOP : MODE_IDLE;
                stopMotors();
                http.end();
                return;
            }

            // 2. Autonomous mode → navigation handled in loop()
            if (modeStr == "autonomous") {
                currentMode = MODE_AUTONOMOUS;
                http.end();
                return;
            }

            // 3. Manual mode — execute direction command
            currentMode = MODE_MANUAL;

            // Primary: use command string; fallback: use motor speed signs
            if      (cmd == "forward"  || (cmd == "stop" && leftSpeed > 0 && rightSpeed > 0))  { moveForward();  }
            else if (cmd == "backward" || (cmd == "stop" && leftSpeed < 0 && rightSpeed < 0))  { moveBackward(); }
            else if (cmd == "left"     || (cmd == "stop" && leftSpeed < 0 && rightSpeed > 0))  { turnLeft();     }
            else if (cmd == "right"    || (cmd == "stop" && leftSpeed > 0 && rightSpeed < 0))  { turnRight();    }
            else    /* cmd == "stop" or unknown */                                              { stopMotors();   }
        }
    } else {
        Serial.print("⚠️ Command fetch failed HTTP: ");
        Serial.println(httpCode);
    }
    http.end();
}

// ============================================================================
// 🧭 MODULE 9: Autonomous Navigation
// ============================================================================

/**
 * Simple obstacle avoidance algorithm using dual ultrasonic sensors.
 */
void autonomousNavigate() {
    float front = currentData.frontDistance;
    float side = currentData.sideDistance;
    
    if (front > SAFE_DISTANCE_CM) {
        // Path is clear — move forward
        moveForward();
    }
    else if (front <= OBSTACLE_DISTANCE_CM) {
        // Obstacle detected! Stop and decide direction
        stopMotors();
        delay(100);
        
        if (side > SIDE_CLEAR_DISTANCE_CM) {
            turnLeft();
            delay(400);  // Turn for 400ms
        } else {
            turnRight();
            delay(400);
        }
        stopMotors();
    }
    else {
        moveForward();
    }
}

// ============================================================================
// 🚀 SETUP
// ============================================================================

void setup() {
    Serial.begin(115200);
    delay(1000);
    
    Serial.println("\n");
    Serial.println("═══════════════════════════════════════════════");
    Serial.println("   GridZero — Autonomous Rescue Rover v1.0");
    Serial.println("   Prepared By: Suvrojit Bose Sarthok & Team");
    Serial.println("   United International University — CSE");
    Serial.println("═══════════════════════════════════════════════\n");
    
    // Initialize modules
    Serial.println("📦 Initializing modules...\n");
    
    initThermalSensor();
    initGasSensor();
    initUltrasonicSensors();
    initMotors();
    
    // Connect to Wi-Fi
    connectWiFi();
    
    // Read initial battery level
    readBattery();
    
    Serial.println("\n═══════════════════════════════════════════════");
    Serial.printf("   Rover ID: %s\n", ROVER_ID);
    Serial.println("   Thermal:  ⏹ Disabled (Not Connected)");
    Serial.printf("   Wi-Fi:    %s\n", isConnected ? "✅ Connected" : "❌ Disconnected");
    Serial.printf("   Battery:  %.1fV (%d%%)\n", currentData.batteryVoltage, currentData.batteryPercent);
    Serial.printf("   Mode:     IDLE\n");
    Serial.println("   Ready to operate! 🤖");
    Serial.println("═══════════════════════════════════════════════\n");
}

// ============================================================================
// 🔄 MAIN LOOP
// ============================================================================

void loop() {
    unsigned long now = millis();
    
    // ── Check Wi-Fi connection ────────────────────────────────────────
    if (now % 10000 < 10) {  // Every 10 seconds
        checkWiFi();
    }
    
    // ── Read ALL sensors ──────────────────────────────────────────────
    readThermalSensor();
    readGasSensor();
    readUltrasonicSensors();
    readBattery();
    
    // ── Fetch Server Commands (Mode & Manual Control) ─────────────────
    fetchServerCommands();
    
    // ── Autonomous Navigation (if in autonomous mode) ─────────────────
    switch (currentMode) {
        case MODE_AUTONOMOUS:
            autonomousNavigate();
            break;
        case MODE_EMERGENCY_STOP:
        case MODE_IDLE:
            stopMotors();
            break;
        case MODE_MANUAL:
        case MODE_RETURNING:
        default:
            // For Manual mode, motors are controlled inside fetchServerCommands()
            break;
    }
    
    // ── Send Telemetry (every 2 seconds) ──────────────────────────────
    if (now - lastTelemetry >= TELEMETRY_INTERVAL_MS) {
        lastTelemetry = now;
        sendTelemetry();
        
        // Print to Serial for debugging
        Serial.printf("📡 T:%.1f/%.1f°C | CO:%.1fppm | Front:%.0fcm | Bat:%d%%\n",
            currentData.ambientTemp, currentData.objectTemp,
            currentData.coPPM, currentData.frontDistance,
            currentData.batteryPercent);
    }
    
    // ── Send Heartbeat (every 5 seconds) ──────────────────────────────
    if (now - lastHeartbeat >= HEARTBEAT_INTERVAL_MS) {
        lastHeartbeat = now;
        sendHeartbeat();
    }
    
    // Small delay to prevent watchdog timeout
    delay(50);
}

