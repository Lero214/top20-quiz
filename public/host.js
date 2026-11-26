/* Host controls: step through the game, fix matches, manage groups */
const PIN_KEY = 'top20.hostPin';
const BACKUP_KEY = 'top20.backup';
const ls = {
  get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
  set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (_) { /* ignore */ } },
};
let pin = ls.get(PIN_KEY) || '';
let S = null;
let restoreDismissed = false;
let pendingTeams = false;

function onHello(res) {
  if (res && res.ok) {
    ls.set(PIN_KEY, pin);
    $('pinForm').hidden = true;
    $('main').hidden = false;
  } else {
    $('main').hidden = true;
    $('pinForm').hidden = false;
    $('pinErr').textContent = pin ? 'Wrong PIN, try again.' : '';
  }
}
const socket = connect(() => ({ role: 'host', pin }), render, onHello);

$('pinForm').addEventListener('submit', (e) => {
  e.preventDefault();
  pin = $('pinInput').value.trim();
  socket.emit('hello', { role: 'host', pin }, onHello);
});

/* ---------- links ---------- */
(async function links() {
  let origin = location.origin;
  if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) {
    try {
      const r = await fetch('/api/lan').then((x) => x.json());
      if (r.ips && r.ips[0]) origin = `${location.protocol}//${r.ips[0]}${location.port ? ':' + location.port : ''}`;
    } catch (_) { /* keep */ }
  }
  $('joinLink').textContent = origin + '/';
  $('screenLink').textContent = origin + '/screen';
})();

/* ---------- controls ---------- */
let busy = false;
function go(event) {
  if (busy) return;
  if (event === 'next' && S && S.phase === 'question') {
    const missing = S.teams.filter((t) => !t.sub).length;
    if (missing && !confirm(`${missing} group${missing > 1 ? 's have' : ' has'} not answered yet. Lock the answers anyway?`)) return;
  }
  busy = true;
  setTimeout(() => { busy = false; }, 400); // no accidental double steps
  socket.emit(event);
}
$('nextBtn').addEventListener('click', () => go('next'));
$('backBtn').addEventListener('click', () => go('back'));
// Presenter clickers send PageDown/PageUp or arrow keys
document.addEventListener('keydown', (e) => {
  if ($('main').hidden || /INPUT|SELECT|TEXTAREA/.test((document.activeElement || {}).tagName)) return;
  if (['ArrowRight', 'PageDown'].includes(e.key)) { e.preventDefault(); if (S && S.nextLabel) go('next'); }
  if (['ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault(); if (S && S.canBack) go('back'); }
});

$('subs').addEventListener('change', (e) => {
  const sel = e.target.closest('select[data-team]');
  if (!sel || !S) return;
  socket.emit('override', { q: S.q, teamId: sel.dataset.team, rank: sel.value === '' ? null : Number(sel.value) });
  sel.blur();
});
$('subs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-remove]');
  if (!b) return;
  if (confirm(`Remove group "${b.dataset.name}"? Their points are removed too.`)) socket.emit('removeTeam', { teamId: b.dataset.remove });
});
$('subs').addEventListener('focusout', () => setTimeout(() => { if (pendingTeams && S) renderTeams(S); }, 0));

$('resetBtn').addEventListener('click', () => {
  if (!confirm('Reset the game? All groups and points are cleared and questions.txt is read again.')) return;
  ls.set(BACKUP_KEY, null);
  restoreDismissed = true;
  socket.emit('reset');
});

/* ---------- backup / restore after a server restart ---------- */
function describeStep(step, total) {
  if (!step) return 'in the lobby';
  if (step > total * 4) return 'at the final results';
  return `at question ${Math.floor((step - 1) / 4) + 1}`;
}
function handleBackup(s) {
  if (!s.pristine) {
    restoreDismissed = false;
    ls.set(BACKUP_KEY, JSON.stringify(s.backup));
    $('restore').hidden = true;
    return;
  }
  let b = null;
  try { b = JSON.parse(ls.get(BACKUP_KEY) || 'null'); } catch (_) { b = null; }
  const usable = b && b.teams && Object.keys(b.teams).length && b.questionsHash === s.questionsHash;
  if (usable && !restoreDismissed) {
    $('restoreText').textContent = `The server restarted and the game was cleared. This browser kept a copy (${Object.keys(b.teams).length} groups, ${describeStep(b.step, s.total)}). Restore it?`;
    $('restore').hidden = false;
  } else {
    $('restore').hidden = true;
  }
}
$('restoreYes').addEventListener('click', () => {
  let b = null;
  try { b = JSON.parse(ls.get(BACKUP_KEY) || 'null'); } catch (_) { b = null; }
  socket.emit('restore', { backup: b }, (res) => { if (!res || !res.ok) alert((res && res.error) || 'Could not restore.'); });
});
$('restoreNo').addEventListener('click', () => {
  restoreDismissed = true;
  ls.set(BACKUP_KEY, null);
  $('restore').hidden = true;
});

/* ---------- rendering ---------- */
const PHASE = { lobby: 'Lobby', question: 'Groups are answering', reveal: 'Revealing on screen', full: 'Full list on screen', scores: 'Scoreboard on screen', final: 'Final results' };

function hintFor(s) {
  const n = s.teams.length;
  const answered = s.teams.filter((t) => t.sub).length;
  switch (s.phase) {
    case 'lobby': return `${n} group${n === 1 ? '' : 's'} joined. Explain the rules, then start question 1.`;
    case 'question': return `${answered} of ${n} groups answered. Check the "Counts as" column, then lock and reveal.`;
    case 'reveal': return 'Answers pop up one by one on the big screen. You can still fix a match.';
    case 'full': return 'The whole top 20 is on the big screen now.';
    case 'scores': return 'The scoreboard is on the big screen.';
    case 'final': return 'The winner is on the big screen. 🎉';
    default: return '';
  }
}

function renderTeams(s) {
  const a = document.activeElement;
  if (a && a.closest && a.closest('#subs') && a.tagName === 'SELECT') { pendingTeams = true; return; }
  pendingTeams = false;
  const showAns = s.q >= 0 && !['lobby', 'final'].includes(s.phase);
  $('teamsTitle').textContent = `Groups (${s.teams.length})`;
  $('noTeams').hidden = s.teams.length > 0;
  let html = s.teams.length ? `<tr><th>Group</th>${showAns ? '<th>Answer</th><th>Counts as</th>' : ''}<th></th></tr>` : '';
  for (const t of s.teams) {
    html += `<tr><td><span class="dot ${t.online ? 'on' : ''}" title="${t.online ? 'online' : 'offline'}"></span>${esc(t.name)}</td>`;
    if (showAns) {
      if (t.sub) {
        const opts = ['<option value="">✗ Not on the list</option>']
          .concat(s.answers.map((x, i) => `<option value="${i + 1}" ${t.sub.rank === i + 1 ? 'selected' : ''}>${i + 1}. ${esc(x)}</option>`))
          .join('');
        const cls = t.sub.rank ? (t.sub.fuzzy ? 'fuzzy' : '') : 'miss';
        html += `<td>${esc(t.sub.text)}${t.sub.fuzzy ? '<span class="tag">typo?</span>' : ''}${t.sub.manual ? '<span class="tag">fixed</span>' : ''}</td>`;
        html += `<td><select data-team="${t.id}" class="${cls}">${opts}</select></td>`;
      } else {
        html += '<td class="empty">waiting…</td><td></td>';
      }
    }
    html += `<td style="text-align:right"><button class="x" title="Remove group" data-remove="${t.id}" data-name="${esc(t.name)}">✕</button></td></tr>`;
  }
  $('subs').innerHTML = html;
}

function renderAnswers(s) {
  const visible = s.answers.length > 0 && !['lobby', 'final'].includes(s.phase);
  $('answersCard').hidden = !visible;
  if (!visible) return;
  const by = {};
  s.teams.forEach((t) => { if (t.sub && t.sub.rank) (by[t.sub.rank] = by[t.sub.rank] || []).push(t.name); });
  $('answerList').innerHTML = s.answers.map((x, i) => {
    const who = by[i + 1];
    return `<li class="${who ? 'taken' : ''} ${i + 1 === s.answers.length ? 'is20' : ''}"><span class="n">${i + 1}</span>
      <span>${esc(x)}${who ? ` <span class="who">← ${who.map(esc).join(', ')}</span>` : ''}</span></li>`;
  }).join('');
}

function renderBoard(s) {
  $('hboard').innerHTML = s.leaderboard.length
    ? s.leaderboard.map((r) => `<li><span>${r.place}. ${esc(r.name)}</span><b>${r.score}${r.round != null ? ` <small>(+${r.round})</small>` : ''}</b></li>`).join('')
    : '<li class="empty">No groups yet</li>';
}

function render(s) {
  S = s;
  handleBackup(s);
  $('phaseLabel').textContent = ['lobby', 'final'].includes(s.phase) ? PHASE[s.phase] : `Question ${s.q + 1} of ${s.total} · ${PHASE[s.phase]}`;
  $('hCat').textContent = s.category || (s.phase === 'lobby' ? 'Waiting for groups to join' : 'Game over');
  $('hint').textContent = hintFor(s);
  $('nextBtn').textContent = s.nextLabel ? s.nextLabel + '  ▶' : 'Game over';
  $('nextBtn').disabled = !s.nextLabel;
  $('backBtn').disabled = !s.canBack;
  renderTeams(s);
  renderAnswers(s);
  renderBoard(s);
  $('qInfo').textContent = `${s.total} questions loaded from questions.txt: ${s.categories.join(' · ')}`;
}
