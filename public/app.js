// ==================== SERVICE WORKER REGISTRATION ====================
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then(reg => console.log('✅ Service Worker registered'))
            .catch(err => console.log('❌ Service Worker registration failed:', err));
    });
}

// ==================== SOCKET & STATE ====================
const socket = io();

const state = {
    roomCode: null,
    playerId: null,
    playerName: null,
    players: [],
    role: null,
    phase: null,
    isHost: false,
    selectedTarget: null,
    hasActed: false,
    dayNumber: 0,
    settings: {}
};

const ROLE_INFO = {
    mafia: { icon: '🔪', image: 'images/Mafia.png', name: 'مافيا', description: 'قم بإزالة سكان المدينة واحداً تلو الآخر. صوّت مع زملائك المافيا لقتل شخص كل ليلة.' },
    doctor: { icon: '💉', image: 'images/doctor.png', name: 'طبيب', description: 'يمكنك إنقاذ شخص واحد كل ليلة من هجوم المافيا. اختر بحكمة!' },
    detective: { icon: '🔍', image: 'images/detective.png', name: 'محقق', description: 'حقق مع لاعب واحد كل ليلة لاكتشاف ما إذا كان مافيا أم لا.' },
    citizen: { icon: '👤', image: 'images/Citizen.png', name: 'مواطن', description: 'اعمل مع المدينة لتحديد وإزالة المافيا من خلال النقاش والتصويت.' }
};

// ==================== LOCALSTORAGE ====================
function savePlayerName(name) {
    localStorage.setItem('mafia_player_name', name);
}

function loadPlayerName() {
    return localStorage.getItem('mafia_player_name') || '';
}

// ==================== DOM ELEMENTS ====================
const screens = {
    lobby: document.getElementById('lobby-screen'),
    waiting: document.getElementById('waiting-screen'),
    role: document.getElementById('role-screen'),
    game: document.getElementById('game-screen'),
    gameover: document.getElementById('gameover-screen')
};

const elements = {
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
    settingSelfHeal: document.getElementById('setting-self-heal'),
    settingPublic: document.getElementById('setting-public'),
    browseName: document.getElementById('browse-name'),
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
    copyCodeBtn: document.getElementById('copy-code-btn')
};

// ==================== INITIALIZE ====================
function init() {
    const savedName = loadPlayerName();
    if (savedName) {
        elements.createName.value = savedName;
        elements.joinName.value = savedName;
        elements.browseName.value = savedName;
    }
}
init();

// ==================== SCREEN NAVIGATION ====================
function showScreen(screenName) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    screens[screenName].classList.add('active');
}

function showError(message) {
    elements.lobbyError.textContent = message;
    elements.lobbyError.classList.remove('hidden');
    setTimeout(() => elements.lobbyError.classList.add('hidden'), 4000);
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
    const name = elements.browseName.value.trim();
    if (!name) return showError('الرجاء إدخال اسمك');
    state.playerName = name;
    savePlayerName(name);
    socket.emit('room:join', { roomCode: code, playerName: name });
}

elements.refreshRoomsBtn.addEventListener('click', fetchPublicRooms);

elements.createBtn.addEventListener('click', () => {
    const name = elements.createName.value.trim();
    if (!name) return showError('الرجاء إدخال اسمك');
    state.playerName = name;
    savePlayerName(name);
    socket.emit('room:create', { playerName: name, settings: {} });
});

elements.joinBtn.addEventListener('click', () => {
    const name = elements.joinName.value.trim();
    const code = elements.roomCodeInput.value.trim().toUpperCase();
    if (!name) return showError('الرجاء إدخال اسمك');
    if (!code || code.length !== 6) return showError('الرجاء إدخال كود غرفة صحيح من 6 أحرف');
    state.playerName = name;
    savePlayerName(name);
    socket.emit('room:join', { roomCode: code, playerName: name });
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
}

function updateSettings() {
    if (!state.isHost) return;
    const settings = {
        maxPlayers: parseInt(elements.settingMaxPlayers.value),
        mafiaCount: parseInt(elements.settingMafia.value),
        doctorCount: parseInt(elements.settingDoctors.value),
        detectiveCount: parseInt(elements.settingDetectives.value),
        doctorSelfHeal: elements.settingSelfHeal.checked,
        isPublic: elements.settingPublic.checked
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
}

setupSettingsHandlers();

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

socket.on('host:assigned', () => {
    state.isHost = true;
    elements.startGameBtn.classList.remove('hidden');
    elements.settingsPanel.classList.remove('hidden');
});

socket.on('settings:updated', (settings) => {
    applySettings(settings);
});

function updatePlayerList(players) {
    elements.playerCount.textContent = players.length;
    elements.playerList.innerHTML = players.map((p, i) =>
        `<li${i === 0 ? ' class="host"' : ''}>${p.name}</li>`
    ).join('');

    if (state.isHost) {
        elements.startGameBtn.disabled = players.length < 4;
    }
}

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

socket.on('player:readyUpdate', ({ readyCount, totalCount }) => {
    elements.readyStatus.textContent = `${readyCount}/${totalCount} لاعب جاهز`;
});

// ==================== SOCKET EVENTS - NIGHT PHASE ====================
socket.on('phase:night', ({ dayNumber, players, settings }) => {
    state.players = players;
    state.phase = 'night';
    state.dayNumber = dayNumber;
    state.hasActed = false;
    state.selectedTarget = null;
    if (settings) state.settings = settings;

    document.body.classList.remove('theme-day');
    elements.phaseBanner.innerHTML = `<span class="phase-icon">🌙</span><span class="phase-text">الليلة ${dayNumber}</span>`;
    elements.skipActionBtn.style.display = 'none';

    updateActionPanel();
    renderSeats();
    showScreen('game');
});

function updateActionPanel() {
    const role = state.role;
    const phase = state.phase;

    if (phase === 'night') {
        if (role === 'mafia') {
            elements.actionTitle.textContent = '🔪 اختر ضحيتك';
            elements.actionHint.textContent = 'اختر لاعباً لإزالته الليلة';
            elements.skipActionBtn.style.display = 'none';
        } else if (role === 'doctor') {
            const selfHealText = state.settings.doctorSelfHeal ? ' (يمكنك حماية نفسك)' : '';
            elements.actionTitle.textContent = '💉 أنقذ شخصاً';
            elements.actionHint.textContent = 'اختر لاعباً لحمايته من المافيا' + selfHealText;
            elements.skipActionBtn.style.display = 'none';
        } else if (role === 'detective') {
            elements.actionTitle.textContent = '🔍 حقق';
            elements.actionHint.textContent = 'اختر لاعباً لاكتشاف هويته الحقيقية';
            elements.skipActionBtn.style.display = 'none';
        } else {
            // Citizen - show skip button
            elements.actionTitle.textContent = '💤 الليل مظلم...';
            elements.actionHint.textContent = 'انتظر الفجر أو اضغط تخطي للمتابعة';
            elements.skipActionBtn.style.display = 'inline-block';
            elements.skipActionBtn.textContent = 'تخطي ⏭️';
        }
    } else if (phase === 'day') {
        elements.actionTitle.textContent = '⚖️ وقت التصويت';
        elements.actionHint.textContent = 'ناقش وصوّت لإزالة المشتبه به';
        elements.skipActionBtn.style.display = 'inline-block';
        elements.skipActionBtn.textContent = 'تخطي التصويت';
    }
}

function renderSeats() {
    const players = state.players;
    const count = players.length;

    elements.seatsContainer.innerHTML = players.map((player, index) => {
        const angle = (360 / count) * index - 90;
        const playerNum = player.playerNumber || (index + 1);
        const isSelf = player.id === state.playerId;
        const isDead = !player.alive;
        const isSelected = state.selectedTarget === player.id;
        const isTeammate = state.teammates && state.teammates.some(t => t.id === player.id);

        let classes = 'player-seat';
        if (isSelf) classes += ' self';
        if (isDead) classes += ' dead';
        if (isSelected) classes += ' selected';
        if (isTeammate) classes += ' teammate';

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

    if (!targetPlayer || !targetPlayer.alive) return;
    if (state.hasActed) return;

    const myPlayer = state.players.find(p => p.id === state.playerId);
    if (!myPlayer || !myPlayer.alive) return;

    // Check if clicking on self
    if (targetId === state.playerId) {
        // Doctor can heal self if setting allows
        if (state.phase === 'night' && state.role === 'doctor' && state.settings.doctorSelfHeal) {
            // Allow self-heal
        } else {
            return;
        }
    }

    if (state.phase === 'night') {
        if (state.role === 'citizen') return;

        state.selectedTarget = targetId;
        state.hasActed = true;

        document.querySelectorAll('.player-seat').forEach(s => s.classList.remove('selected'));
        seat.classList.add('selected');

        socket.emit('night:action', { targetId });

        elements.actionTitle.textContent = '✓ تم تأكيد الإجراء';
        elements.actionHint.textContent = 'في انتظار اللاعبين الآخرين...';
    } else if (state.phase === 'day') {
        state.selectedTarget = targetId;
        state.hasActed = true;

        document.querySelectorAll('.player-seat').forEach(s => s.classList.remove('selected'));
        seat.classList.add('selected');

        socket.emit('day:vote', { targetId });

        elements.actionTitle.textContent = '✓ تم التصويت';
        elements.actionHint.textContent = 'في انتظار الأصوات الأخرى...';
        elements.skipActionBtn.style.display = 'none';
    }
}

elements.skipActionBtn.addEventListener('click', () => {
    if (state.hasActed) return;
    state.hasActed = true;

    if (state.phase === 'night') {
        // Citizen skipping night
        socket.emit('night:skip');
        elements.actionTitle.textContent = '✓ تم التخطي';
        elements.actionHint.textContent = 'في انتظار اللاعبين الآخرين...';
    } else {
        // Day vote skip
        socket.emit('day:skipVote');
        elements.actionTitle.textContent = '✓ تم التخطي';
        elements.actionHint.textContent = 'في انتظار الأصوات الأخرى...';
    }
    elements.skipActionBtn.style.display = 'none';
});

socket.on('night:actionConfirmed', () => {
    // Action confirmed by server
});

// Detective investigation result - show card modal
socket.on('detective:result', ({ targetName, isMafia }) => {
    elements.investigationTarget.textContent = targetName;

    const resultDiv = elements.investigationResult;
    resultDiv.className = `investigation-result ${isMafia ? 'mafia' : 'innocent'}`;
    resultDiv.innerHTML = isMafia
        ? '<span class="result-icon">🔪</span><span class="result-text">مافيا!</span>'
        : '<span class="result-icon">👤</span><span class="result-text">بريء</span>';

    elements.detectiveModal.classList.remove('hidden');
});

elements.detectiveContinueBtn.addEventListener('click', () => {
    elements.detectiveModal.classList.add('hidden');
});

socket.on('night:result', ({ killed, saved }) => {
    if (killed) {
        elements.nightResultTitle.textContent = 'مأساة عند الفجر';
        elements.nightResultText.textContent = `${killed.name} وُجد ميتاً هذا الصباح. المافيا ضربت.`;
    } else if (saved) {
        elements.nightResultTitle.textContent = 'معجزة!';
        elements.nightResultText.textContent = 'الطبيب أنقذ شخصاً من هجوم المافيا الليلة الماضية!';
    } else {
        elements.nightResultTitle.textContent = 'ليلة هادئة';
        elements.nightResultText.textContent = 'استيقظت المدينة لتجد الجميع بخير.';
    }

    elements.nightModal.classList.remove('hidden');
});

elements.nightContinueBtn.addEventListener('click', () => {
    elements.nightModal.classList.add('hidden');
});

// ==================== SOCKET EVENTS - DAY PHASE ====================
socket.on('phase:day', ({ dayNumber, players }) => {
    state.players = players;
    state.phase = 'day';
    state.dayNumber = dayNumber;
    state.hasActed = false;
    state.selectedTarget = null;

    document.body.classList.add('theme-day');
    elements.phaseBanner.innerHTML = `<span class="phase-icon">☀️</span><span class="phase-text">اليوم ${dayNumber}</span>`;

    updateActionPanel();
    renderSeats();
});

socket.on('vote:update', ({ voteCount, requiredVotes }) => {
    // Secret voting: only show progress, not who voted for whom
    elements.actionHint.textContent = `${voteCount}/${requiredVotes} صوتوا`;
});

socket.on('vote:result', ({ eliminated, voteCounts, skipVotes }) => {
    let breakdownHtml = '';

    Object.entries(voteCounts).forEach(([playerId, count]) => {
        const player = state.players.find(p => p.id === playerId);
        if (player) {
            breakdownHtml += `<div class="vote-breakdown-item"><span>${player.name}</span><span>${count} صوت</span></div>`;
        }
    });

    if (skipVotes > 0) {
        breakdownHtml += `<div class="vote-breakdown-item"><span>تخطي</span><span>${skipVotes} صوت</span></div>`;
    }

    elements.voteBreakdown.innerHTML = breakdownHtml;

    if (eliminated) {
        elements.voteResultTitle.textContent = 'إزالة';
        elements.voteResultText.textContent = `${eliminated.name} تم إزالته. كان ${ROLE_INFO[eliminated.role].name}.`;
    } else {
        elements.voteResultTitle.textContent = 'لا إجماع';
        elements.voteResultText.textContent = 'لم تتمكن المدينة من الاتفاق. لم يتم إزالة أحد.';
    }

    elements.voteModal.classList.remove('hidden');
});

elements.voteContinueBtn.addEventListener('click', () => {
    elements.voteModal.classList.add('hidden');
});

// ==================== SOCKET EVENTS - GAME OVER ====================
socket.on('game:over', ({ winner, message, players }) => {
    state.phase = 'gameover';
    document.body.classList.remove('theme-day'); // Reset to night theme

    elements.winnerBanner.className = `winner-banner ${winner}`;
    elements.winnerText.textContent = winner === 'mafia' ? 'المافيا تفوز!' : 'المدينة تفوز!';
    elements.winnerMessage.textContent = message;

    // Show play again button only to host
    if (state.isHost) {
        elements.playAgainBtn.classList.remove('hidden');
    } else {
        elements.playAgainBtn.classList.add('hidden');
    }

    elements.finalPlayerList.innerHTML = players.map(p => `
        <li class="${p.alive ? '' : 'dead'}">
            <span class="final-player-name">
                ${p.alive ? '' : '💀'} ${p.name} ${p.id === state.playerId ? '(أنت)' : ''}
            </span>
            <span class="final-player-role ${p.role}">${ROLE_INFO[p.role].name}</span>
        </li>
    `).join('');

    showScreen('gameover');
});

elements.playAgainBtn.addEventListener('click', () => {
    socket.emit('game:playAgain');
});

elements.leaveGameBtn.addEventListener('click', () => {
    socket.emit('room:leave');
});

// Enable enter key for forms
elements.createName.addEventListener('keypress', e => { if (e.key === 'Enter') elements.createBtn.click(); });
elements.joinName.addEventListener('keypress', e => { if (e.key === 'Enter' && elements.roomCodeInput.value) elements.joinBtn.click(); });
elements.roomCodeInput.addEventListener('keypress', e => { if (e.key === 'Enter') elements.joinBtn.click(); });

console.log('🎭 Mafia Game Client Loaded');
