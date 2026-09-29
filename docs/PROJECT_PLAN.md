# GridZero: Autonomous Cyber-Physical Rescue System
## Complete Project Blueprint & Development Plan

> **⚠️ IMPORTANT FOR AI ASSISTANT:** This file contains the COMPLETE project context.
> Read this file FULLY before doing any work. It contains project details, architecture,
> credentials, completed work, and remaining tasks. DO NOT ask the user to re-explain anything.

---

## 📋 Project Identity

| Field | Details |
|-------|---------|
| **Project Name** | GridZero: Autonomous Cyber-Physical Rescue System |
| **Project Type** | Electronics Lab Project (UIU) |
| **Goal** | 🏆 **BECOME CHAMPION** in Electronics Lab Project |
| **Prepared By** | Suvrojit Bose Sarthok & Team |
| **Institution** | United International University (UIU) |
| **Department** | Computer Science and Engineering |
| **Project Path** | `e:\Electronics_Lab_Project\` |
| **Budget** | 9,550 BDT |
| **Timeline** | 5-week rapid development cycle |

---

## 🎯 Project Description

GridZero is a **decentralized IoT and AI-driven cyber-physical rescue pipeline** designed for
search-and-rescue operations after structural collapses (earthquakes, building failures, etc.).

**Core Concept:** An autonomous rover that:
1. **Navigates rubble** autonomously using ultrasonic sensors
2. **Detects victims** using thermal (infrared) sensor — distinguishes alive vs deceased
3. **Monitors hazardous gases** (CO, methane, propane) for rescuer safety
4. **Streams live video** from disaster zone to command center
5. **Sends all data in real-time** to a web dashboard for first responders

**Key Innovation:** Multi-modal sensor fusion — combining thermal + camera AI + gas + ultrasonic + video data
to give rescue teams **actionable, evidence-backed information** before committing personnel.
Camera AI (TensorFlow.js COCO-SSD) detects human shapes, while thermal sensor confirms body heat —
together they eliminate false positives and provide 85-99% accurate victim identification.

---

## 🏗️ System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    EDGE COMPUTING LAYER                         │
│                   (On the Rover — Hardware)                     │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │   ESP32       │  │  ESP32-CAM   │  │  Sensors & Motors    │  │
│  │  (38-pin)     │  │  (OV2640)    │  │                      │  │
│  │              │  │              │  │  • MLX90614 Thermal   │  │
│  │  Main MCU    │  │  Video       │  │  • MQ-9 Gas Sensor   │  │
│  │  Sensors     │  │  Streaming   │  │  • HC-SR04 x2 Ultra  │  │
│  │  Motors      │  │  AI Feed     │  │  • L298N Motor Driver │  │
│  │  Telemetry   │  │              │  │  • Tank Track Chassis │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────────────────┘  │
│         │   Wi-Fi         │   Wi-Fi                             │
└─────────┼─────────────────┼─────────────────────────────────────┘
          │                 │
          ▼                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                   CENTRALIZED SERVER LAYER                      │
│                  (On Developer's PC / Server)                   │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │  Node.js     │  │  MySQL DB    │  │  Dashboard UI        │  │
│  │  Backend API │  │  (XAMPP /    │  │  (HTML/CSS/JS)       │  │
│  │              │  │   MySQL 8.0) │  │                      │  │
│  │  REST API    │  │              │  │  Real-time Graphs    │  │
│  │  WebSocket   │  │  Electronics │  │  Video Feed          │  │
│  │  Socket.IO   │  │  _Lab DB     │  │  Alert Panel         │  │
│  │              │  │              │  │  Rover Control       │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  AI Sensor Fusion Engine (Multi-Modal)                    │  │
│  │  Thermal + Camera AI + Gas + Distance → Victim Detection  │  │
│  │  TensorFlow.js COCO-SSD → Human Shape Detection           │  │
│  │  Confidence Scoring + Alert Rule Engine                    │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🔧 Hardware Components

| Component | Purpose | Interface | Cost (BDT) | Assembly Status |
|-----------|---------|-----------|------------|----------------|
| Metal Tank Track Chassis (TP101) | Rugged mobility for uneven rubble | DC Motors | 3,200 | ✅ **ASSEMBLED** |
| MLX90614 Thermal Sensor | Heat signature detection (body temp) | I2C (SDA/SCL) | 1,300 | ✅ **READY** |
| 16.4V 4S LiPo Battery | High-torque power source | Direct | 2,100 | ✅ **CONNECTED** |
| Perfboard, Resistors & Wiring | Custom PCB layout, voltage dividers | — | 550 | ⬜ Not done |
| ESP32 Dev Board (38-pin) | Main MCU + Wi-Fi telemetry | GPIO/I2C/ADC | 600 | ⬜ Not flashed |
| ESP32-CAM Module | Live video feed streaming | Wi-Fi MJPEG | 800 | ✅ **READY** |
| L298N H-Bridge Dual Motor Driver | Motor control (GPIO 4-pin, NO ENA/ENB) | GPIO (IN1-IN4 only) | 200 | ✅ **READY** |
| HC-SR04 Ultrasonic (x2) | Distance measurement + pathfinding | GPIO (Trig/Echo) | 200 | ✅ **READY** |
| Active Buzzer (5V) | Obstacle alert — triggers < 20cm | GPIO 13 | ~20 | ✅ **ADDED** |
| LM2596 Buck Converter | Voltage regulation (16.4V → 5V) | Direct | 150 | ⬜ Not wired |
| MQ-9 Gas Sensor | CO, methane (CH4), propane detection | ADC (Analog) | 150 | ⬜ Not wired |
| FTDI Programmer (CP2102/CH340) | Upload code to ESP32-CAM | USB-Serial | 150 | ⬜ Not used yet |
| IPEX/U.FL External Antenna | Better Wi-Fi signal for metal chassis | IPEX connector | 100 | ⬜ Not attached |
| Heavy-Duty Rocker Switch | Safe power on/off | Direct | 50 | ⬜ Not wired |
| **TOTAL** | | | **~9,570** | |

> **⚠️ L298N Note:** ENA and ENB pins are NOT being used. Motor speed is fixed (full speed). Only IN1, IN2, IN3, IN4 are used for direction control.
> **⚠️ Battery Note:** Changed from 11.1V 3S to **16.4V 4S LiPo**. Voltage divider ratio updated to 5.0 in firmware.
> **🔔 Buzzer Note:** Active Buzzer on GPIO 13. Sounds continuously when any ultrasonic sensor detects object < 20cm.

---

## 💻 Software Stack & Tools

| Tool | Version | Purpose |
|------|---------|---------|
| **Antigravity IDE** | Latest | Main development IDE (VS Code-based) |
| **PlatformIO** | 6.2.0 | ESP32 firmware build & upload |
| **Node.js** | (to install) | Backend API server |
| **MySQL Server** | 8.0.46 | Database engine |
| **MySQL Workbench** | Latest | Database GUI management |
| **Python** | 3.14.0 | AI sensor fusion scripts |
| **Socket.IO** | (to install) | Real-time WebSocket communication |
| **Express.js** | (to install) | REST API framework |
| **Chart.js** | (to install) | Dashboard graphs & charts |

---

## 🔑 Credentials & Configuration

| Setting | Value |
|---------|-------|
| **MySQL Host** | localhost |
| **MySQL Port** | 3306 |
| **MySQL Username** | root |
| **MySQL Password** | root123 |
| **Database Name** | Electronics_Lab |
| **ESP32 Wi-Fi SSID** | (to configure when hardware ready) |
| **ESP32 Wi-Fi Password** | (to configure when hardware ready) |
| **API Server Port** | 3000 (planned) |
| **WebSocket Port** | 3000 (same as API, via Socket.IO) |
| **ESP32-CAM Stream Port** | 81 (standard) |

---

## 📁 Project Folder Structure (Planned)

```
e:\Electronics_Lab_Project\
│
├── database/
│   └── schema.sql                    ✅ DONE — Complete MySQL schema
│
├── server/                           ⬜ Phase 2 — Node.js Backend
│   ├── package.json
│   ├── .env                          (MySQL credentials)
│   ├── src/
│   │   ├── index.js                  (Main server entry)
│   │   ├── config/
│   │   │   └── database.js           (MySQL connection pool)
│   │   ├── routes/
│   │   │   ├── telemetry.js          (POST /api/telemetry)
│   │   │   ├── rover.js              (GET/POST /api/rover)
│   │   │   ├── alerts.js             (GET/POST /api/alerts)
│   │   │   ├── victims.js            (GET/POST /api/victims)
│   │   │   └── mission.js            (GET/POST /api/mission)
│   │   ├── websocket/
│   │   │   └── socketHandler.js      (Socket.IO real-time events)
│   │   ├── services/
│   │   │   ├── sensorFusion.js       (AI sensor fusion logic — thermal + camera + gas)
│   │   │   └── visionDetector.js     (Camera AI — TensorFlow.js COCO-SSD human detection)
│   │   └── utils/
│   │       └── dataSimulator.js      (Fake data for testing)
│   └── tests/
│
├── dashboard/                        ⬜ Phase 3 — Frontend UI
│   ├── index.html                    (Main dashboard page)
│   ├── css/
│   │   └── dashboard.css             (Dark theme, premium design)
│   ├── js/
│   │   ├── app.js                    (Main app logic)
│   │   ├── websocket.js              (Socket.IO client)
│   │   ├── charts.js                 (Chart.js graphs)
│   │   ├── alerts.js                 (Alert panel logic)
│   │   └── roverControl.js           (Manual rover control)
│   └── assets/
│       └── images/
│
├── firmware/                         ⬜ Phase 5 — ESP32 Main
│   ├── platformio.ini
│   ├── src/
│   │   └── main.cpp
│   └── lib/
│       ├── WiFiManager/
│       ├── ThermalSensor/
│       ├── GasSensor/
│       ├── UltrasonicSensor/
│       ├── MotorControl/
│       └── Telemetry/
│
├── firmware-cam/                     ⬜ Phase 6 — ESP32-CAM
│   ├── platformio.ini
│   ├── src/
│   │   └── main.cpp
│   └── lib/
│
├── ai/                               ⬜ Phase 4 — Sensor Fusion AI
│   ├── sensor_fusion.py
│   ├── hazard_classifier.py
│   └── victim_classifier.py
│
├── docs/                             (Documentation)
│   └── PROJECT_PLAN.md               ← THIS FILE
│
└── README.md
```

---

## ✅ COMPLETED WORK

### Phase 1: MySQL Database Schema ✅ (Completed: 2026-09-17)

**File:** `e:\Electronics_Lab_Project\database\schema.sql`

**What was created:**
- **7 Tables:** `rover_status`, `thermal_readings`, `gas_readings`, `ultrasonic_readings`, `victim_detections`, `alerts`, `mission_logs`
- **5 Views:** `v_rover_dashboard`, `v_latest_thermal`, `v_latest_gas`, `v_active_alerts`, `v_realtime_dashboard`, `v_mission_summary`
- **2 Stored Procedures:** `sp_insert_telemetry` (bulk sensor data insert + auto alerts), `sp_rover_offline` (connection loss handling)
- **Default Data:** 1 rover (GZ-ROVER-01), 1 mission (MISSION-2025-001)
- **Database verified** in MySQL Workbench ✅

**Key Design Decisions:**
- Generated columns for `temp_delta` and `is_obstacle` (auto-calculated)
- `sp_insert_telemetry` handles ALL sensor data in one call + auto-generates alerts for gas leaks, low battery, and heat signatures
- JSON `context_data` column in alerts for flexible sensor snapshot storage
- Comprehensive indexing for real-time dashboard queries

---

## ⬜ REMAINING WORK

### Phase 2: Node.js Backend API ✅ (Completed: 2026-09-18)
| # | Item | Status |
|---|------|--------|
| 2.1 | Project setup (package.json, Express, MySQL2, Socket.IO) | ✅ |
| 2.2 | MySQL connection pool + .env config | ✅ |
| 2.3 | `POST /api/telemetry` — ESP32 sensor data receiver | ✅ |
| 2.4 | `GET/POST /api/rover/status` — Rover status management | ✅ |
| 2.5 | `GET/POST /api/alerts` — Alert system | ✅ |
| 2.6 | `GET/POST /api/victims` — Victim detection records | ✅ |
| 2.7 | `GET/POST /api/mission` — Mission management | ✅ |
| 2.8 | WebSocket (Socket.IO) — Real-time data broadcast | ✅ |
| 2.9 | Data Simulator — Fake sensor data for testing without hardware | ✅ |
| 2.10 | API validation & error handling | ✅ |

### Phase 3: Dashboard UI ✅ (Completed: 2026-09-18)
| # | Item | Status |
|---|------|--------|
| 3.1 | Layout & Design System (dark theme, CSS variables, grid) | ✅ |
| 3.2 | Header & Navigation (mission status, rover connection) | ✅ |
| 3.3 | Thermal Sensor Card (real-time gauge + history chart) | ✅ |
| 3.4 | Gas Sensor Card (CO/methane/propane levels + danger indicator) | ✅ |
| 3.5 | Ultrasonic Distance Card (distance visualization) | ✅ |
| 3.6 | Video Feed Panel (ESP32-CAM live stream) | ✅ |
| 3.7 | Alert Panel (real-time notifications with sound) | ✅ |
| 3.8 | Victim Detection Panel (AI results + thermal overlay) | ✅ |
| 3.9 | Rover Control Panel (manual Forward/Back/Left/Right + WASD) | ✅ |
| 3.10 | Mission Log Panel (mission history & timeline) | ✅ |
| 3.11 | WebSocket Integration (Socket.IO real-time updates) | ✅ |
| 3.12 | Responsive Design (mobile/tablet compatible) | ✅ |

### Phase 4: AI Sensor Fusion Logic ✅ (Completed: 2026-09-18)
| # | Item | Status |
|---|------|--------|
| 4.1 | Thermal Analysis (body temp 35-38°C vs debris) | ✅ |
| 4.2 | Gas Hazard Classification (CO/methane → Safe/Warning/Danger) | ✅ |
| 4.3 | Multi-sensor Fusion Algorithm (combined victim probability score) | ✅ |
| 4.4 | Alert Rule Engine (when to trigger which alert) | ✅ |
| 4.5 | Confidence Scoring (detection accuracy %) | ✅ |

### Phase 5: ESP32 Main Firmware ✅ (Completed: 2026-09-18)
| # | Item | Status |
|---|------|--------|
| 5.1 | PlatformIO project setup (platformio.ini + folder structure) | ✅ |
| 5.2 | Wi-Fi connection module (connect + auto-reconnect) | ✅ |
| 5.3 | MLX90614 thermal sensor module (I2C temperature read) | ✅ |
| 5.4 | MQ-9 gas sensor module (ADC reading + calibration) | ✅ |
| 5.5 | HC-SR04 ultrasonic module x2 (front + side distance) | ✅ |
| 5.6 | L298N motor control module (Forward/Backward/Left/Right/Stop) | ✅ |
| 5.7 | Autonomous pathfinding (ultrasonic obstacle avoidance) | ✅ |
| 5.8 | HTTP telemetry sender (POST sensor data to server) | ✅ |
| 5.9 | Remote command receiver (receive commands from server) | ✅ |
| 5.10 | Main loop integration (all modules combined) | ✅ |

### Phase 6: ESP32-CAM Streaming Firmware ✅ (Completed: 2026-09-18)
| # | Item | Status |
|---|------|--------|
| 6.1 | PlatformIO project setup (ESP32-CAM board config) | ✅ |
| 6.2 | Camera initialization (OV2640 sensor setup) | ✅ |
| 6.3 | MJPEG HTTP stream (/stream endpoint) | ✅ |
| 6.4 | Wi-Fi connection (Wi-Fi + static IP + auto-reconnect) | ✅ |
| 6.5 | Dashboard integration (video feed connect) | ✅ |

### Phase 7: Camera AI Vision Detection ✅ (Completed: 2026-09-19)
| # | Item | Status |
|---|------|--------|
| 7.1 | TensorFlow.js + COCO-SSD npm packages installed | ✅ |
| 7.2 | `visionDetector.js` service (frame capture + AI analysis loop) | ✅ |
| 7.3 | Sensor fusion updated (Camera + Thermal multi-modal fusion) | ✅ |
| 7.4 | AI routes updated (vision start/stop/status/latest endpoints) | ✅ |
| 7.5 | Telemetry pipeline updated (vision data in fusion analysis) | ✅ |
| 7.6 | Server startup (auto-load model + start camera analysis) | ✅ |
| 7.7 | Dashboard — AI Vision badge in header | ✅ |
| 7.8 | Dashboard — Camera + Thermal detection bar under video | ✅ |
| 7.9 | Dashboard — Vision Socket.IO events (real-time updates) | ✅ |

---

## 🔩 Hardware Assembly Tracker

> **Last Updated: 2026-09-27**

| Component | Physical Status | Notes |
|-----------|----------------|-------|
| ✅ Metal Tank Track Chassis | **ASSEMBLED** | Full frame built and mounted |
| ✅ 16.4V 4S LiPo Battery | **CONNECTED** | Power connected, upgraded from 11.1V 3S |
| ✅ L298N Motor Driver | **ASSEMBLED** | IN1/IN2/IN3/IN4 only — ENA & ENB NOT used |
| ✅ HC-SR04 Ultrasonic #1 | **READY** | Front-facing distance sensor |
| ✅ HC-SR04 Ultrasonic #2 | **READY** | Side/secondary distance sensor |
| ✅ MLX90614 Thermal Sensor | **READY** | I2C wired, heat signature detection |
| ✅ ESP32-CAM Module | **READY** | OV2640 camera, firmware pending flash |
| ✅ Active Buzzer | **WIRED** | GPIO 13 → sounds when object < 20cm (both sensors) |
| ⬜ ESP32 Dev Board (38-pin) | Not flashed | Firmware ready, needs upload |
| ⬜ LM2596 Buck Converter | Not wired | 16.4V → 5V regulation |
| ⬜ MQ-9 Gas Sensor | Not wired | CO/Methane detection |
| ⬜ Perfboard & Wiring | Not done | Final circuit layout |

**Hardware Progress: 8 / 13 components ready ✅**

---

## 🔌 ESP32 Pin Mapping (Planned)

### ESP32 Dev Board (38-pin) — Main MCU
```
┌─────────────────────────────────────────┐
│ Sensor/Module      │ ESP32 Pin          │
├─────────────────────────────────────────┤
│ MLX90614 SDA       │ GPIO 21            │
│ MLX90614 SCL       │ GPIO 22            │
│ MQ-9 Analog Out    │ GPIO 34 (ADC)      │
│ HC-SR04 #1 Trig    │ GPIO 25            │
│ HC-SR04 #1 Echo    │ GPIO 26            │
│ HC-SR04 #2 Trig    │ GPIO 27            │
│ HC-SR04 #2 Echo    │ GPIO 14            │
│ L298N IN1          │ GPIO 16            │
│ L298N IN2          │ GPIO 17            │
│ L298N IN3          │ GPIO 18            │
│ L298N IN4          │ GPIO 19            │
│ ⚠️ ENA & ENB       │ NOT USED           │  ← Jumpers kept on board (full speed)
│ Battery Voltage    │ GPIO 35 (ADC)      │
│ 🔔 Buzzer (+)      │ GPIO 13            │
└─────────────────────────────────────────┘
```

### ESP32-CAM — Video Streaming
```
┌─────────────────────────────────────────┐
│ FTDI Connection    │ ESP32-CAM Pin      │
├─────────────────────────────────────────┤
│ FTDI TX            │ U0R (GPIO 3)       │
│ FTDI RX            │ U0T (GPIO 1)       │
│ FTDI GND           │ GND                │
│ FTDI VCC (5V)      │ 5V                 │
│ GPIO 0             │ GND (during flash) │
└─────────────────────────────────────────┘
```

---

## 📝 Development Rules

1. **Champion-level quality** — Every line of code must be top-notch
2. **Small parts, best effort** — Break into small items, focus 100% on each
3. **Dark theme dashboard** — Premium, modern, glassmorphism design
4. **Real-time everything** — WebSocket for live data
5. **Simulated data** — Test everything without hardware first
6. **Well-documented** — Every file has proper comments

---

## 🛠️ How to Resume Work

When starting a new session, tell the AI:

> "Read my project plan file at `e:\Electronics_Lab_Project\docs\PROJECT_PLAN.md` and continue from where we left off."

The AI will read this file, understand the entire project, see what's completed, and continue from the next pending phase automatically.

*Last Updated: 2026-09-27 | ALL 8 PHASES COMPLETE ✅ | Software 100% Ready | Hardware Assembly: 8/13 Parts Ready (Chassis ✅, Battery 16.4V ✅, L298N ✅, Ultrasonic x2 ✅, MLX90614 ✅, ESP32-CAM ✅, Buzzer ✅)*
