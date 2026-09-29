-- ============================================================================
-- GridZero: Autonomous Cyber-Physical Rescue System
-- Database Schema v1.0
-- 
-- Prepared By : Suvrojit Bose Sarthok & Team
-- Institution : United International University (UIU)
-- Department  : Computer Science and Engineering
--
-- Description : Complete MySQL schema for the GridZero rescue rover system.
--               Stores telemetry data from ESP32 sensors (thermal, gas,
--               ultrasonic), AI-driven victim detection results, real-time
--               alerts, and mission logs.
--
-- Usage       : Run this script in MySQL Workbench or XAMPP phpMyAdmin
--               to initialize the entire database.
-- ============================================================================

-- ============================================================================
-- 0. DATABASE CREATION
-- ============================================================================

DROP DATABASE IF EXISTS Electronics_Lab;
CREATE DATABASE Electronics_Lab
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;

USE Electronics_Lab;

-- ============================================================================
-- 1. ROVER STATUS TABLE
--    Tracks the real-time operational state of each GridZero rover unit.
--    Supports multiple rovers for scalability.
-- ============================================================================

CREATE TABLE rover_status (
    id              INT UNSIGNED    AUTO_INCREMENT PRIMARY KEY,
    rover_id        VARCHAR(32)     NOT NULL UNIQUE
                    COMMENT 'Unique identifier for each rover (e.g., GZ-ROVER-01)',
    rover_name      VARCHAR(100)    NOT NULL DEFAULT 'GridZero Rover'
                    COMMENT 'Human-friendly rover name',
    
    -- Connection & Health
    is_online       BOOLEAN         NOT NULL DEFAULT FALSE
                    COMMENT 'TRUE if rover is actively transmitting data',
    ip_address      VARCHAR(45)     NULL
                    COMMENT 'Current IP address of the rover on the network',
    wifi_rssi       SMALLINT        NULL
                    COMMENT 'Wi-Fi signal strength in dBm (typical: -30 to -90)',
    battery_voltage DECIMAL(4,2)    NULL
                    COMMENT 'Current battery voltage (16.4V LiPo 4S nominal)',
    battery_percent TINYINT UNSIGNED NULL
                    COMMENT 'Estimated battery percentage (0-100)',
    
    -- Operational Mode
    operation_mode  ENUM('idle', 'autonomous', 'manual', 'returning', 'emergency_stop')
                    NOT NULL DEFAULT 'idle'
                    COMMENT 'Current operational mode of the rover',
    
    -- Motor State
    motor_left_speed  SMALLINT      NOT NULL DEFAULT 0
                    COMMENT 'Left motor PWM value (-255 to 255)',
    motor_right_speed SMALLINT      NOT NULL DEFAULT 0
                    COMMENT 'Right motor PWM value (-255 to 255)',
    
    -- Timestamps
    last_heartbeat  TIMESTAMP       NULL
                    COMMENT 'Last time the rover sent a heartbeat',
    created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    -- Indexes
    INDEX idx_rover_online     (is_online),
    INDEX idx_rover_mode       (operation_mode),
    INDEX idx_last_heartbeat   (last_heartbeat)
) ENGINE=InnoDB
  COMMENT='Real-time operational state of each GridZero rover unit';


-- ============================================================================
-- 2. THERMAL READINGS TABLE
--    Stores MLX90614 infrared temperature sensor data.
--    Key for victim detection: human body ≈ 35-38°C vs debris ≈ ambient.
-- ============================================================================

CREATE TABLE thermal_readings (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    rover_id        VARCHAR(32)     NOT NULL
                    COMMENT 'FK to rover_status.rover_id',
    
    -- Temperature Data (MLX90614 provides both ambient and object temps)
    ambient_temp_c  DECIMAL(5,2)    NOT NULL
                    COMMENT 'Ambient temperature in Celsius from MLX90614',
    object_temp_c   DECIMAL(5,2)    NOT NULL
                    COMMENT 'Object/target temperature in Celsius from MLX90614',
    temp_delta      DECIMAL(5,2)    GENERATED ALWAYS AS (object_temp_c - ambient_temp_c) STORED
                    COMMENT 'Temperature difference (object - ambient). High delta suggests living body.',
    
    -- Classification (computed by server-side AI)
    is_body_heat    BOOLEAN         NULL
                    COMMENT 'TRUE if the reading likely indicates a human body',
    confidence      DECIMAL(5,2)    NULL
                    COMMENT 'AI confidence score (0.00 - 100.00)',
    
    -- Metadata
    reading_quality ENUM('good', 'noisy', 'out_of_range', 'sensor_error')
                    NOT NULL DEFAULT 'good'
                    COMMENT 'Quality assessment of the sensor reading',
    
    -- Timestamp
    recorded_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP
                    COMMENT 'When the ESP32 recorded this reading',
    received_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP
                    COMMENT 'When the server received this data',
    
    -- Foreign Key
    CONSTRAINT fk_thermal_rover
        FOREIGN KEY (rover_id) REFERENCES rover_status(rover_id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    
    -- Indexes for real-time queries
    INDEX idx_thermal_rover    (rover_id, recorded_at DESC),
    INDEX idx_thermal_body     (is_body_heat, recorded_at DESC),
    INDEX idx_thermal_time     (recorded_at DESC),
    INDEX idx_thermal_object   (object_temp_c)
) ENGINE=InnoDB
  COMMENT='MLX90614 infrared thermal sensor readings for victim heat detection';


-- ============================================================================
-- 3. GAS READINGS TABLE
--    Stores MQ-9 gas sensor data for hazardous environment detection.
--    Detects: Carbon Monoxide (CO), Methane (CH4), Propane (LPG).
-- ============================================================================

CREATE TABLE gas_readings (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    rover_id        VARCHAR(32)     NOT NULL
                    COMMENT 'FK to rover_status.rover_id',
    
    -- Raw Sensor Data
    raw_adc_value   INT UNSIGNED    NOT NULL
                    COMMENT 'Raw ADC reading from MQ-9 (0-4095 for ESP32 12-bit)',
    sensor_voltage  DECIMAL(4,3)    NOT NULL
                    COMMENT 'Calculated voltage from ADC (0.000 - 3.300V)',
    sensor_resistance_ratio DECIMAL(8,4) NULL
                    COMMENT 'Rs/Ro ratio for gas concentration calculation',
    
    -- Calculated Gas Concentrations (in PPM)
    co_ppm          DECIMAL(10,2)   NULL
                    COMMENT 'Estimated Carbon Monoxide concentration in PPM',
    methane_ppm     DECIMAL(10,2)   NULL
                    COMMENT 'Estimated Methane (CH4) concentration in PPM',
    lpg_ppm         DECIMAL(10,2)   NULL
                    COMMENT 'Estimated LPG/Propane concentration in PPM',
    
    -- Hazard Classification
    hazard_level    ENUM('safe', 'low', 'moderate', 'high', 'critical')
                    NOT NULL DEFAULT 'safe'
                    COMMENT 'Overall hazard level based on gas concentrations',
    
    -- Metadata
    reading_quality ENUM('good', 'warming_up', 'saturated', 'sensor_error')
                    NOT NULL DEFAULT 'good'
                    COMMENT 'MQ-9 needs ~20s warm-up; readings during warm-up are unreliable',
    
    -- Timestamp
    recorded_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    received_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    -- Foreign Key
    CONSTRAINT fk_gas_rover
        FOREIGN KEY (rover_id) REFERENCES rover_status(rover_id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    
    -- Indexes
    INDEX idx_gas_rover        (rover_id, recorded_at DESC),
    INDEX idx_gas_hazard       (hazard_level, recorded_at DESC),
    INDEX idx_gas_time         (recorded_at DESC),
    INDEX idx_gas_co           (co_ppm)
) ENGINE=InnoDB
  COMMENT='MQ-9 gas sensor readings for hazardous environment detection (CO, CH4, LPG)';


-- ============================================================================
-- 4. ULTRASONIC READINGS TABLE
--    Stores HC-SR04 distance measurements for obstacle detection and
--    autonomous pathfinding. Two sensors: front-facing and side-facing.
-- ============================================================================

CREATE TABLE ultrasonic_readings (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    rover_id        VARCHAR(32)     NOT NULL
                    COMMENT 'FK to rover_status.rover_id',
    
    -- Distance Data (HC-SR04 range: 2cm - 400cm)
    sensor_position ENUM('front', 'left', 'right')
                    NOT NULL
                    COMMENT 'Physical position of the ultrasonic sensor on the rover',
    distance_cm     DECIMAL(6,2)    NOT NULL
                    COMMENT 'Measured distance in centimeters (2.00 - 400.00)',
    
    -- Obstacle Detection
    is_obstacle     BOOLEAN         GENERATED ALWAYS AS (distance_cm < 30.0) STORED
                    COMMENT 'TRUE if obstacle detected within 30cm threshold',
    
    -- Metadata
    reading_quality ENUM('good', 'out_of_range', 'no_echo', 'sensor_error')
                    NOT NULL DEFAULT 'good'
                    COMMENT 'Quality of the ultrasonic measurement',
    
    -- Timestamp
    recorded_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    received_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    -- Foreign Key
    CONSTRAINT fk_ultrasonic_rover
        FOREIGN KEY (rover_id) REFERENCES rover_status(rover_id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    
    -- Indexes
    INDEX idx_ultra_rover      (rover_id, sensor_position, recorded_at DESC),
    INDEX idx_ultra_obstacle   (is_obstacle, recorded_at DESC),
    INDEX idx_ultra_time       (recorded_at DESC)
) ENGINE=InnoDB
  COMMENT='HC-SR04 ultrasonic distance readings for autonomous pathfinding';


-- ============================================================================
-- 5. VICTIM DETECTIONS TABLE
--    Stores AI-driven victim detection results from multi-sensor fusion.
--    Combines thermal, visual, and environmental data to classify findings.
-- ============================================================================

CREATE TABLE victim_detections (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    rover_id        VARCHAR(32)     NOT NULL
                    COMMENT 'FK to rover_status.rover_id',
    
    -- Detection Result
    detection_type  ENUM('alive', 'deceased', 'uncertain', 'false_positive')
                    NOT NULL
                    COMMENT 'AI classification of the detected entity',
    confidence_score DECIMAL(5,2)   NOT NULL DEFAULT 0.00
                    COMMENT 'AI confidence percentage (0.00 - 100.00)',
    
    -- Sensor Data Snapshot at Detection Time
    thermal_temp_c  DECIMAL(5,2)    NULL
                    COMMENT 'Object temperature at time of detection',
    thermal_delta   DECIMAL(5,2)    NULL
                    COMMENT 'Temperature delta at time of detection',
    gas_hazard_level ENUM('safe', 'low', 'moderate', 'high', 'critical')
                    NULL
                    COMMENT 'Gas hazard level at time of detection',
    front_distance_cm DECIMAL(6,2)  NULL
                    COMMENT 'Front ultrasonic distance at time of detection',
    
    -- Fusion Details
    fusion_method   ENUM('thermal_only', 'thermal_visual', 'multi_sensor', 'manual_override')
                    NOT NULL DEFAULT 'multi_sensor'
                    COMMENT 'Which sensor fusion method produced this detection',
    fusion_details  JSON            NULL
                    COMMENT 'Detailed JSON breakdown of sensor contributions to the decision',
    
    -- Camera Snapshot
    snapshot_url    VARCHAR(500)    NULL
                    COMMENT 'URL to the camera frame captured at detection time',
    
    -- Human Review
    is_reviewed     BOOLEAN         NOT NULL DEFAULT FALSE
                    COMMENT 'TRUE if a human operator has reviewed this detection',
    reviewer_notes  TEXT            NULL
                    COMMENT 'Notes from human reviewer confirming/denying detection',
    reviewed_at     TIMESTAMP       NULL,
    
    -- Priority for Rescue Team
    priority_level  ENUM('low', 'medium', 'high', 'critical')
                    NOT NULL DEFAULT 'medium'
                    COMMENT 'Rescue priority level assigned by the system',
    
    -- Timestamp
    detected_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP
                    COMMENT 'When the AI made this detection',
    created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    -- Foreign Key
    CONSTRAINT fk_victim_rover
        FOREIGN KEY (rover_id) REFERENCES rover_status(rover_id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    
    -- Indexes
    INDEX idx_victim_rover     (rover_id, detected_at DESC),
    INDEX idx_victim_type      (detection_type, confidence_score DESC),
    INDEX idx_victim_priority  (priority_level, detected_at DESC),
    INDEX idx_victim_unreviewed(is_reviewed, detected_at DESC),
    INDEX idx_victim_time      (detected_at DESC)
) ENGINE=InnoDB
  COMMENT='AI-driven victim detection results from multi-sensor fusion analysis';


-- ============================================================================
-- 6. ALERTS TABLE
--    Real-time alerts generated by the system for operator attention.
--    Covers: gas leaks, victim found, low battery, connection loss, etc.
-- ============================================================================

CREATE TABLE alerts (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    rover_id        VARCHAR(32)     NOT NULL
                    COMMENT 'FK to rover_status.rover_id',
    
    -- Alert Classification
    alert_type      ENUM(
                        'gas_leak_warning',
                        'gas_leak_critical',
                        'victim_detected_alive',
                        'victim_detected_deceased',
                        'victim_detected_uncertain',
                        'high_temperature',
                        'obstacle_detected',
                        'battery_low',
                        'battery_critical',
                        'connection_lost',
                        'connection_restored',
                        'mission_started',
                        'mission_completed',
                        'emergency_stop',
                        'sensor_malfunction',
                        'system_error'
                    ) NOT NULL
                    COMMENT 'Type of alert',
    
    severity        ENUM('info', 'warning', 'danger', 'critical')
                    NOT NULL DEFAULT 'info'
                    COMMENT 'Alert severity level',
    
    -- Alert Content
    title           VARCHAR(200)    NOT NULL
                    COMMENT 'Short alert title for display',
    message         TEXT            NOT NULL
                    COMMENT 'Detailed alert message with sensor readings',
    
    -- Context Data
    context_data    JSON            NULL
                    COMMENT 'JSON object with relevant sensor readings at alert time',
    
    -- Related Detection (if applicable)
    victim_detection_id BIGINT UNSIGNED NULL
                    COMMENT 'FK to victim_detections if this alert is about a detection',
    
    -- Acknowledgement
    is_acknowledged BOOLEAN         NOT NULL DEFAULT FALSE
                    COMMENT 'TRUE if operator has acknowledged this alert',
    acknowledged_at TIMESTAMP       NULL,
    acknowledged_by VARCHAR(100)    NULL
                    COMMENT 'Name/ID of the operator who acknowledged',
    
    -- Timestamp
    triggered_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP
                    COMMENT 'When the alert was triggered',
    
    -- Foreign Keys
    CONSTRAINT fk_alert_rover
        FOREIGN KEY (rover_id) REFERENCES rover_status(rover_id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_alert_victim
        FOREIGN KEY (victim_detection_id) REFERENCES victim_detections(id)
        ON DELETE SET NULL ON UPDATE CASCADE,
    
    -- Indexes
    INDEX idx_alert_rover      (rover_id, triggered_at DESC),
    INDEX idx_alert_severity   (severity, triggered_at DESC),
    INDEX idx_alert_type       (alert_type, triggered_at DESC),
    INDEX idx_alert_unacked    (is_acknowledged, severity, triggered_at DESC),
    INDEX idx_alert_time       (triggered_at DESC)
) ENGINE=InnoDB
  COMMENT='Real-time system alerts for operator notification and action';


-- ============================================================================
-- 7. MISSION LOGS TABLE
--    Tracks complete mission lifecycle from start to finish.
--    Each mission represents one rescue operation session.
-- ============================================================================

CREATE TABLE mission_logs (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    rover_id        VARCHAR(32)     NOT NULL
                    COMMENT 'FK to rover_status.rover_id',
    
    -- Mission Identity
    mission_code    VARCHAR(50)     NOT NULL UNIQUE
                    COMMENT 'Unique mission code (e.g., MISSION-2025-001)',
    mission_name    VARCHAR(200)    NOT NULL
                    COMMENT 'Descriptive mission name',
    
    -- Mission Status
    status          ENUM('planning', 'active', 'paused', 'completed', 'aborted', 'failed')
                    NOT NULL DEFAULT 'planning'
                    COMMENT 'Current mission status',
    
    -- Duration
    started_at      TIMESTAMP       NULL
                    COMMENT 'When the mission actually started',
    ended_at        TIMESTAMP       NULL
                    COMMENT 'When the mission ended',
    duration_seconds INT UNSIGNED   GENERATED ALWAYS AS (
                        CASE 
                            WHEN started_at IS NOT NULL AND ended_at IS NOT NULL 
                            THEN TIMESTAMPDIFF(SECOND, started_at, ended_at)
                            ELSE NULL 
                        END
                    ) STORED
                    COMMENT 'Total mission duration in seconds',
    
    -- Mission Statistics (updated during/after mission)
    total_distance_m    DECIMAL(10,2) NULL DEFAULT 0.00
                    COMMENT 'Total distance traveled by rover in meters',
    victims_found       INT UNSIGNED  NOT NULL DEFAULT 0
                    COMMENT 'Total victims detected during mission',
    victims_alive       INT UNSIGNED  NOT NULL DEFAULT 0
                    COMMENT 'Victims classified as alive',
    alerts_triggered    INT UNSIGNED  NOT NULL DEFAULT 0
                    COMMENT 'Total alerts triggered during mission',
    gas_hazards_found   INT UNSIGNED  NOT NULL DEFAULT 0
                    COMMENT 'Number of gas hazard zones identified',
    
    -- Telemetry Summary
    avg_battery_voltage DECIMAL(4,2)  NULL
                    COMMENT 'Average battery voltage during mission',
    min_battery_voltage DECIMAL(4,2)  NULL
                    COMMENT 'Minimum battery voltage during mission',
    total_readings      INT UNSIGNED  NOT NULL DEFAULT 0
                    COMMENT 'Total sensor readings collected',
    
    -- Operator Notes
    notes           TEXT            NULL
                    COMMENT 'Operator notes about the mission',
    
    -- Timestamps
    created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    -- Foreign Key
    CONSTRAINT fk_mission_rover
        FOREIGN KEY (rover_id) REFERENCES rover_status(rover_id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    
    -- Indexes
    INDEX idx_mission_rover    (rover_id, created_at DESC),
    INDEX idx_mission_status   (status, started_at DESC),
    INDEX idx_mission_time     (started_at DESC),
    INDEX idx_mission_code     (mission_code)
) ENGINE=InnoDB
  COMMENT='Complete mission lifecycle tracking for rescue operations';


-- ============================================================================
-- 8. VIEWS — Pre-built queries for the Dashboard
-- ============================================================================

-- View: Latest status of all rovers
CREATE OR REPLACE VIEW v_rover_dashboard AS
SELECT 
    rs.rover_id,
    rs.rover_name,
    rs.is_online,
    rs.battery_percent,
    rs.battery_voltage,
    rs.wifi_rssi,
    rs.operation_mode,
    rs.last_heartbeat,
    TIMESTAMPDIFF(SECOND, rs.last_heartbeat, NOW()) AS seconds_since_heartbeat,
    CASE 
        WHEN TIMESTAMPDIFF(SECOND, rs.last_heartbeat, NOW()) > 30 THEN 'disconnected'
        WHEN TIMESTAMPDIFF(SECOND, rs.last_heartbeat, NOW()) > 10 THEN 'unstable'
        ELSE 'connected'
    END AS connection_quality
FROM rover_status rs;


-- View: Latest sensor readings per rover (last reading of each type)
CREATE OR REPLACE VIEW v_latest_thermal AS
SELECT 
    tr.rover_id,
    tr.ambient_temp_c,
    tr.object_temp_c,
    tr.temp_delta,
    tr.is_body_heat,
    tr.confidence,
    tr.recorded_at
FROM thermal_readings tr
INNER JOIN (
    SELECT rover_id, MAX(recorded_at) AS max_time
    FROM thermal_readings
    GROUP BY rover_id
) latest ON tr.rover_id = latest.rover_id AND tr.recorded_at = latest.max_time;


-- View: Latest gas readings per rover
CREATE OR REPLACE VIEW v_latest_gas AS
SELECT 
    gr.rover_id,
    gr.co_ppm,
    gr.methane_ppm,
    gr.lpg_ppm,
    gr.hazard_level,
    gr.recorded_at
FROM gas_readings gr
INNER JOIN (
    SELECT rover_id, MAX(recorded_at) AS max_time
    FROM gas_readings
    GROUP BY rover_id
) latest ON gr.rover_id = latest.rover_id AND gr.recorded_at = latest.max_time;


-- View: Active (unacknowledged) alerts
CREATE OR REPLACE VIEW v_active_alerts AS
SELECT 
    a.id,
    a.rover_id,
    a.alert_type,
    a.severity,
    a.title,
    a.message,
    a.triggered_at,
    TIMESTAMPDIFF(SECOND, a.triggered_at, NOW()) AS seconds_ago
FROM alerts a
WHERE a.is_acknowledged = FALSE
ORDER BY 
    FIELD(a.severity, 'critical', 'danger', 'warning', 'info'),
    a.triggered_at DESC;


-- View: Mission summary dashboard
CREATE OR REPLACE VIEW v_mission_summary AS
SELECT 
    ml.id,
    ml.mission_code,
    ml.mission_name,
    ml.rover_id,
    rs.rover_name,
    ml.status,
    ml.started_at,
    ml.ended_at,
    ml.duration_seconds,
    ml.victims_found,
    ml.victims_alive,
    ml.alerts_triggered,
    ml.gas_hazards_found,
    ml.total_readings
FROM mission_logs ml
JOIN rover_status rs ON ml.rover_id = rs.rover_id
ORDER BY ml.started_at DESC;


-- View: Full real-time dashboard (combines all latest data)
CREATE OR REPLACE VIEW v_realtime_dashboard AS
SELECT 
    rd.rover_id,
    rd.rover_name,
    rd.is_online,
    rd.connection_quality,
    rd.battery_percent,
    rd.operation_mode,
    
    -- Latest Thermal
    lt.object_temp_c    AS thermal_object_c,
    lt.ambient_temp_c   AS thermal_ambient_c,
    lt.temp_delta        AS thermal_delta,
    lt.is_body_heat      AS thermal_body_detected,
    
    -- Latest Gas
    lg.co_ppm           AS gas_co_ppm,
    lg.methane_ppm      AS gas_methane_ppm,
    lg.lpg_ppm          AS gas_lpg_ppm,
    lg.hazard_level     AS gas_hazard_level,
    
    -- Counts
    (SELECT COUNT(*) FROM alerts WHERE rover_id = rd.rover_id AND is_acknowledged = FALSE) AS active_alerts,
    (SELECT COUNT(*) FROM victim_detections WHERE rover_id = rd.rover_id AND detection_type = 'alive') AS total_alive_victims
    
FROM v_rover_dashboard rd
LEFT JOIN v_latest_thermal lt ON rd.rover_id = lt.rover_id
LEFT JOIN v_latest_gas lg ON rd.rover_id = lg.rover_id;


-- ============================================================================
-- 9. DEFAULT DATA — Insert a default rover for development
-- ============================================================================

INSERT INTO rover_status (rover_id, rover_name, is_online, operation_mode)
VALUES ('GZ-ROVER-01', 'GridZero Alpha', FALSE, 'idle');

-- Create a default mission for testing
INSERT INTO mission_logs (rover_id, mission_code, mission_name, status)
VALUES ('GZ-ROVER-01', 'MISSION-2025-001', 'Initial System Test', 'planning');


-- ============================================================================
-- 10. STORED PROCEDURES — Reusable operations for the API
-- ============================================================================

DELIMITER //

-- Procedure: Insert telemetry data (called by ESP32 via Node.js API)
CREATE PROCEDURE sp_insert_telemetry(
    IN p_rover_id       VARCHAR(32),
    IN p_ambient_temp   DECIMAL(5,2),
    IN p_object_temp    DECIMAL(5,2),
    IN p_gas_adc        INT UNSIGNED,
    IN p_gas_voltage    DECIMAL(4,3),
    IN p_co_ppm         DECIMAL(10,2),
    IN p_methane_ppm    DECIMAL(10,2),
    IN p_lpg_ppm        DECIMAL(10,2),
    IN p_gas_hazard     VARCHAR(20),
    IN p_front_dist     DECIMAL(6,2),
    IN p_side_dist      DECIMAL(6,2),
    IN p_side_position  VARCHAR(10),
    IN p_battery_v      DECIMAL(4,2),
    IN p_battery_pct    TINYINT UNSIGNED,
    IN p_wifi_rssi      SMALLINT
)
BEGIN
    -- Update rover status
    UPDATE rover_status SET
        is_online       = TRUE,
        battery_voltage = p_battery_v,
        battery_percent = p_battery_pct,
        wifi_rssi       = p_wifi_rssi,
        last_heartbeat  = NOW()
    WHERE rover_id = p_rover_id;
    
    -- Insert thermal reading
    INSERT INTO thermal_readings (rover_id, ambient_temp_c, object_temp_c)
    VALUES (p_rover_id, p_ambient_temp, p_object_temp);
    
    -- Insert gas reading
    INSERT INTO gas_readings (rover_id, raw_adc_value, sensor_voltage, co_ppm, methane_ppm, lpg_ppm, hazard_level)
    VALUES (p_rover_id, p_gas_adc, p_gas_voltage, p_co_ppm, p_methane_ppm, p_lpg_ppm, p_gas_hazard);
    
    -- Insert front ultrasonic reading
    INSERT INTO ultrasonic_readings (rover_id, sensor_position, distance_cm)
    VALUES (p_rover_id, 'front', p_front_dist);
    
    -- Insert side ultrasonic reading
    IF p_side_dist IS NOT NULL THEN
        INSERT INTO ultrasonic_readings (rover_id, sensor_position, distance_cm)
        VALUES (p_rover_id, p_side_position, p_side_dist);
    END IF;
    
    -- Auto-generate alerts for critical conditions
    
    -- Gas leak alert
    IF p_gas_hazard IN ('high', 'critical') THEN
        INSERT INTO alerts (rover_id, alert_type, severity, title, message, context_data)
        VALUES (
            p_rover_id,
            IF(p_gas_hazard = 'critical', 'gas_leak_critical', 'gas_leak_warning'),
            IF(p_gas_hazard = 'critical', 'critical', 'danger'),
            CONCAT('⚠️ Gas Hazard Detected - ', UPPER(p_gas_hazard)),
            CONCAT('Dangerous gas levels detected. CO: ', p_co_ppm, ' PPM, CH4: ', p_methane_ppm, ' PPM, LPG: ', p_lpg_ppm, ' PPM'),
            JSON_OBJECT('co_ppm', p_co_ppm, 'methane_ppm', p_methane_ppm, 'lpg_ppm', p_lpg_ppm)
        );
    END IF;
    
    -- Low battery alert
    IF p_battery_pct IS NOT NULL AND p_battery_pct <= 20 THEN
        INSERT INTO alerts (rover_id, alert_type, severity, title, message, context_data)
        VALUES (
            p_rover_id,
            IF(p_battery_pct <= 10, 'battery_critical', 'battery_low'),
            IF(p_battery_pct <= 10, 'critical', 'warning'),
            CONCAT('🔋 Battery ', IF(p_battery_pct <= 10, 'CRITICAL', 'Low'), ' - ', p_battery_pct, '%'),
            CONCAT('Battery level at ', p_battery_pct, '% (', p_battery_v, 'V). Consider returning rover.'),
            JSON_OBJECT('battery_percent', p_battery_pct, 'battery_voltage', p_battery_v)
        );
    END IF;
    
    -- High temperature (potential victim) alert
    IF p_object_temp >= 34.0 AND (p_object_temp - p_ambient_temp) >= 5.0 THEN
        INSERT INTO alerts (rover_id, alert_type, severity, title, message, context_data)
        VALUES (
            p_rover_id,
            'high_temperature',
            'warning',
            CONCAT('🌡️ Heat Signature Detected - ', p_object_temp, '°C'),
            CONCAT('Elevated temperature reading: ', p_object_temp, '°C (ambient: ', p_ambient_temp, '°C, delta: ', ROUND(p_object_temp - p_ambient_temp, 2), '°C). Possible victim nearby.'),
            JSON_OBJECT('object_temp', p_object_temp, 'ambient_temp', p_ambient_temp, 'delta', ROUND(p_object_temp - p_ambient_temp, 2))
        );
    END IF;
    
    -- Update mission stats (if active mission exists)
    UPDATE mission_logs SET
        total_readings = total_readings + 1,
        alerts_triggered = (SELECT COUNT(*) FROM alerts WHERE rover_id = p_rover_id),
        updated_at = NOW()
    WHERE rover_id = p_rover_id AND status = 'active';
    
END //


-- Procedure: Mark rover as offline (called by heartbeat timeout checker)
CREATE PROCEDURE sp_rover_offline(
    IN p_rover_id VARCHAR(32)
)
BEGIN
    UPDATE rover_status SET is_online = FALSE WHERE rover_id = p_rover_id;
    
    INSERT INTO alerts (rover_id, alert_type, severity, title, message)
    VALUES (
        p_rover_id,
        'connection_lost',
        'danger',
        '📡 Rover Connection Lost',
        CONCAT('Lost connection with rover ', p_rover_id, '. Last heartbeat: ', 
               (SELECT last_heartbeat FROM rover_status WHERE rover_id = p_rover_id))
    );
END //

DELIMITER ;


-- ============================================================================
-- SCHEMA COMPLETE ✅
-- 
-- Tables Created : 7
-- Views Created  : 5
-- Procedures     : 2
-- Default Data   : 1 rover + 1 mission
--
-- Next Step      : Phase 2 — Node.js Backend API
-- ============================================================================
