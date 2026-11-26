'use strict';
/* Reads questions.txt and matches typed answers to the list. */

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/ø/g, 'o').replace(/æ/g, 'ae').replace(/ß/g, 'ss').replace(/œ/g, 'oe')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/^the /, '');
}

function parseQuestions(text) {
  const out = [];
  let cur = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('//')) continue;
    if (line.startsWith('#')) {
      cur = { category: line.replace(/^#+\s*/, '').trim(), answers: [] };
      out.push(cur);
      continue;
    }
    if (!cur) continue;
    // "1. Russia | Russian Federation"  ->  name "Russia", aliases [Russia, Russian Federation]
    const parts = line.replace(/^\d+\s*[.):-]\s*/, '').split('|').map((s) => s.trim()).filter(Boolean);
    if (!parts.length) continue;
    cur.answers.push({ name: parts[0], keys: [...new Set(parts.map(norm).filter(Boolean))] });
  }
  return out.filter((q) => q.category && q.answers.length);
}

/* ------------------------------------------------------------------ */
/* Answer matching: exact (with aliases), then small typos             */
/* ------------------------------------------------------------------ */

function lev(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

// Short words must be exact (Iran vs Iraq), longer ones may have 1-2 typos (Rusia -> Russia).
const allowedTypos = (len) => (len >= 10 ? 2 : len >= 5 ? 1 : 0);

function matchAnswer(text, answers) {
  const t = norm(text);
  if (!t) return { rank: null, fuzzy: false };
  for (let i = 0; i < answers.length; i++) {
    if (answers[i].keys.includes(t)) return { rank: i + 1, fuzzy: false };
  }
  const tn = t.replace(/ /g, '');
  let best = null;
  let bestD = Infinity;
  let ambiguous = false;
  answers.forEach((a, i) => {
    let d = Infinity;
    for (const k of a.keys) {
      const kn = k.replace(/ /g, '');
      if (kn === tn) { d = 0; break; }
      if (kn[0] !== tn[0]) continue;
      const max = allowedTypos(Math.min(kn.length, tn.length));
      if (!max || Math.abs(kn.length - tn.length) > max) continue;
      const dd = lev(kn, tn);
      if (dd <= max && dd < d) d = dd;
    }
    if (d === Infinity) return;
    if (d < bestD) { bestD = d; best = i; ambiguous = false; }
    else if (d === bestD) ambiguous = true;
  });
  if (best === null || ambiguous) return { rank: null, fuzzy: false };
  return { rank: best + 1, fuzzy: bestD > 0 };
}

module.exports = { norm, parseQuestions, matchAnswer };
