const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { getRandomWord, checkGuess, isValidWord } = require('./words');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};

function genCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function genId() {
  return Math.random().toString(36).substring(2, 14);
}

function roomBySocket(socketId) {
  for (const code in rooms) {
    if (rooms[code].players.some(p => p.socketId === socketId)) return rooms[code];
  }
  return null;
}

function playerBySocket(room, socketId) {
  return room.players.find(p => p.socketId === socketId);
}

function activePlayers(room) {
  if (room.phase === 'group_stage') return room.players.map(p => p.id);
  if (room.phase === 'elimination_stage') return room.elim.active;
  if (room.phase === 'finals') return room.finals.players;
  return [];
}

function playerName(room, id) {
  return room.players.find(p => p.id === id)?.name || '?';
}

// ─── Round management ────────────────────────────────────────────────────────

function startRound(room) {
  const word = getRandomWord(room.usedWords);
  room.usedWords.push(word);
  room.currentWord = word;
  room.roundStartTime = Date.now();

  const players = activePlayers(room);
  room.playerStates = {};
  for (const id of players) {
    room.playerStates[id] = { guesses: [], solved: false, failed: false, tries: 0, solveTimeMs: null };
  }

  if (room.timerHandle) clearTimeout(room.timerHandle);
  if (room.tickHandle) clearInterval(room.tickHandle);

  room.timerHandle = setTimeout(() => {
    for (const id of activePlayers(room)) {
      const s = room.playerStates[id];
      if (!s.solved && !s.failed) { s.failed = true; s.timedOut = true; }
    }
    endRound(room);
  }, room.settings.roundTimer * 1000);

  room.tickHandle = setInterval(() => {
    const elapsed = Date.now() - room.roundStartTime;
    const remaining = Math.max(0, room.settings.roundTimer - Math.floor(elapsed / 1000));
    io.to(room.code).emit('timer_tick', { timeLeft: remaining });
  }, 1000);

  let phaseInfo = {};
  if (room.phase === 'group_stage') {
    phaseInfo = { phase: 'group', roundNum: room.groupRound + 1, totalRounds: 4 };
  } else if (room.phase === 'elimination_stage') {
    phaseInfo = { phase: 'elimination', roundNum: room.elim.round + 1 };
  } else if (room.phase === 'finals') {
    const r = room.finals.round;
    phaseInfo = {
      phase: r < 3 ? 'finals' : 'sudden_death',
      roundNum: r < 3 ? r + 1 : (r - 2),
      totalRounds: 3
    };
  }

  io.to(room.code).emit('round_started', {
    ...phaseInfo,
    timer: room.settings.roundTimer,
    activePlayers: players.map(id => ({ id, name: playerName(room, id) })),
  });
}

function endRound(room) {
  if (room.timerHandle) { clearTimeout(room.timerHandle); room.timerHandle = null; }
  if (room.tickHandle) { clearInterval(room.tickHandle); room.tickHandle = null; }

  const players = activePlayers(room);
  const results = players.map(id => {
    const s = room.playerStates[id];
    const scoreTries = s.solved ? s.tries : 8;
    return { playerId: id, name: playerName(room, id), solved: s.solved, tries: s.tries, scoreTries, solveTimeMs: s.solveTimeMs, timedOut: !!s.timedOut };
  });

  io.to(room.code).emit('round_ended', { word: room.currentWord, results });

  setTimeout(() => {
    if (room.phase === 'group_stage') processGroupEnd(room, results);
    else if (room.phase === 'elimination_stage') processElimEnd(room, results);
    else if (room.phase === 'finals') processFinalsEnd(room, results);
  }, 6000);
}

// ─── Group Stage ─────────────────────────────────────────────────────────────

function processGroupEnd(room, results) {
  for (const r of results) {
    room.groupScores[r.playerId] = (room.groupScores[r.playerId] || 0) + r.scoreTries;
    const p = room.players.find(p => p.id === r.playerId);
    if (p) p.groupScore = room.groupScores[r.playerId];
  }

  room.groupRound++;

  const standings = Object.entries(room.groupScores)
    .map(([id, score]) => ({ id, name: playerName(room, id), score }))
    .sort((a, b) => a.score - b.score);

  io.to(room.code).emit('group_standings', { standings, round: room.groupRound, totalRounds: 4 });

  if (room.groupRound >= 4) {
    setTimeout(() => startEliminationStage(room), 4000);
  } else {
    setTimeout(() => startRound(room), 4000);
  }
}

// ─── Elimination Stage ───────────────────────────────────────────────────────

function startEliminationStage(room) {
  room.phase = 'elimination_stage';
  room.elim = {
    round: 0,
    active: room.players.map(p => p.id),
    confirmedFinalists: [],
  };

  io.to(room.code).emit('phase_changed', {
    phase: 'elimination_stage',
    activePlayers: room.elim.active.map(id => ({ id, name: playerName(room, id) })),
    groupScores: Object.entries(room.groupScores).map(([id, score]) => ({ id, name: playerName(room, id), score })),
  });

  if (room.elim.active.length <= 2) {
    setTimeout(() => startFinals(room, room.elim.active), 3000);
  } else {
    setTimeout(() => startRound(room), 3000);
  }
}

function processElimEnd(room, results) {
  room.elim.round++;
  const { newActive, newFinalists, eliminated } = resolveElimination(results, room.elim.active, room.elim.confirmedFinalists);

  room.elim.active = newActive;
  room.elim.confirmedFinalists = newFinalists;

  const elimInfo = eliminated.map(id => ({ id, name: playerName(room, id) }));

  io.to(room.code).emit('elimination_result', {
    eliminated: elimInfo,
    confirmedFinalists: newFinalists.map(id => ({ id, name: playerName(room, id) })),
    activePlayers: newActive.map(id => ({ id, name: playerName(room, id) })),
  });

  const totalConfirmed = newFinalists.length;
  const totalActive = newActive.length;
  const neededMore = 2 - totalConfirmed;

  if (totalConfirmed >= 2) {
    setTimeout(() => startFinals(room, newFinalists.slice(0, 2)), 4000);
  } else if (totalActive <= neededMore) {
    // Not enough to eliminate further — everyone remaining becomes a finalist
    setTimeout(() => startFinals(room, [...newFinalists, ...newActive]), 4000);
  } else {
    setTimeout(() => startRound(room), 4000);
  }
}

function resolveElimination(results, activePlayers, confirmedFinalists) {
  const neededFinalists = 2 - confirmedFinalists.length;
  const solved = results.filter(r => r.solved);
  const failed = results.filter(r => !r.solved);

  // Everyone failed — no elimination
  if (solved.length === 0) {
    return { newActive: activePlayers, newFinalists: confirmedFinalists, eliminated: [] };
  }

  if (failed.length > 0) {
    if (solved.length >= neededFinalists) {
      // Take the best N solvers, eliminate the rest
      solved.sort((a, b) => a.tries - b.tries);
      const advancing = solved.slice(0, neededFinalists).map(r => r.playerId);
      const eliminated = [...solved.slice(neededFinalists).map(r => r.playerId), ...failed.map(r => r.playerId)];
      return { newActive: [], newFinalists: [...confirmedFinalists, ...advancing], eliminated };
    } else {
      // Fewer solvers than needed — all solvers become confirmed, failed keep competing
      const newConfirmed = [...confirmedFinalists, ...solved.map(r => r.playerId)];
      return { newActive: failed.map(r => r.playerId), newFinalists: newConfirmed, eliminated: [] };
    }
  }

  // Everyone solved — eliminate the one(s) with most tries
  const maxTries = Math.max(...results.map(r => r.tries));
  const highest = results.filter(r => r.tries === maxTries);
  const rest = results.filter(r => r.tries < maxTries);

  if (rest.length === 0) {
    // All tied — no elimination
    return { newActive: activePlayers, newFinalists: confirmedFinalists, eliminated: [] };
  }

  if (rest.length >= neededFinalists) {
    return { newActive: rest.map(r => r.playerId), newFinalists: confirmedFinalists, eliminated: highest.map(r => r.playerId) };
  } else {
    // Fewer lower-scorers than needed — rest are confirmed, highest tries compete for remaining spots
    const newConfirmed = [...confirmedFinalists, ...rest.map(r => r.playerId)];
    return { newActive: highest.map(r => r.playerId), newFinalists: newConfirmed, eliminated: [] };
  }
}

// ─── Finals ──────────────────────────────────────────────────────────────────

function startFinals(room, finalists) {
  room.phase = 'finals';
  room.finals = {
    players: finalists.slice(0, 2),
    round: 0,
    scores: {},
    roundScores: [],
  };
  for (const id of room.finals.players) room.finals.scores[id] = 0;

  io.to(room.code).emit('finals_started', {
    finalists: room.finals.players.map(id => ({ id, name: playerName(room, id) })),
  });

  setTimeout(() => startRound(room), 3000);
}

function processFinalsEnd(room, results) {
  const isSuddenDeath = room.finals.round >= 3;
  const [r1, r2] = results;

  if (isSuddenDeath) {
    const winner = resolveSuddenDeath(r1, r2);
    if (winner) {
      endTournament(room, winner);
    } else {
      room.finals.round++;
      setTimeout(() => startRound(room), 3000);
    }
  } else {
    for (const r of results) {
      room.finals.scores[r.playerId] += r.scoreTries;
    }
    room.finals.roundScores.push(results.map(r => ({ id: r.playerId, score: r.scoreTries, solved: r.solved })));

    io.to(room.code).emit('finals_round_scored', {
      round: room.finals.round + 1,
      scores: room.finals.scores,
      roundScores: room.finals.roundScores,
      finalists: room.finals.players.map(id => ({ id, name: playerName(room, id) })),
    });

    room.finals.round++;

    if (room.finals.round >= 3) {
      const [id1, id2] = room.finals.players;
      if (room.finals.scores[id1] !== room.finals.scores[id2]) {
        const winnerId = room.finals.scores[id1] < room.finals.scores[id2] ? id1 : id2;
        setTimeout(() => endTournament(room, winnerId), 4000);
      } else {
        io.to(room.code).emit('sudden_death_start', {
          scores: room.finals.scores,
          finalists: room.finals.players.map(id => ({ id, name: playerName(room, id) })),
        });
        setTimeout(() => startRound(room), 4000);
      }
    } else {
      setTimeout(() => startRound(room), 4000);
    }
  }
}

function resolveSuddenDeath(r1, r2) {
  if (r1.solved && r2.solved) {
    if (r1.tries !== r2.tries) return r1.tries < r2.tries ? r1.playerId : r2.playerId;
    if (r1.solveTimeMs !== null && r2.solveTimeMs !== null && r1.solveTimeMs !== r2.solveTimeMs) {
      return r1.solveTimeMs < r2.solveTimeMs ? r1.playerId : r2.playerId;
    }
    return null; // true tie, play again
  }
  if (r1.solved) return r1.playerId;
  if (r2.solved) return r2.playerId;
  return null; // both failed, play again
}

function endTournament(room, winnerId) {
  room.phase = 'complete';
  io.to(room.code).emit('tournament_complete', {
    winner: { id: winnerId, name: playerName(room, winnerId) },
    finalsScores: room.finals?.scores,
    finalists: room.finals?.players.map(id => ({ id, name: playerName(room, id) })),
  });
}

// ─── Socket handlers ──────────────────────────────────────────────────────────

io.on('connection', socket => {
  socket.on('create_room', ({ playerName: name }) => {
    if (!name?.trim()) return socket.emit('error', { message: 'Name required' });
    const code = genCode();
    const playerId = genId();

    rooms[code] = {
      code,
      adminId: playerId,
      players: [{ id: playerId, socketId: socket.id, name: name.trim(), groupScore: 0 }],
      settings: { roundTimer: 120 },
      phase: 'lobby',
      groupRound: 0,
      groupScores: {},
      currentWord: null,
      roundStartTime: null,
      playerStates: {},
      timerHandle: null,
      tickHandle: null,
      usedWords: [],
      elim: null,
      finals: null,
    };

    socket.join(code);
    socket.data.playerId = playerId;
    socket.data.roomCode = code;

    socket.emit('room_created', {
      code,
      playerId,
      isAdmin: true,
      players: [{ id: playerId, name: name.trim(), isAdmin: true }],
      settings: rooms[code].settings,
    });
  });

  socket.on('join_room', ({ code, playerName: name }) => {
    const uCode = code?.toUpperCase?.().trim();
    const room = rooms[uCode];
    if (!room) return socket.emit('error', { message: 'Room not found' });
    if (room.phase !== 'lobby') return socket.emit('error', { message: 'Tournament already started' });
    if (!name?.trim()) return socket.emit('error', { message: 'Name required' });
    if (room.players.length >= 20) return socket.emit('error', { message: 'Room is full' });

    const playerId = genId();
    room.players.push({ id: playerId, socketId: socket.id, name: name.trim(), groupScore: 0 });

    socket.join(uCode);
    socket.data.playerId = playerId;
    socket.data.roomCode = uCode;

    const playerList = room.players.map(p => ({ id: p.id, name: p.name, isAdmin: p.id === room.adminId }));

    socket.emit('room_joined', {
      code: uCode,
      playerId,
      isAdmin: false,
      players: playerList,
      settings: room.settings,
    });

    socket.to(uCode).emit('player_joined', {
      player: { id: playerId, name: name.trim() },
      players: playerList,
    });
  });

  socket.on('update_settings', ({ roundTimer }) => {
    const room = rooms[socket.data.roomCode];
    if (!room) return;
    const player = playerBySocket(room, socket.id);
    if (!player || player.id !== room.adminId) return;
    room.settings.roundTimer = Math.max(30, Math.min(300, Math.floor(Number(roundTimer)) || 120));
    io.to(room.code).emit('settings_updated', { settings: room.settings });
  });

  socket.on('start_tournament', () => {
    const room = rooms[socket.data.roomCode];
    if (!room) return;
    const player = playerBySocket(room, socket.id);
    if (!player || player.id !== room.adminId) return;
    if (room.players.length < 2) return socket.emit('error', { message: 'Need at least 2 players' });
    if (room.phase !== 'lobby') return;

    room.phase = 'group_stage';
    room.groupRound = 0;
    room.groupScores = {};
    for (const p of room.players) room.groupScores[p.id] = 0;

    io.to(room.code).emit('tournament_started', {
      players: room.players.map(p => ({ id: p.id, name: p.name })),
    });

    setTimeout(() => startRound(room), 2000);
  });

  socket.on('submit_guess', ({ guess }) => {
    const room = rooms[socket.data.roomCode];
    if (!room || !room.currentWord) return;
    const player = playerBySocket(room, socket.id);
    if (!player) return;

    const inRound = activePlayers(room).includes(player.id);
    if (!inRound) return;

    const state = room.playerStates[player.id];
    if (!state || state.solved || state.failed) return;

    const word = (guess || '').toUpperCase().trim();
    if (word.length !== 5) return socket.emit('guess_error', { message: 'Must be 5 letters' });
    if (!isValidWord(word)) return socket.emit('guess_error', { message: 'Not a valid word' });

    const result = checkGuess(word, room.currentWord);
    state.guesses.push(word);
    state.tries++;

    const isCorrect = word === room.currentWord;
    if (isCorrect) {
      state.solved = true;
      state.solveTimeMs = Date.now() - room.roundStartTime;
    } else if (state.tries >= 6) {
      state.failed = true;
    }

    socket.emit('guess_result', {
      guess: word,
      result,
      isCorrect,
      tryNum: state.tries,
      gameOver: state.solved || state.failed,
      word: (state.solved || state.failed) ? room.currentWord : null,
    });

    // Broadcast progress (no letters revealed)
    socket.to(room.code).emit('opponent_progress', {
      playerId: player.id,
      name: player.name,
      tryNum: state.tries,
      solved: state.solved,
      failed: state.failed,
    });

    if (state.solved) {
      io.to(room.code).emit('player_solved', { playerId: player.id, name: player.name, tries: state.tries });
    }

    // Check if all done
    const current = activePlayers(room);
    const allDone = current.every(id => {
      const s = room.playerStates[id];
      return s && (s.solved || s.failed);
    });
    if (allDone) endRound(room);
  });

  socket.on('disconnect', () => {
    const room = roomBySocket(socket.id);
    if (!room) return;
    const player = playerBySocket(room, socket.id);
    if (!player) return;

    // Mark as failed if in active play
    if (room.playerStates?.[player.id]) {
      const s = room.playerStates[player.id];
      if (!s.solved && !s.failed) {
        s.failed = true;
        s.timedOut = true;
        socket.to(room.code).emit('opponent_progress', { playerId: player.id, name: player.name, tryNum: s.tries, solved: false, failed: true });

        const current = activePlayers(room);
        const allDone = current.every(id => {
          const st = room.playerStates[id];
          return st && (st.solved || st.failed);
        });
        if (allDone) endRound(room);
      }
    }

    io.to(room.code).emit('player_disconnected', { playerId: player.id, name: player.name });

    // If lobby, remove player
    if (room.phase === 'lobby') {
      room.players = room.players.filter(p => p.id !== player.id);
      io.to(room.code).emit('player_joined', {
        player: null,
        players: room.players.map(p => ({ id: p.id, name: p.name, isAdmin: p.id === room.adminId })),
      });
    }

    // Clean up empty rooms
    if (room.players.length === 0) delete rooms[room.code];
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Wordle Tournament running at http://localhost:${PORT}`);

  // Keep Render free tier alive by self-pinging every 14 min
  if (process.env.RENDER_EXTERNAL_URL) {
    setInterval(() => {
      const url = process.env.RENDER_EXTERNAL_URL;
      require('https').get(url, r => console.log(`keep-alive ping → ${r.statusCode}`)).on('error', () => {});
    }, 14 * 60 * 1000);
  }
});
