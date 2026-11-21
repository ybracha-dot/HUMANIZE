// Turns the rough draft into a timed list of keystrokes:
//   1. type each paragraph's rough draft sentence by sentence, with typos that
//      get noticed and backspaced, and the odd word swapped mid-sentence;
//   2. pause to reread, then walk the cursor back and fix every rough-draft edit;
//   3. move on to the next paragraph.
// Every action is { d: ms to wait before it, k?: key, g?: text, sh?: shift held,
// s?: status line for the UI, ev?: event name for the UI counters }.

import { graphemes, glen, splitSentences, findWords, matchCase, isCapitalized } from './text.js';
import { makeRng } from './rng.js';
import { makeDraft } from './degrade.js';
import { alternativeFor } from './lexicon.js';
import { neighborOf } from './keyboard.js';
import { diffTexts, editorDiff } from './diff.js';

// Every pause is a range in seconds: each one is picked at random between Min and Max.
export const PAUSES = ['sentencePause', 'paragraphPause', 'commaPause', 'citationPause', 'reviewPause', 'editTime'];

export const DEFAULT_SETTINGS = {
  wpm: 60, // typing speed while actually typing
  sentencePauseMin: 1,
  sentencePauseMax: 4,
  paragraphPauseMin: 4,
  paragraphPauseMax: 12,
  commaPauseMin: 0.2, // after commas, semicolons and colons
  commaPauseMax: 0.9,
  citationPauseMin: 1, // after a quote, before "(Miller 10)"
  citationPauseMax: 3,
  reviewPauseMin: 2, // after a paragraph is written, before going back to fix it
  reviewPauseMax: 6,
  editTimeMin: 1.5, // thinking time before each revision
  editTimeMax: 4.5,
  typoRate: 4, // % of words with a typo
  roughness: 35, // 0-100, how rough the first draft is
  variation: 35, // % rhythm variation
  secondThoughts: 8, // % of sentences where a word gets swapped mid-typing
  countdown: 3, // seconds before typing starts
};

// Accepts old single-value settings ({ sentencePause: 2.5 }) as well as ranges.
export function normalizeSettings(input = {}) {
  const s = { ...DEFAULT_SETTINGS, ...input };
  for (const key of PAUSES) {
    if (typeof input[key] === 'number' && input[`${key}Min`] == null) {
      s[`${key}Min`] = input[key] * 0.6;
      s[`${key}Max`] = input[key] * 1.4;
    }
    s[`${key}Min`] = Math.max(0, Number(s[`${key}Min`]) || 0);
    s[`${key}Max`] = Math.max(s[`${key}Min`], Number(s[`${key}Max`]) || 0);
  }
  return s;
}

// Keeps the real typing speed close to the WPM slider (measured in tests).
const SPEED_CAL = 1.03;

const FAST_BIGRAMS = new Set(
  'th he in er an re on at en nd ti es or te of ed is it al ar st to nt ng se ha as ou io le ve co me de hi ri ro ic ne ea ra ce li ch ll be ma si om ur'.split(' '),
);

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

class PlanBuilder {
  constructor(settings, r) {
    this.s = settings;
    this.r = r;
    this.actions = [];
    this.ms = { typing: 0, thinking: 0, editing: 0 };
    this.phase = 'typing';
    this.prev = '';
    this.charMs = 60000 / (Math.max(5, settings.wpm) * 5) / SPEED_CAL;
    this.sigma = 0.06 + (clamp(settings.variation, 0, 100) / 100) * 0.7;
    const editMean = (settings.editTimeMin + settings.editTimeMax) / 2;
    this.repeatMs = clamp(editMean * 9, 7, 34);
    this.repeatDelay = clamp(editMean * 110, 160, 420);
    // Long cursor trips stay short, the way a person would just click there.
    this.maxTripMs = 900 + editMean * 400;
    this.counts = { typos: 0, rethinks: 0 };
    this.citeAt = null;
  }

  // A pause picked at random between the setting's Min and Max, in ms.
  between(key) {
    const lo = this.s[`${key}Min`];
    const hi = this.s[`${key}Max`];
    if (!(hi > 0)) return 0;
    return (lo + (hi - lo) * this.r()) * 1000;
  }

  thinkPause(key, label) {
    const ms = this.between(key);
    if (!ms) return;
    const phase = this.phase;
    this.phase = 'thinking';
    this.wait(ms, label);
    this.phase = phase;
  }

  push(a) {
    this.actions.push(a);
    this.ms[this.phase] += a.d;
  }

  say(text, extra = {}) {
    this.actions.push({ d: 0, s: text, ...extra });
  }

  event(ev) {
    this.actions.push({ d: 0, ev });
  }

  wait(ms, label) {
    if (!(ms > 0)) return;
    const a = { d: Math.round(ms) };
    if (label) a.s = label;
    this.push(a);
  }

  key(k, d, extra) {
    this.push({ k, d: Math.round(Math.max(0, d)), ...extra });
  }

  charDelay(prev, g) {
    let m = 1;
    const lower = g.toLowerCase();
    const pl = prev.toLowerCase();
    if (/^\p{L}$/u.test(g)) {
      if (FAST_BIGRAMS.has(pl + lower)) m *= 0.75;
      else if (pl === lower) m *= 0.85;
      if (prev === '' || prev === ' ' || prev === '\n') m *= 1.25;
      if (g !== lower) m *= 1.4;
    } else if (g === ' ') {
      m *= 0.9;
    } else if (/^\p{N}$/u.test(g)) {
      m *= 1.45;
    } else {
      m *= 1.5;
    }
    if (g === ' ' && /[,;:]/.test(prev)) m *= 1.8;
    let d = this.r.lognormal(this.charMs * m, this.sigma);
    if (this.r.chance(0.012)) d += this.r.lognormal(450, 0.5);
    return clamp(d, 16, 6000);
  }

  typeG(g) {
    const d = this.charDelay(this.prev, g);
    if (g === '\n') this.key('enter', d);
    else this.key('type', d, { g });
    this.prev = g;
  }

  typePlain(text) {
    for (const g of graphemes(text)) this.typeG(g);
  }

  // ---- typos -------------------------------------------------------------

  makeTypo(gs) {
    const r = this.r;
    const isLetter = (g) => /^[A-Za-z]$/.test(g);
    const letters = [];
    for (let i = 0; i < gs.length; i++) if (isLetter(gs[i])) letters.push(i);
    if (letters.length < 2) return null;
    const late = letters.filter((i) => i > 0);
    const kinds = [['sub', 40], ['swap', 24], ['skip', 14], ['double', 10], ['extra', 7], ['shift', 5]];
    for (let attempt = 0; attempt < 8; attempt++) {
      const kind = r.weighted(kinds, (k) => k[1])[0];
      if (kind === 'sub') {
        const i = late.length && r.chance(0.85) ? r.pick(late) : r.pick(letters);
        const nb = neighborOf(gs[i], r);
        if (nb) return { i, wrong: [nb], used: 1 };
      } else if (kind === 'swap') {
        const opts = letters.filter((i) => i + 1 < gs.length && isLetter(gs[i + 1])
          && gs[i].toLowerCase() !== gs[i + 1].toLowerCase() && (i > 0 || gs[0] === gs[0].toLowerCase()));
        if (opts.length) {
          const i = r.pick(opts);
          return { i, wrong: [gs[i + 1], gs[i]], used: 2 };
        }
      } else if (kind === 'skip') {
        if (late.length) return { i: r.pick(late), wrong: [], used: 1 };
      } else if (kind === 'double') {
        const i = r.pick(late.length ? late : letters);
        return { i, wrong: [gs[i], gs[i]], used: 1 };
      } else if (kind === 'extra') {
        const i = r.pick(letters);
        const nb = neighborOf(gs[i], r);
        if (nb) return { i, wrong: i > 0 && r.chance(0.5) ? [nb, gs[i]] : [gs[i], nb], used: 1 };
      } else if (kind === 'shift') {
        if (gs.length >= 3 && /^[A-Z]$/.test(gs[0]) && /^[a-z]$/.test(gs[1])) {
          return { i: 1, wrong: [gs[1].toUpperCase()], used: 1 };
        }
      }
    }
    return null;
  }

  // Type the slip, keep going a few letters, notice, backspace, retype.
  // Slips are always caught inside the word, before the space, so editors
  // with autocorrect never get a chance to "fix" them first.
  typeTypo(gs, t) {
    const r = this.r;
    const { i, wrong, used } = t;
    for (let j = 0; j < i; j++) this.typeG(gs[j]);
    for (const g of wrong) this.typeG(g);
    const rest = gs.length - (i + used);
    let k = r.weighted([[0, 35], [1, 30], [2, 20], [3, 10], [4, 5]], (x) => x[1])[0];
    if (wrong.length === 0) k = Math.max(k, 1);
    k = Math.min(k, rest);
    for (let j = 0; j < k; j++) this.typeG(gs[i + used + j]);
    const back = wrong.length + k;
    this.counts.typos++;
    this.wait(r.lognormal(back ? 380 : 300, 0.4));
    for (let j = 0; j < back; j++) {
      this.key('back', j === 0 ? r.lognormal(120, 0.3) : r.lognormal(95, 0.25), j === 0 ? { ev: 'typo' } : undefined);
    }
    if (!back) this.event('typo');
    this.wait(r.lognormal(160, 0.35));
    this.prev = i > 0 ? gs[i - 1] : '';
    for (let j = i; j < gs.length; j++) this.typeG(gs[j]);
  }

  typeWord(word, { typoScale = 1 } = {}) {
    const gs = graphemes(word);
    if (gs.length >= 8 && this.r.chance(0.2)) this.wait(this.r.lognormal(260, 0.5));
    const p = (this.s.typoRate / 100) * typoScale;
    if (gs.length >= 2 && p > 0 && this.r.chance(p)) {
      const t = this.makeTypo(gs);
      if (t) {
        this.typeTypo(gs, t);
        return;
      }
    }
    for (const g of gs) this.typeG(g);
  }

  // A word typed, reconsidered, deleted and replaced ("big" -> "significant").
  rethink(word, alt) {
    const r = this.r;
    for (const g of graphemes(alt)) this.typeG(g);
    const phase = this.phase;
    this.phase = 'thinking';
    this.wait(r.lognormal(650, 0.45));
    this.phase = phase;
    const n = glen(alt);
    for (let j = 0; j < n; j++) {
      this.key('back', j === 0 ? r.lognormal(140, 0.3) : r.lognormal(85, 0.25), j === 0 ? { ev: 'rethink' } : undefined);
    }
    this.wait(r.lognormal(220, 0.35));
    this.prev = ' ';
    for (const g of graphemes(word)) this.typeG(g);
    this.counts.rethinks++;
  }

  typeText(text, opts) {
    const words = findWords(text);
    let pos = 0;
    for (const w of words) {
      this.typePlain(text.slice(pos, w.s));
      this.typeWord(w.w, opts);
      pos = w.e;
    }
    this.typePlain(text.slice(pos));
  }

  // Types text[from, to) with the paragraph's absolute positions in hand, so it
  // can stop before a citation to "look up the page number".
  typeGap(text, from, to) {
    let i = from;
    for (const g of graphemes(text.slice(from, to))) {
      if (this.citeAt?.has(i)) this.thinkPause('citationPause', 'Checking the source…');
      this.typeG(g);
      i += g.length;
    }
  }

  // One sentence of the rough draft. Quotes and citations get typos like
  // anything else, but never a mid-typing word swap.
  typeSentence(text, a, b, shielded) {
    const words = findWords(text.slice(a, b)).map((w) => ({ ...w, s: w.s + a, e: w.e + a }));
    const inside = (pos) => shielded.some(([s, e]) => pos >= s && pos < e);
    let target = -1;
    let alt = null;
    if (this.s.secondThoughts > 0 && this.r.chance(this.s.secondThoughts / 100)) {
      const options = [];
      words.forEach((w, i) => {
        if (i === 0 || isCapitalized(w.w) || inside(w.s)) return;
        const x = alternativeFor(w.lw);
        if (x) options.push([i, matchCase(w.w, x)]);
      });
      if (options.length) [target, alt] = this.r.pick(options);
    }
    let pos = a;
    words.forEach((w, i) => {
      this.typeGap(text, pos, w.s);
      const gap = text.slice(pos, w.s);
      const citeInGap = this.citeAt && [...this.citeAt].some((x) => x >= pos && x < w.s);
      if (i > 0 && /[,;:]/.test(gap) && /\s$/.test(gap) && !citeInGap) this.thinkPause('commaPause');
      if (i === target) this.rethink(w.w, alt);
      else this.typeWord(w.w);
      pos = w.e;
    });
    this.typeGap(text, pos, b);
  }

  typeParagraph(para, label, p) {
    const text = para.draft;
    const quotes = para.quotesD || [];
    const cites = para.citesD || [];
    const shielded = [...quotes, ...cites.map((c) => [c.pauseAt, c.e])];
    this.citeAt = new Set(cites.map((c) => c.pauseAt));
    splitSentences(text).forEach(([a, b], k) => {
      // A quote that holds several sentences is copied in one go.
      const midQuote = quotes.some(([s, e]) => a > s && a < e);
      if (k > 0 && text.slice(a, b).trim() && !midQuote) this.thinkPause('sentencePause', 'Thinking about the next sentence…');
      this.say(`Typing ${label}`, { p });
      this.typeSentence(text, a, b, shielded);
    });
    this.citeAt = null;
  }

  // ---- cursor movement -----------------------------------------------------

  // One tap per key for short hops; otherwise hold the key and let it repeat.
  hold(k, n, extra, repeatMs = this.repeatMs) {
    const r = this.r;
    if (n <= 3) {
      for (let j = 0; j < n; j++) this.key(k, r.lognormal(150, 0.3), extra);
      return;
    }
    this.key(k, r.lognormal(150, 0.3), extra);
    this.key(k, r.lognormal(this.repeatDelay, 0.12), extra);
    for (let j = 2; j < n; j++) this.key(k, repeatMs * (0.85 + 0.3 * r()), extra);
  }

  travel(from, to) {
    const n = Math.abs(to - from);
    if (!n) return;
    const repeat = clamp(Math.min(this.repeatMs, this.maxTripMs / n), 4, 34);
    this.hold(to < from ? 'left' : 'right', n, undefined, repeat);
  }

  backspaces(n) {
    if (n <= 6) {
      for (let j = 0; j < n; j++) this.key('back', this.r.lognormal(j ? 105 : 160, 0.28));
    } else {
      this.hold('back', n);
    }
  }

  // ---- revision ------------------------------------------------------------

  revise(para, label, p) {
    const { edits } = para;
    if (!edits.length) return;
    const r = this.r;
    // The pause between finishing the paragraph and starting to fix it.
    this.phase = 'thinking';
    this.push({ d: Math.round(this.between('reviewPause')), s: `Rereading ${label}…`, p });
    this.phase = 'editing';
    let cursor = glen(para.draft);
    let delta = 0;
    edits.forEach((ed, j) => {
      const start = ed.dsG + delta;
      const end = start + ed.draftG;
      this.push({
        d: Math.round(Math.max(120, this.between('editTime'))),
        s: `Revising ${label}`,
        p,
        fix: { from: ed.draft, to: ed.orig, type: ed.type, label: ed.label, n: j + 1, of: edits.length },
      });
      this.travel(cursor, end);
      if (ed.draftG > 0) {
        const selectIt = ed.draftG > 12 || (ed.draftG > 6 && r.chance(0.4));
        if (selectIt) {
          this.hold('left', ed.draftG, { sh: 1 });
          if (!ed.orig) this.key('back', r.lognormal(160, 0.3));
        } else {
          this.backspaces(ed.draftG);
        }
      }
      if (ed.orig) {
        this.prev = '';
        this.typeText(ed.orig, { typoScale: 0.5 });
      }
      this.event('fix');
      cursor = start + ed.origG;
      delta += ed.origG - ed.draftG;
      this.wait(r.lognormal(260, 0.4));
    });
    this.travel(cursor, glen(para.original));
    this.phase = 'typing';
  }

  build(draft) {
    const paras = draft.paragraphs;
    const total = paras.filter((p) => p.original.trim()).length;
    let shown = 0;
    paras.forEach((p, idx) => {
      if (idx > 0) {
        this.phase = 'typing';
        for (let j = 0; j < paras[idx - 1].sep.length; j++) this.key('enter', this.r.lognormal(this.charMs * 2.2, 0.3));
        this.prev = '\n';
      }
      if (!p.original.trim()) {
        this.typePlain(p.original);
        return;
      }
      shown++;
      const label = total > 1 ? `paragraph ${shown} of ${total}` : 'your text';
      this.phase = 'thinking';
      if (shown > 1) this.thinkPause('paragraphPause', 'Thinking about the next paragraph…');
      else this.wait(this.r.lognormal(500, 0.3), 'Getting started…');
      this.phase = 'typing';
      this.say(`Typing ${label}`, { p: shown });
      this.typeParagraph(p, label, shown);
      this.revise(p, label, shown);
    });
    const last = paras[paras.length - 1];
    for (let j = 0; j < last.sep.length; j++) this.key('enter', this.r.lognormal(this.charMs * 2.2, 0.3));
    this.say('Done', { done: true });
  }

  // ---- editor: apply changes to a finished document ------------------------

  // Longer additions read like writing: sentence, paragraph and comma pauses.
  typeAddition(text) {
    if (findWords(text).length <= 3) {
      this.typeText(text, { typoScale: 0.5 });
      return;
    }
    text.split(/(\n+)/).forEach((part, i) => {
      if (i % 2 === 1) {
        for (let k = 0; k < part.length; k++) this.key('enter', this.r.lognormal(this.charMs * 2.2, 0.3));
        this.prev = '\n';
        return;
      }
      if (!part) return;
      if (i > 0 && part.trim()) {
        this.thinkPause('paragraphPause', 'Thinking about the next paragraph…');
        this.say('Typing new text');
      }
      splitSentences(part).forEach(([x, y], k) => {
        if (k > 0 && part.slice(x, y).trim() && this.s.sentencePauseMax > 0) {
          this.thinkPause('sentencePause', 'Thinking about the next sentence…');
          this.say('Typing new text');
        }
        this.typeSentence(part, x, y, []);
      });
    });
  }

  buildEdits(diff) {
    const { edits, old: a } = diff;
    const total = edits.length;
    this.phase = 'thinking';
    this.wait(this.r.lognormal(600, 0.3), 'Getting started…');
    this.order = 'down';
    if (!total) {
      this.say('Done', { done: true });
      return;
    }
    // Grapheme positions of every edit, in the document as it is now.
    let g = 0;
    let at = 0;
    const spots = edits.map((h) => {
      g += glen(a.slice(at, h.s));
      const start = g;
      const oldLen = glen(a.slice(h.s, h.e));
      g += oldLen;
      at = h.e;
      return { h, start, oldLen, newLen: glen(h.text) };
    });
    const docLen = g + glen(a.slice(at));
    // Always count from the top: only the text above each edit has to match
    // exactly, so extras at the end of a document (footnotes, blank lines) can't
    // throw it off. (docLen is kept for working up from the bottom if ever needed.)
    const down = docLen >= 0;
    this.order = down ? 'down' : 'up';
    this.phase = 'editing';
    this.say(down ? 'Jumping to the top of the document' : 'Jumping to the end of the document');
    this.key(down ? 'docstart' : 'docend', this.r.lognormal(300, 0.3));
    let cursor = down ? 0 : docLen;
    let delta = 0;
    const list = down ? spots : spots.slice().reverse();
    list.forEach(({ h, start: s0, oldLen, newLen }, n) => {
      const start = down ? s0 + delta : s0;
      const end = start + oldLen;
      this.push({
        d: Math.round(Math.max(120, this.between('editTime'))),
        s: `Editing (${n + 1} of ${total})`,
        fix: { from: a.slice(h.s, h.e), to: h.text, type: 'edit', label: '', n: n + 1, of: total },
      });
      this.travel(cursor, end);
      if (oldLen > 0) {
        const selectIt = oldLen > 12 || (oldLen > 6 && this.r.chance(0.4));
        if (selectIt) {
          this.hold('left', oldLen, { sh: 1 });
          if (!h.text) this.key('back', this.r.lognormal(160, 0.3));
        } else {
          this.backspaces(oldLen);
        }
      }
      if (h.text) {
        this.prev = '';
        this.typeAddition(h.text);
      }
      this.event('fix');
      cursor = start + newLen;
      if (down) delta += newLen - oldLen;
      this.wait(this.r.lognormal(260, 0.4));
    });
    this.say('Done', { done: true });
  }

  stats(draft) {
    const { typing, thinking, editing } = this.ms;
    return {
      totalMs: typing + thinking + editing,
      typingMs: typing,
      thinkingMs: thinking,
      editingMs: editing,
      typos: this.counts.typos,
      rethinks: this.counts.rethinks,
      fixes: draft.total,
      keys: this.actions.reduce((n, a) => n + (a.k ? 1 : 0), 0),
    };
  }
}

export function buildPlan(input, settings = {}, opts = {}) {
  const s = normalizeSettings(settings);
  const draft = opts.draft || makeDraft(input, s.roughness, opts.draftSeed ?? 1);
  const b = new PlanBuilder(s, makeRng(opts.runSeed ?? 2));
  b.build(draft);
  return { actions: b.actions, draft, stats: b.stats(draft) };
}

// The editor: a timed plan that turns `oldText` (what the document holds now)
// into `newText`, one small edit at a time.
export function buildEditPlan(oldText, newText, settings = {}, opts = {}) {
  const s = normalizeSettings(settings);
  const diff = opts.diff || diffTexts(oldText, newText);
  const b = new PlanBuilder(s, makeRng(opts.runSeed ?? 2));
  b.buildEdits(diff);
  const { typing, thinking, editing } = b.ms;
  return {
    actions: b.actions,
    diff,
    order: b.order,
    stats: {
      totalMs: typing + thinking + editing,
      typingMs: typing,
      thinkingMs: thinking,
      editingMs: editing,
      typos: b.counts.typos,
      rethinks: b.counts.rethinks,
      fixes: diff.edits.length,
      keys: b.actions.reduce((n, x) => n + (x.k ? 1 : 0), 0),
    },
  };
}

// Replays a plan against a plain-text model of the page. Used to prove a plan
// ends on the exact original before a single key is sent.
// A plain-text model of the page: what's in it, where the cursor is, and any
// selection. Used to prove a plan ends on the exact text before a single key
// is sent, and to know what the page should hold at every check.
export class TextModel {
  constructor(prefix = '', suffix = '') {
    this.doc = [...graphemes(prefix), ...graphemes(suffix)];
    this.cur = glen(prefix);
    this.anchor = null;
  }

  get text() {
    return this.doc.join('');
  }

  dropSelection() {
    const a = Math.min(this.anchor, this.cur);
    const b = Math.max(this.anchor, this.cur);
    this.doc.splice(a, b - a);
    this.cur = a;
    this.anchor = null;
  }

  apply(a) {
    if (!a.k) return;
    if (this.anchor !== null && this.anchor === this.cur) this.anchor = null;
    switch (a.k) {
      case 'type':
      case 'enter':
        if (this.anchor !== null) this.dropSelection();
        this.doc.splice(this.cur, 0, a.k === 'enter' ? '\n' : a.g);
        this.cur++;
        break;
      case 'back':
        if (this.anchor !== null) this.dropSelection();
        else if (this.cur > 0) this.doc.splice(--this.cur, 1);
        break;
      case 'left':
        if (a.sh) {
          if (this.anchor === null) this.anchor = this.cur;
          if (this.cur > 0) this.cur--;
        } else if (this.anchor !== null) {
          this.cur = Math.min(this.anchor, this.cur);
          this.anchor = null;
        } else if (this.cur > 0) this.cur--;
        break;
      case 'right':
        if (a.sh) {
          if (this.anchor === null) this.anchor = this.cur;
          if (this.cur < this.doc.length) this.cur++;
        } else if (this.anchor !== null) {
          this.cur = Math.max(this.anchor, this.cur);
          this.anchor = null;
        } else if (this.cur < this.doc.length) this.cur++;
        break;
      case 'docstart':
        this.anchor = null;
        this.cur = 0;
        break;
      case 'docend':
        this.anchor = null;
        this.cur = this.doc.length;
        break;
      default:
        break;
    }
  }
}

export function simulate(actions, prefix = '', suffix = '') {
  const m = new TextModel(prefix, suffix);
  for (const a of actions) m.apply(a);
  return m.text;
}

// Adds a check after every `every` edits and one at the very end. A due check
// waits for the next pause a person would take anyway (so rereading hides
// inside it) and never lands while text is selected. Each check carries what
// the typed text should be at that moment and where the cursor should sit.
export function addChecks(actions, { every = 5, events = ['fix'], prefix = '', suffix = '', firstKeys = Infinity, maxKeys = Infinity } = {}) {
  const out = [];
  const model = new TextModel(prefix, suffix);
  const total = actions.filter((a) => events.includes(a.ev)).length;
  let edits = 0;
  let from = 1;
  let since = 0;
  let due = false;
  let keysSince = false;
  let keysSinceCheck = 0;
  let last = null;
  const check = (final) => {
    last = { d: 0, check: { from, to: edits, of: total, final, text: model.text, cursor: model.cur } };
    out.push(last);
    from = edits + 1;
    since = 0;
    due = false;
    keysSince = false;
    keysSinceCheck = 0;
  };
  for (const a of actions) {
    if (due && model.anchor === null && (a.d >= 500 || a.fix || a.done)) check(false);
    out.push(a);
    model.apply(a);
    if (a.k) {
      keysSince = true;
      keysSinceCheck++;
      if (keysSinceCheck >= (last ? maxKeys : firstKeys) && model.anchor === null) check(false);
    }
    if (events.includes(a.ev)) {
      edits++;
      since++;
      if (since >= every) due = true;
    }
  }
  // The last check covers everything; if nothing was typed since the previous one, that one is the last.
  if (keysSince || due || !last) check(true);
  else last.check.final = true;
  return out;
}

// The keystrokes that turn what's really in the document into what should be
// there: jump to the top, fix each wrong spot like any other edit, then come
// back to where the plan left the cursor. `cursor` counts characters
// (graphemes) from the top of the expected document.
export function buildFixPlan(actual, expected, cursor, settings = {}, opts = {}) {
  const s = normalizeSettings({ ...settings, typoRate: 0, secondThoughts: 0 });
  const diff = editorDiff(actual, expected, { looseQuotes: opts.looseQuotes, trimEnd: false });
  const b = new PlanBuilder(s, makeRng(opts.runSeed ?? 7));
  b.buildEdits(diff);
  const actions = [];
  for (const a of b.actions) {
    if (a.done) continue;
    const x = { ...a };
    delete x.fix;
    if (x.ev === 'fix') x.ev = 'repair';
    if (x.s === 'Getting started…') x.s = 'Found a mistake. Going back to fix it';
    else if (x.s && x.s.startsWith('Editing (')) x.s = x.s.replace('Editing', 'Fixing');
    actions.push(x);
  }
  // Back to where the plan left off.
  const back = new PlanBuilder(s, makeRng((opts.runSeed ?? 7) + 1));
  back.say('Going back to where it left off');
  back.key('docstart', back.r.lognormal(300, 0.3));
  back.travel(0, cursor);
  actions.push(...back.actions);
  // Prove it: the fixed document, with the cursor exactly where it should be.
  const m = new TextModel(actual, '');
  for (const a of actions) m.apply(a);
  const ok = m.text === diff.after && m.cur === cursor && m.anchor === null;
  return { actions, diff, ok, fixes: diff.edits.length };
}

export function formatDuration(ms) {
  const sec = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}
