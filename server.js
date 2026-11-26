'use strict';
/*
 * Top 20 quiz server.
 * One process holds the game. Three pages talk to it in real time (Socket.IO):
 *   /        groups join and send answers from their phones
 *   /screen  the big screen (projector)
 *   /host    the host's controls (PIN protected)
 */
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const { parseQuestions, matchAnswer } = require('./match');

const PORT = Number(process.env.PORT) || 3000;
const HOST_PIN = String(process.env.HOST_PIN || '4720');
const QUESTIONS_FILE = process.env.QUESTIONS_FILE || path.join(__dirname, 'questions.txt');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const BOOT_ID = crypto.randomBytes(6).toString('hex');

/* ------------------------------------------------------------------ */
/* Questions (questions.txt)                                           */
/* ------------------------------------------------------------------ */

let questions = [];
let questionsHash = '';
function loadQuestions() {
  questions = parseQuestions(fs.readFileSync(QUESTIONS_FILE, 'utf8'));
  questionsHash = crypto.createHash('sha1').update(JSON.stringify(questions)).digest('hex').slice(0, 12);
  console.log(`Loaded ${questions.length} questions from ${path.basename(QUESTIONS_FILE)}`);
  questions.forEach((q, i) => {
    if (q.answers.length !== 20) console.warn(`  ! Question ${i + 1} "${q.category}" has ${q.answers.length} answers (expected 20)`);
  });
}

/* ------------------------------------------------------------------ */
/* Game state                                                          */
/* ------------------------------------------------------------------ */
// step 0 = lobby; for each question i: question, reveal, full list, scoreboard; then final.
// subs[q][teamId] = { text, rank (1-20 or null), fuzzy, manual, at }

const freshState = () => ({ questionsHash, step: 0, teams: {}, subs: {} });
let state;

function steps() {
  const s = [{ phase: 'lobby', q: -1 }];
  questions.forEach((_, i) => {
    s.push({ phase: 'question', q: i }, { phase: 'reveal', q: i }, { phase: 'full', q: i }, { phase: 'scores', q: i });
  });
  s.push({ phase: 'final', q: questions.length - 1 });
  return s;
}
function cur() {
  const s = steps();
  state.step = Math.max(0, Math.min(state.step, s.length - 1));
  return s[state.step];
}
const isRevealed = (i) => state.step >= 2 + i * 4;
const isPristine = () => state.step === 0 && Object.keys(state.teams).length === 0;

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(STATE_FILE, JSON.stringify(state));
    } catch (e) {
      console.warn('Could not save state:', e.message);
    }
  }, 250);
}

function loadSavedState() {
  try {
    const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (saved && saved.questionsHash === questionsHash && saved.teams) {
      console.log(`Resumed saved game (${Object.keys(saved.teams).length} groups).`);
      return { questionsHash, step: Number(saved.step) || 0, teams: saved.teams, subs: saved.subs || {} };
    }
  } catch (_) { /* no saved game */ }
  return freshState();
}

function scoreboard() {
  const c = cur();
  const rows = Object.values(state.teams).map((t) => {
    let score = 0;
    let round = null;
    questions.forEach((_, i) => {
      if (!isRevealed(i)) return;
      const s = state.subs[i] && state.subs[i][t.id];
      const pts = s && s.rank ? s.rank : 0;
      score += pts;
      if (i === c.q) round = pts;
    });
    return { id: t.id, name: t.name, score, round };
  });
  rows.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  let place = 0;
  let last = null;
  rows.forEach((r, i) => {
    if (r.score !== last) { place = i + 1; last = r.score; }
    r.place = place;
  });
  return rows;
}

/* ------------------------------------------------------------------ */
/* What each page gets to see                                          */
/* ------------------------------------------------------------------ */

let io;
const onlineCount = (teamId) => {
  const room = io.sockets.adapter.rooms.get('team:' + teamId);
  return room ? room.size : 0;
};

function baseInfo() {
  const c = cur();
  const q = c.q >= 0 ? questions[c.q] : null;
  return {
    phase: c.phase,
    q: c.q,
    total: questions.length,
    category: q && c.phase !== 'lobby' ? q.category : null,
    size: q ? q.answers.length : 20,
  };
}

function screenView() {
  const c = cur();
  const q = c.q >= 0 ? questions[c.q] : null;
  const subs = (q && state.subs[c.q]) || {};
  const teams = Object.values(state.teams).map((t) => ({
    id: t.id, name: t.name, submitted: !!subs[t.id], online: onlineCount(t.id) > 0,
  }));
  let slots = null;
  let misses = null;
  if (q && ['question', 'reveal', 'full', 'scores'].includes(c.phase)) {
    slots = q.answers.map((_, i) => ({ rank: i + 1, name: null, teams: [] }));
    if (c.phase !== 'question') {
      misses = [];
      for (const t of Object.values(state.teams)) {
        const s = subs[t.id];
        if (!s) misses.push({ team: t.name, text: null });
        else if (s.rank) slots[s.rank - 1].teams.push(t.name);
        else misses.push({ team: t.name, text: s.text });
      }
      slots.forEach((sl, i) => {
        if (sl.teams.length || c.phase !== 'reveal') sl.name = q.answers[i].name;
      });
    }
  }
  return {
    ...baseInfo(),
    teams,
    submittedCount: teams.filter((t) => t.submitted).length,
    slots,
    misses,
    leaderboard: c.phase === 'scores' || c.phase === 'final' ? scoreboard() : null,
  };
}

function teamView(teamId) {
  const team = state.teams[teamId];
  if (!team) return { phase: 'join' };
  const c = cur();
  const q = c.q >= 0 ? questions[c.q] : null;
  const s = q && state.subs[c.q] ? state.subs[c.q][teamId] : null;
  const board = scoreboard();
  const me = board.find((r) => r.id === teamId) || { score: 0, place: board.length };
  let result = null;
  if (q && ['full', 'scores'].includes(c.phase)) {
    if (!s) result = { none: true, points: 0 };
    else if (s.rank) result = { rank: s.rank, name: q.answers[s.rank - 1].name, points: s.rank, text: s.text };
    else result = { miss: true, points: 0, text: s.text };
  }
  return {
    ...baseInfo(),
    team: { id: team.id, name: team.name },
    answer: s ? s.text : null,
    result,
    // during the reveal animation the score would spoil the surprise
    score: c.phase === 'reveal' ? null : me.score,
    place: c.phase === 'reveal' ? null : me.place,
    teamCount: board.length,
  };
}

function nextLabel() {
  const n = steps()[state.step + 1];
  if (!n) return null;
  return {
    question: `Start question ${n.q + 1}`,
    reveal: 'Lock answers & reveal',
    full: 'Show the full top 20',
    scores: 'Show scoreboard',
    final: 'Show final results',
  }[n.phase];
}

function hostView() {
  const c = cur();
  const q = c.q >= 0 ? questions[c.q] : null;
  const subs = (q && state.subs[c.q]) || {};
  return {
    ...baseInfo(),
    bootId: BOOT_ID,
    questionsHash,
    categories: questions.map((x) => x.category),
    answers: q ? q.answers.map((a) => a.name) : [],
    teams: Object.values(state.teams).map((t) => ({
      id: t.id, name: t.name, online: onlineCount(t.id), sub: subs[t.id] || null,
    })),
    leaderboard: scoreboard(),
    nextLabel: nextLabel(),
    canBack: state.step > 0,
    pristine: isPristine(),
    backup: state,
  };
}

function broadcast() {
  save();
  const sv = screenView();
  const hv = hostView();
  const tv = {};
  for (const s of io.sockets.sockets.values()) {
    const role = s.data.role;
    if (role === 'screen') s.emit('state', sv);
    else if (role === 'host') s.emit('state', hv);
    else if (role === 'team') {
      const id = s.data.teamId;
      if (id && !state.teams[id]) { s.leave('team:' + id); s.data.teamId = null; }
      s.emit('state', s.data.teamId ? (tv[id] = tv[id] || teamView(id)) : { phase: 'join' });
    }
  }
}

/* ------------------------------------------------------------------ */
/* HTTP + sockets                                                      */
/* ------------------------------------------------------------------ */

loadQuestions();
state = loadSavedState();

const app = express();
const server = http.createServer(app);
io = new Server(server, { pingInterval: 10000, pingTimeout: 20000 });

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.get('/healthz', (_req, res) => res.send('ok'));

// LAN addresses, so phones can join when the server runs on a laptop
app.get('/api/lan', (_req, res) => {
  const ips = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    if (/vethernet|virtual|vmware|wsl|hyper-v|docker|loopback|bluetooth/i.test(name)) continue;
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) ips.push(a.address);
  }
  res.json({ ips });
});

app.get('/api/qr', async (req, res) => {
  const text = String(req.query.u || '').slice(0, 300);
  if (!text) return res.status(400).send('missing u');
  try {
    const svg = await QRCode.toString(text, {
      type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#002B45', light: '#FFFFFF' },
    });
    res.type('image/svg+xml').send(svg);
  } catch (e) {
    res.status(500).send('qr error');
  }
});

const reply = (ack, data) => { if (typeof ack === 'function') ack(data); };
const cleanName = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 24);

function attachTeam(socket, teamId) {
  if (socket.data.teamId) socket.leave('team:' + socket.data.teamId);
  socket.data.role = 'team';
  socket.data.teamId = teamId;
  socket.join('team:' + teamId);
}

io.on('connection', (socket) => {
  // Identity also travels in the handshake, so events sent while reconnecting are accepted
  const a = socket.handshake.auth || {};
  if (a.role === 'screen') socket.data.role = 'screen';
  else if (a.role === 'host' && String(a.pin || '') === HOST_PIN) socket.data.role = 'host';
  else if (a.role === 'team') {
    socket.data.role = 'team';
    if (a.teamId && state.teams[a.teamId]) attachTeam(socket, a.teamId);
  }

  socket.on('hello', (msg, ack) => {
    msg = msg || {};
    if (msg.role === 'screen') {
      socket.data.role = 'screen';
      reply(ack, { ok: true });
      socket.emit('state', screenView());
    } else if (msg.role === 'host') {
      if (String(msg.pin || '') !== HOST_PIN) return reply(ack, { ok: false, error: 'Wrong PIN' });
      socket.data.role = 'host';
      reply(ack, { ok: true });
      socket.emit('state', hostView());
    } else {
      socket.data.role = 'team';
      if (msg.teamId && state.teams[msg.teamId]) {
        attachTeam(socket, msg.teamId);
        reply(ack, { ok: true, team: state.teams[msg.teamId] });
        broadcast();
      } else if (!socket.data.teamId) {
        reply(ack, { ok: false });
        socket.emit('state', { phase: 'join' });
      }
    }
  });

  socket.on('join', (msg, ack) => {
    const name = cleanName(msg && msg.name);
    if (!name) return reply(ack, { ok: false, error: 'Please type a group name.' });
    // Same name = same group (a second phone, or a phone that reloaded)
    let team = Object.values(state.teams).find((t) => t.name.toLowerCase() === name.toLowerCase());
    if (!team) {
      team = { id: crypto.randomBytes(5).toString('hex'), name, joinedAt: Date.now() };
      state.teams[team.id] = team;
    }
    attachTeam(socket, team.id);
    reply(ack, { ok: true, team });
    broadcast();
  });

  // "Switch group" on a phone
  socket.on('leave', (_m, ack) => {
    const id = socket.data.teamId;
    if (id) socket.leave('team:' + id);
    socket.data.teamId = null;
    reply(ack, { ok: true });
    socket.emit('state', { phase: 'join' });
    broadcast();
  });

  socket.on('submit', (msg, ack) => {
    const teamId = socket.data.teamId;
    if (!teamId || !state.teams[teamId]) return reply(ack, { ok: false, error: 'Please join first.' });
    const c = cur();
    if (c.phase !== 'question') return reply(ack, { ok: false, error: 'Answers are locked.' });
    const text = String((msg && msg.text) || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!text) return reply(ack, { ok: false, error: 'Type an answer first.' });
    const m = matchAnswer(text, questions[c.q].answers);
    state.subs[c.q] = state.subs[c.q] || {};
    state.subs[c.q][teamId] = { text, rank: m.rank, fuzzy: m.fuzzy, manual: false, at: Date.now() };
    reply(ack, { ok: true });
    broadcast();
  });

  // ---- host only ----
  const hostOnly = (fn) => (msg, ack) => {
    if (socket.data.role !== 'host') return reply(ack, { ok: false, error: 'Not allowed' });
    fn(msg || {}, ack);
  };

  socket.on('next', hostOnly((_m, ack) => {
    if (state.step < steps().length - 1) state.step++;
    reply(ack, { ok: true });
    broadcast();
  }));

  socket.on('back', hostOnly((_m, ack) => {
    if (state.step > 0) state.step--;
    reply(ack, { ok: true });
    broadcast();
  }));

  // Host corrects a match: rank 1-20, or null = not on the list
  socket.on('override', hostOnly((m, ack) => {
    const q = Number(m.q);
    const sub = state.subs[q] && state.subs[q][m.teamId];
    const max = questions[q] ? questions[q].answers.length : 0;
    if (!sub) return reply(ack, { ok: false, error: 'No answer to change' });
    const r = m.rank === null || m.rank === '' ? null : Number(m.rank);
    if (r !== null && !(r >= 1 && r <= max)) return reply(ack, { ok: false, error: 'Bad rank' });
    sub.rank = r;
    sub.fuzzy = false;
    sub.manual = true;
    reply(ack, { ok: true });
    broadcast();
  }));

  socket.on('removeTeam', hostOnly((m, ack) => {
    delete state.teams[m.teamId];
    for (const q of Object.keys(state.subs)) delete state.subs[q][m.teamId];
    reply(ack, { ok: true });
    broadcast();
  }));

  socket.on('reset', hostOnly((_m, ack) => {
    loadQuestions(); // picks up edits to questions.txt
    state = freshState();
    reply(ack, { ok: true });
    broadcast();
  }));

  // After a server restart the host's browser can put the game back
  socket.on('restore', hostOnly((m, ack) => {
    const b = m.backup;
    if (!b || b.questionsHash !== questionsHash || !b.teams) return reply(ack, { ok: false, error: 'The backup does not match the current questions.' });
    if (!isPristine()) return reply(ack, { ok: false, error: 'A game is already running.' });
    state = { questionsHash, step: Number(b.step) || 0, teams: b.teams, subs: b.subs || {} };
    reply(ack, { ok: true });
    broadcast();
  }));

  socket.on('disconnect', () => {
    if (socket.data.teamId) broadcast();
  });
});

server.listen(PORT, () => {
  console.log(`\nTop 20 quiz running on http://localhost:${PORT}`);
  console.log(`  Big screen: http://localhost:${PORT}/screen`);
  console.log(`  Host:       http://localhost:${PORT}/host   (PIN: ${process.env.HOST_PIN ? 'from HOST_PIN' : HOST_PIN})`);
  console.log(`  Groups:     http://localhost:${PORT}/\n`);
});

