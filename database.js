const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');

const dbPath = path.join(__dirname, 'mafia.db');
const db = new sqlite3.Database(dbPath);

// Initialize Tables
db.serialize(() => {
    // Users Table
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Stats Table
    db.run(`CREATE TABLE IF NOT EXISTS stats (
        user_id INTEGER PRIMARY KEY,
        level INTEGER DEFAULT 1,
        total_xp INTEGER DEFAULT 0,
        games_played INTEGER DEFAULT 0,
        wins INTEGER DEFAULT 0,
        FOREIGN KEY (user_id) REFERENCES users(id)
    )`);

    // Achievements Table
    db.run(`CREATE TABLE IF NOT EXISTS achievements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        achievement_key TEXT,
        earned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
    )`);
});

const DB = {
    // Register User
    register: (username, password) => {
        return new Promise((resolve, reject) => {
            const hash = bcrypt.hashSync(password, 10);
            db.run(`INSERT INTO users (username, password_hash) VALUES (?, ?)`, [username, hash], function (err) {
                if (err) return reject(err);

                const userId = this.lastID;
                // Initialize stats
                db.run(`INSERT INTO stats (user_id) VALUES (?)`, [userId], (err) => {
                    if (err) return reject(err);
                    resolve(userId);
                });
            });
        });
    },

    // Login User
    login: (username, password) => {
        return new Promise((resolve, reject) => {
            db.get(`SELECT * FROM users WHERE username = ?`, [username], (err, user) => {
                if (err) return reject(err);
                if (!user) return reject(new Error('User not found'));

                const valid = bcrypt.compareSync(password, user.password_hash);
                if (!valid) return reject(new Error('Invalid password'));

                resolve(user);
            });
        });
    },

    // Get User Stats
    getStats: (userId) => {
        return new Promise((resolve, reject) => {
            db.get(`SELECT u.username, s.* FROM users u JOIN stats s ON u.id = s.user_id WHERE u.id = ?`, [userId], (err, stats) => {
                if (err) return reject(err);
                resolve(stats);
            });
        });
    },

    // Update Stats after game
    updateGameStats: (userId, xpGain, isWinner) => {
        return new Promise((resolve, reject) => {
            db.get(`SELECT total_xp, level FROM stats WHERE user_id = ?`, [userId], (err, row) => {
                if (err) return reject(err);

                let newXp = row.total_xp + xpGain;
                let newLevel = Math.floor(Math.sqrt(newXp / 100)) + 1; // Basic level formula
                let winInc = isWinner ? 1 : 0;

                db.run(`UPDATE stats SET total_xp = ?, level = ?, games_played = games_played + 1, wins = wins + ? WHERE user_id = ?`,
                    [newXp, newLevel, winInc, userId], (err) => {
                        if (err) return reject(err);
                        resolve({ newXp, newLevel });
                    });
            });
        });
    }
};

module.exports = DB;
