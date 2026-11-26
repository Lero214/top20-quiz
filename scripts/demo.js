/*
 * Demo / rehearsal helper.
 * Resets the game, joins 9 demo groups, presses Next <steps> times (the groups
 * answer every question by themselves) and keeps them connected until Ctrl+C.
 *
 *   node scripts/demo.js [steps] [--url http://localhost:3000] [--pin 4720]
 *
 * steps: 0 lobby · 1 question 1 · 2 reveal · 3 full list · 4 scoreboard · 5 question 2 · …
 * WARNING: it resets the current game. Use it for rehearsals and screenshots only.
 */
const { io } = require('socket.io-client');

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const URL = opt('--url', 'http://localhost:3000');
const PIN = opt('--pin', process.env.HOST_PIN || '4720');
const STEPS = Number(args.find((a) => /^\d+$/.test(a)) || 0);

const NAMES = ['Neurons', 'Coil Crew', 'MagPros', 'Team Pulse', 'Copenhagen', 'Farum FC', 'Brainwaves', 'Tesla Ten', 'Late Comers'];
// What each group aims for (rank on the list, 'miss' = wrong answer, null = no answer).
const PATTERN = [20, 19, 1, 'miss', 17, 4, 19, 9, null];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const call = (s, ev, data) => new Promise((r) => s.timeout(5000).emit(ev, data, (err, res) => r(err ? { ok: false } : res)));

(async () => {
  const host = io(URL, { transports: ['websocket'], auth: (cb) => cb({ role: 'host', pin: PIN }) });
  host.last = null;
  host.on('state', (s) => { host.last = s; });
  const hello = await new Promise((r) => host.on('connect', () => host.emit('hello', { role: 'host', pin: PIN }, r)));
  if (!hello || !hello.ok) { console.error('Wrong host PIN. Use --pin <PIN>.'); process.exit(1); }
  await call(host, 'reset');

  const groups = [];
  for (let i = 0; i < NAMES.length; i++) {
    const g = io(URL, { transports: ['websocket'], auth: (cb) => cb({ role: 'team', teamId: g.teamId || null }) });
    g.on('state', (s) => { g.last = s; });
    const res = await call(g, 'join', { name: NAMES[i] });
    g.teamId = res.team.id;
    groups.push(g);
    await wait(150);
  }

  for (let step = 1; step <= STEPS; step++) {
    await call(host, 'next');
    await wait(300);
    const s = host.last;
    if (s && s.phase === 'question') {
      const list = s.answers;
      for (let i = 0; i < groups.length; i++) {
        const want = PATTERN[(i + s.q) % PATTERN.length];
        if (want === null) continue;
        const text = want === 'miss' ? 'Atlantis' : list[Math.min(want, list.length) - 1];
        await call(groups[i], 'submit', { text });
        await wait(120);
      }
    }
    await wait(500);
  }
  const s = host.last;
  console.log(`Demo ready: ${s.phase}${s.q >= 0 ? ' (question ' + (s.q + 1) + ')' : ''}, ${s.teams.length} groups. Ctrl+C to stop.`);
})().catch((e) => { console.error(e.message); process.exit(1); });
