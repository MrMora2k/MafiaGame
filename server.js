const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Game state storage
const rooms = new Map();

// Role types
const ROLES = {
    MAFIA: 'mafia',
    DOCTOR: 'doctor',
    DETECTIVE: 'detective',
    CITIZEN: 'citizen'
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
    doctorSelfHeal: true
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

    // Add Doctors
    for (let i = 0; i < settings.doctorCount; i++) {
        if (roles.length < totalPlayers) roles.push(ROLES.DOCTOR);
    }

    // Add Detectives
    for (let i = 0; i < settings.detectiveCount; i++) {
        if (roles.length < totalPlayers) roles.push(ROLES.DETECTIVE);
    }

    // Fill rest with Citizens
    while (roles.length < totalPlayers) {
        roles.push(ROLES.CITIZEN);
    }

    // Shuffle and assign
    const shuffledRoles = shuffleArray(roles);
    players.forEach((player, index) => {
        player.role = shuffledRoles[index];
    });

    return players;
}

// Check win conditions
function checkWinCondition(room) {
    const alivePlayers = room.players.filter(p => p.alive);
    const aliveMafia = alivePlayers.filter(p => p.role === ROLES.MAFIA);
    const aliveTown = alivePlayers.filter(p => p.role !== ROLES.MAFIA);

    if (aliveMafia.length === 0) {
        return { winner: 'town', message: 'The Town wins! All Mafia have been eliminated.' };
    }

    if (aliveMafia.length >= aliveTown.length) {
        return { winner: 'mafia', message: 'The Mafia wins! They have taken over the town.' };
    }

    return null;
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

// Socket.io connection handling
io.on('connection', (socket) => {
    console.log(`Player connected: ${socket.id}`);

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

        // Assign roles with settings
        room.players = assignRoles(room.players, room.settings);
        room.phase = PHASES.ROLE_REVEAL;

        // Send role to each player
        room.players.forEach(player => {
            io.to(player.id).emit('role:assigned', {
                role: player.role,
                phase: room.phase
            });
        });

        io.to(socket.roomCode).emit('game:started', {
            players: room.players.map(p => ({ id: p.id, name: p.name, alive: p.alive })),
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

        const player = room.players.find(p => p.id === socket.id);
        if (!player || !player.alive) return;

        // Doctor self-heal check
        if (player.role === ROLES.DOCTOR && targetId === socket.id && !room.settings.doctorSelfHeal) {
            socket.emit('room:error', 'You cannot heal yourself');
            return;
        }

        room.nightActions[player.role] = room.nightActions[player.role] || [];

        // Remove previous action from same player
        room.nightActions[player.role] = room.nightActions[player.role].filter(a => a.actor !== socket.id);

        room.nightActions[player.role].push({
            actor: socket.id,
            target: targetId
        });

        socket.emit('night:actionConfirmed', { targetId });

        checkNightComplete(room);
    });

    // Day vote
    socket.on('day:vote', ({ targetId }) => {
        const room = rooms.get(socket.roomCode);
        if (!room || room.phase !== PHASES.DAY) return;

        const player = room.players.find(p => p.id === socket.id);
        if (!player || !player.alive) return;

        room.votes[socket.id] = targetId;

        io.to(socket.roomCode).emit('vote:update', {
            votes: room.votes,
            voteCount: Object.keys(room.votes).length,
            requiredVotes: room.players.filter(p => p.alive).length
        });

        const alivePlayers = room.players.filter(p => p.alive);
        if (Object.keys(room.votes).length >= alivePlayers.length) {
            resolveDayVoting(room);
        }
    });

    // Skip vote
    socket.on('day:skipVote', () => {
        const room = rooms.get(socket.roomCode);
        if (!room || room.phase !== PHASES.DAY) return;

        const player = room.players.find(p => p.id === socket.id);
        if (!player || !player.alive) return;

        room.votes[socket.id] = 'skip';

        io.to(socket.roomCode).emit('vote:update', {
            votes: room.votes,
            voteCount: Object.keys(room.votes).length,
            requiredVotes: room.players.filter(p => p.alive).length
        });

        const alivePlayers = room.players.filter(p => p.alive);
        if (Object.keys(room.votes).length >= alivePlayers.length) {
            resolveDayVoting(room);
        }
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

// Start night phase
function startNightPhase(room) {
    room.phase = PHASES.NIGHT;
    room.dayNumber++;
    room.nightActions = {};
    room.players.forEach(p => p.ready = false);

    io.to(room.code).emit('phase:night', {
        dayNumber: room.dayNumber,
        players: room.players.map(p => ({ id: p.id, name: p.name, alive: p.alive })),
        settings: room.settings
    });
}

// Check if all night actions are complete
function checkNightComplete(room) {
    const alivePlayers = room.players.filter(p => p.alive);
    const aliveMafia = alivePlayers.filter(p => p.role === ROLES.MAFIA);
    const aliveDoctors = alivePlayers.filter(p => p.role === ROLES.DOCTOR);
    const aliveDetectives = alivePlayers.filter(p => p.role === ROLES.DETECTIVE);

    const mafiaActed = room.nightActions[ROLES.MAFIA]?.length >= aliveMafia.length;
    const doctorsActed = aliveDoctors.length === 0 || room.nightActions[ROLES.DOCTOR]?.length >= aliveDoctors.length;
    const detectivesActed = aliveDetectives.length === 0 || room.nightActions[ROLES.DETECTIVE]?.length >= aliveDetectives.length;

    if (mafiaActed && doctorsActed && detectivesActed) {
        resolveNight(room);
    }
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

    // Send night results
    io.to(room.code).emit('night:result', {
        killed: killedPlayer ? { id: killedPlayer.id, name: killedPlayer.name } : null,
        saved: savedPlayer ? true : false
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
        endGame(room, winResult);
        return;
    }

    startDayPhase(room);
}

// Start day phase
function startDayPhase(room) {
    room.phase = PHASES.DAY;
    room.votes = {};

    io.to(room.code).emit('phase:day', {
        dayNumber: room.dayNumber,
        players: room.players.map(p => ({ id: p.id, name: p.name, alive: p.alive }))
    });
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
        }
    }

    io.to(room.code).emit('vote:result', {
        eliminated: eliminatedPlayer ? {
            id: eliminatedPlayer.id,
            name: eliminatedPlayer.name,
            role: eliminatedPlayer.role
        } : null,
        voteCounts,
        skipVotes
    });

    const winResult = checkWinCondition(room);
    if (winResult) {
        endGame(room, winResult);
        return;
    }

    setTimeout(() => {
        startNightPhase(room);
    }, 3000);
}

// End game
function endGame(room, result) {
    room.phase = PHASES.GAME_OVER;

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
