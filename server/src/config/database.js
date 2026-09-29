// ============================================================================
// GridZero Server — MySQL Database Connection Pool
// ============================================================================
// Creates a reusable connection pool to the Electronics_Lab database.
// Uses mysql2/promise for async/await support throughout the application.
// ============================================================================

const mysql = require('mysql2/promise');
require('dotenv').config();

// Create connection pool with optimized settings for real-time IoT data
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'root123',
    database: process.env.DB_NAME || 'Electronics_Lab',
    
    // Pool settings
    connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT) || 10,
    waitForConnections: true,
    queueLimit: 0,
    
    // Timeout settings
    connectTimeout: 10000,     // 10 seconds to establish connection
    
    // Enable JSON parsing for JSON columns
    typeCast: function (field, next) {
        if (field.type === 'JSON') {
            return JSON.parse(field.string());
        }
        return next();
    }
});

/**
 * Test the database connection on startup.
 * Logs success or failure to console.
 */
async function testConnection() {
    try {
        const connection = await pool.getConnection();
        console.log('✅ MySQL Connected → Database: Electronics_Lab');
        
        // Verify tables exist
        const [tables] = await connection.query('SHOW TABLES');
        console.log(`   📦 Tables found: ${tables.length}`);
        
        connection.release();
        return true;
    } catch (error) {
        console.error('❌ MySQL Connection Failed:', error.message);
        console.error('   Make sure MySQL is running (XAMPP/MySQL Server 8.0)');
        return false;
    }
}

module.exports = { pool, testConnection };
