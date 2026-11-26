/* Big screen: lobby with QR, question board with reveal animation, scoreboard, final */
let S = null;
const VIEWS = ['lobby', 'board', 'scores', 'final'];
const show = (v) => VIEWS.forEach((x) => { $('v-' + x).hidden = x !== v; });

/* Keyed list update, so existing chips/rows don't re-animate on every update */
function syncList(container, items) {
  const existing = new Map();
  [...container.children].forEach((el) => (el.dataset.key ? existing.set(el.dataset.key, el) : el.remove()));
  let prev = null;
  items.forEach((it) => {
    let el = existing.get(it.key);
    if (!el) { el = document.createElement('span'); el.dataset.key = it.key; }
    existing.delete(it.key);
    if (el.className !== it.cls) el.className = it.cls;
    if (el.innerHTML !== it.html) el.innerHTML = it.html;
    const want = prev ? prev.nextSibling : container.firstChild;
    if (el !== want) container.insertBefore(el, want);
    prev = el;
  });
  existing.forEach((el) => el.remove());
}

/* ---------- join link + QR ---------- */
(async function setupJoin() {
  let url = location.origin + '/';
  if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) {
    try {
      const r = await fetch('/api/lan').then((x) => x.json());
      if (r.ips && r.ips[0]) url = `${location.protocol}//${r.ips[0]}${location.port ? ':' + location.port : ''}/`;
    } catch (_) { /* keep origin */ }
  }
  $('joinUrl').textContent = url.replace(/^https?:\/\//, '').replace(/\/$/, '');
  $('qr').src = '/api/qr?u=' + encodeURIComponent(url);
})();

/* ---------- lobby ---------- */
function renderLobby(s) {
  syncList($('lobbyTeams'), s.teams.map((t) => ({ key: t.id, cls: 'chip' + (t.online ? '' : ' off'), html: esc(t.name) })));
  $('lobbyFoot').textContent = s.teams.length
    ? `${s.teams.length} group${s.teams.length > 1 ? 's' : ''} ready`
    : 'Waiting for groups to join…';
}

/* ---------- board ---------- */
let boardKey = null;
let revealed = new Set();
let missesShown = false;
let timer = null;
let popRank = null;

function stopTimer() { clearTimeout(timer); timer = null; }

function buildSlots(n) {
  const el = $('slots');
  el.innerHTML = '';
  el.style.gridTemplateRows = `repeat(${Math.ceil(n / 2)}, 1fr)`;
  for (let i = 1; i <= n; i++) {
    const d = document.createElement('div');
    d.className = 'slot' + (i === n ? ' target' : '');
    d.innerHTML = `<span class="n">${i}</span><span class="a"></span><span class="t"></span>`;
    el.appendChild(d);
  }
}

function syncBoard() {
  const s = S;
  const key = s.q + ':' + s.size;
  if (key !== boardKey) {
    boardKey = key;
    buildSlots(s.size);
    revealed = new Set();
    missesShown = false;
    stopTimer();
  }
  $('qNum').textContent = `Question ${s.q + 1}`;
  $('qCat').textContent = s.category || '';

  if (s.phase === 'question') {
    revealed.clear();
    missesShown = false;
    stopTimer();
  } else if (s.phase === 'reveal') {
    const pending = s.slots.some((sl) => sl.teams.length && !revealed.has(sl.rank));
    if (pending && !timer) timer = setTimeout(revealNext, 900);
    if (!pending && !timer) missesShown = true;
  } else {
    stopTimer();
    s.slots.forEach((sl) => { if (sl.teams.length) revealed.add(sl.rank); });
    missesShown = true;
  }
  paintBoard();
}

// Hits pop in one at a time, lowest number first, so #20 comes last
function revealNext() {
  timer = null;
  if (!S || S.phase !== 'reveal') return;
  const next = S.slots.filter((sl) => sl.teams.length && !revealed.has(sl.rank)).sort((a, b) => a.rank - b.rank)[0];
  if (next) {
    revealed.add(next.rank);
    popRank = next.rank;
    paintBoard();
    popRank = null;
    timer = setTimeout(revealNext, 1300);
  } else {
    missesShown = true;
    paintBoard();
  }
}

function paintBoard() {
  const s = S;
  if (!s.slots) return;
  const els = $('slots').children;
  const showAll = s.phase === 'full';
  s.slots.forEach((sl, i) => {
    const el = els[i];
    if (!el) return;
    const hit = sl.teams.length > 0 && revealed.has(sl.rank);
    const listed = !hit && showAll && !!sl.name;
    el.classList.toggle('hit', hit);
    el.classList.toggle('listed', listed);
    const a = hit || listed ? sl.name : '';
    if (el.children[1].textContent !== a) el.children[1].textContent = a;
    const t = hit ? sl.teams.map((n) => `<span>${esc(n)}</span>`).join('') : '';
    if (el.children[2].innerHTML !== t) el.children[2].innerHTML = t;
    if (popRank === sl.rank) {
      el.classList.remove('pop');
      void el.offsetWidth;
      el.classList.add('pop');
    }
  });

  const items = [];
  if (s.phase === 'question') {
    items.push({ key: 'lbl-in', cls: 'label', html: `Answers in: ${s.submittedCount}/${s.teams.length}` });
    s.teams.forEach((t) => items.push({
      key: 't' + t.id,
      cls: 'chip' + (t.submitted ? ' done' : '') + (t.online || t.submitted ? '' : ' off'),
      html: esc(t.name),
    }));
  } else if (missesShown && s.misses) {
    if (s.misses.length) {
      items.push({ key: 'lbl-miss', cls: 'label', html: 'Not on the list' });
      s.misses.forEach((m) => items.push({
        key: 'm' + m.team,
        cls: 'miss',
        html: `<b>${esc(m.team)}</b> ${m.text ? esc(m.text) : '<i>no answer</i>'}`,
      }));
    } else {
      items.push({ key: 'lbl-all', cls: 'label', html: 'Every group made the list!' });
    }
  }
  syncList($('boardFoot'), items);
}

/* ---------- scoreboard + final ---------- */
let scoresKey = null;
function boardRows(list, withBars) {
  const max = Math.max(1, ...list.map((r) => r.score));
  return list.map((r, i) => `
    <li class="${r.place === 1 ? 'first' : ''}" style="animation-delay:${i * 90}ms">
      ${withBars ? `<span class="bar" data-w="${(r.score / max) * 100}" style="width:0"></span>` : ''}
      <span class="p">${r.place}</span><span>${esc(r.name)}</span>
      <span class="r">${r.round != null ? '+' + r.round : ''}</span><span class="s">${r.score}</span>
    </li>`).join('');
}
/* Animated ranking: previous standings -> points count up -> groups slide to their new place */
let rankingFor = null;
let seq = [];
const later = (ms, fn) => seq.push(setTimeout(fn, ms));
const clearSeq = () => { seq.forEach(clearTimeout); seq = []; };
const rowOf = (id) => $('scoreList').querySelector(`li[data-id="${CSS.escape(id)}"]`);

function newRow(r) {
  const li = document.createElement('li');
  li.dataset.id = r.id;
  li.innerHTML = `<span class="bar"></span><span class="p"></span><span class="nm">${esc(r.name)}</span>
    <span class="mv"></span><span class="r"></span><span class="s"></span>`;
  return li;
}
function countUp(el, from, to, ms) {
  const t0 = performance.now();
  const tick = (t) => {
    const k = Math.min(1, (t - t0) / ms);
    el.textContent = Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3)));
    if (k < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
function setRow(li, { place, score, max, lead }) {
  li.querySelector('.p').textContent = place;
  li.querySelector('.s').textContent = score;
  li.querySelector('.bar').style.width = (score / max) * 100 + '%';
  li.classList.toggle('first', !!lead);
}
function showRound(li, r) {
  const el = li.querySelector('.r');
  el.textContent = r.round != null ? '+' + r.round : '';
  el.classList.remove('pop');
  void el.offsetWidth;
  if (r.round) el.classList.add('pop');
}
function showMove(li, move) {
  const el = li.querySelector('.mv');
  el.textContent = move > 0 ? `▲ ${move}` : move < 0 ? `▼ ${-move}` : '';
  el.className = 'mv' + (move > 0 ? ' up' : move < 0 ? ' down' : '');
}

// Moves the rows into the order of `list`, sliding each one from where it was (FLIP)
function slideTo(list, max) {
  const ol = $('scoreList');
  const before = new Map([...ol.children].map((li) => [li.dataset.id, li.getBoundingClientRect().top]));
  const ids = new Set(list.map((r) => r.id));
  [...ol.children].forEach((li) => { if (!ids.has(li.dataset.id)) li.remove(); });
  list.forEach((r) => {
    const li = rowOf(r.id) || newRow(r);
    ol.appendChild(li);
    li.style.animation = 'none';
    setRow(li, { place: r.place, score: r.score, max, lead: r.place === 1 && r.score > 0 });
    showMove(li, r.round != null ? r.prevPlace - r.place : 0);
  });
  [...ol.children].forEach((li) => {
    const was = before.get(li.dataset.id);
    if (was == null) return;
    const dy = was - li.getBoundingClientRect().top;
    if (!dy) return;
    li.style.transition = 'none';
    li.style.transform = `translateY(${dy}px)`;
    li.getBoundingClientRect();
    li.style.transition = 'transform .9s cubic-bezier(.65,0,.35,1)';
    li.style.transform = '';
  });
}

function renderScores(s) {
  const list = s.leaderboard;
  const key = 'scores' + JSON.stringify(list);
  if (key === scoresKey) return;
  scoresKey = key;
  const max = Math.max(1, ...list.map((r) => r.score));
  clearSeq();
  if (rankingFor === s.q) { slideTo(list, max); return; } // a live change (host fixed a match)
  rankingFor = s.q;

  // 1. standings before this question
  const ol = $('scoreList');
  ol.innerHTML = '';
  const prev = [...list].sort((a, b) => a.prevPlace - b.prevPlace || a.name.localeCompare(b.name));
  prev.forEach((r, i) => {
    const li = newRow(r);
    li.style.animationDelay = i * 70 + 'ms';
    setRow(li, { place: r.prevPlace, score: r.prevScore, max, lead: false });
    ol.appendChild(li);
  });
  // 2. this question's points pop in and the totals count up
  later(1200, () => list.forEach((r) => {
    const li = rowOf(r.id);
    if (!li) return;
    showRound(li, r);
    countUp(li.querySelector('.s'), r.prevScore, r.score, 900);
    li.querySelector('.bar').style.width = (r.score / max) * 100 + '%';
  }));
  // 3. everyone slides to the new place
  later(2600, () => slideTo(list, max));
}
function renderFinal(s) {
  const key = 'final' + JSON.stringify(s.leaderboard);
  if (key === scoresKey) return;
  scoresKey = key;
  const lb = s.leaderboard || [];
  const top = lb.filter((r) => r.place === 1);
  $('winner').textContent = top.length ? top.map((r) => r.name).join(' & ') : '—';
  $('winnerPts').textContent = top.length ? `${top[0].score} points` : '';
  $('finalList').innerHTML = boardRows(lb.map((r) => ({ ...r, round: null })), false);
}

/* ---------- main ---------- */
function render(s) {
  S = s;
  $('meta').textContent = s.phase === 'lobby' ? 'Get ready'
    : s.phase === 'final' ? 'Final results'
      : `Question ${s.q + 1} of ${s.total}`;
  if (s.phase !== 'scores' && s.phase !== 'final') scoresKey = null;
  if (s.phase !== 'scores') { rankingFor = null; clearSeq(); }
  if (s.phase === 'lobby') { show('lobby'); renderLobby(s); }
  else if (['question', 'reveal', 'full'].includes(s.phase)) { show('board'); syncBoard(); }
  else if (s.phase === 'scores') { show('scores'); renderScores(s); }
  else if (s.phase === 'final') { show('final'); renderFinal(s); }
}

connect(() => ({ role: 'screen' }), render);
