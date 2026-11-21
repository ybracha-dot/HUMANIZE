// Finds the changes between what's in the document now and the updated
// version, as a short list of human-sized edits: a word swapped, a phrase
// rewritten, a comma added, a letter fixed. Unchanged text is never touched.
//
// How: line up the paragraphs first (unchanged paragraphs are skipped
// entirely), then compare changed paragraphs word by word, then shrink each
// change to the letters that actually differ when that's what a person would
// do ("walk" -> "walked" just types "ed").

import { graphemes } from './text.js';

const isWordChar = (g) => /[\p{L}\p{N}]/u.test(g);
const isApostrophe = (g) => g === "'" || g === '’';
const isSpace = (g) => /^[ \t ]+$/.test(g);

// Words, runs of spaces, single newlines and single other characters.
// tokens.join('') always equals the input.
export function tokenize(text) {
  const gs = graphemes(text);
  const out = [];
  let i = 0;
  while (i < gs.length) {
    const g = gs[i];
    let j = i + 1;
    if (isWordChar(g)) {
      while (j < gs.length && (isWordChar(gs[j]) || (isApostrophe(gs[j]) && j + 1 < gs.length && isWordChar(gs[j + 1])))) j++;
    } else if (isSpace(g)) {
      while (j < gs.length && isSpace(gs[j])) j++;
    }
    out.push(gs.slice(i, j).join(''));
    i = j;
  }
  return out;
}

// Longest common subsequence: index pairs [i, j] where x[i] === y[j].
function lcsMatches(x, y) {
  const n = x.length;
  const m = y.length;
  const W = m + 1;
  const dp = new Uint32Array((n + 1) * W);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * W + j] = x[i] === y[j] ? dp[(i + 1) * W + j + 1] + 1 : Math.max(dp[(i + 1) * W + j], dp[i * W + j + 1]);
    }
  }
  const pairs = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (dp[(i + 1) * W + j] >= dp[i * W + j + 1]) i++;
    else j++;
  }
  return pairs;
}

// Same, but trims the shared start and end first and gives up (no matches)
// on enormous middles, which then just get replaced.
function matchesTrimmed(x, y, cap) {
  let p = 0;
  while (p < x.length && p < y.length && x[p] === y[p]) p++;
  let q = 0;
  while (q < x.length - p && q < y.length - p && x[x.length - 1 - q] === y[y.length - 1 - q]) q++;
  const pairs = [];
  for (let k = 0; k < p; k++) pairs.push([k, k]);
  const mx = x.slice(p, x.length - q);
  const my = y.slice(p, y.length - q);
  if (mx.length && my.length && mx.length * my.length <= cap) {
    for (const [i, j] of lcsMatches(mx, my)) pairs.push([i + p, j + p]);
  }
  for (let k = 0; k < q; k++) pairs.push([x.length - q + k, y.length - q + k]);
  return pairs;
}

function splitLines(tokens) {
  const lines = [];
  let cur = [];
  for (const t of tokens) {
    cur.push(t);
    if (t === '\n') {
      lines.push(cur);
      cur = [];
    }
  }
  if (cur.length) lines.push(cur);
  return lines;
}

// Turns a token-level comparison of one changed region into raw edits.
function regionEdits(ta, tb, base, out) {
  const pairs = matchesTrimmed(ta, tb, 2_500_000);
  let i = 0;
  let j = 0;
  let pos = base;
  const flush = (ui, uj) => {
    // tokens ta[i..ui) are removed and tb[j..uj) are added, at pos
    if (ui === i && uj === j) return;
    const removed = ta.slice(i, ui).join('');
    out.push({ s: pos, e: pos + removed.length, text: tb.slice(j, uj).join('') });
    pos += removed.length;
  };
  for (const [mi, mj] of [...pairs, [ta.length, tb.length]]) {
    flush(mi, mj);
    if (mi < ta.length) pos += ta[mi].length;
    i = mi + 1;
    j = mj + 1;
  }
}

// Two edits split by a single space become one phrase edit ("big red" -> "large brown").
function mergeNeighbors(edits, a) {
  const out = [];
  for (const h of edits) {
    const prev = out[out.length - 1];
    if (prev) {
      const gap = a.slice(prev.e, h.s);
      const merged = h.e - prev.s;
      if (/^[ \t]+$/.test(gap) && merged <= 40 && (prev.text.length + gap.length + h.text.length) <= 60 && prev.e > prev.s && h.e > h.s) {
        prev.text = prev.text + gap + h.text;
        prev.e = h.e;
        continue;
      }
    }
    out.push({ ...h });
  }
  return out;
}

// Shrink an edit to the letters that differ, when that's the natural fix:
// "colour" -> "color" deletes one letter instead of retyping the word.
function tighten(h, a) {
  const oldStr = a.slice(h.s, h.e);
  if (!oldStr || !h.text) return h;
  const og = graphemes(oldStr);
  const ng = graphemes(h.text);
  let p = 0;
  while (p < og.length && p < ng.length && og[p] === ng[p]) p++;
  let q = 0;
  while (q < og.length - p && q < ng.length - p && og[og.length - 1 - q] === ng[ng.length - 1 - q]) q++;
  if (!p && !q) return h;
  const midOld = og.length - p - q;
  const midNew = ng.length - p - q;
  const longest = Math.max(og.length, ng.length);
  if (!((midOld <= 3 && midNew <= 3) || (p + q) / longest >= 0.5)) return h;
  const pre = og.slice(0, p).join('').length;
  const suf = og.slice(og.length - q).join('').length;
  return { s: h.s + pre, e: h.e - suf, text: ng.slice(p, ng.length - q).join('') };
}

// How natural a spot is for the edge of an edit, from 0 (inside a word) up to
// 6 (the very start or end of the document).
function edgeScore(one, two) {
  if (!one || !two) return 6;
  const c1 = one[one.length - 1];
  const c2 = two[0];
  const n1 = !/[\p{L}\p{N}]/u.test(c1);
  const n2 = !/[\p{L}\p{N}]/u.test(c2);
  const w1 = n1 && /\s/.test(c1);
  const w2 = n2 && /\s/.test(c2);
  const l1 = w1 && c1 === '\n';
  const l2 = w2 && c2 === '\n';
  if ((l1 && /\n\n$/.test(one)) || (l2 && /^\n\n/.test(two))) return 5;
  if (l1 || l2) return 4;
  if (n1 && !w1 && w2) return 3; // right after a sentence or clause ends
  if (w1 || w2) return 2;
  if (n1 || n2) return 1;
  return 0;
}

const firstG = (s) => (s ? graphemes(s.slice(0, 32))[0] || '' : '');
const lastG = (s) => (s ? graphemes(s.slice(-32)).pop() || '' : '');

// An addition or a cut can often sit in several spots with the same result:
// '(Miller 301)' + '. More' + '.' reads the same as '(Miller 301).' + ' More.'.
// Slide each one to the spot a person would choose (after the period, at a
// word or line edge), never into a neighboring edit.
function slide(edits, a) {
  return edits.map((h, k) => {
    const minP = k ? edits[k - 1].e + 1 : 0;
    const maxP = k < edits.length - 1 ? edits[k + 1].s - 1 : a.length;
    if (h.s === h.e && h.text) {
      const score = (p, x) => edgeScore(a.slice(Math.max(0, p - 3), p), x) + edgeScore(x, a.slice(p, p + 3));
      let p = h.s;
      let x = h.text;
      for (;;) {
        const g = lastG(x);
        if (!g || g !== lastG(a.slice(Math.max(0, p - 32), p)) || p - g.length < minP) break;
        x = g + x.slice(0, x.length - g.length);
        p -= g.length;
      }
      let best = { s: p, e: p, text: x, score: score(p, x) };
      for (;;) {
        const g = firstG(x);
        if (!g || g !== firstG(a.slice(p, p + 32)) || p + g.length > maxP) break;
        x = x.slice(g.length) + g;
        p += g.length;
        const sc = score(p, x);
        if (sc >= best.score) best = { s: p, e: p, text: x, score: sc };
      }
      return { s: best.s, e: best.e, text: best.text };
    }
    if (!h.text && h.e > h.s) {
      const score = (s, e) => edgeScore(a.slice(Math.max(0, s - 3), s), a.slice(s, e)) + edgeScore(a.slice(s, e), a.slice(e, e + 3));
      let { s, e } = h;
      for (;;) {
        const g = lastG(a.slice(Math.max(0, s - 32), s));
        if (!g || g !== lastG(a.slice(Math.max(0, e - 32), e)) || s - g.length < minP) break;
        s -= g.length;
        e -= g.length;
      }
      let best = { s, e, score: score(s, e) };
      for (;;) {
        const g = firstG(a.slice(s, s + 32));
        if (!g || g !== firstG(a.slice(e, e + 32)) || e + g.length > maxP) break;
        s += g.length;
        e += g.length;
        const sc = score(s, e);
        if (sc >= best.score) best = { s, e, score: sc };
      }
      return { s: best.s, e: best.e, text: '' };
    }
    return h;
  });
}

export function applyEdits(text, edits) {
  let out = '';
  let last = 0;
  for (const h of edits) {
    out += text.slice(last, h.s) + h.text;
    last = h.e;
  }
  return out + text.slice(last);
}

const norm = (t) => String(t ?? '').replace(/\r\n?/g, '\n');

// Returns { old, new, edits } where each edit replaces old[s, e) with text.
export function diffTexts(oldText, newText) {
  const a = norm(oldText);
  const b = norm(newText);
  const LA = splitLines(tokenize(a));
  const LB = splitLines(tokenize(b));
  const sa = LA.map((l) => l.join(''));
  const sb = LB.map((l) => l.join(''));
  const offsets = [];
  let o = 0;
  for (const s of sa) {
    offsets.push(o);
    o += s.length;
  }
  offsets.push(o);

  const raw = [];
  let pi = 0;
  let pj = 0;
  for (const [i, j] of [...matchesTrimmed(sa, sb, 4_000_000), [LA.length, LB.length]]) {
    if (i > pi || j > pj) regionEdits(LA.slice(pi, i).flat(), LB.slice(pj, j).flat(), offsets[pi], raw);
    pi = i + 1;
    pj = j + 1;
  }
  const edits = slide(mergeNeighbors(raw, a).map((h) => tighten(h, a)).filter((h) => h.e > h.s || h.text), a);
  if (applyEdits(a, edits) !== b) {
    // Never expected; keep the promise of an exact result anyway.
    return { old: a, new: b, edits: a === b ? [] : [{ s: 0, e: a.length, text: b }] };
  }
  return { old: a, new: b, edits };
}

export function describeEdit(h, a) {
  const from = a.slice(h.s, h.e);
  const kind = !from ? 'add' : !h.text ? 'cut' : 'change';
  return { from, to: h.text, kind };
}

// The Editor's comparison. Trailing blank lines are left out on both sides (an
// export can add or drop one), so edits never reach past the end of the text.
// Characters a Google Doc has that can't be typed: a page break (\f) and a
// picture or footnote mark (￼). Each takes one arrow-key step, so they
// stay in the document text, but they're left out of the comparison and every
// edit is placed around them, never through them.
const HIDDEN = /[\f￼]/g;

// Curly and straight quotes compare equal when looseQuotes is on (Google Docs
// turns typed quotes curly anyway), so a quote style alone is never an edit.
const QUOTE_OF = { '‘': "'", '’': "'", '‚': "'", '‛': "'", '“': '"', '”': '"', '„': '"', '‟': '"' };
export const plainQuotes = (t) => t.replace(/[‘-‟]/g, (c) => QUOTE_OF[c] || c);

function looseDiff(a, b) {
  // Swapping quotes keeps every position the same, so edits found on the plain
  // versions take their new text from the real updated version.
  const d = diffTexts(plainQuotes(a), plainQuotes(b));
  let shift = 0;
  const edits = d.edits.map((h) => {
    const at = h.s + shift;
    shift += h.text.length - (h.e - h.s);
    return { s: h.s, e: h.e, text: b.slice(at, at + h.text.length) };
  });
  return { old: a, new: applyEdits(a, edits), edits };
}

// Moves edits found on the text without hidden characters onto the real text.
// spots: where each hidden character sits, counted in the text without them.
function placeAround(edits, spots) {
  const before = (p, orEqual) => {
    let n = 0;
    while (n < spots.length && (orEqual ? spots[n] <= p : spots[n] < p)) n++;
    return n;
  };
  const out = [];
  for (const h of edits) {
    if (h.s === h.e) {
      // An addition goes before any hidden characters at that spot.
      const r = h.s + before(h.s, false);
      out.push({ s: r, e: r, text: h.text });
      continue;
    }
    let s = h.s + before(h.s, true);
    const e = h.e + before(h.e, false);
    let text = h.text;
    spots.forEach((p, k) => {
      if (p <= h.s || p >= h.e) return;
      const real = p + k; // a hidden character inside the range: step over it
      if (real > s) {
        out.push({ s, e: real, text });
        text = '';
      }
      s = real + 1;
    });
    if (e > s || text) out.push({ s, e: Math.max(e, s), text });
  }
  return out;
}

export function editorDiff(current, updated, { looseQuotes = false, trimEnd = true } = {}) {
  const cur = norm(current);
  // Blank lines at the very end are left alone, unless every character counts.
  const trailing = trimEnd ? cur.match(/\n*$/)[0] : '';
  const body = cur.slice(0, cur.length - trailing.length);
  const spots = [];
  let plain = body;
  if (/[\f￼]/.test(body)) {
    plain = '';
    for (let i = 0; i < body.length; i++) {
      const c = body[i];
      if (c === '\f' || c === '￼') spots.push(plain.length);
      else plain += c;
    }
  }
  const target = trimEnd ? norm(updated).replace(HIDDEN, '').replace(/\n+$/, '') : norm(updated).replace(HIDDEN, '');
  const d = looseQuotes ? looseDiff(plain, target) : diffTexts(plain, target);
  if (!spots.length) return { ...d, trailing, before: cur, after: d.new + trailing };
  const edits = placeAround(d.edits, spots);
  const afterBody = applyEdits(body, edits);
  // Leaving out the hidden characters again must give exactly the plain result.
  if (afterBody.replace(HIDDEN, '') !== d.new) throw new Error("These changes couldn't be placed around the page breaks or pictures.");
  return { old: body, new: afterBody, edits, trailing, before: cur, after: afterBody + trailing };
}
