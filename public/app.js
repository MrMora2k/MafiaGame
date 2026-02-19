// ==================== SERVICE WORKER (TEMPORARILY DISABLED) ====================
/*
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then(reg => console.log('✅ Service Worker registered'))
            .catch(err => console.log('❌ Service Worker registration failed:', err));
    });
}
*/
console.log('--- Mafia App Script Execution Started --- VERSION 2.0 ---');

// ==================== SOCKET & STATE ====================
let socket;

const state = {
    roomCode: null,
    playerId: null,
    username: null,
    role: null,
    phase: 'lobby',
    players: [],
    dayNumber: 0,
    hasActed: false,
    selectedTarget: null,
    settings: {},
    token: localStorage.getItem('mafia_token') || null,
    user: null,
    authMode: 'login', // 'login' or 'register'
    isCheckingAuth: false // Guard for redundant calls
};

const ROLE_INFO = {
    mafia: { icon: '🔪', image: 'images/Mafia.png', name: 'مافيا', description: 'قم بإزالة سكان المدينة واحداً تلو الآخر. صوّت مع زملائك المافيا لقتل شخص كل ليلة.' },
    doctor: { icon: '💉', image: 'images/doctor.png', name: 'طبيب', description: 'يمكنك إنقاذ شخص واحد كل ليلة من هجوم المافيا. اختر بحكمة!' },
    detective: { icon: '🔍', image: 'images/detective.png', name: 'محقق', description: 'حقق مع لاعب واحد كل ليلة لاكتشاف ما إذا كان مافيا أم لا.' },
    citizen: { icon: '👤', image: 'images/Citizen.png', name: 'مواطن', description: 'اعمل مع المدينة لتحديد وإزالة المافيا من خلال النقاش والتصويت.' },
    guardian_angel: { icon: '👼', image: 'images/Angel.png', name: 'الملاك الحارس', description: 'لديك القدرة على إعادة أحد الموتى إلى الحياة! يمكنك استخدام هذه القدرة مرة واحدة فقط كل لعبة.' },
    joker: { icon: '🃏', image: 'images/Joker.png', name: 'الجوكر', description: 'يمكنك انتحال شخصية أحد الموتى وأخذ دوره! تتاح هذه القدرة بعد موت شخصين أو أكثر، ولمرة واحدة فقط.' }
};

// ==================== AUDIO MANAGER ====================
const AudioManager = {
    sounds: {
        save: new Audio('sound/1.wav'),      // Sound 1: Saved by Doctor
        innocent: new Audio('sound/2.wav'),  // Sound 2: Innocent voted out
        mafia: new Audio('sound/3.wav')      // Sound 3: Mafia voted out
    },
    play(soundName) {
        const audio = this.sounds[soundName];
        if (audio) {
            audio.currentTime = 0;
            audio.play().catch(err => console.warn('[AUDIO] Playback failed:', err));
        }
    }
};

// ==================== LOCALSTORAGE ====================
function savePlayerName(name) {
    localStorage.setItem('mafia_player_name', name);
}

function loadPlayerName() {
    return localStorage.getItem('mafia_player_name') || '';
}

// ==================== DOM ELEMENTS ====================
const elements = {
    // Screens
    authScreen: document.getElementById('auth-screen'),
    lobbyScreen: document.getElementById('lobby-screen'),
    waitingScreen: document.getElementById('waiting-screen'),
    roleScreen: document.getElementById('role-screen'),
    gameScreen: document.getElementById('game-screen'),
    gameoverScreen: document.getElementById('gameover-screen'),
    profileScreen: document.getElementById('profile-screen'),
    progressionSummary: document.getElementById('progression-summary'),
    createName: document.getElementById('create-name'),
    joinName: document.getElementById('join-name'),
    roomCodeInput: document.getElementById('room-code'),
    createBtn: document.getElementById('create-btn'),
    joinBtn: document.getElementById('join-btn'),
    lobbyError: document.getElementById('lobby-error'),
    displayRoomCode: document.getElementById('display-room-code'),
    playerCount: document.getElementById('player-count'),
    maxPlayers: document.getElementById('max-players'),
    playerList: document.getElementById('player-list'),
    startGameBtn: document.getElementById('start-game-btn'),
    leaveRoomBtn: document.getElementById('leave-room-btn'),
    settingsPanel: document.getElementById('settings-panel'),
    settingMaxPlayers: document.getElementById('setting-max-players'),
    settingMafia: document.getElementById('setting-mafia'),
    settingDoctors: document.getElementById('setting-doctors'),
    settingDetectives: document.getElementById('setting-detectives'),
    settingDayTimer: document.getElementById('setting-day-timer'),
    settingNightTimer: document.getElementById('setting-night-timer'),
    settingGameMode: document.getElementById('setting-game-mode'),
    settingSelfHeal: document.getElementById('setting-self-heal'),
    roomsList: document.getElementById('rooms-list'),
    refreshRoomsBtn: document.getElementById('refresh-rooms-btn'),
    roleCard: document.getElementById('role-card'),
    roleIcon: document.getElementById('role-icon'),
    roleName: document.getElementById('role-name'),
    roleDescription: document.getElementById('role-description'),
    readyStatus: document.getElementById('ready-status'),
    readyBtn: document.getElementById('ready-btn'),
    phaseBanner: document.getElementById('phase-banner'),
    seatsContainer: document.getElementById('seats-container'),
    actionPanel: document.getElementById('action-panel'),
    actionTitle: document.getElementById('action-title'),
    actionHint: document.getElementById('action-hint'),
    skipActionBtn: document.getElementById('skip-action-btn'),
    nightModal: document.getElementById('night-modal'),
    nightResultTitle: document.getElementById('night-result-title'),
    nightResultText: document.getElementById('night-result-text'),
    nightContinueBtn: document.getElementById('night-continue-btn'),
    detectiveModal: document.getElementById('detective-modal'),
    investigationTarget: document.getElementById('investigation-target'),
    investigationResult: document.getElementById('investigation-result'),
    detectiveContinueBtn: document.getElementById('detective-continue-btn'),
    voteModal: document.getElementById('vote-modal'),
    voteResultTitle: document.getElementById('vote-result-title'),
    voteResultText: document.getElementById('vote-result-text'),
    voteBreakdown: document.getElementById('vote-breakdown'),
    voteContinueBtn: document.getElementById('vote-continue-btn'),
    winnerBanner: document.getElementById('winner-banner'),
    winnerText: document.getElementById('winner-text'),
    winnerMessage: document.getElementById('winner-message'),
    finalPlayerList: document.getElementById('final-player-list'),
    playAgainBtn: document.getElementById('play-again-btn'),
    leaveGameBtn: document.getElementById('leave-game-btn'),
    copyCodeBtn: document.getElementById('copy-code-btn'),
    phaseTransition: document.getElementById('phase-transition'),
    phaseTransitionIcon: document.getElementById('phase-transition-icon'),
    phaseTransitionText: document.getElementById('phase-transition-text'),
    spectatorBanner: document.getElementById('spectator-banner'),
    eventLogToggle: document.getElementById('event-log-toggle'),
    eventLog: document.getElementById('event-log'),
    eventLogContent: document.getElementById('event-log-content'),
    closeEventLog: document.getElementById('close-event-log'),
    nightRoundSummary: document.getElementById('night-round-summary'),
    voteRoundSummary: document.getElementById('vote-round-summary'),

    // Timer Settings
    settingNightTimer: document.getElementById('setting-night-timer'),
    settingDayTimer: document.getElementById('setting-day-timer'),
    phaseTimer: document.getElementById('phase-timer'),

    // Auth & Profile
    authForm: document.getElementById('auth-form'),
    authUsername: document.getElementById('auth-username'),
    authPassword: document.getElementById('auth-password'),
    authSubmitBtn: document.getElementById('auth-submit-btn'),
    authError: document.getElementById('auth-error'),
    tabLogin: document.getElementById('tab-login'),
    tabRegister: document.getElementById('tab-register'),
    profileBtn: document.getElementById('profile-btn'),
    headerUsername: document.getElementById('header-username'),
    profileModal: document.getElementById('profile-modal'),
    profileUsername: document.getElementById('profile-username'),
    profileLevel: document.getElementById('profile-level'),
    xpText: document.getElementById('xp-text'),
    xpBarFill: document.getElementById('xp-bar-fill'),
    statsGames: document.getElementById('stats-games'),
    statsWins: document.getElementById('stats-wins'),
    statsRatio: document.getElementById('stats-ratio'),
    closeProfileBtn: document.getElementById('close-profile-btn'),
    logoutBtn: document.getElementById('logout-btn'),
    headerLogoutBtn: document.getElementById('header-logout-btn')
};

// ==================== ERROR HANDLING & UTILS ====================
window.onerror = function (msg, url, lineNo, columnNo, error) {
    const string = msg.toLowerCase();
    const substring = "script error";
    if (string.indexOf(substring) > -1) {
        alert('Script Error: See Console for details');
    } else {
        const message = [
            'Message: ' + msg,
            'URL: ' + url,
            'Line: ' + lineNo,
            'Column: ' + columnNo,
            'Error object: ' + JSON.stringify(error)
        ].join(' - ');

        console.error(message);
    }
    return false;
    return false;
};

// Helper to safely add events
function safeAddEvent(element, event, callback) {
    if (element) {
        element.addEventListener(event, callback);
    } else {
        // Optional: console.warn(`[INIT] Could not add ${event} listener: Element not found.`);
    }
}


// ==================== AUTH LOGIC ====================
function setupAuthListeners() {
    console.log('[INIT] Setting up Auth Listeners...');

    // Tab Switching
    if (elements.tabLogin && elements.tabRegister) {
        elements.tabLogin.addEventListener('click', () => switchAuthMode('login'));
        elements.tabRegister.addEventListener('click', () => switchAuthMode('register'));
    }

    // Form Submission
    if (elements.authForm) {
        elements.authForm.addEventListener('submit', handleAuthSubmit);
    }
}

function switchAuthMode(mode) {
    state.authMode = mode;
    console.log(`[AUTH] Switched to ${mode} mode`);

    // Update Tabs
    elements.tabLogin.classList.toggle('active', mode === 'login');
    elements.tabRegister.classList.toggle('active', mode === 'register');

    // Update Button Text
    elements.authSubmitBtn.textContent = mode === 'login' ? 'دخول' : 'تسجيل جديد';

    // Clear Errors
    elements.authError.classList.add('hidden');
}

async function handleAuthSubmit(e) {
    e.preventDefault();
    console.log('[AUTH] Form Submitted');

    const username = elements.authUsername.value.trim();
    const password = elements.authPassword.value.trim();

    if (!username || !password) {
        showAuthError('الرجاء إدخال اسم المستخدم وكلمة المرور');
        return;
    }

    setAuthLoading(true);

    try {
        const endpoint = state.authMode === 'login' ? '/api/login' : '/api/register';
        console.log(`[AUTH] Sending request to ${endpoint}...`);

        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        const data = await res.json();

        if (data.success) {
            console.log('[AUTH] Success!');
            state.token = data.token;
            localStorage.setItem('mafia_token', data.token);
            checkAuth('login-success');
        } else {
            showAuthError(data.error || 'فشلت العملية');
        }
    } catch (err) {
        console.error('[AUTH] Request Failed:', err);
        showAuthError('تعذر الاتصال بالخادم. تأكد من تشغيله.');
    } finally {
        setAuthLoading(false);
    }
}

function showAuthError(msg) {
    elements.authError.textContent = msg;
    elements.authError.classList.remove('hidden');
}

function setAuthLoading(isLoading) {
    elements.authSubmitBtn.disabled = isLoading;
    elements.authSubmitBtn.textContent = isLoading ? 'جاري التحميل...' : (state.authMode === 'login' ? 'دخول' : 'تسجيل جديد');
}

async function checkAuth(source = 'unknown') {
    if (state.isCheckingAuth) {
        console.warn(`[AUTH] checkAuth ignored (already in progress). Source: ${source}`);
        return;
    }

    try {
        state.isCheckingAuth = true;
        console.log(`[AUTH] Checking authentication... Source: ${source}`);

        if (!state.token) {
            console.warn('[AUTH] No token found, skipping checkAuth');
            showScreen('auth');
            state.isCheckingAuth = false;
            return;
        }

        const res = await fetch('/api/me', {
            headers: { 'Authorization': `Bearer ${state.token}` }
        });

        if (!res.ok) throw new Error(`API Error: ${res.status}`);

        const data = await res.json();

        if (data.success && data.user) {
            console.log('[AUTH] Auth success:', data.user.username);
            state.user = data.user;
            state.username = data.user.username;
            state.playerId = data.user.id || data.user.user_id;
            updateProfileUI();
            showScreen('lobby');
            connectSocket();
        } else {
            console.warn('[AUTH] Auth failed or user data missing:', data);
            logout();
        }
    } catch (err) {
        console.error('[AUTH] Auth check crashed:', err);
        logout();
    } finally {
        state.isCheckingAuth = false;
    }
}

function connectSocket() {
    socket = io({
        auth: { token: state.token }
    });
    setupSocketEvents();
}

function updateProfileUI() {
    console.log('[PROFILE] updateProfileUI called. state.user:', state.user, 'state.username:', state.username);

    const username = state.username || (state.user && state.user.username) || '';

    // Direct DOM lookups instead of elements cache
    const elHeaderUsername = document.getElementById('header-username');
    const elProfileUsername = document.getElementById('profile-username');
    const elProfileLevel = document.getElementById('profile-level');
    const elXpText = document.getElementById('xp-text');
    const elXpBarFill = document.getElementById('xp-bar-fill');
    const elStatsGames = document.getElementById('stats-games');
    const elStatsWins = document.getElementById('stats-wins');
    const elStatsRatio = document.getElementById('stats-ratio');

    console.log('[PROFILE] DOM elements found:', {
        headerUsername: !!elHeaderUsername,
        profileUsername: !!elProfileUsername,
        profileLevel: !!elProfileLevel
    });

    if (username) {
        console.log('[PROFILE] === USERNAME UPDATE ===');
        console.log('[PROFILE] username value:', JSON.stringify(username));
        console.log('[PROFILE] elProfileUsername:', elProfileUsername);
        console.log('[PROFILE] elProfileUsername tag:', elProfileUsername?.tagName, 'id:', elProfileUsername?.id);
        console.log('[PROFILE] BEFORE textContent:', JSON.stringify(elProfileUsername?.textContent));
        if (elHeaderUsername) elHeaderUsername.textContent = username;
        if (elProfileUsername) {
            elProfileUsername.textContent = username;
            console.log('[PROFILE] AFTER textContent:', JSON.stringify(elProfileUsername.textContent));
            console.log('[PROFILE] AFTER innerHTML:', elProfileUsername.innerHTML);
            console.log('[PROFILE] Element outerHTML:', elProfileUsername.outerHTML);
        }
    }

    if (!state.user) {
        if (state.token) {
            fetch('/api/me', {
                headers: { 'Authorization': `Bearer ${state.token}` }
            }).then(r => r.json()).then(data => {
                if (data.success && data.user) {
                    state.user = data.user;
                    state.username = data.user.username;
                    updateProfileUI();
                }
            }).catch(err => console.error('[PROFILE] Failed to fetch user:', err));
        }
        return;
    }

    const level = state.user.level || 1;
    if (elProfileLevel) elProfileLevel.textContent = `Lv ${level}`;

    const xp = state.user.total_xp || 0;
    const currentLevelXP = Math.pow((level - 1), 2) * 100;
    const nextLevelXP = Math.pow(level, 2) * 100;
    const progress = nextLevelXP > currentLevelXP
        ? ((xp - currentLevelXP) / (nextLevelXP - currentLevelXP)) * 100
        : 100;

    if (elXpText) elXpText.textContent = `${xp} / ${nextLevelXP} XP`;
    if (elXpBarFill) elXpBarFill.style.width = `${Math.min(100, Math.max(0, progress))}%`;

    if (elStatsGames) elStatsGames.textContent = state.user.games_played || 0;
    if (elStatsWins) elStatsWins.textContent = state.user.wins || 0;
    const ratio = state.user.games_played > 0 ? Math.round((state.user.wins / state.user.games_played) * 100) : 0;
    if (elStatsRatio) elStatsRatio.textContent = `${ratio}%`;
}

function logout() {
    localStorage.removeItem('mafia_token');
    state.token = null;
    state.user = null;
    if (socket) socket.disconnect();
    showScreen('auth');
}

// ==================== INITIALIZE ====================
function init() {
    console.log('[INIT] App Initializing...');
    setupAuthListeners();

    if (state.token) {
        checkAuth('init');
    } else {
        showScreen('auth');
    }
}

safeAddEvent(elements.profileBtn, 'click', () => {
    if (elements.profileModal) elements.profileModal.classList.remove('hidden');
});

safeAddEvent(elements.closeProfileBtn, 'click', () => {
    if (elements.profileModal) elements.profileModal.classList.add('hidden');
});

safeAddEvent(elements.logoutBtn, 'click', logout);
safeAddEvent(elements.headerLogoutBtn, 'click', logout);

// ==================== EVENT LOG ====================
const eventHistory = [];

function addEvent(type, text, dayNumber) {
    eventHistory.push({ type, text, dayNumber });
    const entry = document.createElement('div');
    entry.className = `event-entry ${type}`;
    entry.innerHTML = `
        <div class="event-entry-header">الجولة ${dayNumber} — ${type === 'night' ? '🌙 ليل' : type === 'day' ? '☀️ نهار' : type === 'death' ? '💀 وفاة' : '✅ نجاة'}</div>
        <div class="event-entry-text">${text}</div>
    `;
    if (elements.eventLogContent) elements.eventLogContent.prepend(entry);
}

// Event log toggle
safeAddEvent(elements.eventLogToggle, 'click', () => {
    if (elements.eventLog) elements.eventLog.classList.toggle('hidden');
});

safeAddEvent(elements.closeEventLog, 'click', () => {
    if (elements.eventLog) elements.eventLog.classList.add('hidden');
});

// ==================== PHASE TRANSITION ====================
function showPhaseTransition(phase, dayNumber, callback) {
    const overlay = elements.phaseTransition;
    overlay.className = `phase-transition ${phase === 'night' ? 'night-transition' : 'day-transition'}`;
    elements.phaseTransitionIcon.textContent = phase === 'night' ? '🌙' : '☀️';
    elements.phaseTransitionText.textContent = phase === 'night' ? `الليلة ${dayNumber}` : `اليوم ${dayNumber}`;

    // Show overlay
    overlay.classList.remove('hidden');

    // After animation plays, fade out and run callback
    setTimeout(() => {
        overlay.classList.add('fade-out');
        setTimeout(() => {
            overlay.classList.add('hidden');
            overlay.classList.remove('fade-out');
            if (callback) callback();
        }, 600);
    }, 1800);
}

// ==================== ROUND SUMMARY ====================
function renderRoundSummary(container, roleStats) {
    const aliveListHtml = roleStats.alivePlayers.map(p => `
        <div class="alive-player-tag">
            <span class="player-num">#${p.playerNumber}</span>
            <span class="player-name">${p.name}</span>
        </div>
    `).join('');

    container.innerHTML = `
        <div class="round-summary-title">اللاعبون المتبقون (${roleStats.total})</div>
        <div class="alive-players-grid">
            ${aliveListHtml}
        </div>
    `;
}

// ==================== SPECTATOR MODE ====================
function updateSpectatorUI() {
    const myPlayer = state.players.find(p => p.id === state.playerId);
    if (myPlayer && !myPlayer.alive) {
        elements.actionPanel.classList.add('hidden');
        elements.spectatorBanner.classList.remove('hidden');
    } else {
        elements.actionPanel.classList.remove('hidden');
        elements.spectatorBanner.classList.add('hidden');
    }
}

// ==================== SCREEN NAVIGATION ====================
function showScreen(screenName) {
    console.log(`[NAV] Navigating to: ${screenName}`);
    const screenMap = {
        auth: elements.authScreen,
        lobby: elements.lobbyScreen,
        waiting: elements.waitingScreen,
        role: elements.roleScreen,
        game: elements.gameScreen,
        gameover: elements.gameoverScreen,
        profile: elements.profileScreen
    };

    // Deactivate all screens
    Object.entries(screenMap).forEach(([name, element]) => {
        if (element) {
            element.classList.remove('active');
        } else {
            console.error(`[NAV] Element for screen '${name}' is missing!`);
        }
    });

    // Activate target screen
    const target = screenMap[screenName];
    if (target) {
        target.classList.add('active');
        console.log(`[NAV] Switched to: ${screenName}`);
        // Update profile UI when navigating to profile
        if (screenName === 'profile') updateProfileUI();
    } else {
        console.error(`[NAV] Screen not found in map: ${screenName}`);
    }
}

function showError(message) {
    elements.lobbyError.textContent = message;
    elements.lobbyError.classList.remove('hidden');
    setTimeout(() => elements.lobbyError.classList.add('hidden'), 4000);
}

// ==================== SOCKET EVENTS SETUP ====================
function setupSocketEvents() {
    // Progression update
    socket.on('player:progression', (data) => {
        handleProgression(data);
    });

    socket.on('connect', () => {
        console.log('Connected to server');
    });

    socket.on('disconnect', () => {
        console.log('Disconnected from server');
    });

    socket.on('error', (message) => showError(message));

    // Progression update
    socket.on('player:progression', (data) => {
        handleProgression(data);
    });

    // ==================== SOCKET EVENTS - LOBBY ====================
    socket.on('room:created', ({ roomCode, players, settings }) => {
        state.roomCode = roomCode;
        state.isHost = true;
        state.playerId = socket.id;
        state.players = players;
        elements.displayRoomCode.textContent = roomCode;
        elements.startGameBtn.classList.remove('hidden');
        elements.settingsPanel.classList.remove('hidden');
        applySettings(settings);
        updatePlayerList(players);
        showScreen('waiting');
    });

    socket.on('room:joined', ({ roomCode, players, settings }) => {
        state.roomCode = roomCode;
        state.playerId = socket.id;
        state.players = players;
        elements.displayRoomCode.textContent = roomCode;
        applySettings(settings);
        updatePlayerList(players);
        showScreen('waiting');
    });

    socket.on('room:error', (message) => {
        showError(message);
    });

    socket.on('room:left', () => {
        state.roomCode = null;
        state.isHost = false;
        state.players = [];
        document.body.classList.remove('theme-day'); // Reset to night theme
        showScreen('lobby');
    });

    socket.on('player:list', (players) => {
        state.players = players;
        updatePlayerList(players);
    });

    // Timer logic
    socket.on('timer:sync', ({ duration, phase }) => {
        console.log(`[TIMER] Received sync: ${duration}s for ${phase}`);
        startLocalTimer(duration, phase);
    });

    socket.on('phase:night', () => {
        if (localTimerInterval) clearInterval(localTimerInterval);
    });

    socket.on('phase:day', () => {
        if (localTimerInterval) clearInterval(localTimerInterval);
    });

    socket.on('game:over', (data) => {
        if (localTimerInterval) clearInterval(localTimerInterval);
        elements.phaseTimer.classList.add('hidden');
    });

    socket.on('host:assigned', () => {
        state.isHost = true;
        elements.startGameBtn.classList.remove('hidden');
        elements.settingsPanel.classList.remove('hidden');
    });

    socket.on('settings:updated', (settings) => {
        applySettings(settings);
    });

    // ==================== SOCKET EVENTS - ROLE REVEAL ====================
    socket.on('role:assigned', ({ role, teammates }) => {
        state.role = role;
        state.teammates = teammates || [];
        const info = ROLE_INFO[role];
        elements.roleIcon.innerHTML = `<img src="${info.image}" alt="${info.name}" style="width: 80px; height: 80px; object-fit: contain;">`;
        elements.roleName.textContent = info.name;

        // If mafia with teammates, show them in description
        if (role === 'mafia' && teammates && teammates.length > 0) {
            const teammateNames = teammates.map(t => `${t.name} (#${t.playerNumber})`).join('، ');
            elements.roleDescription.innerHTML = `${info.description}<br><br><strong>🔪 زملاؤك المافيا:</strong> ${teammateNames}`;
        } else {
            elements.roleDescription.textContent = info.description;
        }

        document.querySelector('.card-back').className = `card-face card-back role-${role}`;
        elements.roleCard.classList.remove('flipped');
        elements.readyBtn.disabled = true;
        elements.readyBtn.textContent = "أنا جاهز";
    });

    socket.on('game:started', ({ players }) => {
        state.players = players;
        state.phase = 'roleReveal';
        showScreen('role');
    });

    socket.on('game:reset', ({ players, settings }) => {
        state.players = players;
        state.phase = 'lobby';
        state.role = null;
        document.body.classList.remove('theme-day'); // Reset to night theme
        applySettings(settings);
        updatePlayerList(players);
        showScreen('waiting');
    });

    socket.on('player:readyUpdate', ({ readyCount, totalCount }) => {
        elements.readyStatus.textContent = `${readyCount}/${totalCount} لاعب جاهز`;
    });

    // ==================== SOCKET EVENTS - NIGHT PHASE ====================
    socket.on('phase:night', ({ dayNumber, players, settings, currentTurn }) => {
        state.players = players;
        state.phase = 'night';
        state.dayNumber = dayNumber;
        state.hasActed = false;
        state.selectedTarget = null;
        state.currentTurn = currentTurn;
        if (settings) state.settings = settings;

        showPhaseTransition('night', dayNumber, () => {
            document.body.classList.remove('theme-day');
            elements.phaseBanner.innerHTML = `<span class="phase-icon">🌙</span><span class="phase-text">الليلة ${dayNumber}</span>`;
            if (state.currentTurn) {
                elements.phaseBanner.innerHTML += ` <span class="turn-indicator">| دور: ${state.currentTurn.name}</span>`;
            }

            updateActionPanel();
            updateSpectatorUI();
            renderSeats();
            showScreen('game');
        });
    });

    socket.on('turn:change', ({ playerId, playerNumber, name }) => {
        state.currentTurn = playerId ? { playerId, playerNumber, name } : null;
        state.hasActed = false; // Reset action state for new turn

        // Update banner
        const turnSpan = elements.phaseBanner.querySelector('.turn-indicator');
        if (playerId && name) {
            if (turnSpan) {
                turnSpan.textContent = `| دور: ${name}`;
            } else {
                elements.phaseBanner.innerHTML += ` <span class="turn-indicator">| دور: ${name}</span>`;
            }
        } else if (turnSpan) {
            turnSpan.remove(); // Remove indicator if turn is null
        }

        updateActionPanel();
        renderSeats();
    });

    socket.on('night:actionConfirmed', () => {
        // Action confirmed by server
    });

    socket.on('detective:result', ({ targetName, isMafia }) => {
        elements.investigationTarget.textContent = targetName;

        const resultDiv = elements.investigationResult;
        resultDiv.className = `investigation-result ${isMafia ? 'mafia' : 'innocent'}`;
        resultDiv.innerHTML = isMafia
            ? '<span class="result-icon">🔪</span><span class="result-text">مافيا!</span>'
            : '<span class="result-icon">👤</span><span class="result-text">بريء</span>';

        elements.detectiveModal.classList.remove('hidden');
    });

    socket.on('night:result', ({ killed, revived, saved, roleStats, dayNumber }) => {
        if (killed) {
            elements.nightResultTitle.textContent = 'مأساة عند الفجر';
            elements.nightResultText.textContent = `${killed.name} وُجد ميتاً هذا الصباح. المافيا ضربت.`;
            addEvent('death', `💀 ${killed.name} قُتل على يد المافيا`, dayNumber);
        } else if (revived) {
            elements.nightResultTitle.textContent = 'عودة من الموت! ✨';
            elements.nightResultText.textContent = `الملاك الحارس تدخل! ${revived.name} عاد إلى الحياة.`;
            addEvent('safe', `👼 الملاك الحارس أعاد ${revived.name} للحياة`, dayNumber);
        } else if (saved) {
            elements.nightResultTitle.textContent = 'معجزة!';
            elements.nightResultText.textContent = 'الطبيب أنقذ شخصاً من هجوم المافيا الليلة الماضية!';
            addEvent('safe', '💉 الطبيب أنقذ أحد اللاعبين من الموت', dayNumber);
            AudioManager.play('save'); // Sound 1
        } else {
            elements.nightResultTitle.textContent = 'ليلة هادئة';
            elements.nightResultText.textContent = 'استيقظت المدينة لتجد الجميع بخير.';
            addEvent('night', '🌙 ليلة هادئة — لم يُقتل أحد', dayNumber);
        }

        if (roleStats) {
            renderRoundSummary(elements.nightRoundSummary, roleStats);
        }

        elements.nightModal.classList.remove('hidden');
    });

    // ==================== SOCKET EVENTS - DAY PHASE ====================
    socket.on('phase:day', ({ dayNumber, players, currentTurn }) => {
        state.players = players;
        state.phase = 'day';
        state.dayNumber = dayNumber;
        state.hasActed = false;
        state.selectedTarget = null;
        state.currentTurn = currentTurn;

        showPhaseTransition('day', dayNumber, () => {
            document.body.classList.add('theme-day');
            elements.phaseBanner.innerHTML = `<span class="phase-icon">☀️</span><span class="phase-text">اليوم ${dayNumber}</span>`;
            if (state.currentTurn && state.currentTurn.name) {
                elements.phaseBanner.innerHTML += ` <span class="turn-indicator">| دور: ${state.currentTurn.name}</span>`;
            }

            updateActionPanel();
            updateSpectatorUI();
            renderSeats();
        });
    });

    socket.on('vote:update', ({ voteCount, requiredVotes }) => {
        // Secret voting: only show progress, not who voted for whom
        elements.actionHint.textContent = `${voteCount}/${requiredVotes} صوتوا`;
    });

    socket.on('vote:result', ({ eliminated, roleStats, dayNumber }) => {
        // No vote breakdown - results are secret
        elements.voteBreakdown.innerHTML = '';

        if (eliminated) {
            elements.voteResultTitle.textContent = '⚖️ قرار المدينة';
            elements.voteResultText.textContent = `تم إخراج ${eliminated.name} من اللعبة.`;
            addEvent('day', `⚖️ ${eliminated.name} أُخرج بالتصويت`, dayNumber);

            // Trigger sound based on role
            if (eliminated.role === 'mafia') {
                AudioManager.play('mafia');    // Sound 3
            } else {
                AudioManager.play('innocent'); // Sound 2
            }
        } else {
            elements.voteResultTitle.textContent = 'لم يتم الاتفاق';
            elements.voteResultText.textContent = 'لم يتمكن اللاعبون من الاتفاق على قرار موحد. لم يتم إخراج أحد.';
            addEvent('day', '🤷 لم يتفق اللاعبون — لم يُخرج أحد', dayNumber);
        }
        if (roleStats) renderRoundSummary(elements.voteRoundSummary, roleStats);
        elements.voteModal.classList.remove('hidden');
    });

    // ==================== SOCKET EVENTS - GAME OVER ====================
    socket.on('game:over', ({ winner, message, players }) => {
        state.phase = 'gameover';
        document.body.classList.remove('theme-day');
        elements.winnerBanner.className = `winner-banner ${winner}`;
        elements.winnerText.textContent = winner === 'mafia' ? 'المافيا تفوز!' : 'المدينة تفوز!';
        elements.winnerMessage.textContent = message;
        if (state.isHost) {
            elements.playAgainBtn.classList.remove('hidden');
        } else {
            elements.playAgainBtn.classList.add('hidden');
        }
        elements.finalPlayerList.innerHTML = players.map(p => `
            <li class="${p.alive ? '' : 'dead'}">
                <span class="final-player-name">${p.alive ? '' : '💀'} ${p.name} ${p.id === state.playerId ? '(أنت)' : ''}</span>
                <span class="final-player-role ${p.role}">${ROLE_INFO[p.role].name}</span>
            </li>
        `).join('');
        showScreen('gameover');
    });

    socket.on('joker:roleUpdate', ({ newRole, revivedPlayer }) => {
        if (newRole) {
            state.role = newRole;
            // Update role card icon
            const icon = ROLE_INFO[newRole].icon;
            document.querySelector('.role-icon').textContent = icon;
            document.querySelector('.role-name').textContent = ROLE_INFO[newRole].name;
            document.querySelector('.role-description').textContent = ROLE_INFO[newRole].description;

            showError(`🃏 لقد تقمصت دور: ${ROLE_INFO[newRole].name}!`);
        }
    });
}


// ==================== LOBBY SETUP ====================
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const tab = btn.dataset.tab;
        document.getElementById('create-form').classList.toggle('hidden', tab !== 'create');
        document.getElementById('join-form').classList.toggle('hidden', tab !== 'join');
        document.getElementById('browse-form').classList.toggle('hidden', tab !== 'browse');

        // Auto-fetch rooms when browse tab is selected
        if (tab === 'browse') {
            fetchPublicRooms();
        }
    });
});

// Fetch and display public rooms
async function fetchPublicRooms() {
    try {
        const response = await fetch('/api/rooms');
        const rooms = await response.json();

        if (rooms.length === 0) {
            elements.roomsList.innerHTML = '<p class="no-rooms">لا توجد غرف عامة متاحة حالياً</p>';
        } else {
            elements.roomsList.innerHTML = rooms.map(room => `
                <div class="room-item" data-code="${room.code}">
                    <div class="room-item-info">
                        <span class="room-host">🎮 ${room.hostName}</span>
                        <span class="room-players">${room.playerCount}/${room.maxPlayers} لاعب</span>
                    </div>
                    <button class="btn btn-small btn-join-room" data-code="${room.code}">انضمام</button>
                </div>
            `).join('');

            // Add click handlers to join buttons
            document.querySelectorAll('.btn-join-room').forEach(btn => {
                btn.addEventListener('click', () => {
                    joinPublicRoom(btn.dataset.code);
                });
            });
        }
    } catch (error) {
        console.error('Failed to fetch rooms:', error);
        elements.roomsList.innerHTML = '<p class="no-rooms">فشل في تحميل الغرف</p>';
    }
}

function joinPublicRoom(code) {
    socket.emit('room:join', { roomCode: code, playerName: state.username });
}

elements.refreshRoomsBtn.addEventListener('click', fetchPublicRooms);

elements.createBtn.addEventListener('click', () => {
    socket.emit('room:create', { playerName: state.username, settings: {} });
});

elements.joinBtn.addEventListener('click', () => {
    const code = elements.roomCodeInput.value.trim().toUpperCase();
    if (!code || code.length !== 6) return showError('الرجاء إدخال كود غرفة صحيح من 6 أحرف');
    socket.emit('room:join', { roomCode: code, playerName: state.username });
});

elements.copyCodeBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(state.roomCode);
    elements.copyCodeBtn.textContent = 'تم النسخ!';
    setTimeout(() => elements.copyCodeBtn.textContent = 'نسخ الكود', 2000);
});

elements.startGameBtn.addEventListener('click', () => {
    socket.emit('game:start');
});

elements.leaveRoomBtn.addEventListener('click', () => {
    socket.emit('room:leave');
});

// Settings change handlers
function setupSettingsHandlers() {
    elements.settingMaxPlayers.addEventListener('change', updateSettings);
    elements.settingMafia.addEventListener('change', updateSettings);
    elements.settingDoctors.addEventListener('change', updateSettings);
    elements.settingDetectives.addEventListener('change', updateSettings);
    elements.settingSelfHeal.addEventListener('change', updateSettings);
    elements.settingPublic.addEventListener('change', updateSettings);
    elements.settingNightTimer.addEventListener('change', updateSettings);
    elements.settingDayTimer.addEventListener('change', updateSettings);
    elements.settingGameMode.addEventListener('change', updateSettings);
}

function updateSettings() {
    if (!state.isHost) return;
    const settings = {
        maxPlayers: parseInt(elements.settingMaxPlayers.value),
        mafiaCount: parseInt(elements.settingMafia.value),
        doctorCount: parseInt(elements.settingDoctors.value),
        detectiveCount: parseInt(elements.settingDetectives.value),
        doctorSelfHeal: elements.settingSelfHeal.checked,
        isPublic: elements.settingPublic.checked,
        nightTimer: parseInt(elements.settingNightTimer.value),
        dayTimer: parseInt(elements.settingDayTimer.value),
        gameMode: elements.settingGameMode.value
    };
    socket.emit('room:updateSettings', settings);
}

function applySettings(settings) {
    state.settings = settings;
    elements.maxPlayers.textContent = settings.maxPlayers;
    elements.settingMaxPlayers.value = settings.maxPlayers;
    elements.settingMafia.value = settings.mafiaCount;
    elements.settingDoctors.value = settings.doctorCount;
    elements.settingDetectives.value = settings.detectiveCount;
    elements.settingSelfHeal.checked = settings.doctorSelfHeal;
    elements.settingPublic.checked = settings.isPublic || false;
    elements.settingNightTimer.value = settings.nightTimer || 60;
    elements.settingDayTimer.value = settings.dayTimer || 120;
    elements.settingGameMode.value = settings.gameMode || 'classic';
}

setupSettingsHandlers();

function updatePlayerList(players) {
    elements.playerCount.textContent = players.length;
    elements.playerList.innerHTML = players.map((p, i) =>
        `<li${i === 0 ? ' class="host"' : ''}>${p.name}</li>`
    ).join('');

    if (state.isHost) {
        elements.startGameBtn.disabled = players.length < 4;
    }
}

elements.roleCard.addEventListener('click', () => {
    elements.roleCard.classList.toggle('flipped');
    if (elements.roleCard.classList.contains('flipped')) {
        elements.readyBtn.disabled = false;
    }
});

elements.readyBtn.addEventListener('click', () => {
    elements.readyBtn.disabled = true;
    elements.readyBtn.textContent = 'في الانتظار...';
    socket.emit('player:ready');
});

function updateActionPanel() {
    const role = state.role;
    const phase = state.phase;
    const isMyTurn = state.currentTurn && state.currentTurn.playerId === state.playerId;
    const isAlive = state.players.find(p => p.id === state.playerId)?.alive;

    // DEBUG: Check turn logic
    console.log('[DEBUG] Action Panel Update:', {
        myId: state.playerId,
        turnPlayer: state.currentTurn,
        isMyTurn: isMyTurn,
        phase: phase,
        role: role
    });

    elements.actionHint.style.color = '';

    if (!isAlive) {
        elements.actionTitle.textContent = '💀 أنت ميت';
        elements.actionHint.textContent = 'شاهد اللعبة واستمتع.';
        elements.skipActionBtn.style.display = 'none';
        return;
    }

    if (!isMyTurn) {
        const turnPlayerName = state.currentTurn ? state.currentTurn.name : 'انتظر...';
        const turnPlayerNum = state.currentTurn ? state.currentTurn.playerNumber : '?';
        const myPlayerNum = state.players.find(p => p.id === state.playerId)?.playerNumber;

        elements.actionTitle.textContent = `⏳ دور: ${turnPlayerName} (#${turnPlayerNum})`;
        elements.actionHint.textContent = `أنت اللاعب رقم (#${myPlayerNum}). بانتظار دورك...`;
        elements.skipActionBtn.style.display = 'none';
        return;
    }

    elements.actionTitle.textContent = '🟢 دورك الآن!';
    elements.skipActionBtn.style.display = 'none';

    if (phase === 'night') {
        if (role === 'mafia') {
            elements.actionTitle.textContent = '🔪 دورك: اختر ضحيتك';
            elements.actionHint.textContent = 'اختر لاعباً لإزالته';
        } else if (role === 'guardian_angel') {
            elements.actionTitle.textContent = '👼 الملاك الحارس: أعد الحياة';
            elements.actionHint.textContent = 'اختر لاعباً ميتاً (ليس مقتولاً بالتصويت) لإعادته.';
            elements.skipActionBtn.style.display = 'inline-block';
            elements.skipActionBtn.textContent = 'تخطي';
        } else if (role === 'joker') {
            const deadCount = state.players.filter(p => !p.alive).length;
            if (deadCount >= 2) {
                elements.actionTitle.textContent = '🃏 الجوكر: اختر دوراً';
                elements.actionHint.textContent = 'اختر لاعباً ميتاً لتأخذ دوره (لا تعرف الدور مسبقاً).';
            } else {
                elements.actionTitle.textContent = '🃏 الجوكر: انتظر';
                elements.actionHint.textContent = 'يجب أن يموت شخصان على الأقل لتفعيل قدرتك.';
            }
            elements.skipActionBtn.style.display = 'inline-block';
            elements.skipActionBtn.textContent = 'تخطي';
        } else {
            // Citizen
            elements.actionTitle.textContent = '💤 دورك: لا يوجد إجراء';
            elements.actionHint.textContent = 'اضغط تخطي لإنهاء دورك';
            elements.skipActionBtn.style.display = 'inline-block';
            elements.skipActionBtn.textContent = 'تخطي ⏭️';
        }
    } else if (phase === 'day') {
        elements.actionTitle.textContent = '⚖️ دورك: وقت التصويت';
        elements.actionHint.textContent = 'ناقش، صوّت، أو تخطى';
        elements.skipActionBtn.style.display = 'inline-block';
        elements.skipActionBtn.textContent = 'تخطي التصويت';
    }
}

function renderSeats() {
    const players = state.players;
    const count = players.length;

    elements.seatsContainer.innerHTML = players.map((player, index) => {
        const angle = (360 / count) * index - 90;
        const playerNum = player.playerNumber;
        const isSelf = player.id === state.playerId;
        const isDead = !player.alive;
        const isSelected = state.selectedTarget === player.id;
        const isTeammate = state.teammates && state.teammates.some(t => t.id === player.id);
        const isCurrentTurn = state.currentTurn && state.currentTurn.playerId === player.id;

        let classes = 'player-seat';
        if (isSelf) classes += ' self';
        if (isDead) classes += ' dead';
        if (isSelected) classes += ' selected';
        if (isTeammate) classes += ' teammate';
        if (isCurrentTurn) classes += ' current-turn';

        // Show role image for self, player number for others
        const avatarContent = isSelf
            ? `<img src="${ROLE_INFO[state.role].image}" alt="${state.role}" class="seat-avatar-img">`
            : playerNum;

        return `
            <div class="${classes}" data-player-id="${player.id}" style="--angle: ${angle}deg">
                <div class="seat-avatar">${avatarContent}</div>
                <span class="seat-name">${player.name}${isSelf ? ' (أنت)' : ''}</span>
                <span class="vote-count hidden">0</span>
            </div>
        `;
    }).join('');

    document.querySelectorAll('.player-seat').forEach(seat => {
        seat.addEventListener('click', () => handleSeatClick(seat));
    });
}

function handleSeatClick(seat) {
    const targetId = seat.dataset.playerId;
    const targetPlayer = state.players.find(p => p.id === targetId);
    if (!targetPlayer) return;

    // Guardian Angel & Joker can target dead players
    const isSpecialRole = state.role === 'guardian_angel' || state.role === 'joker';

    if (!targetPlayer.alive && !isSpecialRole) return;
    if (targetPlayer.alive && isSpecialRole && state.phase === 'night') {
        // Special roles MUST target dead players at night
        return showError('يجب اختيار لاعب ميت لتفعيل هذه القدرة');
    }

    if (state.hasActed) return;

    const myPlayer = state.players.find(p => p.id === state.playerId);
    if (!myPlayer || !myPlayer.alive) return;

    // Check if clicking on self
    if (targetId === state.playerId) {
        // Doctor can heal self if setting allows AND it is their turn
        if (state.phase === 'night' && state.role === 'doctor' && state.settings.doctorSelfHeal) {
            // Allow self-heal
            if (!state.currentTurn || state.currentTurn.playerId !== state.playerId) return;
        } else {
            return;
        }
    }

    // Turn Check
    if (state.currentTurn && state.currentTurn.playerId !== state.playerId) return;

    if (state.phase === 'night') {
        if (state.role === 'citizen') return;

        state.selectedTarget = targetId;
        state.hasActed = true;

        document.querySelectorAll('.player-seat').forEach(s => s.classList.remove('selected'));
        seat.classList.add('selected');

        socket.emit('night:action', { targetId });

        // Role-specific confirmation with target name
        if (state.role === 'mafia') {
            elements.actionTitle.textContent = `🔪 اخترت: ${targetPlayer.name}`;
        } else if (state.role === 'doctor') {
            elements.actionTitle.textContent = `💉 تحمي: ${targetPlayer.name}`;
        } else if (state.role === 'guardian_angel') {
            elements.actionTitle.textContent = `👼 دعوت: ${targetPlayer.name}`;
        } else if (state.role === 'joker') {
            elements.actionTitle.textContent = `🃏 اخترت تقمص: ${targetPlayer.name}`;
        }
        elements.actionHint.textContent = 'في انتظار اللاعبين الآخرين...';
    } else if (state.phase === 'day') {
        state.selectedTarget = targetId;
        state.hasActed = true;

        document.querySelectorAll('.player-seat').forEach(s => s.classList.remove('selected'));
        seat.classList.add('selected');

        socket.emit('day:vote', { targetId });

        elements.actionTitle.textContent = `✓ صوّت على: ${targetPlayer.name}`;
        elements.actionHint.textContent = 'في انتظار الأصوات الأخرى...';
        elements.skipActionBtn.style.display = 'none';
    }
}

// = [GAME ACTION EVENTS] =
safeAddEvent(elements.skipActionBtn, 'click', () => {
    if (state.hasActed) return;
    const isMyTurn = state.currentTurn && state.currentTurn.playerId === state.playerId;
    if (!isMyTurn) return;

    console.log(`[ACTION] Skipping turn in phase: ${state.phase}`);
    state.hasActed = true;
    elements.skipActionBtn.style.display = 'none';

    if (state.phase === 'night') {
        socket.emit('night:skip');
        elements.actionTitle.textContent = '💤 تخطيت الدور';
    } else if (state.phase === 'day') {
        socket.emit('day:skipVote');
        elements.actionTitle.textContent = '✓ تخطيت التصويت';
    }

    elements.actionHint.textContent = 'في انتظار اللاعبين الآخرين...';

    // Clear selections if any
    document.querySelectorAll('.player-seat').forEach(s => s.classList.remove('selected'));
});

// Modal Continue Listeners
safeAddEvent(elements.nightContinueBtn, 'click', () => {
    elements.nightModal.classList.add('hidden');
});

safeAddEvent(elements.detectiveContinueBtn, 'click', () => {
    elements.detectiveModal.classList.add('hidden');
});

safeAddEvent(elements.voteContinueBtn, 'click', () => {
    elements.voteModal.classList.add('hidden');
});

// = [GAME OVER EVENTS] =
safeAddEvent(elements.playAgainBtn, 'click', () => {
    socket.emit('game:playAgain');
});

safeAddEvent(elements.leaveGameBtn, 'click', () => {
    socket.emit('room:leave');
});

// = [LOBBY EVENTS] =
safeAddEvent(elements.createBtn, 'click', () => {
    socket.emit('room:create', { playerName: state.username });
});

safeAddEvent(elements.joinBtn, 'click', () => {
    const code = elements.roomCodeInput.value.trim().toUpperCase();
    if (!code || code.length !== 6) return showError('الرجاء إدخال كود غرفة صحيح من 6 أحرف');
    socket.emit('room:join', { roomCode: code, playerName: state.username });
});

safeAddEvent(elements.refreshRoomsBtn, 'click', () => {
    socket.emit('rooms:get');
});

safeAddEvent(elements.copyCodeBtn, 'click', () => {
    const code = elements.displayRoomCode.textContent;
    navigator.clipboard.writeText(code).then(() => {
        const originalText = elements.copyCodeBtn.innerHTML;
        elements.copyCodeBtn.innerHTML = '✅ نسخ';
        setTimeout(() => elements.copyCodeBtn.innerHTML = originalText, 2000);
    });
});

safeAddEvent(elements.leaveRoomBtn, 'click', () => {
    socket.emit('room:leave');
});

safeAddEvent(elements.startGameBtn, 'click', () => {
    socket.emit('game:start');
});

// Enable enter key for forms
safeAddEvent(elements.roomCodeInput, 'keypress', e => { if (e.key === 'Enter') elements.joinBtn.click(); });
safeAddEvent(elements.authUsername, 'keypress', e => { if (e.key === 'Enter') elements.authPassword.focus(); });
safeAddEvent(elements.authPassword, 'keypress', e => { if (e.key === 'Enter') elements.authForm.dispatchEvent(new Event('submit')); });

console.log('🎭 Mafia Game Client Loaded Successfully');
console.log('--- Mafia App Script Execution Completed ---');

function handleProgression(data) {
    if (!state.user) return;

    // Check for level up before updating state
    const isLevelUp = data.newLevel > (state.user.level || 1);

    // Update local state
    state.user.total_xp = data.newXp;
    state.user.level = data.newLevel;
    updateProfileUI();

    // Show sequence in Game Over screen
    if (elements.progressionSummary) {
        elements.progressionSummary.innerHTML = '';
        elements.progressionSummary.classList.add('visible');

        // XP Gain
        const xpEl = document.createElement('div');
        xpEl.className = 'xp-gain';
        xpEl.innerHTML = `<span class="icon">✨</span> <span>+${data.xpEarned} XP</span>`;
        elements.progressionSummary.appendChild(xpEl);

        // Level Up Animation
        if (isLevelUp) {
            const lvlEl = document.createElement('div');
            lvlEl.className = 'level-up-message';
            lvlEl.innerHTML = `🎉 مستوى جديد: ${data.newLevel}!`;
            elements.progressionSummary.appendChild(lvlEl);
        }
    }
}

// Timer logic
let localTimerInterval = null;

function startLocalTimer(duration, phase) {
    if (localTimerInterval) clearInterval(localTimerInterval);
    if (duration <= 0) {
        elements.phaseTimer.classList.add('hidden');
        return;
    }

    elements.phaseTimer.classList.remove('hidden');
    let timeLeft = duration;

    const updateDisplay = () => {
        const mins = Math.floor(timeLeft / 60);
        const secs = timeLeft % 60;
        elements.phaseTimer.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;

        // Add warning class if < 10s
        if (timeLeft <= 10) {
            elements.phaseTimer.classList.add('warning');
        } else {
            elements.phaseTimer.classList.remove('warning');
        }
    };

    updateDisplay();
    localTimerInterval = setInterval(() => {
        timeLeft--;
        if (timeLeft <= 0) {
            clearInterval(localTimerInterval);
            elements.phaseTimer.textContent = "00:00";
        } else {
            updateDisplay();
        }
    }, 1000);
}

function handleProgression(data) {
    if (!state.user) return;
    const isLevelUp = data.newLevel > (state.user.level || 1);
    state.user.total_xp = data.newXp;
    state.user.level = data.newLevel;
    updateProfileUI();

    if (elements.progressionSummary) {
        elements.progressionSummary.innerHTML = '';
        elements.progressionSummary.classList.add('visible');
        const xpEl = document.createElement('div');
        xpEl.className = 'xp-gain';
        xpEl.innerHTML = `<span class="icon">✨</span> <span>+${data.xpEarned} XP</span>`;
        elements.progressionSummary.appendChild(xpEl);
        if (isLevelUp) {
            const lvlEl = document.createElement('div');
            lvlEl.className = 'level-up-message';
            lvlEl.innerHTML = `🎉 مستوى جديد: ${data.newLevel}!`;
            elements.progressionSummary.appendChild(lvlEl);
        }
    }
}

// Start the application
init();
