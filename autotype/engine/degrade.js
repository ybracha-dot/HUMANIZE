// Builds the "rough draft": a slightly worse version of each paragraph made of
// small, separate edits. Each edit remembers the original text it replaced, so
// the revision pass can always restore the exact input.

import {
  findWords, splitSentences, splitParagraphs, normalizeInput, matchCase, isCapitalized,
  lowerFirst, upperFirst, articleFor, glen, graphemes, findProtected,
} from './text.js';
import { makeRng } from './rng.js';
import * as L from './lexicon.js';

export const EDIT_TYPES = {
  synonym: { w: 3.0, cat: 'wording' },
  phrase: { w: 1.2, cat: 'wording' },
  connective: { w: 1.0, cat: 'wording' },
  wordy: { w: 0.7, cat: 'wording' },
  filler: { w: 1.5, cat: 'wording' },
  that: { w: 0.35, cat: 'wording' },
  missing: { w: 1.4, cat: 'grammar' },
  doubled: { w: 0.3, cat: 'grammar' },
  agreement: { w: 0.8, cat: 'grammar' },
  article: { w: 0.35, cat: 'grammar' },
  homophone: { w: 0.8, cat: 'grammar' },
  plural: { w: 0.5, cat: 'grammar' },
  preposition: { w: 0.35, cat: 'grammar' },
  comma: { w: 0.9, cat: 'grammar' },
  splice: { w: 0.6, cat: 'clause' },
  runon: { w: 0.35, cat: 'clause' },
  fragment: { w: 0.45, cat: 'clause' },
  reorder: { w: 0.7, cat: 'clause' },
  propercase: { w: 2.4, cat: 'caps' },
};

export const CATEGORY_NAMES = { wording: 'word choice', grammar: 'grammar', clause: 'sentence structure', caps: 'capitalization' };

const SINGULAR_EXCEPTIONS = new Set(['movies', 'cookies', 'calories', 'zombies', 'rookies', 'brownies', 'selfies', 'prairies', 'hippies', 'goalies', 'pies', 'ties', 'lies', 'dies']);
const NOT_PLURAL = new Set(['was', 'has', 'does', 'goes', 'is', 'us', 'this', 'thus', 'yes', 'his', 'hers', 'its', 'ours', 'yours', 'theirs', 'as', 'always', 'perhaps', 'news', 'series', 'species', 'means', 'whereas', 'besides', 'towards', 'afterwards']);

function singular(word) {
  const lw = word.toLowerCase();
  if (lw.length < 4 || NOT_PLURAL.has(lw) || /(ss|us|is|ous|ves)$/.test(lw)) return null;
  if (SINGULAR_EXCEPTIONS.has(lw)) return word.slice(0, -1);
  if (/[^aeiou]ies$/.test(lw)) return `${word.slice(0, -3)}y`;
  if (/(ches|shes|xes|zes)$/.test(lw)) return word.slice(0, -2);
  if (/[^s']s$/.test(lw)) return word.slice(0, -1);
  return null;
}

function buildContext(text) {
  const words = findWords(text);
  const sentences = splitSentences(text);
  let si = 0;
  for (const w of words) {
    while (si < sentences.length - 1 && w.s >= sentences[si][1]) si++;
    w.sent = si;
  }
  const perSentence = new Array(sentences.length).fill(0);
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    w.i = i;
    w.first = i === 0 || words[i - 1].sent !== w.sent;
    w.idxInSentence = perSentence[w.sent]++;
    w.prevGap = i > 0 ? text.slice(words[i - 1].e, w.s) : text.slice(0, w.s);
    w.nextGap = i < words.length - 1 ? text.slice(w.e, words[i + 1].s) : text.slice(w.e);
  }
  return { text, words, sentences, perSentence };
}

function perfectOrPassive(words, i) {
  for (let k = i - 1; k >= Math.max(0, i - 2); k--) {
    if (words[k].sent !== words[i].sent) break;
    if (L.HAVE.has(words[k].lw) || L.BE.has(words[k].lw)) return true;
  }
  return false;
}

// When a swap changes the sound of the next word, fix "a"/"an" in the same edit.
function withArticle(c, s, e, draft) {
  const { prev, w } = c;
  if (prev && (prev.lw === 'a' || prev.lw === 'an') && w.prevGap === ' ') {
    const want = articleFor(draft);
    if (want !== prev.lw) return { s: prev.s, e, draft: `${matchCase(prev.w, want)} ${draft}` };
  }
  return { s, e, draft };
}

function insertBefore(c, filler) {
  const { prev, w } = c;
  if (prev && (prev.lw === 'a' || prev.lw === 'an') && w.prevGap === ' ') {
    const want = articleFor(filler);
    if (want !== prev.lw) return { s: prev.s, e: w.s, draft: `${matchCase(prev.w, want)} ${filler} ` };
  }
  return { s: w.s, e: w.s, draft: `${filler} ` };
}

function collect(ctx, apos, r) {
  const { text, words, sentences, perSentence } = ctx;
  const out = [];
  const add = (type, s, e, draft, label, extra) => out.push({ type, cat: EDIT_TYPES[type].cat, s, e, draft, label, ...extra });
  const fixApos = (s) => (apos === "'" ? s : s.replace(/'/g, apos));
  const n = words.length;
  const near = (i) => {
    const w = words[i];
    const prev = w.first ? null : words[i - 1];
    const next = i + 1 < n && words[i + 1].sent === w.sent ? words[i + 1] : null;
    return { w, prev, next, nextGap: w.nextGap, prevGap: w.prevGap };
  };
  const properNoun = (w) => isCapitalized(w.w) && !w.first && w.lw !== 'i';
  const startsWord = new Map(words.map((w) => [w.s, w]));

  for (let i = 0; i < n; i++) {
    const c = near(i);
    const { w, prev, next } = c;
    if (/^\p{N}/u.test(w.w)) continue;
    const proper = properNoun(w);

    // Word choice: a plainer or vaguer word in the first draft.
    const swaps = L.WORD_SWAPS.get(w.lw);
    if (swaps && !proper) {
      for (const sw of swaps) {
        if (sw.kind === 'verb' && w.first) continue;
        if (!L.checkFlags(sw.flags, c)) continue;
        let d = sw.draft || (perfectOrPassive(words, i) ? sw.pp : sw.past);
        d = matchCase(w.w, d);
        const span = withArticle(c, w.s, w.e, d);
        add('synonym', span.s, span.e, span.draft, `${d} → ${w.w}`);
      }
    }

    // Wordier first-draft phrasing ("due to the fact that").
    const wordy = L.WORDY.get(w.lw);
    if (wordy && !proper && L.checkFlags(wordy.flags, c)) {
      const d = matchCase(w.w, wordy.draft);
      add('wordy', w.s, w.e, d, `${d} → ${w.w}`);
    }

    // Filler words that get cut in revision ("really", "very").
    if (!w.first && !proper && prev && w.prevGap === ' ' && !L.NO_FILLER_AFTER.has(prev.lw)) {
      if (L.GRADABLE.has(w.lw)) {
        let pool = L.LINKING_VERBS.has(prev.lw) ? L.LINKING_INTENSIFIERS : L.INTENSIFIERS;
        if (L.EXTREME.has(w.lw)) pool = pool.filter(([x]) => x === 'really' || x === 'so');
        const f = r.weighted(pool, (x) => x[1])[0];
        const span = insertBefore(c, f);
        add('filler', span.s, span.e, span.draft, `cut "${f}"`);
      } else if (L.FILLER_VERBS.has(w.lw) && L.FILLER_VERB_SUBJECTS.has(prev.lw)) {
        const f = r.pick(['really', 'really', 'actually', 'just']);
        add('filler', w.s, w.s, `${f} `, `cut "${f}"`);
      }
    }

    // An extra "that" ("I think that the...").
    if (L.THAT_VERBS.has(w.lw) && next && w.nextGap === ' ' && L.THAT_NEXT.has(next.lw) && next.lw !== 'that') {
      add('that', next.s, next.s, 'that ', 'cut extra "that"');
    }

    // A small word left out.
    if (L.DROPPABLE.has(w.lw) && !w.first && next && w.nextGap === ' ' && /\s$/.test(w.prevGap)) {
      add('missing', w.s, w.e + 1, '', `add missing "${w.w}"`);
    }

    // A word typed twice ("the the").
    if (L.DOUBLABLE.has(w.lw) && !w.first && next && w.nextGap === ' ' && /\s$/.test(w.prevGap)) {
      add('doubled', w.s, w.s, `${w.w} `, `cut repeated "${w.w}"`);
    }

    // Subject-verb agreement slips ("the results was").
    const agr = L.AGREEMENT.get(w.lw);
    if (agr && !w.first && prev && !L.PRONOUNS.has(prev.lw) && !L.MODALS.has(prev.lw) && prev.lw !== 'to') {
      const d = fixApos(matchCase(w.w, agr));
      add('agreement', w.s, w.e, d, `${d} → ${w.w}`);
    }

    // Wrong article ("an book").
    if ((w.lw === 'a' || w.lw === 'an') && next && w.nextGap === ' ' && articleFor(next.w) === w.lw) {
      const d = matchCase(w.w, w.lw === 'a' ? 'an' : 'a');
      add('article', w.s, w.e, d, `${d} → ${w.w}`);
    }

    // Mixed-up homophones (their/there, its/it's).
    const hom = L.HOMOPHONES.get(w.lw);
    if (hom && !proper) {
      const d = fixApos(matchCase(w.w, hom));
      add('homophone', w.s, w.e, d, `${d} → ${w.w}`);
    }

    // Plural slips ("many student").
    if (prev && L.PLURAL_QUANTIFIERS.has(prev.lw) && w.prevGap === ' ' && !proper) {
      const sg = singular(w.w);
      if (sg) add('plural', w.s, w.e, sg, `${sg} → ${w.w}`);
    }

    // Wrong preposition ("interested on").
    const prep = L.PREPOSITION_SWAPS.get(w.lw);
    if (prep && !w.first && next && w.nextGap === ' ' && (!prep.needDet || L.DETERMINERS.has(next.lw))) {
      const d = matchCase(w.w, prep.to);
      add('preposition', w.s, w.e, d, `${d} → ${w.w}`);
    }

    // Sentence fragments ("...the test. Which was hard.").
    if (L.FRAGMENT_WORDS.has(w.lw) && !w.first) {
      const before = w.idxInSentence;
      const after = perSentence[w.sent] - before;
      if (before >= 4 && after >= 3) {
        const cap = w.w[0].toUpperCase();
        if (w.prevGap === ', ') add('fragment', w.s - 2, w.s + 1, `. ${cap}`, 'join a sentence fragment');
        else if (w.prevGap === ' ' && w.lw === 'because') add('fragment', w.s - 1, w.s + 1, `. ${cap}`, 'join a sentence fragment');
      }
    }
  }

  // Proper nouns typed in lowercase ("britain", "north america"). Words of one
  // name share a group so the whole name gets lowercased together.
  let group = 0;
  let prevProper = -2;
  for (let i = 0; i < n; i++) {
    const w = words[i];
    const letters = w.w.replace(/[^\p{L}]/gu, '');
    const proper = !w.first && isCapitalized(w.w) && w.lw !== 'i' && !/^i['’]/.test(w.lw)
      && letters.length >= 2 && letters !== letters.toUpperCase()
      && !/["“‘(\[:]\s*$/.test(w.prevGap);
    if (!proper) continue;
    if (!(prevProper === i - 1 && w.prevGap === ' ')) group++;
    prevProper = i;
    const lead = graphemes(w.w)[0];
    add('propercase', w.s, w.s + lead.length, lead.toLowerCase(), `capitalize "${w.w}"`, { group });
  }

  // Multi-word phrases.
  for (const [phrase, repl] of L.PHRASES) {
    const re = new RegExp(`\\b${phrase}\\b`, 'gi');
    let m;
    while ((m = re.exec(text))) {
      const s = m.index;
      const first = startsWord.get(s)?.first;
      if (isCapitalized(m[0]) && !first) continue;
      let rep = repl;
      // "the majority of people" -> "most people", but "...of the data" -> "most of the data"
      if (phrase === 'the majority of') {
        const after = startsWord.get(s + m[0].length + 1);
        if (!after || !L.DETERMINERS.has(after.lw)) rep = 'most';
      }
      const d = matchCase(m[0], rep);
      add('phrase', s, s + m[0].length, d, `${d} → ${m[0]}`);
    }
  }

  // Sentence openers ("However," -> "But").
  for (const [a] of sentences) {
    let s = a;
    while (s < text.length && /\s/.test(text[s])) s++;
    for (const [conn, repl] of L.CONNECTIVES) {
      if (text.startsWith(conn, s) && text[s + conn.length] === ' ') {
        add('connective', s, s + conn.length, repl, `${repl} → ${conn}`);
      }
    }
  }

  // Missing commas.
  const commaRe = /,(?= \S)/g;
  let cm;
  while ((cm = commaRe.exec(text))) {
    const i = cm.index;
    if (i === 0 || !/[\p{L}\p{N})"”’]/u.test(text[i - 1])) continue;
    add('comma', i, i + 1, '', 'add a missing comma');
  }

  // Two sentences run together (comma splice or "and").
  for (let k = 0; k + 1 < sentences.length; k++) {
    const b = sentences[k][1];
    if (!(text[b - 1] === ' ' && text[b - 2] === '.' && /[\p{L}\p{N}]/u.test(text[b - 3] || ''))) continue;
    const nw = startsWord.get(b);
    if (!nw || !L.SPLICE_STARTERS.has(nw.lw) || nw.w === 'I') continue;
    if (nw.w.length > 1 && nw.w === nw.w.toUpperCase()) continue;
    const n1 = perSentence[k];
    const n2 = perSentence[k + 1];
    if (n1 < 3 || n2 < 3 || n1 > 28 || n2 > 28) continue;
    const lower = nw.w[0].toLowerCase();
    add('splice', b - 2, b + 1, `, ${lower}`, 'split a run-on sentence');
    if (!['and', 'but', 'so', 'yet', 'however', 'also', 'or', 'then'].includes(nw.lw)) {
      add('runon', b - 2, b + 1, ` and ${lower}`, 'split a run-on sentence');
    }
  }

  // Clauses in the other order ("We played outside although it rained.").
  sentences.forEach(([a, b]) => {
    const raw = text.slice(a, b);
    const lead = raw.length - raw.trimStart().length;
    const body = raw.trim();
    if (!/^\p{L}/u.test(body) || !body.endsWith('.') || body.endsWith('..')) return;
    if (/[;:()"“”‘\[\]—–]/.test(body)) return;
    const core = body.slice(0, -1);
    if (core.includes('.') || core.split(',').length !== 2) return;
    const ci = core.indexOf(', ');
    if (ci < 0) return;
    const sub = core.slice(0, ci);
    const main = core.slice(ci + 2);
    const subWords = findWords(sub);
    const mainWords = findWords(main);
    if (!subWords.length || !mainWords.length || !L.REORDER_OPENERS.has(subWords[0].lw)) return;
    if (subWords.length < 3 || mainWords.length < 3 || subWords.length > 15 || mainWords.length > 22) return;
    if (['and', 'but', 'so', 'or', 'yet', 'then'].includes(mainWords[0].lw)) return;
    const s = a + lead;
    add('reorder', s, s + core.length, `${upperFirst(main)} ${lowerFirst(sub)}`, 'reorder a sentence');
  });

  return out;
}

// Edits may not touch or sit on neighboring words: two slips in a row read as noise.
function overlaps(a, b) {
  return a.s <= b.e + 1 && b.s <= a.e + 1;
}

function choose(cands, n, r, rough) {
  const byType = new Map();
  for (const c of cands) {
    if (!byType.has(c.type)) byType.set(c.type, []);
    byType.get(c.type).push(c);
  }
  const chosen = [];
  const clauseLimit = Math.max(1, Math.floor(n / 3));
  let clauses = 0;
  const boost = 0.45 + rough;
  const weightOf = (t) => EDIT_TYPES[t].w * (EDIT_TYPES[t].cat === 'wording' ? 1 : boost);
  while (chosen.length < n && byType.size) {
    const t = r.weighted([...byType.keys()], weightOf);
    const list = byType.get(t);
    const idx = Math.floor(r() * list.length);
    const c = list[idx];
    list.splice(idx, 1);
    if (!list.length) byType.delete(t);
    if (c.cat === 'clause' && clauses >= clauseLimit) continue;
    if (chosen.some((x) => overlaps(x, c))) continue;
    chosen.push(c);
    if (c.cat === 'clause') clauses++;
    if (c.group != null) {
      // Lowercase the rest of the name too ("north america", not "north America").
      for (const x of cands) {
        if (x !== c && x.type === c.type && x.group === c.group && !chosen.some((y) => overlaps(y, x))) chosen.push(x);
      }
      const rest = (byType.get(c.type) || []).filter((x) => x.group !== c.group);
      if (rest.length) byType.set(c.type, rest);
      else byType.delete(c.type);
    }
  }
  return chosen.sort((a, b) => a.s - b.s);
}

function applyEdits(text, edits) {
  let draft = '';
  let last = 0;
  for (const ed of edits) {
    draft += text.slice(last, ed.s);
    ed.orig = text.slice(ed.s, ed.e);
    ed.ds = draft.length;
    draft += ed.draft;
    ed.de = draft.length;
    last = ed.e;
  }
  draft += text.slice(last);
  for (const ed of edits) {
    ed.dsG = glen(draft.slice(0, ed.ds));
    ed.draftG = glen(ed.draft);
    ed.origG = glen(ed.orig);
  }
  return draft;
}

export function makeDraft(input, roughnessPct, seed) {
  const text = normalizeInput(input);
  const r = makeRng(seed);
  const rough = Math.max(0, Math.min(1, (Number(roughnessPct) || 0) / 100));
  const apos = /’/.test(text) && !/'/.test(text) ? '’' : "'";
  const paragraphs = splitParagraphs(text).map(({ text: p, sep }) => {
    const ctx = buildContext(p);
    const prot = findProtected(p);
    const shields = [...prot.quotes, ...prot.cites.map((c) => [c.pauseAt, c.e])];
    const blocked = (c) => shields.some(([s, e]) => (c.s === c.e ? c.s > s && c.s < e : c.s < e && s < c.e));
    let edits = [];
    if (rough > 0 && ctx.words.length >= 3) {
      const expected = ctx.words.length * 0.13 * rough;
      let n;
      if (expected < 1) n = r.chance(expected) ? 1 : 0;
      else n = Math.max(0, Math.round(expected + r.normal() * Math.sqrt(expected) * 0.6));
      if (n > 0) edits = choose(collect(ctx, apos, r).filter((c) => !blocked(c)), n, r, rough);
    }
    const draft = applyEdits(p, edits);
    // Where the untouched quotes and citations sit in the draft.
    const toDraft = (pos) => {
      let d = 0;
      for (const ed of edits) if (ed.e <= pos) d += ed.draft.length - ed.orig.length;
      return pos + d;
    };
    const quotesD = prot.quotes.map(([s, e]) => [toDraft(s), toDraft(s) + (e - s)]);
    const citesD = prot.cites.map((c) => ({ s: toDraft(c.s), e: toDraft(c.s) + (c.e - c.s), pauseAt: toDraft(c.pauseAt) }));
    return { original: p, draft, sep, edits, words: ctx.words.length, quotesD, citesD, quotes: prot.quotes.length, cites: prot.cites.length };
  });
  const counts = { wording: 0, grammar: 0, clause: 0, caps: 0 };
  for (const p of paragraphs) for (const e of p.edits) counts[e.cat]++;
  const total = counts.wording + counts.grammar + counts.clause + counts.caps;
  const quotes = paragraphs.reduce((sum, p) => sum + p.quotes, 0);
  const cites = paragraphs.reduce((sum, p) => sum + p.cites, 0);
  const words = paragraphs.reduce((sum, p) => sum + p.words, 0);
  return { text, seed, roughness: roughnessPct, paragraphs, counts, total, words, quotes, cites };
}
