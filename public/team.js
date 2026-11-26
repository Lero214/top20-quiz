/* Phone page for groups: join, answer, see result */
const KEY = 'top20.teamId';
const store = {
  get() { try { return localStorage.getItem(KEY); } catch (_) { return null; } },
  set(v) { try { if (v) localStorage.setItem(KEY, v); else localStorage.removeItem(KEY); } catch (_) { /* private mode */ } },
};
let teamId = store.get();
let lastQ = null;
const VIEWS = ['join', 'wait', 'question', 'watch', 'result', 'final'];
const show = (v) => VIEWS.forEach((x) => { $('v-' + x).hidden = x !== v; });

const socket = connect(
  () => ({ role: 'team', teamId }),
  render,
  (res) => { if (res && !res.ok) { teamId = null; store.set(null); } },
);

/* ---------- join ---------- */
$('joinForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('joinName').value.trim();
  if (!name) { $('joinErr').textContent = 'Please type a group name.'; return; }
  $('joinErr').textContent = '';
  socket.timeout(8000).emit('join', { name }, (err, res) => {
    if (err) { $('joinErr').textContent = 'No connection. Try again.'; return; }
    if (!res || !res.ok) { $('joinErr').textContent = (res && res.error) || 'Could not join. Try again.'; return; }
    teamId = res.team.id;
    store.set(teamId);
  });
});

$('leave').addEventListener('click', (e) => {
  e.preventDefault();
  if (!confirm('Switch to another group on this phone?')) return;
  teamId = null;
  store.set(null);
  lastQ = null;
  $('joinName').value = '';
  socket.emit('leave');
});

/* ---------- answer ---------- */
$('answerForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = $('answerInput').value.trim();
  if (!text) { $('answerErr').textContent = 'Type an answer first.'; return; }
  $('answerBtn').disabled = true;
  socket.timeout(8000).emit('submit', { text }, (err, res) => {
    $('answerBtn').disabled = false;
    if (err) { $('answerErr').textContent = 'No connection. Try again.'; return; }
    $('answerErr').textContent = res && res.ok ? '' : (res && res.error) || 'Not sent. Try again.';
    if (res && res.ok) $('answerInput').blur();
  });
});

/* ---------- views ---------- */
function renderQuestion(s) {
  $('qKicker').textContent = `Question ${s.q + 1} of ${s.total}`;
  $('qCat').textContent = s.category;
  if (lastQ !== s.q) {
    lastQ = s.q;
    $('answerInput').value = s.answer || '';
    $('answerErr').textContent = '';
  }
  $('sent').hidden = !s.answer;
  $('sentText').textContent = s.answer || '';
  $('answerBtn').textContent = s.answer ? 'Change answer' : 'Send answer';
}

function renderResult(s) {
  const r = s.result || { none: true, points: 0 };
  const is20 = r.rank && r.rank === s.size;
  let html;
  if (r.rank) {
    html = `<div class="kicker">Your answer</div><div class="ans">${esc(r.name)}</div>
      <div class="big ${is20 ? 'hit20' : ''}">#${r.rank}</div>
      <div class="pts">+${r.points} point${r.points === 1 ? '' : 's'}</div>
      ${is20 ? '<p>Jackpot! 🎯</p>' : ''}`;
  } else if (r.miss) {
    html = `<div class="kicker">Your answer</div><div class="ans">${esc(r.text)}</div>
      <div class="big">✗</div><div class="pts">Not on the list · 0 points</div>`;
  } else {
    html = '<div class="kicker">No answer this time</div><div class="big">–</div><div class="pts">0 points</div>';
  }
  $('resultCard').innerHTML = html;
  $('rScore').textContent = s.score == null ? 0 : s.score;
  $('rPlace').textContent = s.place ? `${ordinal(s.place)} / ${s.teamCount}` : '–';
}

function renderFinal(s) {
  const p = s.place || s.teamCount;
  const msg = p === 1 ? 'You won! 🏆' : p <= 3 ? 'On the podium! 🎉' : 'Thanks for playing!';
  $('finalCard').innerHTML = `<div class="kicker">Final result</div>
    <div class="big ${p === 1 ? 'hit20' : ''}">${ordinal(p)}</div>
    <div class="pts">${s.score} points</div><p>${msg}</p><p class="ans">out of ${s.teamCount} groups</p>`;
}

function render(s) {
  const joined = s.phase !== 'join';
  $('foot').hidden = !joined;
  $('whoName').textContent = joined ? s.team.name : '';
  if (!joined) { show('join'); return; }
  if (s.team.id !== teamId) { teamId = s.team.id; store.set(teamId); }

  switch (s.phase) {
    case 'lobby':
      $('waitTitle').textContent = s.team.name;
      show('wait');
      break;
    case 'question':
      renderQuestion(s);
      show('question');
      break;
    case 'reveal':
      $('watchText').textContent = s.answer ? `Your answer: “${s.answer}”` : 'Your group did not answer this one.';
      show('watch');
      break;
    case 'full':
    case 'scores':
      renderResult(s);
      show('result');
      break;
    case 'final':
      renderFinal(s);
      show('final');
      break;
    default:
      show('wait');
  }
}
