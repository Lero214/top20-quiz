/*
 * End-to-end test: starts the server, plays a full game with 9 groups,
 * a host and a big screen, and checks matching, scoring, reconnects and restarts.
 * Run: npm test
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { io } = require('socket.io-client');
const assert = require('assert');

const PORT = 3999;
const URL = `http://localhost:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'top20-'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let srv;

function startServer() {
  return new Promise((resolve, reject) => {
    srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
      env: { ...process.env, PORT, HOST_PIN: 'test', DATA_DIR },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    srv.stdout.on('data', (d) => { if (String(d).includes('running')) resolve(); });
    srv.stderr.on('data', (d) => process.stderr.write(d));
    srv.on('exit', (c) => c && reject(new Error('server exited ' + c)));
  });
}
const stopServer = () => new Promise((r) => { srv.once('exit', r); srv.kill(); });

function client(hello) {
  const s = io(URL, { transports: ['websocket'], forceNew: true, reconnectionDelay: 200, auth: (cb) => cb(hello()) });
  s.last = null;
  s.on('state', (st) => { s.last = st; });
  s.on('connect', () => s.emit('hello', hello()));
  return s;
}
const call = (s, ev, data) => new Promise((r) => s.emit(ev, data, r));
async function until(fn, label, ms = 3000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { if (fn()) return; } catch (_) { /* retry */ } await wait(25); }
  throw new Error('Timed out waiting for: ' + label);
}

(async () => {
  // ---- pure matching checks ----
  const { matchAnswer, parseQuestions } = require('../match');
  const qs = parseQuestions(fs.readFileSync(path.join(__dirname, '..', 'questions.txt'), 'utf8'));
  assert.ok(qs.length >= 1, 'questions parsed');
  qs.forEach((q) => assert.strictEqual(q.answers.length, 20, `${q.category} has 20 answers`));
  const A = qs[0].answers;
  const cases = [
    ['Peru', 19], ['peru ', 19], ['Chad', 20], ['Russia', 1], ['Rusia', 1], ['USA', 4], ['the united states', 4],
    ['Brasil', 5], ['Kazakstan', 9], ['DRC', 11], ['Iraq', null], ['Austria', null], ['Niger', null], ['', null],
  ];
  for (const [txt, want] of cases) assert.strictEqual(matchAnswer(txt, A).rank, want, `match "${txt}"`);
  assert.strictEqual(matchAnswer('Rusia', A).fuzzy, true);
  console.log(`✓ matching (${cases.length} cases) and ${qs.length} questions with 20 answers each`);

  // ---- live game ----
  await startServer();
  const host = client(() => ({ role: 'host', pin: 'test' }));
  const screen = client(() => ({ role: 'screen' }));
  const bad = client(() => ({ role: 'host', pin: 'nope' }));
  await until(() => host.last && screen.last, 'host + screen state');
  assert.strictEqual(host.last.phase, 'lobby');
  assert.strictEqual((await call(bad, 'next')).ok, false, 'wrong PIN cannot control the game');

  const names = ['Neurons', 'Coil Crew', 'MagPros', 'Team Pulse', 'Copenhagen', 'Farum FC', 'Brainwaves', 'Tesla Ten', 'Late Comers'];
  const teams = [];
  for (const n of names) {
    const t = client(() => ({ role: 'team', teamId: t.teamId || null }));
    const res = await call(t, 'join', { name: n });
    assert.ok(res.ok, 'join ' + n);
    t.teamId = res.team.id;
    teams.push(t);
  }
  await until(() => screen.last.teams.length === 9, 'screen shows 9 groups');
  // second phone for the same group joins the same team
  const phone2 = client(() => ({ role: 'team', teamId: null }));
  const r2 = await call(phone2, 'join', { name: 'neurons' });
  assert.strictEqual(r2.team.id, teams[0].teamId, 'same name = same group');
  console.log('✓ 9 groups joined, second phone merged into its group');

  // answering before the game starts is refused
  assert.strictEqual((await call(teams[0], 'submit', { text: 'Chad' })).ok, false);

  // ---- question 1 ----
  await call(host, 'next');
  await until(() => teams.every((t) => t.last.phase === 'question'), 'teams see question 1');
  assert.ok(!('answers' in teams[0].last) && !JSON.stringify(teams[0].last).includes('Chad'), 'phones never get the list');
  assert.ok(screen.last.slots.every((s) => s.name === null), 'screen slots empty during question');
  const answers = ['Chad', 'Peru', 'Rusia', 'Austria', 'Iraq', 'usa', 'Peru', 'Kazakstan'];
  for (let i = 0; i < answers.length; i++) assert.ok((await call(teams[i], 'submit', { text: answers[i] })).ok);
  await call(teams[3], 'submit', { text: 'Australia' }); // a group changes its mind
  await until(() => screen.last.submittedCount === 8, 'screen counts 8 answers');
  const sub = (i) => host.last.teams.find((t) => t.id === teams[i].teamId).sub;
  assert.strictEqual(sub(0).rank, 20);
  assert.strictEqual(sub(2).rank, 1);
  assert.strictEqual(sub(2).fuzzy, true);
  await until(() => sub(3).rank === 6, 'changed answer counts');
  assert.strictEqual(sub(4).rank, null, 'Iraq is not Iran');
  // host decides "Iraq" should count as Iran (#17)
  assert.ok((await call(host, 'override', { q: 0, teamId: teams[4].teamId, rank: 17 })).ok);
  await until(() => sub(4).rank === 17 && sub(4).manual, 'override applied');
  console.log('✓ question 1: answers matched (incl. typos), host override works');

  // ---- reveal ----
  await call(host, 'next');
  await until(() => screen.last.phase === 'reveal', 'screen reveal');
  assert.strictEqual((await call(teams[8], 'submit', { text: 'Chad' })).ok, false, 'locked after reveal');
  const slot = (r) => screen.last.slots[r - 1];
  assert.deepStrictEqual(slot(20).teams, ['Neurons']);
  assert.deepStrictEqual(slot(19).teams.sort(), ['Brainwaves', 'Coil Crew']);
  assert.strictEqual(slot(19).name, 'Peru');
  assert.strictEqual(slot(2).name, null, 'unpicked answers stay hidden during reveal');
  assert.ok(screen.last.misses.some((m) => m.team === 'Late Comers' && m.text === null));
  assert.strictEqual(teams[0].last.phase, 'reveal');
  assert.strictEqual(teams[0].last.score, null, 'no spoiler on phones during reveal');

  await call(host, 'next'); // full list
  await until(() => screen.last.phase === 'full' && slot(2).name === 'Canada', 'full list');
  await until(() => teams[0].last.result && teams[0].last.result.points === 20, 'phone result');
  assert.strictEqual(teams[2].last.result.points, 1);
  assert.strictEqual(teams[8].last.result.none, true);

  await call(host, 'next'); // scoreboard
  await until(() => screen.last.phase === 'scores', 'scores');
  const lb = screen.last.leaderboard;
  assert.strictEqual(lb[0].name, 'Neurons');
  assert.strictEqual(lb[0].score, 20);
  assert.strictEqual(lb[1].score, 19);
  assert.strictEqual(lb[1].place, 2);
  assert.strictEqual(lb[2].place, 2, 'ties share a place');
  console.log('✓ reveal, full list and scoreboard correct (20 for Chad, 19 for Peru, ties shared)');

  // ---- phone reconnect + server restart mid-game ----
  teams[1].disconnect();
  await wait(100);
  teams[1].connect();
  await until(() => teams[1].last.phase === 'scores' && teams[1].last.team.name === 'Coil Crew', 'phone rejoins after reconnect');
  await wait(400); // let the state file be written
  await stopServer();
  host.last = null;
  await startServer();
  await until(() => host.last && host.last.phase === 'scores' && host.last.teams.length === 9, 'game resumed after restart', 8000);
  console.log('✓ phones reconnect, game survives a server restart');

  // ---- play the remaining questions quickly ----
  const total = host.last.total;
  for (let q = 1; q < total; q++) {
    await call(host, 'next');
    await until(() => host.last.phase === 'question' && host.last.q === q, 'question ' + (q + 1));
    const last = qs[q].answers[19].name;
    assert.ok((await call(teams[5], 'submit', { text: last })).ok);
    for (let k = 0; k < 3; k++) await call(host, 'next');
  }
  await call(host, 'next');
  await until(() => screen.last.phase === 'final', 'final');
  const fin = screen.last.leaderboard;
  assert.strictEqual(fin[0].name, 'Farum FC');
  assert.strictEqual(fin[0].score, 4 + 20 * (total - 1));
  await until(() => teams[5].last.phase === 'final' && teams[5].last.place === 1, 'winner phone');
  console.log(`✓ final: ${fin[0].name} wins with ${fin[0].score} points`);

  // ---- back button + reset ----
  await call(host, 'back');
  await until(() => host.last.phase === 'scores', 'back works');
  await call(host, 'reset');
  await until(() => host.last.phase === 'lobby' && host.last.teams.length === 0 && host.last.pristine, 'reset');
  await until(() => teams[0].last.phase === 'join', 'phones go back to join after reset');
  console.log('✓ back and reset work');

  [host, screen, bad, phone2, ...teams].forEach((s) => s.close());
  await stopServer();
  console.log('\nALL TESTS PASSED');
  process.exit(0);
})().catch(async (e) => {
  console.error('\nTEST FAILED:', e.message);
  if (srv) srv.kill();
  process.exit(1);
});
