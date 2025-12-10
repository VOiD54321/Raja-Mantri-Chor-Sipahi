// server.js
// Simple backend for Raja-Mantri-Chor-Sipahi
// In-memory storage. Testable with Postman / curl.

const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { nanoid } = require('nanoid');

const app = express();
app.use(cors());
app.use(bodyParser.json());

// ----- CONFIG -----
const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 4;
const DEFAULT_POINTS = { Raja: 1000, Mantri: 800, Sipahi: 500, Chor: 0 };

// ----- In-memory storage -----
/*
rooms: {
  [roomId]: {
    id,
    name,
    players: [{ id, name, joinedAt }],
    seatsAssigned: boolean,
    waitlist: [{id,name}],
    currentRound: {
      roundNumber,
      roles: { playerId: role },   // assigned for this round
      rolePoints: { playerId: points }, // points for this round (before scoring)
      guessedByMantri: null | {mantriId, guessedId, correct:bool, resolved:bool, resolvedAt}
      completed: boolean
    },
    cumulativeScores: { playerId: totalPoints },
    createdAt
  }
}
*/
const rooms = {};

// ----- Helpers -----
function shuffleArray(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function ensureRoom(roomId) {
  const r = rooms[roomId];
  if (!r) {
    const err = new Error('Room not found');
    err.code = 404;
    throw err;
  }
  return r;
}

function roleForPlayer(room, playerId) {
  const round = room.currentRound;
  if (!round || !round.roles) return null;
  return round.roles[playerId] || null;
}

function assignRolesToRoom(room) {
  if (room.players.length < MAX_PLAYERS) {
    const err = new Error(`Need ${MAX_PLAYERS} players to assign roles.`);
    err.code = 400;
    throw err;
  }
  const roles = ['Raja', 'Mantri', 'Chor', 'Sipahi'];
  shuffleArray(roles);

  // map playerId -> role
  const mapping = {};
  for (let i = 0; i < MAX_PLAYERS; i++) {
    const pid = room.players[i].id;
    mapping[pid] = roles[i];
  }

  // assign base role points for the round
  const rolePoints = {};
  for (const pid of room.players.map(p => p.id)) {
    const r = mapping[pid];
    rolePoints[pid] = DEFAULT_POINTS[r] ?? 0;
  }

  // initialize round object
  room.currentRound = {
    roundNumber: (room.currentRound?.roundNumber || 0) + 1,
    roles: mapping,
    rolePoints,
    guessedByMantri: null,
    completed: false,
    assignedAt: Date.now(),
  };

  // ensure cumulativeScores keys exist
  for (const p of room.players) {
    if (!room.cumulativeScores[p.id]) room.cumulativeScores[p.id] = 0;
  }

  return room.currentRound;
}

// ----- API Endpoints -----

// POST /room/create
// Body: { name?: string, playerName: string }
// Response: { roomId, playerId, player }
app.post('/room/create', (req, res) => {
  const { playerName, name } = req.body || {};
  if (!playerName) return res.status(400).json({ error: 'playerName required' });

  const roomId = nanoid(8);
  const playerId = nanoid(10);
  const player = { id: playerId, name: playerName, joinedAt: Date.now() };

  const room = {
    id: roomId,
    name: name || `Room-${roomId}`,
    players: [player],
    seatsAssigned: false,
    waitlist: [],
    currentRound: null,
    cumulativeScores: {},
    createdAt: Date.now()
  };
  rooms[roomId] = room;

  return res.json({ roomId, playerId, player, roomMeta: { id: roomId, name: room.name } });
});

// POST /room/join
// Body: { roomId, playerName }
// Response: { roomId, playerId, assigned: boolean, message }
app.post('/room/join', (req, res) => {
  const { roomId, playerName } = req.body || {};
  if (!roomId || !playerName) return res.status(400).json({ error: 'roomId and playerName required' });

  const room = rooms[roomId];
  if (!room) return res.status(404).json({ error: 'Room not found' });

  // if player already present (by name), allow multiple with same name but different id
  const playerId = nanoid(10);
  const player = { id: playerId, name: playerName, joinedAt: Date.now() };

  if (room.players.length < MAX_PLAYERS) {
    room.players.push(player);
    // initialize cumulative entry
    if (!room.cumulativeScores[playerId]) room.cumulativeScores[playerId] = 0;

    // If now exactly 4 players, auto-assign roles
    let autoAssigned = false;
    if (room.players.length === MAX_PLAYERS) {
      assignRolesToRoom(room);
      autoAssigned = true;
    }

    return res.json({ roomId, playerId, player, assigned: autoAssigned, currentPlayers: room.players.map(p => ({ id: p.id, name: p.name })) });
  } else {
    // add to waitlist
    room.waitlist.push(player);
    return res.status(200).json({ roomId, playerId, player, assigned: false, message: 'Room full — added to waitlist', waitlistPosition: room.waitlist.length });
  }
});

// GET /room/players/:roomId
// Response: [ { id, name } ]
app.get('/room/players/:roomId', (req, res) => {
  const { roomId } = req.params;
  try {
    const room = ensureRoom(roomId);
    const players = room.players.map(p => ({ id: p.id, name: p.name }));
    return res.json({ roomId, players, waitlistCount: room.waitlist.length });
  } catch (err) {
    return res.status(err.code || 500).json({ error: err.message });
  }
});

// POST /room/assign/:roomId
// System/Admin: forces random role assignment (if 4 players present)
// Response: currentRound info
app.post('/room/assign/:roomId', (req, res) => {
  const { roomId } = req.params;
  try {
    const room = ensureRoom(roomId);
    if (room.players.length < MAX_PLAYERS) return res.status(400).json({ error: `Need ${MAX_PLAYERS} players to assign roles` });
    const round = assignRolesToRoom(room);
    return res.json({ roomId, round });
  } catch (err) {
    return res.status(err.code || 500).json({ error: err.message });
  }
});

// GET /role/me/:roomId/:playerId
// Individual: see only your role (returns null if roles not assigned)
app.get('/role/me/:roomId/:playerId', (req, res) => {
  const { roomId, playerId } = req.params;
  try {
    const room = ensureRoom(roomId);
    const player = room.players.find(p => p.id === playerId) || room.waitlist.find(p => p.id === playerId);
    if (!player) return res.status(404).json({ error: 'Player not in room or waitlist' });

    const role = roleForPlayer(room, playerId);
    return res.json({ roomId, playerId, name: player.name, role: role || null, roundNumber: room.currentRound?.roundNumber || null });
  } catch (err) {
    return res.status(err.code || 500).json({ error: err.message });
  }
});

// POST /guess/:roomId
// Body: { mantriId, guessedId }
// Only Mantri can post. This resolves the round and updates scoring
app.post('/guess/:roomId', (req, res) => {
  const { roomId } = req.params;
  const { mantriId, guessedId } = req.body || {};
  if (!mantriId || !guessedId) return res.status(400).json({ error: 'mantriId and guessedId required' });

  try {
    const room = ensureRoom(roomId);
    const round = room.currentRound;
    if (!round) return res.status(400).json({ error: 'No active round. Assign roles first.' });
    if (round.completed) return res.status(400).json({ error: 'Round already resolved' });

    const mantriRole = round.roles[mantriId];
    if (mantriRole !== 'Mantri') return res.status(403).json({ error: 'Only the player who is Mantri may make the guess.' });

    const guessedRole = round.roles[guessedId];
    if (!guessedRole) return res.status(404).json({ error: 'Guessed player not found in this round' });

    const correct = (guessedRole === 'Chor');

    // scoring logic:
    // - Default points are in round.rolePoints
    // - If correct -> points remain as-is (Mantri & Sipahi keep points)
    // - If incorrect -> Chor steals Mantri's points: Chor += MantriPoints; MantriPoints -> 0
    let roundPointsBefore = { ...round.rolePoints };
    let roundPointsAfter = { ...round.rolePoints };

    if (!correct) {
      // find chor (there's exactly 1)
      const chorId = Object.keys(round.roles).find(pid => round.roles[pid] === 'Chor');
      if (chorId) {
        const mantriPoints = roundPointsAfter[mantriId] || 0;
        roundPointsAfter[mantriId] = 0;
        roundPointsAfter[chorId] = (roundPointsAfter[chorId] || 0) + mantriPoints;
      }
    }

    // commit round: add to cumulativeScores and mark completed
    for (const pid of Object.keys(roundPointsAfter)) {
      const pts = roundPointsAfter[pid] || 0;
      room.cumulativeScores[pid] = (room.cumulativeScores[pid] || 0) + pts;
    }

    round.guessedByMantri = {
      mantriId,
      guessedId,
      correct,
      resolvedAt: Date.now()
    };
    round.rolePointsBefore = roundPointsBefore;
    round.rolePointsAfter = roundPointsAfter;
    round.completed = true;

    // optionally, after resolving, move one from waitlist into players if available
    if (room.waitlist.length > 0 && room.players.length < MAX_PLAYERS) {
      const next = room.waitlist.shift();
      room.players.push(next);
      if (!room.cumulativeScores[next.id]) room.cumulativeScores[next.id] = 0;
    }

    return res.json({
      roomId,
      roundNumber: round.roundNumber,
      result: { correct, mantriId, guessedId },
      rolePointsBefore,
      rolePointsAfter,
      cumulative: room.cumulativeScores
    });
  } catch (err) {
    return res.status(err.code || 500).json({ error: err.message });
  }
});

// GET /result/:roomId
// All players: show roles and points for last round + cumulative
app.get('/result/:roomId', (req, res) => {
  const { roomId } = req.params;
  try {
    const room = ensureRoom(roomId);
    const round = room.currentRound;
    if (!round) return res.status(400).json({ error: 'No round assigned yet' });

    // Build list of players with roles and per-round points (if completed)
    const players = room.players.map(p => {
      const pid = p.id;
      return {
        id: pid,
        name: p.name,
        role: round.roles ? round.roles[pid] || null : null,
        pointsThisRoundBefore: round.rolePointsBefore ? (round.rolePointsBefore[pid] || 0) : (round.rolePoints ? (round.rolePoints[pid] || 0) : null),
        pointsThisRoundAfter: round.rolePointsAfter ? (round.rolePointsAfter[pid] || 0) : null,
        cumulative: room.cumulativeScores[pid] || 0
      };
    });

    return res.json({
      roomId,
      roundNumber: round.roundNumber,
      completed: !!round.completed,
      guessed: round.guessedByMantri || null,
      players
    });
  } catch (err) {
    return res.status(err.code || 500).json({ error: err.message });
  }
});

// GET /leaderboard/:roomId
// cumulative scores
app.get('/leaderboard/:roomId', (req, res) => {
  const { roomId } = req.params;
  try {
    const room = ensureRoom(roomId);
    const board = Object.entries(room.cumulativeScores).map(([pid, pts]) => {
      const p = room.players.find(x => x.id === pid) || room.waitlist.find(x => x.id === pid) || { name: 'Unknown' };
      return { playerId: pid, name: p.name, points: pts };
    }).sort((a, b) => b.points - a.points);
    return res.json({ roomId, leaderboard: board });
  } catch (err) {
    return res.status(err.code || 500).json({ error: err.message });
  }
});

// POST /room/next/:roomId
// Prepare next round: clear current roles (keeps cumulative scores and players).
// If there are enough players, assign immediately.
app.post('/room/next/:roomId', (req, res) => {
  const { roomId } = req.params;
  try {
    const room = ensureRoom(roomId);

    // Prevent calling next while a round is active and not completed
    if (room.currentRound && !room.currentRound.completed) {
      return res.status(400).json({ error: 'Current round not completed. Resolve guess first.' });
    }

    // If players < 4, just clear currentRound and wait
    if (room.players.length < MAX_PLAYERS) {
      room.currentRound = null;
      // If waitlist has players and there is space, move them in
      while (room.players.length < MAX_PLAYERS && room.waitlist.length > 0) {
        const next = room.waitlist.shift();
        room.players.push(next);
        if (!room.cumulativeScores[next.id]) room.cumulativeScores[next.id] = 0;
      }
      return res.json({ roomId, message: 'Waiting for players', players: room.players.map(p => ({ id: p.id, name: p.name })) });
    }

    // Otherwise assign roles for new round
    const newRound = assignRolesToRoom(room);
    return res.json({ roomId, newRound });
  } catch (err) {
    return res.status(err.code || 500).json({ error: err.message });
  }
});

// Basic health endpoint
app.get('/', (req, res) => {
  res.json({ ok: true, description: 'Raja-Mantri-Chor-Sipahi backend', version: '1.0' });
});

// start server
app.listen(PORT, () => {
  console.log(`RMCS backend listening at http://localhost:${PORT}`);
});
