/*
 * ============================================================================
 * GridZero Rescue Tank -- ESP32 Standalone Firmware
 * ============================================================================
 * WiFi AP "RescueTank" (192.168.4.1) + WebServer + Obstacle Detection
 *
 * Motor Wiring (dual L298N, ENA/ENB jumper caps -- always enabled):
 *   L298N #1  LEFT : IN1=G16, IN2=G17, IN3=G18, IN4=G19
 *   L298N #2  RIGHT: IN1=G21, IN2=G22, IN3=G23, IN4=G32
 *
 * Sensors & Buzzer:
 *   HC-SR04 Front : TRIG=G25, ECHO=G26  (stops forward  if < 20 cm)
 *   HC-SR04 Rear  : TRIG=G27, ECHO=G14  (stops backward if < 15 cm)
 *   Buzzer        : G13                 (beeps while obstacle nearby)
 * ============================================================================
 */

#include <WiFi.h>
#include <WebServer.h>
#include <Wire.h>
#include <Adafruit_MLX90614.h>

// -- WiFi AP ------------------------------------------------------------------
const char* AP_SSID = "RescueTank";
const char* AP_PASS = "12345678";

// -- Motor Pins ----------------------------------------------------------------
const uint8_t L_FRONT_FWD = 16;
const uint8_t L_FRONT_BWD = 17;
const uint8_t L_REAR_FWD  = 18;
const uint8_t L_REAR_BWD  = 19;
const uint8_t R_FRONT_FWD = 21;
const uint8_t R_FRONT_BWD = 22;
const uint8_t R_REAR_FWD  = 23;
const uint8_t R_REAR_BWD  = 32;

// -- Sensor & Buzzer Pins -----------------------------------------------------
const uint8_t FRONT_TRIG = 25;
const uint8_t FRONT_ECHO = 26;
const uint8_t REAR_TRIG  = 27;
const uint8_t REAR_ECHO  = 14;
const uint8_t BUZZER_PIN = 13;

// -- Safety Thresholds (cm) ---------------------------------------------------
const float FRONT_STOP_CM = 13.0f;   // stop FORWARD  if object < 13 cm
const float REAR_STOP_CM  = 13.0f;   // stop BACKWARD if object < 13 cm

// -- Timing Config ------------------------------------------------------------
const bool          INVERT_LEFT     = false;
const bool          INVERT_RIGHT    = false;
const unsigned long FAILSAFE_MS     = 500;   // ms -- stop if no cmd received
const unsigned long SENSOR_INTERVAL = 80;    // ms between sensor pings
const unsigned long BUZZER_ON_MS    = 120;   // buzzer HIGH duration
const unsigned long BUZZER_OFF_MS   = 180;   // buzzer LOW  duration

// -- Runtime State ------------------------------------------------------------
WebServer server(80);
unsigned long lastCmdMs    = 0;
bool moving                = false;
int  lastLeftDir           = 0;
int  lastRightDir          = 0;

float         frontDist    = 999.0f;
float         rearDist     = 999.0f;
bool          frontBlocked = false;
bool          rearBlocked  = false;

unsigned long lastSensorMs = 0;
bool          pingFront    = true;

bool          buzzerState  = false;
unsigned long buzzerMs     = 0;

Adafruit_MLX90614 mlx = Adafruit_MLX90614();
bool mlxReady = false;
float tempAmbient = 0.0f;
float tempObject  = 0.0f;

// -- Embedded Web UI ----------------------------------------------------------
const char PAGE[] PROGMEM = R"rawliteral(
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>Rescue Tank</title>
<style>
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent;-webkit-user-select:none;user-select:none;touch-action:none}
body{margin:0;background:#111;color:#fff;font-family:Arial,sans-serif;text-align:center}
h1{font-size:22px;margin:16px 0 2px}
#st{font-size:13px;color:#8f8;margin-bottom:4px}
#sens{font-size:12px;color:#aaa;margin-bottom:10px;letter-spacing:.02em}
.pad{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;max-width:380px;margin:0 auto;padding:0 12px}
button{height:90px;font-size:28px;border:0;border-radius:16px;background:#2b3a55;color:#fff;cursor:pointer}
button.on{background:#3d7dff}
button.stop{background:#b22;font-size:20px;font-weight:bold}
</style>
</head>
<body>
<h1>Rescue Tank</h1>
<div id="st">Ready</div>
<div id="sens">Front: -- cm &nbsp;|&nbsp; Rear: -- cm</div>
<div class="pad">
  <button data-c="FL">&#8598;</button>
  <button data-c="F">&#9650;</button>
  <button data-c="FR">&#8599;</button>
  <button data-c="L">&#9664;</button>
  <button data-c="S" class="stop">STOP</button>
  <button data-c="R">&#9654;</button>
  <button data-c="BL">&#8601;</button>
  <button data-c="B">&#9660;</button>
  <button data-c="BR">&#8600;</button>
</div>
<script>
var timer=null,st=document.getElementById('st'),sens=document.getElementById('sens');
function send(c){
  fetch('/cmd?d='+c,{cache:'no-store'})
    .then(r=>r.text()).then(t=>{
      if(t==='BLOCKED'){st.textContent='OBSTACLE! Blocked';st.style.color='#f88';}
      else{st.textContent='Connected';st.style.color='#8f8';}
    }).catch(()=>{st.textContent='Disconnected';st.style.color='#f88';});
}
function stopAll(){if(timer){clearInterval(timer);timer=null;}document.querySelectorAll('button.on').forEach(b=>b.classList.remove('on'));send('S');}
function press(b){
  var c=b.dataset.c;
  if(c==='S'){stopAll();return;}
  if(timer)clearInterval(timer);
  document.querySelectorAll('button.on').forEach(x=>x.classList.remove('on'));
  b.classList.add('on');send(c);
  timer=setInterval(()=>send(c),150);
}
document.querySelectorAll('button').forEach(b=>{
  b.addEventListener('pointerdown',e=>{e.preventDefault();press(b);});
  ['pointerup','pointercancel','pointerleave'].forEach(ev=>b.addEventListener(ev,()=>{if(b.dataset.c!=='S')stopAll();}));
});
document.addEventListener('contextmenu',e=>e.preventDefault());
document.addEventListener('visibilitychange',()=>{if(document.hidden)stopAll();});
setInterval(()=>{
  fetch('/sensors',{cache:'no-store'}).then(r=>r.json()).then(d=>{
    var f=d.front<900?d.front.toFixed(1)+'cm':'--';
    var r=d.rear<900?d.rear.toFixed(1)+'cm':'--';
    sens.textContent='Front: '+f+' | Rear: '+r;
  }).catch(()=>{});
},500);
</script>
</body>
</html>
)rawliteral";

// -- Motor Control ------------------------------------------------------------
void setMotor(uint8_t fwdPin, uint8_t bwdPin, int dir) {
    if      (dir > 0) { digitalWrite(bwdPin, LOW);  digitalWrite(fwdPin, HIGH); }
    else if (dir < 0) { digitalWrite(fwdPin, LOW);  digitalWrite(bwdPin, HIGH); }
    else              { digitalWrite(fwdPin, LOW);  digitalWrite(bwdPin, LOW);  }
}

void applyDrive(int leftDir, int rightDir) {
    if (INVERT_LEFT)  leftDir  = -leftDir;
    if (INVERT_RIGHT) rightDir = -rightDir;
    setMotor(L_FRONT_FWD, L_FRONT_BWD, leftDir);
    setMotor(L_REAR_FWD,  L_REAR_BWD,  leftDir);
    setMotor(R_FRONT_FWD, R_FRONT_BWD, rightDir);
    setMotor(R_REAR_FWD,  R_REAR_BWD,  rightDir);
    lastLeftDir  = leftDir;
    lastRightDir = rightDir;
}

void stopMotors() {
    applyDrive(0, 0);
    moving = false;
}

// -- Ultrasonic Distance (blocking ~5ms, called non-blocking via timer) -------
float measureCm(uint8_t trig, uint8_t echo) {
    digitalWrite(trig, LOW);  delayMicroseconds(2);
    digitalWrite(trig, HIGH); delayMicroseconds(10);
    digitalWrite(trig, LOW);
    long dur = pulseIn(echo, HIGH, 25000);   // 25ms timeout ~ 4m
    if (dur == 0) return 999.0f;
    return (dur * 0.0343f) / 2.0f;
}

// -- Non-blocking sensor update (called every SENSOR_INTERVAL ms) -------------
void updateSensors() {
    if (pingFront) {
        frontDist    = measureCm(FRONT_TRIG, FRONT_ECHO);
        frontBlocked = (frontDist < FRONT_STOP_CM);
    } else {
        rearDist    = measureCm(REAR_TRIG, REAR_ECHO);
        rearBlocked = (rearDist < REAR_STOP_CM);
    }
    pingFront = !pingFront;

    // Read thermal sensor
    if (mlxReady) {
        tempAmbient = mlx.readAmbientTempC();
        tempObject  = mlx.readObjectTempC();
    }

    // If currently moving into an obstacle, stop immediately
    if (moving) {
        bool goingFwd = (lastLeftDir > 0 || lastRightDir > 0);
        bool goingBwd = (lastLeftDir < 0 || lastRightDir < 0);
        if (goingFwd && frontBlocked) {
            stopMotors();
            Serial.printf("[OBSTACLE] Front blocked! %.1f cm\n", frontDist);
        }
        if (goingBwd && rearBlocked) {
            stopMotors();
            Serial.printf("[OBSTACLE] Rear blocked! %.1f cm\n", rearDist);
        }
    }
}

// -- Non-blocking buzzer beep pattern -----------------------------------------
void updateBuzzer() {
    bool obstacle = frontBlocked || rearBlocked;
    if (!obstacle) {
        if (buzzerState) { digitalWrite(BUZZER_PIN, LOW); buzzerState = false; }
        return;
    }
    unsigned long now = millis();
    if (buzzerState  && (now - buzzerMs >= BUZZER_ON_MS))  { digitalWrite(BUZZER_PIN, LOW);  buzzerState = false; buzzerMs = now; }
    if (!buzzerState && (now - buzzerMs >= BUZZER_OFF_MS)) { digitalWrite(BUZZER_PIN, HIGH); buzzerState = true;  buzzerMs = now; }
}

// -- CORS helper --------------------------------------------------------------
void addCORS() {
    server.sendHeader("Access-Control-Allow-Origin",  "*");
    server.sendHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    server.sendHeader("Access-Control-Allow-Headers", "Content-Type");
    server.sendHeader("Cache-Control", "no-store");
}

// -- HTTP Handlers ------------------------------------------------------------
void handleRoot()    { addCORS(); server.send(200, "text/html", PAGE); }
void handleOptions() { addCORS(); server.send(204); }
void handleNotFound(){ addCORS(); server.send(404, "text/plain", "Not found"); }

void handleSensors() {
    addCORS();
    String j = "{\"front\":" + String(frontDist,1) + 
               ",\"rear\":" + String(rearDist,1) + 
               ",\"thermal_ambient\":" + String(tempAmbient,1) +
               ",\"thermal_object\":" + String(tempObject,1) + "}";
    server.send(200, "application/json", j);
}

void handleCmd() {
    addCORS();
    if (!server.hasArg("d")) { server.send(400, "text/plain", "missing d"); return; }

    String d = server.arg("d");

    // Obstacle safety gate
    bool isFwd = (d=="F"||d=="FL"||d=="FR");
    bool isBwd = (d=="B"||d=="BL"||d=="BR");
    if (isFwd && frontBlocked) { server.send(200, "text/plain", "BLOCKED"); return; }
    if (isBwd && rearBlocked)  { server.send(200, "text/plain", "BLOCKED"); return; }

    // Execute command
    if      (d=="F")  applyDrive( 1,  1);
    else if (d=="B")  applyDrive(-1, -1);
    else if (d=="L")  applyDrive(-1,  1);
    else if (d=="R")  applyDrive( 1, -1);
    else if (d=="FL") applyDrive( 0,  1);
    else if (d=="FR") applyDrive( 1,  0);
    else if (d=="BL") applyDrive( 0, -1);
    else if (d=="BR") applyDrive(-1,  0);
    else if (d=="S")  { stopMotors(); server.send(200, "text/plain", "OK"); return; }
    else { server.send(400, "text/plain", "bad command"); return; }

    moving    = true;
    lastCmdMs = millis();
    server.send(200, "text/plain", "OK");
}

// -- setup() ------------------------------------------------------------------
void setup() {
    Serial.begin(115200);
    delay(100);

    // Motor output pins
    uint8_t mPins[] = {
        L_FRONT_FWD,L_FRONT_BWD,L_REAR_FWD,L_REAR_BWD,
        R_FRONT_FWD,R_FRONT_BWD,R_REAR_FWD,R_REAR_BWD
    };
    for (uint8_t i=0; i<sizeof(mPins); i++) { pinMode(mPins[i], OUTPUT); digitalWrite(mPins[i], LOW); }

    // Ultrasonic & buzzer
    pinMode(FRONT_TRIG, OUTPUT); pinMode(FRONT_ECHO, INPUT);
    pinMode(REAR_TRIG,  OUTPUT); pinMode(REAR_ECHO,  INPUT);
    pinMode(BUZZER_PIN, OUTPUT);
    digitalWrite(FRONT_TRIG, LOW);
    digitalWrite(REAR_TRIG,  LOW);
    digitalWrite(BUZZER_PIN, LOW);

    stopMotors();

    // Startup beep: 1 short beep = firmware ready
    digitalWrite(BUZZER_PIN, HIGH); delay(120); digitalWrite(BUZZER_PIN, LOW);

    Serial.println("\n[OK] GridZero Tank Firmware Ready");
    Serial.println("  Front sensor : TRIG=G25 ECHO=G26  stop < 20cm");
    Serial.println("  Rear  sensor : TRIG=G27 ECHO=G14  stop < 15cm");
    Serial.println("  Buzzer       : G13");

    // Init I2C and Thermal Sensor (SDA=4, SCL=15)
    Wire.begin(4, 15);
    delay(250); // Wait for sensor to boot up

    if (!mlx.begin()) {
        Serial.println("[ERR] MLX90614 Thermal Sensor not found!");
        mlxReady = false;
    } else {
        Serial.println("[OK] MLX90614 Thermal Sensor ready");
        mlxReady = true;
    }

    // WiFi AP
    WiFi.mode(WIFI_AP);
    bool ok = WiFi.softAP(AP_SSID, AP_PASS);
    Serial.println(ok ? "[OK] AP started" : "[ERR] AP FAILED");
    Serial.print("  SSID : "); Serial.println(AP_SSID);
    Serial.print("  URL  : http://"); Serial.println(WiFi.softAPIP());

    // Routes
    server.on("/",        HTTP_GET,     handleRoot);
    server.on("/cmd",     HTTP_GET,     handleCmd);
    server.on("/cmd",     HTTP_OPTIONS, handleOptions);
    server.on("/sensors", HTTP_GET,     handleSensors);
    server.onNotFound(handleNotFound);
    server.begin();
    Serial.println("[OK] HTTP server ready\n");
}

// -- loop() -------------------------------------------------------------------
void loop() {
    server.handleClient();

    unsigned long now = millis();

    // Non-blocking sensor ping
    if (now - lastSensorMs >= SENSOR_INTERVAL) {
        lastSensorMs = now;
        updateSensors();
    }

    // Non-blocking buzzer
    updateBuzzer();

    // Failsafe: no command received
    if (moving && (now - lastCmdMs > FAILSAFE_MS)) {
        Serial.println("[FAILSAFE] No cmd -- stopping");
        stopMotors();
    }
}
