require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const jwt = require('jsonwebtoken');
const DB = require('./database');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const SECRET_KEY = 'mafia_ultra_secret_key_2026'; // In production, move to env

app.use(express.json());
// Serve static files with no-cache headers
app.use(express.static(path.join(__dirname, 'public'), {
    etag: false,
    lastModified: false,
    setHeaders: (res) => {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
    }
}));

// Authentication API
app.post('/api/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        console.log(`[AUTH] Registering user: ${username}`);
        const userId = await DB.register(username, password);
        const token = jwt.sign({ userId, username }, SECRET_KEY, { expiresIn: '7d' });
        console.log(`[AUTH] Registration success: ${username} (ID: ${userId})`);
        res.json({ success: true, token, user: { id: userId, username } });
    } catch (err) {
        console.error(`[AUTH] Registration failed for ${req.body.username}:`, err);
        res.status(400).json({ success: false, error: 'Registration failed or user exists' });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        console.log(`[AUTH] Login attempt: ${username}`);
        const user = await DB.login(username, password);
        const token = jwt.sign({ userId: user.id, username: user.username }, SECRET_KEY, { expiresIn: '7d' });
        console.log(`[AUTH] Login success: ${username}`);
        res.json({ success: true, token, user: { id: user.id, username: user.username } });
    } catch (err) {
        console.error(`[AUTH] Login failed for ${req.body.username}:`, err.message);
        res.status(401).json({ success: false, error: err.message });
    }
});

app.get('/api/me', async (req, res) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) throw new Error('No token');
        const decoded = jwt.verify(token, SECRET_KEY);
        const stats = await DB.getStats(decoded.userId);
        if (!stats) {
            console.warn(`[AUTH] Stats not found for user ID: ${decoded.userId}`);
            return res.status(404).json({ success: false, error: 'User stats not found' });
        }
        res.json({ success: true, user: stats });
    } catch (err) {
        console.error(`[AUTH] Auth check failed:`, err.message);
        res.status(401).json({ success: false });
    }
});

// Socket Auth Middleware
io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (token) {
        try {
            const decoded = jwt.verify(token, SECRET_KEY);
            socket.userId = decoded.userId;
            socket.username = decoded.username;
            return next();
        } catch (err) {
            // Expired or invalid token
        }
    }
    next();
});

// API to get public rooms
app.get('/api/rooms', (req, res) => {
    const publicRooms = [];
    rooms.forEach((room, code) => {
        if (room.settings.isPublic && room.phase === 'lobby') {
            publicRooms.push({
                code: code,
                hostName: room.players[0]?.name || 'Unknown',
                playerCount: room.players.length,
                maxPlayers: room.settings.maxPlayers
            });
        }
    });
    res.json(publicRooms);
});

// Game state storage
const rooms = new Map();

// Role types
const ROLES = {
    MAFIA: 'mafia',
    DOCTOR: 'doctor',
    DETECTIVE: 'detective',
    CITIZEN: 'citizen',
    GUARDIAN_ANGEL: 'guardian_angel', // New: Revives killed players
    JOKER: 'joker'                     // New: Mimics dead roles
};

// Game phases
const PHASES = {
    LOBBY: 'lobby',
    ROLE_REVEAL: 'roleReveal',
    NIGHT: 'night',
    DAY: 'day',
    GAME_OVER: 'gameOver'
};

// Default settings
const DEFAULT_SETTINGS = {
    maxPlayers: 20,
    mafiaCount: 0, // 0 = auto (floor(players/4))
    doctorCount: 1,
    detectiveCount: 1,
    doctorSelfHeal: true,
    isPublic: false,
    nightTimer: 60,
    dayTimer: 120,
    gameMode: 'classic' // classic or custom
};

// Generate a random 6-character room code
function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

// Shuffle array (Fisher-Yates)
function shuffleArray(array) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

// Assign roles based on player count and settings
function assignRoles(players, settings) {
    const totalPlayers = players.length;
    const mafiaCount = settings.mafiaCount > 0 ? settings.mafiaCount : Math.floor(totalPlayers / 4);

    const roles = [];

    // Add Mafia
    for (let i = 0; i < mafiaCount; i++) {
        roles.push(ROLES.MAFIA);
    }

    if (settings.gameMode === 'custom') {
        // Custom Mode Specifics
        roles.push(ROLES.GUARDIAN_ANGEL);
        roles.push(ROLES.JOKER);

        // Fill remaining special slots minus what's taken by GA/Joker
        for (let i = 0; i < settings.doctorCount; i++) {
            if (roles.length < totalPlayers) roles.push(ROLES.DOCTOR);
        }
        for (let i = 0; i < settings.detectiveCount; i++) {
            if (roles.length < totalPlayers) roles.push(ROLES.DETECTIVE);
        }
    } else {
        // Classic Mode
        // Add Doctors
        for (let i = 0; i < settings.doctorCount; i++) {
            if (roles.length < totalPlayers) roles.push(ROLES.DOCTOR);
        }

        // Add Detectives
        for (let i = 0; i < settings.detectiveCount; i++) {
            if (roles.length < totalPlayers) roles.push(ROLES.DETECTIVE);
        }
    }

    // Fill rest with Citizens
    while (roles.length < totalPlayers) {
        roles.push(ROLES.CITIZEN);
    }

    // Shuffle and assign
    const shuffledRoles = shuffleArray(roles);
    players.forEach((player, index) => {
        player.role = shuffledRoles[index];
        player.originalRole = shuffledRoles[index]; // Keep record for Joker
        player.usedSpecialAction = false; // For roles with one-time use powers
    });

    return players;
}

// Check win conditions
function checkWinCondition(room) {
    const alivePlayers = room.players.filter(p => p.alive);
    const aliveMafia = alivePlayers.filter(p => p.role === ROLES.MAFIA);
    const aliveTown = alivePlayers.filter(p => p.role !== ROLES.MAFIA);

    if (aliveMafia.length === 0) {
        return {
            winner: 'town',
            message: 'المدينة تفوز! تم القضاء على جميع أفراد المافيا.',
            winningRole: 'town'
        };
    }

    if (aliveMafia.length >= aliveTown.length) {
        return {
            winner: 'mafia',
            message: 'المافيا تفوز! لقد سيطروا على المدينة.',
            winningRole: 'mafia'
        };
    }

    return null;
}

// Get anonymized stats for round summary (hide roles, show names)
function getRoleStats(room) {
    const alive = room.players.filter(p => p.alive);
    return {
        total: alive.length,
        alivePlayers: alive.map(p => ({
            name: p.name,
            playerNumber: p.playerNumber
        })).sort((a, b) => a.playerNumber - b.playerNumber)
    };
}

// Reset room for new game
function resetRoomForNewGame(room) {
    room.phase = PHASES.LOBBY;
    room.nightActions = {};
    room.votes = {};
    room.dayNumber = 0;
    room.players.forEach(p => {
        p.role = null;
        p.alive = true;
        p.ready = false;
    });
}
// Handle player leaving room
function handlePlayerLeave(socket) {
    const roomCode = socket.roomCode;
    if (!roomCode) return;

    const room = rooms.get(roomCode);
    if (!room) return;

    // Remove player from room
    room.players = room.players.filter(p => p.id !== socket.id);
    socket.leave(roomCode);

    // If room is empty, delete it
    if (room.players.length === 0) {
        rooms.delete(roomCode);
        console.log(`Room ${roomCode} deleted (empty)`);
        return;
    }

    // If host left, assign new host
    if (room.host === socket.id && room.players.length > 0) {
        room.host = room.players[0].id;
        io.to(room.players[0].id).emit('host:assigned');
        console.log(`New host assigned in room ${roomCode}: ${room.players[0].name}`);
    }

    // Notify remaining players
    io.to(roomCode).emit('player:list', room.players);
    console.log(`Player ${socket.id} left room ${roomCode}`);
}

// Socket.io connection handling
io.on('connection', (socket) => {
    console.log(`Player connected: ${socket.id}`);

    // Handle disconnect
    socket.on('disconnect', () => {
        console.log(`Player disconnected: ${socket.id}`);
        handlePlayerLeave(socket);
    });

    // Create a new room with settings
    socket.on('room:create', ({ playerName, settings }) => {
        const roomCode = generateRoomCode();
        const roomSettings = { ...DEFAULT_SETTINGS, ...settings };

        const room = {
            code: roomCode,
            host: socket.id,
            phase: PHASES.LOBBY,
            settings: roomSettings,
            players: [{
                id: socket.id,
                name: playerName,
                playerNumber: 1,
                role: null,
                alive: true,
                ready: false
            }],
            nightActions: {},
            votes: {},
            dayNumber: 0
        };

        rooms.set(roomCode, room);
        socket.join(roomCode);
        socket.roomCode = roomCode;

        socket.emit('room:created', { roomCode, players: room.players, settings: roomSettings });
        console.log(`Room created: ${roomCode} by ${playerName}`);
    });

    // Update room settings (host only)
    socket.on('room:updateSettings', (newSettings) => {
        const room = rooms.get(socket.roomCode);
        if (!room || room.host !== socket.id) return;
        if (room.phase !== PHASES.LOBBY) return;

        room.settings = { ...room.settings, ...newSettings };
        io.to(socket.roomCode).emit('settings:updated', room.settings);
    });

    // Join an existing room
    socket.on('room:join', ({ roomCode, playerName }) => {
        const room = rooms.get(roomCode.toUpperCase());

        if (!room) {
            socket.emit('room:error', 'Room not found');
            return;
        }

        if (room.phase !== PHASES.LOBBY) {
            socket.emit('room:error', 'Game already in progress');
            return;
        }

        if (room.players.length >= room.settings.maxPlayers) {
            socket.emit('room:error', 'Room is full');
            return;
        }

        room.players.push({
            id: socket.id,
            name: playerName,
            playerNumber: room.players.length + 1,
            role: null,
            alive: true,
            ready: false
        });

        socket.join(roomCode.toUpperCase());
        socket.roomCode = roomCode.toUpperCase();

        io.to(roomCode.toUpperCase()).emit('player:list', room.players);
        socket.emit('room:joined', { roomCode: roomCode.toUpperCase(), players: room.players, settings: room.settings });
        console.log(`${playerName} joined room ${roomCode}`);
    });

    // Leave room
    socket.on('room:leave', () => {
        handlePlayerLeave(socket);
        socket.roomCode = null;
        socket.emit('room:left');
    });

    // Start the game
    socket.on('game:start', () => {
        const room = rooms.get(socket.roomCode);

        if (!room || room.host !== socket.id) {
            socket.emit('room:error', 'Only the host can start the game');
            return;
        }

        if (room.players.length < 4) {
            socket.emit('room:error', 'Need at least 4 players to start');
            return;
        }

        // Re-assign player numbers sequentially to ensure valid order (1, 2, 3, 4...)
        room.players.forEach((p, index) => {
            p.playerNumber = index + 1;
        });

        console.log(`[DEBUG] Game Starting in Room ${socket.roomCode}. Player Numbers Assigned:`, room.players.map(p => `${p.name}: #${p.playerNumber}`));

        // Assign roles with settings
        room.players = assignRoles(room.players, room.settings);
        room.phase = PHASES.ROLE_REVEAL;

        // Get list of mafia players for team awareness
        const mafiaTeam = room.players
            .filter(p => p.role === ROLES.MAFIA)
            .map(p => ({ id: p.id, name: p.name, playerNumber: p.playerNumber }));

        // Send role to each player (with mafia teammates if applicable)
        room.players.forEach(player => {
            const roleData = {
                role: player.role,
                phase: room.phase
            };

            // If player is mafia, send list of teammates
            if (player.role === ROLES.MAFIA) {
                roleData.teammates = mafiaTeam.filter(m => m.id !== player.id);
            }

            io.to(player.id).emit('role:assigned', roleData);
        });

        io.to(socket.roomCode).emit('game:started', {
            players: room.players.map(p => ({ id: p.id, name: p.name, playerNumber: p.playerNumber, alive: p.alive })),
            phase: room.phase
        });

        console.log(`Game started in room ${socket.roomCode}`);
    });

    // Play again in same room
    socket.on('game:playAgain', () => {
        const room = rooms.get(socket.roomCode);
        if (!room || room.host !== socket.id) return;

        resetRoomForNewGame(room);

        io.to(socket.roomCode).emit('game:reset', {
            players: room.players,
            settings: room.settings
        });

        console.log(`Game reset in room ${socket.roomCode}`);
    });

    // Player is ready (after viewing role)
    socket.on('player:ready', () => {
        const room = rooms.get(socket.roomCode);
        if (!room) return;

        const player = room.players.find(p => p.id === socket.id);
        if (player) {
            player.ready = true;

            io.to(socket.roomCode).emit('player:readyUpdate', {
                playerId: socket.id,
                readyCount: room.players.filter(p => p.ready).length,
                totalCount: room.players.length
            });

            if (room.players.every(p => p.ready)) {
                startNightPhase(room);
            }
        }
    });

    // Night action (Mafia kill, Doctor save, Detective investigate)
    socket.on('night:action', ({ targetId }) => {
        const room = rooms.get(socket.roomCode);
        if (!room || room.phase !== PHASES.NIGHT) return;

        // Turn check
        if (room.currentTurnPlayerId !== socket.id) {
            socket.emit('room:error', 'Not your turn!');
            return;
        }

        const player = room.players.find(p => p.id === socket.id);
        if (!player || !player.alive) return;

        // Guardian Angel / Joker Target Check
        const target = room.players.find(p => p.id === targetId);
        if ((player.role === ROLES.GUARDIAN_ANGEL || player.role === ROLES.JOKER)) {
            if (player.usedSpecialAction) {
                socket.emit('room:error', 'لقد استخدمت قدرتك الخاصة بالفعل!');
                return;
            }
            if (!target || target.alive) {
                socket.emit('room:error', 'يجب اختيار لاعب ميت!');
                return;
            }

            if (player.role === ROLES.GUARDIAN_ANGEL && target.lynched) {
                socket.emit('room:error', 'يمكنك فقط إحياء من قُتلوا غدراً، وليس من أُخرجوا بالتصويت!');
                return;
            }

            if (player.role === ROLES.JOKER) {
                const deadCount = room.players.filter(p => !p.alive).length;
                if (deadCount < 2) {
                    socket.emit('room:error', 'يجب أن يموت شخصان على الأقل لتفعيل قدرتك!');
                    return;
                }
            }
        }

        // Doctor self-heal check
        if (player.role === ROLES.DOCTOR && targetId === socket.id && !room.settings.doctorSelfHeal) {
            socket.emit('room:error', 'You cannot heal yourself');
            return;
        }

        room.nightActions[player.role] = room.nightActions[player.role] || [];
        // Sequential turn means only one action per turn
        room.nightActions[player.role] = room.nightActions[player.role].filter(a => a.actor !== socket.id);

        room.nightActions[player.role].push({
            actor: socket.id,
            target: targetId
        });

        socket.emit('night:actionConfirmed', { targetId });

        // Advance turn
        advanceTurn(room);
    });

    // Night skip (for anyone in their turn)
    socket.on('night:skip', () => {
        const room = rooms.get(socket.roomCode);
        if (!room || room.phase !== PHASES.NIGHT) return;

        const player = room.players.find(p => p.id === socket.id);
        if (!player || !player.alive) return;

        // Skip logic
        room.nightActions['skips'] = room.nightActions['skips'] || [];
        room.nightActions['skips'].push(socket.id);

        // Advance turn
        advanceTurn(room);
    });

    // Day vote
    socket.on('day:vote', ({ targetId }) => {
        const room = rooms.get(socket.roomCode);
        if (!room || room.phase !== PHASES.DAY) return;

        // Turn check
        if (room.currentTurnPlayerId !== socket.id) {
            socket.emit('room:error', 'Not your turn!');
            return;
        }

        const player = room.players.find(p => p.id === socket.id);
        if (!player || !player.alive) return;

        room.votes[socket.id] = targetId;

        // Send vote update
        io.to(socket.roomCode).emit('vote:update', {
            voterId: socket.id,
            targetId: targetId
        });

        // Advance turn
        advanceTurn(room);
    });

    // Skip vote
    socket.on('day:skipVote', () => {
        const room = rooms.get(socket.roomCode);
        if (!room || room.phase !== PHASES.DAY) return;

        // Turn check
        if (room.currentTurnPlayerId !== socket.id) {
            socket.emit('room:error', 'Not your turn!');
            return;
        }

        const player = room.players.find(p => p.id === socket.id);
        if (!player || !player.alive) return;

        room.votes[socket.id] = 'skip';

        io.to(socket.roomCode).emit('vote:update', {
            voterId: socket.id,
            targetId: 'skip'
        });

        // Advance turn
        advanceTurn(room);
    });

    // Disconnect handling
    socket.on('disconnect', () => {
        console.log(`Player disconnected: ${socket.id}`);
        handlePlayerLeave(socket);
    });
});

function handlePlayerLeave(socket) {
    if (socket.roomCode) {
        const room = rooms.get(socket.roomCode);
        if (room) {
            room.players = room.players.filter(p => p.id !== socket.id);

            if (room.players.length === 0) {
                rooms.delete(socket.roomCode);
                console.log(`Room ${socket.roomCode} deleted (empty)`);
            } else {
                if (room.host === socket.id) {
                    room.host = room.players[0].id;
                    io.to(room.players[0].id).emit('host:assigned');
                }

                io.to(socket.roomCode).emit('player:list', room.players);
            }
        }
    }
}

// Helper to get alive players sorted by playerNumber
function getSortedAlivePlayers(room) {
    return room.players
        .filter(p => p.alive)
        .sort((a, b) => a.playerNumber - b.playerNumber);
}

// Auto-complete action for the current turn player
function autoCompleteCurrentTurnAction(room, player) {
    console.log(`[TIMER] Auto-completing turn for ${player.name} in room ${room.code} (${room.phase})`);

    if (room.phase === PHASES.NIGHT) {
        const role = player.role;
        if (role === ROLES.MAFIA) {
            // Smart/Random Kill: Favor teammates' targets, otherwise pick random Town
            let targetId = null;
            const existingMafiaActions = room.nightActions[ROLES.MAFIA] || [];
            if (existingMafiaActions.length > 0) {
                targetId = existingMafiaActions[0].target;
            } else {
                const alivePlayers = room.players.filter(p => p.alive);
                const townies = alivePlayers.filter(p => p.role !== ROLES.MAFIA);
                if (townies.length > 0) {
                    targetId = townies[Math.floor(Math.random() * townies.length)].id;
                }
            }

            if (targetId) {
                room.nightActions[ROLES.MAFIA] = room.nightActions[ROLES.MAFIA] || [];
                room.nightActions[ROLES.MAFIA].push({ actor: player.id, target: targetId });
                console.log(`[AUTO] Mafia ${player.name} auto-targeted ${targetId}`);
            }
        } else {
            // Auto-skip for Town roles (Doctor, Detective, Citizen)
            room.nightActions['skips'] = room.nightActions['skips'] || [];
            if (!room.nightActions['skips'].includes(player.id)) {
                room.nightActions['skips'].push(player.id);
            }
            console.log(`[AUTO] Role ${role} (${player.name}) auto-skipped`);
        }
    } else if (room.phase === PHASES.DAY) {
        // Auto-skip vote for Day phase turn
        if (!room.votes[player.id]) {
            room.votes[player.id] = 'skip';
            console.log(`[AUTO] Player ${player.name} auto-voted skip`);
        }
    }
}


// Timer management
const roomTimers = new Map();

function clearRoomTimer(roomCode) {
    if (roomTimers.has(roomCode)) {
        clearTimeout(roomTimers.get(roomCode));
        roomTimers.delete(roomCode);
        console.log(`[TIMER] Cleared timer for room ${roomCode}`);
    }
}

function startRoomTimer(room, duration, onExpire) {
    clearRoomTimer(room.code);
    if (duration <= 0) return;

    console.log(`[TIMER] Starting ${duration}s timer for room ${room.code}`);

    // Sync with clients
    io.to(room.code).emit('timer:sync', { duration, phase: room.phase });

    const timerId = setTimeout(() => {
        console.log(`[TIMER] Timer expired for room ${room.code}, phase ${room.phase}`);
        roomTimers.delete(room.code);
        onExpire();
    }, duration * 1000);

    roomTimers.set(room.code, timerId);
}

// Advance turn to the next player
function advanceTurn(room) {
    const sortedAlive = getSortedAlivePlayers(room);
    const currentIndex = sortedAlive.findIndex(p => p.id === room.currentTurnPlayerId);

    let nextPlayer = null;

    if (currentIndex === -1) {
        // Should not happen if logic is correct, but safe fallback to first
        nextPlayer = sortedAlive[0];
    } else if (currentIndex < sortedAlive.length - 1) {
        nextPlayer = sortedAlive[currentIndex + 1];
        console.log(`[DEBUG] Advancing turn to: ${nextPlayer.name} (#${nextPlayer.playerNumber})`);
    } else {
        // End of turns for this phase
        console.log(`[DEBUG] Final player acted in phase ${room.phase}. Resolving phase...`);
        room.currentTurnPlayerId = null;
        clearRoomTimer(room.code); // Stop timer when naturally finished
        io.to(room.code).emit('turn:change', { playerId: null });

        if (room.phase === PHASES.NIGHT) {
            resolveNight(room);
        } else if (room.phase === PHASES.DAY) {
            resolveDayVoting(room);
        }
        return;
    }

    if (nextPlayer) {
        room.currentTurnPlayerId = nextPlayer.id;
        io.to(room.code).emit('turn:change', {
            playerId: nextPlayer.id,
            playerNumber: nextPlayer.playerNumber,
            name: nextPlayer.name
        });

        // Start Turn Timer
        const duration = room.phase === PHASES.NIGHT ? room.settings.nightTimer : room.settings.dayTimer;
        if (duration > 0) {
            startRoomTimer(room, duration, () => {
                console.log(`[TIMER] Turn timed out for ${nextPlayer.name} (#${nextPlayer.playerNumber})`);
                autoCompleteCurrentTurnAction(room, nextPlayer);
                advanceTurn(room);
            });
        }
    }
}

// Start night phase
function startNightPhase(room) {
    room.phase = PHASES.NIGHT;
    room.dayNumber++;
    room.nightActions = {};
    room.players.forEach(p => p.ready = false);

    // Initialize turn state
    const sortedAlive = getSortedAlivePlayers(room);
    if (sortedAlive.length > 0) {
        room.currentTurnPlayerId = sortedAlive[0].id;
    }

    io.to(room.code).emit('phase:night', {
        dayNumber: room.dayNumber,
        players: room.players.map(p => ({ id: p.id, name: p.name, playerNumber: p.playerNumber, alive: p.alive })),
        settings: room.settings,
        currentTurn: sortedAlive.length > 0 ? {
            playerId: sortedAlive[0].id,
            playerNumber: sortedAlive[0].playerNumber,
            name: sortedAlive[0].name
        } : null
    });

    console.log(`[DEBUG] Night Play Order Room ${room.code}:`, sortedAlive.map(p => `${p.name}(#${p.playerNumber})`));

    // Start timer AFTER emitting phase event
    const duration = room.settings.nightTimer;
    if (duration > 0 && sortedAlive.length > 0) {
        startRoomTimer(room, duration, () => {
            const firstPlayer = sortedAlive[0];
            console.log(`[TIMER] First night turn timed out for ${firstPlayer.name}`);
            autoCompleteCurrentTurnAction(room, firstPlayer);
            advanceTurn(room);
        });
    }
}

// Check if all night actions are complete - DEPRECATED in Turn-based, logic moved to advanceTurn
function checkNightComplete(room) {
    // In sequential mode, we don't check via this function anymore.
    // The turn advancement handles completion.
}

// Resolve night actions
function resolveNight(room) {
    let killedPlayer = null;
    let savedPlayer = null;
    const investigationResults = [];

    // Get mafia kill target (majority vote among mafia)
    if (room.nightActions[ROLES.MAFIA]) {
        const killVotes = {};
        room.nightActions[ROLES.MAFIA].forEach(action => {
            killVotes[action.target] = (killVotes[action.target] || 0) + 1;
        });

        // In turn-based, Mafia technically vote sequentially.
        // We still take the majority or the last one? Majority is fair.
        const targetId = Object.entries(killVotes).sort((a, b) => b[1] - a[1])[0]?.[0];
        if (targetId) {
            killedPlayer = room.players.find(p => p.id === targetId);
        }
    }

    // Check if any doctor saved the target
    if (room.nightActions[ROLES.DOCTOR]) {
        room.nightActions[ROLES.DOCTOR].forEach(saveAction => {
            if (killedPlayer && saveAction.target === killedPlayer.id) {
                savedPlayer = killedPlayer;
                killedPlayer = null;
            }
        });
    }

    // Detective investigations
    if (room.nightActions[ROLES.DETECTIVE]) {
        room.nightActions[ROLES.DETECTIVE].forEach(investigateAction => {
            const target = room.players.find(p => p.id === investigateAction.target);
            if (target) {
                investigationResults.push({
                    detectiveId: investigateAction.actor,
                    targetId: target.id,
                    targetName: target.name,
                    isMafia: target.role === ROLES.MAFIA
                });
            }
        });
    }

    // Apply kill
    if (killedPlayer) {
        killedPlayer.alive = false;
    }

    // Guardian Angel Revival
    let revivedPlayer = null;
    if (room.nightActions[ROLES.GUARDIAN_ANGEL]) {
        const action = room.nightActions[ROLES.GUARDIAN_ANGEL][0];
        const target = room.players.find(p => p.id === action.target);

        // Only revive if they weren't voted out (we should track how they died)
        // For now, let's assume all dead players in nightActions for GA are valid targets
        // but we should check if they were already dead before this night or killed this night.
        // The user said "not those اخرجوا بالتصويت".
        if (target && !target.alive && !target.lynched) {
            target.alive = true;
            revivedPlayer = target;
            const gaPlayer = room.players.find(p => p.id === action.actor);
            if (gaPlayer) gaPlayer.usedSpecialAction = true;
        }
    }

    // Joker Mimicry (processed at end of night for simplicity, or immediate? Let's do end of night)
    if (room.nightActions[ROLES.JOKER]) {
        const action = room.nightActions[ROLES.JOKER][0];
        const jokerPlayer = room.players.find(p => p.id === action.actor);
        const target = room.players.find(p => p.id === action.target);

        if (jokerPlayer && target && !target.alive) {
            jokerPlayer.role = target.originalRole;
            jokerPlayer.usedSpecialAction = true;
            // Notify the joker privately
            io.to(jokerPlayer.id).emit('joker:roleUpdate', { newRole: jokerPlayer.role });
        }
    }

    // Send night results with role stats
    io.to(room.code).emit('night:result', {
        killed: killedPlayer ? { id: killedPlayer.id, name: killedPlayer.name } : null,
        revived: revivedPlayer ? { id: revivedPlayer.id, name: revivedPlayer.name } : null,
        saved: savedPlayer ? true : false,
        roleStats: getRoleStats(room),
        dayNumber: room.dayNumber
    });

    // Send investigation results to each detective
    investigationResults.forEach(result => {
        io.to(result.detectiveId).emit('detective:result', {
            targetId: result.targetId,
            targetName: result.targetName,
            isMafia: result.isMafia
        });
    });

    // Check win condition
    const winResult = checkWinCondition(room);
    if (winResult) {
        resolveGameOver(room, winResult);
    } else {
        startDayPhase(room);
    }
}

// Start day phase
function startDayPhase(room) {
    room.phase = PHASES.DAY;
    room.votes = {};

    // Initialize turn state
    const sortedAlive = getSortedAlivePlayers(room);
    if (sortedAlive.length > 0) {
        room.currentTurnPlayerId = sortedAlive[0].id;
    }

    io.to(room.code).emit('phase:day', {
        dayNumber: room.dayNumber,
        players: room.players.map(p => ({ id: p.id, name: p.name, playerNumber: p.playerNumber, alive: p.alive })),
        currentTurn: sortedAlive.length > 0 ? {
            playerId: sortedAlive[0].id,
            playerNumber: sortedAlive[0].playerNumber,
            name: sortedAlive[0].name
        } : null
    });

    console.log(`[DEBUG] Day Play Order Room ${room.code}:`, sortedAlive.map(p => `${p.name}(#${p.playerNumber})`));

    // Start timer AFTER emitting phase event
    const duration = room.settings.dayTimer;
    if (duration > 0 && sortedAlive.length > 0) {
        startRoomTimer(room, duration, () => {
            const firstPlayer = sortedAlive[0];
            console.log(`[TIMER] First day turn timed out for ${firstPlayer.name}`);
            autoCompleteCurrentTurnAction(room, firstPlayer);
            advanceTurn(room);
        });
    }
}

// Resolve day voting
function resolveDayVoting(room) {
    const voteCounts = {};
    let skipVotes = 0;

    Object.values(room.votes).forEach(targetId => {
        if (targetId === 'skip') {
            skipVotes++;
        } else {
            voteCounts[targetId] = (voteCounts[targetId] || 0) + 1;
        }
    });

    const sortedVotes = Object.entries(voteCounts).sort((a, b) => b[1] - a[1]);
    const topVote = sortedVotes[0];

    let eliminatedPlayer = null;

    if (topVote && topVote[1] > skipVotes && (sortedVotes.length === 1 || topVote[1] > sortedVotes[1]?.[1])) {
        eliminatedPlayer = room.players.find(p => p.id === topVote[0]);
        if (eliminatedPlayer) {
            eliminatedPlayer.alive = false;
            eliminatedPlayer.lynched = true; // Mark as lynched for Guardian Angel check
        }
    }

    io.to(room.code).emit('vote:result', {
        eliminated: eliminatedPlayer ? {
            id: eliminatedPlayer.id,
            name: eliminatedPlayer.name,
            role: eliminatedPlayer.role // Added role for sound triggers
        } : null,
        roleStats: getRoleStats(room),
        dayNumber: room.dayNumber
    });

    // Check win condition after vote
    const winResult = checkWinCondition(room);
    if (winResult) {
        resolveGameOver(room, winResult);
    } else {
        setTimeout(() => {
            startNightPhase(room);
        }, 3000);
    }
}

// Resolve game over and award XP
async function resolveGameOver(room, result) {
    room.phase = PHASES.GAME_OVER; // Fixed enum key
    room.currentTurnPlayerId = null;
    clearRoomTimer(room.code); // Stop any active timers

    console.log(`[GAME] Resolving Game Over for room ${room.code}. Winner: ${result.winner}`);

    // Award XP and update stats for each player
    const updates = room.players.map(async (player) => {
        // Find if they are logged in via socket.userId
        const socket = Array.from(io.sockets.sockets.values()).find(s => s.id === player.id);

        if (!socket || !socket.userId) return;

        const isWinner = (result.winningRole === 'town' && player.role !== ROLES.MAFIA) ||
            (result.winningRole === 'mafia' && player.role === ROLES.MAFIA);

        const xpEarned = isWinner ? 50 : 10;

        try {
            const newStats = await DB.updateGameStats(socket.userId, xpEarned, isWinner);
            console.log(`[XP] Updated stats for ${player.name}: +${xpEarned} XP (Total: ${newStats.newXp}, Lvl: ${newStats.newLevel})`);

            // Send private progression update
            io.to(player.id).emit('player:progression', {
                xpEarned,
                newXp: newStats.newXp,
                newLevel: newStats.newLevel,
                isWinner
            });
        } catch (err) {
            console.error(`Failed to update stats for user ${socket.userId}:`, err);
        }
    });

    await Promise.all(updates);

    io.to(room.code).emit('game:over', {
        winner: result.winner,
        message: result.message,
        players: room.players.map(p => ({
            id: p.id,
            name: p.name,
            role: p.role,
            alive: p.alive
        }))
    });
}

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🎭 Mafia Game Server running on http://localhost:${PORT}`);
});
