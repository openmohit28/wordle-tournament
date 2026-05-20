/* ── State ────────────────────────────────────────────────────────── */
const S = {
  socket: null,
  playerId: null,
  isAdmin: false,
  roomCode: null,
  playerName: null,

  // Round
  currentWord: null,
  guesses: [],       // [{guess, result}]
  currentInput: '',
  rowIndex: 0,
  gameOver: false,
  failed: false,
  timerTotal: 120,
  timerLeft: 120,

  // Opponents
  opponents: {},  // {id: {name, tryNum, solved, failed}}

  // Finals
  finalists: [],
  finalsScores: {},
};

/* ── Screen helpers ──────────────────────────────────────────────── */
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function toast(msg, duration = 1800) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('visible');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('visible'), duration);
}

/* ── Home screen ─────────────────────────────────────────────────── */
document.getElementById('btn-create').addEventListener('click', () => {
  const name = document.getElementById('home-name').value.trim();
  if (!name) return setHomeError('Enter your name first');
  S.playerName = name;
  S.socket.emit('create_room', { playerName: name });
});

document.getElementById('btn-join').addEventListener('click', joinRoom);
document.getElementById('home-code').addEventListener('keydown', e => { if (e.key === 'Enter') joinRoom(); });
document.getElementById('home-name').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('btn-create').click(); });

function joinRoom() {
  const name = document.getElementById('home-name').value.trim();
  const code = document.getElementById('home-code').value.trim();
  if (!name) return setHomeError('Enter your name first');
  if (!code) return setHomeError('Enter a room code');
  S.playerName = name;
  S.socket.emit('join_room', { playerName: name, code });
}

function setHomeError(msg) {
  document.getElementById('home-error').textContent = msg;
  setTimeout(() => document.getElementById('home-error').textContent = '', 3000);
}

/* ── Lobby ───────────────────────────────────────────────────────── */
document.getElementById('btn-copy').addEventListener('click', () => {
  navigator.clipboard.writeText(S.roomCode).catch(() => {});
  toast('Code copied!');
});

document.getElementById('timer-slider').addEventListener('input', function () {
  document.getElementById('timer-display').textContent = this.value + 's';
  S.socket.emit('update_settings', { roundTimer: parseInt(this.value) });
});

document.getElementById('btn-start').addEventListener('click', () => {
  S.socket.emit('start_tournament');
});

document.getElementById('btn-play-again').addEventListener('click', () => {
  location.reload();
});

function renderLobby(players, code, isAdmin) {
  document.getElementById('lobby-code').textContent = code;
  document.getElementById('player-count').textContent = players.length;
  S.roomCode = code;

  const list = document.getElementById('player-list');
  list.innerHTML = players.map(p => {
    const badges = [];
    if (p.id === getAdminId(players)) badges.push('<span class="badge badge-admin">ADMIN</span>');
    if (p.id === S.playerId) badges.push('<span class="badge badge-you">YOU</span>');
    return `<li>${badges.join('')} ${escHtml(p.name)}</li>`;
  }).join('');

  if (isAdmin) {
    document.getElementById('admin-settings').classList.remove('hidden');
    document.getElementById('guest-waiting').classList.add('hidden');
    const canStart = players.length >= 2;
    document.getElementById('btn-start').disabled = !canStart;
    const hint = document.getElementById('start-hint');
    if (canStart) {
      hint.textContent = `${players.length} players ready — you can start!`;
      hint.classList.add('ready');
    } else {
      hint.textContent = 'Waiting for more players to join…';
      hint.classList.remove('ready');
    }
  } else {
    document.getElementById('admin-settings').classList.add('hidden');
    document.getElementById('guest-waiting').classList.remove('hidden');
  }

  showScreen('screen-lobby');
}

function getAdminId(players) {
  const ap = players.find(p => p.isAdmin);
  return ap ? ap.id : null;
}

/* ── Board ───────────────────────────────────────────────────────── */
function buildBoard() {
  const board = document.getElementById('board');
  board.innerHTML = '';
  for (let r = 0; r < 6; r++) {
    for (let c = 0; c < 5; c++) {
      const tile = document.createElement('div');
      tile.className = 'tile';
      tile.id = `tile-${r}-${c}`;
      board.appendChild(tile);
    }
  }
}

function buildKeyboard() {
  const rows = [
    ['Q','W','E','R','T','Y','U','I','O','P'],
    ['A','S','D','F','G','H','J','K','L'],
    ['ENTER','Z','X','C','V','B','N','M','⌫'],
  ];
  rows.forEach((keys, ri) => {
    const row = document.getElementById(`kb-row-${ri + 1}`);
    row.innerHTML = '';
    keys.forEach(k => {
      const btn = document.createElement('button');
      btn.className = 'key' + (k === 'ENTER' || k === '⌫' ? ' wide' : '');
      btn.textContent = k;
      btn.dataset.key = k;
      btn.addEventListener('click', () => handleKey(k));
      row.appendChild(btn);
    });
  });
}

function resetBoard() {
  S.guesses = [];
  S.currentInput = '';
  S.rowIndex = 0;
  S.gameOver = false;
  S.failed = false;
  buildBoard();
  buildKeyboard();
  setMessage('');
  // Clear keyboard colors
  document.querySelectorAll('.key').forEach(k => {
    k.classList.remove('correct', 'present', 'absent');
  });
}

function resetSidebar() {
  S.opponents = {};
  document.getElementById('sidebar-players').innerHTML = '';
}

/* ── Input ───────────────────────────────────────────────────────── */
document.addEventListener('keydown', e => {
  if (document.getElementById('screen-game').classList.contains('active')) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Enter') handleKey('ENTER');
    else if (e.key === 'Backspace' || e.key === 'Delete') handleKey('⌫');
    else if (/^[a-zA-Z]$/.test(e.key)) handleKey(e.key.toUpperCase());
  }
});

function handleKey(key) {
  if (S.gameOver) return;
  if (key === '⌫' || key === 'Backspace') {
    if (S.currentInput.length > 0) {
      S.currentInput = S.currentInput.slice(0, -1);
      updateCurrentRow();
    }
    return;
  }
  if (key === 'ENTER') {
    submitGuess();
    return;
  }
  if (/^[A-Z]$/.test(key) && S.currentInput.length < 5) {
    S.currentInput += key;
    updateCurrentRow();
  }
}

function updateCurrentRow() {
  for (let c = 0; c < 5; c++) {
    const tile = document.getElementById(`tile-${S.rowIndex}-${c}`);
    if (!tile) return;
    const letter = S.currentInput[c] || '';
    tile.textContent = letter;
    tile.classList.toggle('filled', letter.length > 0);
  }
}

function submitGuess() {
  if (S.currentInput.length !== 5) {
    shakeRow(S.rowIndex);
    setMessage('Not enough letters');
    setTimeout(() => setMessage(''), 1500);
    return;
  }
  S.socket.emit('submit_guess', { guess: S.currentInput });
}

/* ── Guess result ────────────────────────────────────────────────── */
function applyGuessResult(guess, result, rowIdx) {
  for (let c = 0; c < 5; c++) {
    const tile = document.getElementById(`tile-${rowIdx}-${c}`);
    if (!tile) continue;
    tile.textContent = guess[c];
    tile.classList.remove('filled');
    tile.classList.add(result[c], 'reveal');
  }
  updateKeyColors(guess, result);
}

function updateKeyColors(guess, result) {
  const priority = { correct: 3, present: 2, absent: 1 };
  const keyStates = {};

  // read existing
  document.querySelectorAll('.key').forEach(k => {
    const key = k.dataset.key;
    if (!key || key.length !== 1) return;
    if (k.classList.contains('correct')) keyStates[key] = 3;
    else if (k.classList.contains('present')) keyStates[key] = 2;
    else if (k.classList.contains('absent')) keyStates[key] = 1;
  });

  for (let i = 0; i < 5; i++) {
    const letter = guess[i];
    const newPriority = priority[result[i]] || 0;
    if (!keyStates[letter] || newPriority > keyStates[letter]) {
      keyStates[letter] = newPriority;
    }
  }

  document.querySelectorAll('.key').forEach(k => {
    const key = k.dataset.key;
    if (!key || key.length !== 1) return;
    k.classList.remove('correct', 'present', 'absent');
    if (keyStates[key] === 3) k.classList.add('correct');
    else if (keyStates[key] === 2) k.classList.add('present');
    else if (keyStates[key] === 1) k.classList.add('absent');
  });
}

function shakeRow(rowIdx) {
  for (let c = 0; c < 5; c++) {
    const tile = document.getElementById(`tile-${rowIdx}-${c}`);
    if (tile) { tile.classList.remove('shake'); void tile.offsetWidth; tile.classList.add('shake'); }
  }
}

function setMessage(msg) {
  document.getElementById('board-msg').textContent = msg;
}

/* ── Sidebar ─────────────────────────────────────────────────────── */
function initSidebar(activePlayers) {
  S.opponents = {};
  activePlayers.forEach(p => {
    if (p.id !== S.playerId) {
      S.opponents[p.id] = { name: p.name, tryNum: 0, solved: false, failed: false };
    }
  });
  renderSidebar(activePlayers);
}

function renderSidebar(activePlayers) {
  const list = document.getElementById('sidebar-players');
  list.innerHTML = '';

  const all = activePlayers.map(p => {
    const opp = p.id === S.playerId ? { name: S.playerName, tryNum: S.rowIndex, solved: S.gameOver && !S.failed, failed: S.gameOver && S.failed } : (S.opponents[p.id] || { name: p.name, tryNum: 0, solved: false, failed: false });
    return { ...p, ...opp };
  });

  all.forEach(p => {
    const li = document.createElement('li');
    const isYou = p.id === S.playerId;
    const stateClass = p.solved ? 'solved' : p.failed ? 'failed' : 'waiting';
    li.className = stateClass;

    const pips = Array.from({ length: 6 }, (_, i) => {
      let cls = 'pip';
      if (p.solved && i === p.tryNum - 1) cls += ' solved';
      else if (p.failed) cls += ' failed';
      else if (i < p.tryNum) cls += ' used';
      return `<div class="${cls}"></div>`;
    }).join('');

    const statusText = p.solved ? `Solved in ${p.tryNum}` : p.failed ? 'Failed' : p.tryNum > 0 ? `Try ${p.tryNum}/6` : 'Waiting…';
    li.innerHTML = `<span class="sp-name">${escHtml(p.name)}${isYou ? ' <small>(you)</small>' : ''}</span><span class="sp-status">${statusText}</span><div class="sp-pips">${pips}</div>`;
    list.appendChild(li);
  });
}

function updateOpponent(data) {
  if (!S.opponents[data.playerId]) return;
  S.opponents[data.playerId].tryNum = data.tryNum;
  S.opponents[data.playerId].solved = data.solved;
  S.opponents[data.playerId].failed = data.failed;
  // Re-render
  const activePlayers = Object.entries(S.opponents).map(([id, o]) => ({ id, ...o }));
  activePlayers.push({ id: S.playerId, name: S.playerName });
  renderSidebar(activePlayers);
}

/* ── Timer ───────────────────────────────────────────────────────── */
function updateTimer(timeLeft) {
  S.timerLeft = timeLeft;
  const pct = S.timerTotal > 0 ? (timeLeft / S.timerTotal) * 100 : 0;
  const fill = document.getElementById('timer-fill');
  const text = document.getElementById('timer-text');
  fill.style.width = pct + '%';
  fill.classList.toggle('warning', pct <= 50 && pct > 20);
  fill.classList.toggle('danger', pct <= 20);
  const m = Math.floor(timeLeft / 60);
  const s = timeLeft % 60;
  text.textContent = `${m}:${s.toString().padStart(2, '0')}`;
}

/* ── Phase badge ─────────────────────────────────────────────────── */
function setPhaseBadge(text, style = '') {
  const badge = document.getElementById('phase-badge');
  badge.textContent = text;
  badge.classList.remove('green', 'yellow', 'red');
  if (style) badge.classList.add(style);
}

/* ── Round result screen ─────────────────────────────────────────── */
function showRoundResult({ word, results, eliminated, confirmedFinalists, nextInfo, header }) {
  document.getElementById('result-header').textContent = header || 'Round Over';
  document.getElementById('result-word').innerHTML = `The word was<strong>${word}</strong>`;

  const sorted = [...results].sort((a, b) => a.scoreTries - b.scoreTries);
  document.getElementById('result-list').innerHTML = sorted.map((r, i) => `
    <div class="result-row">
      <div class="result-rank">${['🥇','🥈','🥉'][i] || (i + 1)}</div>
      <div class="result-name">${escHtml(r.name)}${r.playerId === S.playerId ? ' <small>(you)</small>' : ''}</div>
      <div class="result-tries">${r.solved ? r.tries + ' tries' : 'failed'}</div>
      <div class="result-badge ${r.solved ? 'badge-solved' : 'badge-failed'}">${r.solved ? '✓' : '✗'}</div>
    </div>`).join('');

  let elimHtml = '';
  if (eliminated?.length) {
    elimHtml += `<div class="elim-header">ELIMINATED</div>`;
    elimHtml += eliminated.map(e => `<div class="elim-row">💀 ${escHtml(e.name)}</div>`).join('');
  }
  if (confirmedFinalists?.length) {
    elimHtml += `<div class="elim-header" style="color:var(--gold);margin-top:8px">CONFIRMED FINALISTS</div>`;
    elimHtml += confirmedFinalists.map(f => `<div class="finalist-row">⭐ ${escHtml(f.name)}</div>`).join('');
  }
  document.getElementById('result-elim').innerHTML = elimHtml;
  document.getElementById('result-next').innerHTML = nextInfo || '';

  showScreen('screen-round-result');
}

/* ── Countdown helper ────────────────────────────────────────────── */
function startCountdown(el, seconds, onDone) {
  let t = seconds;
  el.innerHTML = `<span class="countdown">${t}</span>`;
  const iv = setInterval(() => {
    t--;
    if (t <= 0) { clearInterval(iv); onDone?.(); }
    else el.querySelector('.countdown').textContent = t;
  }, 1000);
}

/* ── Socket setup ────────────────────────────────────────────────── */
function initSocket() {
  S.socket = io();

  S.socket.on('room_created', data => {
    S.playerId = data.playerId;
    S.isAdmin = true;
    S.roomCode = data.code;
    renderLobby(data.players, data.code, true);
  });

  S.socket.on('room_joined', data => {
    S.playerId = data.playerId;
    S.isAdmin = false;
    S.roomCode = data.code;
    S.timerTotal = data.settings.roundTimer;
    renderLobby(data.players, data.code, false);
  });

  S.socket.on('player_joined', data => {
    if (data.players) {
      document.getElementById('player-count').textContent = data.players.length;
      const list = document.getElementById('player-list');
      list.innerHTML = data.players.map(p => {
        const badges = [];
        if (p.isAdmin) badges.push('<span class="badge badge-admin">ADMIN</span>');
        if (p.id === S.playerId) badges.push('<span class="badge badge-you">YOU</span>');
        return `<li>${badges.join('')} ${escHtml(p.name)}</li>`;
      }).join('');
      if (S.isAdmin) {
        const canStart = data.players.length >= 2;
        document.getElementById('btn-start').disabled = !canStart;
        const hint = document.getElementById('start-hint');
        if (canStart) {
          hint.textContent = `${data.players.length} players ready — you can start!`;
          hint.classList.add('ready');
        } else {
          hint.textContent = 'Waiting for more players to join…';
          hint.classList.remove('ready');
        }
      }
    }
  });

  S.socket.on('settings_updated', ({ settings }) => {
    S.timerTotal = settings.roundTimer;
    if (S.isAdmin) {
      document.getElementById('timer-slider').value = settings.roundTimer;
      document.getElementById('timer-display').textContent = settings.roundTimer + 's';
    }
  });

  S.socket.on('tournament_started', () => {
    showScreen('screen-game');
    resetBoard();
    resetSidebar();
  });

  S.socket.on('round_started', data => {
    S.timerTotal = data.timer;
    S.timerLeft = data.timer;
    resetBoard();
    S.gameOver = false;
    S.failed = false;
    initSidebar(data.activePlayers);
    updateTimer(data.timer);
    showScreen('screen-game');

    const phaseLabels = {
      group: `GROUP • ROUND ${data.roundNum}/${data.totalRounds}`,
      elimination: `ELIMINATION • ROUND ${data.roundNum}`,
      finals: `FINALS • ROUND ${data.roundNum}/3`,
      sudden_death: `⚡ SUDDEN DEATH ${data.roundNum > 1 ? data.roundNum : ''}`,
    };
    const phaseStyles = { group: 'green', elimination: 'yellow', finals: 'yellow', sudden_death: 'red' };
    setPhaseBadge(phaseLabels[data.phase] || data.phase.toUpperCase(), phaseStyles[data.phase] || '');
    document.getElementById('sidebar-title').textContent = data.phase === 'finals' ? 'Finals' : 'Players';

    setMessage('');
  });

  S.socket.on('timer_tick', ({ timeLeft }) => {
    updateTimer(timeLeft);
  });

  S.socket.on('guess_result', data => {
    const rowIdx = S.rowIndex;
    if (data.result) applyGuessResult(data.guess, data.result, rowIdx);
    S.guesses.push({ guess: data.guess, result: data.result });
    S.currentInput = '';
    S.rowIndex++;

    if (data.isCorrect) {
      S.gameOver = true;
      setMessage('Brilliant! 🎉');
      toast('You got it!');
    } else if (data.gameOver) {
      S.gameOver = true;
      S.failed = true;
      if (data.word) setMessage(`The word was ${data.word}`);
      toast('Better luck next time');
    }
  });

  S.socket.on('guess_error', data => {
    shakeRow(S.rowIndex);
    setMessage(data.message);
    setTimeout(() => setMessage(''), 1500);
  });

  S.socket.on('opponent_progress', data => {
    if (data.playerId === S.playerId) return;
    if (!S.opponents[data.playerId]) {
      S.opponents[data.playerId] = { name: data.name, tryNum: 0, solved: false, failed: false };
    }
    S.opponents[data.playerId].tryNum = data.tryNum;
    S.opponents[data.playerId].solved = data.solved;
    S.opponents[data.playerId].failed = data.failed;

    const allPlayers = [{ id: S.playerId, name: S.playerName }, ...Object.entries(S.opponents).map(([id, o]) => ({ id, ...o }))];
    renderSidebar(allPlayers);
  });

  S.socket.on('player_solved', data => {
    if (data.playerId !== S.playerId) toast(`${data.name} solved it in ${data.tries}!`);
  });

  S.socket.on('round_ended', data => {
    S.gameOver = true;
    // Show round result screen after a short delay to let flip animations finish
    setTimeout(() => {
      showRoundResult({
        word: data.word,
        results: data.results,
        header: 'Round Over',
        nextInfo: '<div>Next round coming up…</div>',
      });
    }, 1800);
  });

  S.socket.on('group_standings', data => {
    // Update the round result screen with standings info
    const nextEl = document.getElementById('result-next');
    if (data.round < data.totalRounds) {
      nextEl.innerHTML = `<div>Group Stage — Round ${data.round}/${data.totalRounds} complete</div>`;
    } else {
      nextEl.innerHTML = `<div>Group Stage complete! Elimination round starting…</div>`;
    }
  });

  S.socket.on('phase_changed', data => {
    if (data.phase === 'elimination_stage') {
      toast('Elimination Round begins!', 3000);
      const nextEl = document.getElementById('result-next');
      if (nextEl) nextEl.innerHTML = '<div style="color:var(--yellow-bright)">⚔️ Elimination Round starting!</div>';
    }
  });

  S.socket.on('elimination_result', data => {
    const resultElim = document.getElementById('result-elim');
    if (!resultElim) return;

    let html = '';
    if (data.eliminated?.length) {
      html += `<div class="elim-header">ELIMINATED</div>`;
      html += data.eliminated.map(e => `<div class="elim-row">💀 ${escHtml(e.name)}</div>`).join('');
    }
    if (data.confirmedFinalists?.length) {
      html += `<div class="elim-header" style="color:var(--gold);margin-top:8px">CONFIRMED FINALISTS</div>`;
      html += data.confirmedFinalists.map(f => `<div class="finalist-row">⭐ ${escHtml(f.name)}</div>`).join('');
    }
    if (data.activePlayers?.length) {
      html += `<div class="elim-header" style="color:var(--text-muted);margin-top:8px">STILL COMPETING</div>`;
      html += data.activePlayers.map(p => `<div class="result-row"><div class="result-name">${escHtml(p.name)}</div></div>`).join('');
    }
    resultElim.innerHTML = html;
  });

  S.socket.on('finals_started', data => {
    S.finalists = data.finalists;
    S.finalsScores = {};
    data.finalists.forEach(f => S.finalsScores[f.id] = 0);
    toast(`Finals: ${data.finalists.map(f => f.name).join(' vs ')}!`, 4000);
  });

  S.socket.on('finals_round_scored', data => {
    S.finalsScores = data.scores;
    showFinalsScore(data);
  });

  S.socket.on('sudden_death_start', data => {
    S.finalsScores = data.scores;
    showFinalsScore({ scores: data.scores, roundScores: [], finalists: data.finalists, isSuddenDeath: true });
    toast('⚡ SUDDEN DEATH!', 4000);
  });

  S.socket.on('tournament_complete', data => {
    const winnerName = document.getElementById('winner-name');
    winnerName.textContent = data.winner.name;

    const scoresEl = document.getElementById('winner-scores');
    scoresEl.innerHTML = '';
    if (data.finalists && data.finalsScores) {
      data.finalists.forEach(f => {
        const div = document.createElement('div');
        div.className = 'winner-score-row' + (f.id === data.winner.id ? ' highlight' : '');
        div.innerHTML = `<span>${f.id === data.winner.id ? '🏆 ' : ''}${escHtml(f.name)}</span><span>${data.finalsScores[f.id] ?? '—'} pts</span>`;
        scoresEl.appendChild(div);
      });
    }

    showScreen('screen-winner');
  });

  S.socket.on('player_disconnected', data => {
    toast(`${data.name} disconnected`);
  });

  S.socket.on('error', data => {
    setHomeError(data.message);
    toast(data.message, 3000);
  });
}

function showFinalsScore(data) {
  const body = document.getElementById('finals-score-body');
  body.innerHTML = '';

  const finalists = data.finalists || S.finalists;
  finalists.forEach(f => {
    const score = data.scores[f.id] ?? 0;
    const roundScores = (data.roundScores || []).map(round => {
      const rs = round.find(r => r.id === f.id);
      return rs ? `<div class="fps-round-score ${rs.solved ? 'solved' : ''}">${rs.score}</div>` : '';
    }).join('');

    const div = document.createElement('div');
    div.className = 'finals-player-score';
    div.innerHTML = `
      <div class="fps-name">${escHtml(f.name)}${f.id === S.playerId ? ' <small>(you)</small>' : ''}</div>
      <div class="fps-rounds">${roundScores}</div>
      <div class="fps-score">${score}</div>
    `;
    body.appendChild(div);
  });

  const nextEl = document.getElementById('finals-next-info');
  if (data.isSuddenDeath) {
    nextEl.innerHTML = '<div style="color:var(--danger)">⚡ Sudden death — next correct word wins!</div>';
  } else {
    nextEl.innerHTML = `<div>Finals round ${data.round || (data.roundScores?.length)} of 3 complete</div>`;
  }

  showScreen('screen-finals-score');
}

/* ── Utility ─────────────────────────────────────────────────────── */
function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ── Init ────────────────────────────────────────────────────────── */
buildBoard();
buildKeyboard();
initSocket();
