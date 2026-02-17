const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

// Connection string from environment variable (set in Render dashboard)
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Initialize Tables
async function initDB() {
    const client = await pool.connect();
    try {
        // Users Table
        await client.query(`CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        )`);

        // Stats Table
        await client.query(`CREATE TABLE IF NOT EXISTS stats (
            user_id INTEGER PRIMARY KEY REFERENCES users(id),
            level INTEGER DEFAULT 1,
            total_xp INTEGER DEFAULT 0,
            games_played INTEGER DEFAULT 0,
            wins INTEGER DEFAULT 0
        )`);

        // Achievements Table
        await client.query(`CREATE TABLE IF NOT EXISTS achievements (
            id SERIAL PRIMARY KEY,
            user_id INTEGER REFERENCES users(id),
            achievement_key TEXT,
            earned_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        )`);

        console.log('[DB] PostgreSQL tables initialized successfully');
    } catch (err) {
        console.error('[DB] Error initializing tables:', err);
    } finally {
        client.release();
    }
}

// Run initialization
initDB();

const DB = {
    // Register User
    register: async (username, password) => {
        const hash = bcrypt.hashSync(password, 10);
        const userResult = await pool.query(
            `INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id`,
            [username, hash]
        );
        const userId = userResult.rows[0].id;

        // Initialize stats
        await pool.query(`INSERT INTO stats (user_id) VALUES ($1)`, [userId]);
        return userId;
    },

    // Login User
    login: async (username, password) => {
        const result = await pool.query(
            `SELECT * FROM users WHERE username = $1`,
            [username]
        );
        const user = result.rows[0];
        if (!user) throw new Error('User not found');

        const valid = bcrypt.compareSync(password, user.password_hash);
        if (!valid) throw new Error('Invalid password');

        return user;
    },

    // Get User Stats
    getStats: async (userId) => {
        const result = await pool.query(
            `SELECT u.username, s.* FROM users u JOIN stats s ON u.id = s.user_id WHERE u.id = $1`,
            [userId]
        );
        return result.rows[0] || null;
    },

    // Update Stats after game
    updateGameStats: async (userId, xpGain, isWinner) => {
        const statsResult = await pool.query(
            `SELECT total_xp, level FROM stats WHERE user_id = $1`,
            [userId]
        );
        const row = statsResult.rows[0];
        if (!row) throw new Error('Stats not found for user');

        const newXp = row.total_xp + xpGain;
        const newLevel = Math.floor(Math.sqrt(newXp / 100)) + 1;
        const winInc = isWinner ? 1 : 0;

        await pool.query(
            `UPDATE stats SET total_xp = $1, level = $2, games_played = games_played + 1, wins = wins + $3 WHERE user_id = $4`,
            [newXp, newLevel, winInc, userId]
        );

        return { newXp, newLevel };
    }
};

module.exports = DB;
