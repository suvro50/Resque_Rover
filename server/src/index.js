
require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const morgan = require('morgan');
const helmet = require('helmet');
const path = require('path');

// Internal modules
const { testConnection } = require('./config/database');
const { initializeWebSocket } = require('./websocket/socketHandler');
const { initVisionDetector, startCameraAnalysis } = require('./services/visionDetector');

// Routes
const telemetryRoutes = require('./routes/telemetry');
const roverRoutes = require('./routes/rover');
const alertRoutes = require('./routes/alerts');
const victimRoutes = require('./routes/victims');
const missionRoutes = require('./routes/mission');
const simulatorRoutes = require('./utils/dataSimulator');
const aiRoutes = require('./routes/ai');

// ============================================================================
// App Setup
// ============================================================================

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

// Socket.IO setup with CORS for dashboard
const io = new Server(server, {
    cors: {
        origin: process.env.CORS_ORIGIN || '*',
        methods: ['GET', 'POST', 'PUT', 'DELETE']
    }
});

// Store io instance on app for access in routes
app.set('io', io);

// ============================================================================
// Middleware
// ============================================================================

// Security headers
app.use(helmet({
    contentSecurityPolicy: false,  // Allow inline scripts for dashboard
    crossOriginEmbedderPolicy: false
}));

// CORS — allow dashboard and ESP32 to connect
app.use(cors({
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// Request logging
app.use(morgan('dev'));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve dashboard static files from the dashboard folder
app.use(express.static(path.join(__dirname, '../../dashboard')));

// ============================================================================
// API Routes
// ============================================================================

app.use('/api/telemetry', telemetryRoutes);
app.use('/api/rover', roverRoutes);
app.use('/api/alerts', alertRoutes);
app.use('/api/victims', victimRoutes);
app.use('/api/mission', missionRoutes);
app.use('/api/simulator', simulatorRoutes);
app.use('/api/ai', aiRoutes);

// ── Health Check ──────────────────────────────────────────────────────────

app.get('/api/health', (req, res) => {
    res.json({
        status: 'online',
        project: 'GridZero — Autonomous Rescue System',
        version: '1.0.0',
        uptime: Math.floor(process.uptime()),
        timestamp: new Date().toISOString()
    });
});

// ── API Documentation (simple overview) ───────────────────────────────────

app.get('/api', (req, res) => {
    res.json({
        project: 'GridZero Server API',
        version: '1.0.0',
        endpoints: {
            health: 'GET /api/health',
            telemetry: {
                post: 'POST /api/telemetry — Send sensor data from ESP32',
                latest: 'GET /api/telemetry/latest — Latest sensor readings',
                history: 'GET /api/telemetry/history?sensor=thermal&minutes=60'
            },
            rover: {
                status: 'GET /api/rover/status — Rover status',
                list: 'GET /api/rover/list — All rovers',
                command: 'POST /api/rover/command — Send motor command',
                mode: 'POST /api/rover/mode — Change operation mode'
            },
            alerts: {
                list: 'GET /api/alerts — All alerts',
                active: 'GET /api/alerts/active — Unacknowledged alerts',
                create: 'POST /api/alerts — Create alert',
                ack: 'PUT /api/alerts/:id/ack — Acknowledge alert',
                ackAll: 'PUT /api/alerts/ack-all — Acknowledge all'
            },
            victims: {
                list: 'GET /api/victims — All detections',
                stats: 'GET /api/victims/stats — Statistics',
                create: 'POST /api/victims — Record detection',
                review: 'PUT /api/victims/:id/review — Human review'
            },
            mission: {
                list: 'GET /api/mission — All missions',
                active: 'GET /api/mission/active — Current mission',
                create: 'POST /api/mission — New mission',
                start: 'PUT /api/mission/:id/start',
                complete: 'PUT /api/mission/:id/complete',
                abort: 'PUT /api/mission/:id/abort'
            },
            simulator: {
                start: 'POST /api/simulator/start — Start fake data',
                stop: 'POST /api/simulator/stop — Stop fake data',
                status: 'GET /api/simulator/status'
            }
        },
        websocket: {
            url: `ws://localhost:${PORT}`,
            events: [
                'telemetry:update', 'rover:status', 'rover:command',
                'rover:mode', 'alert:new', 'alert:acknowledged',
                'victim:detected', 'mission:started', 'mission:completed'
            ]
        }
    });
});

// ── Serve Dashboard for root URL ──────────────────────────────────────────

app.get('/', (req, res) => {
    const dashboardPath = path.join(__dirname, '../../dashboard/index.html');
    res.sendFile(dashboardPath, (err) => {
        if (err) {
            res.json({
                message: 'GridZero Server is running! Dashboard not yet built.',
                api: `http://localhost:${PORT}/api`,
                docs: `http://localhost:${PORT}/api`
            });
        }
    });
});

// ── 404 Handler ───────────────────────────────────────────────────────────

app.use((req, res) => {
    res.status(404).json({
        success: false,
        error: `Route ${req.method} ${req.originalUrl} not found`,
        available: `GET /api for endpoint documentation`
    });
});

// ── Global Error Handler ──────────────────────────────────────────────────

app.use((err, req, res, next) => {
    console.error('💥 Server Error:', err);
    res.status(500).json({
        success: false,
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

// ============================================================================
// Start Server
// ============================================================================

async function startServer() {
    console.log('');
    console.log('═══════════════════════════════════════════════════');
    console.log('   GridZero — Autonomous Rescue System Server');
    console.log('   Prepared By: Suvrojit Bose Sarthok & Team');
    console.log('   Institution: United International University');
    console.log('═══════════════════════════════════════════════════');
    console.log('');

    // Test database connection
    const dbConnected = await testConnection();
    if (!dbConnected) {
        console.error('');
        console.error('⛔ Cannot start without database. Make sure MySQL is running.');
        process.exit(1);
    }

    // Initialize WebSocket
    initializeWebSocket(io);

    // Start HTTP server
    server.listen(PORT, async () => {
        console.log('');
        console.log(`🚀 Server running at:   http://localhost:${PORT}`);
        console.log(`📡 WebSocket at:        ws://localhost:${PORT}`);
        console.log(`📋 API Docs at:         http://localhost:${PORT}/api`);
        console.log(`🎮 Dashboard at:        http://localhost:${PORT}`);
        console.log(`🧪 Start Simulator:     POST http://localhost:${PORT}/api/simulator/start`);
        console.log('');

        // Initialize Camera AI Vision Detector
        console.log('📷 Initializing Camera AI Vision Detector...');
        const visionReady = await initVisionDetector();
        if (visionReady) {
            startCameraAnalysis(io);
            console.log('✅ Camera AI Vision Detector is active');
            console.log(`   Vision API:          http://localhost:${PORT}/api/ai/vision/status`);
        } else {
            console.log('⚠️ Camera AI Vision Detector failed to load — thermal-only mode');
            console.log('   The system will still work using thermal sensor for detection.');
        }

        console.log('');
        console.log('═══════════════════════════════════════════════════');
        console.log('   Ready to receive data from ESP32 rover! 🤖');
        console.log('═══════════════════════════════════════════════════');
        console.log('');
    });
}

startServer();
