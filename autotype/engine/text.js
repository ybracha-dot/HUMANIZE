// Text helpers shared by the engine. Everything that moves a cursor counts
// graphemes (what one arrow-key press skips over), not UTF-16 code units.

const graphemeSegmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });

export function graphemes(str) {
  const out = [];
  for (const { segment } of graphemeSegmenter.segment(str)) out.push(segment);
  return out;
}

export function glen(str) {
  let n = 0;
  // eslint-disable-next-line no-unused-vars
  for (const _ of graphemeSegmenter.segment(str)) n++;
  return n;
}

export function normalizeInput(text) {
  return String(text ?? '').replace(/\r\n?/g, '\n');
}

// Splits text into paragraphs, keeping the exact newline run after each one
// so the typed result can match the input byte for byte.
export function splitParagraphs(text) {
  const parts = text.split(/(\n+)/);
  const paras = [];
  for (let i = 0; i < parts.length; i += 2) {
    paras.push({ text: parts[i], sep: parts[i + 1] || '' });
  }
  return paras;
}

// Letters, marks and digits, with inner apostrophes or hyphens ("don't", "well-known").
const WORD_SOURCE = "[\\p{L}\\p{M}\\p{N}]+(?:['’\\-][\\p{L}\\p{M}\\p{N}]+)*";

export function findWords(text) {
  const re = new RegExp(WORD_SOURCE, 'gu');
  const out = [];
  let m;
  while ((m = re.exec(text))) {
    out.push({
      w: m[0],
      lw: m[0].toLowerCase().replace(/’/g, "'"),
      s: m.index,
      e: m.index + m[0].length,
    });
  }
  return out;
}

const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'vs', 'etc', 'e.g', 'i.e', 'u.s', 'u.k',
  'a.m', 'p.m', 'no', 'fig', 'vol', 'inc', 'ltd', 'co', 'corp', 'jan', 'feb', 'mar', 'apr',
  'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec', 'approx', 'dept', 'est', 'gen',
  'gov', 'lt', 'col', 'sgt', 'capt', 'mt', 'ave', 'rd', 'blvd', 'ph.d', 'cf', 'al',
]);

// Returns [start, end) ranges that cover the whole string. Each range keeps the
// whitespace after its closing punctuation, so the next sentence starts on a letter.
export function splitSentences(text) {
  const ranges = [];
  const re = /[.!?…]+["'”’)\]]*(\s+)/g;
  let start = 0;
  let m;
  while ((m = re.exec(text))) {
    const next = m.index + m[0].length;
    if (next >= text.length) break;
    if (!/[\p{Lu}\p{N}"“‘'(\[]/u.test(text[next])) continue;
    if (text[m.index] === '.') {
      const before = text.slice(start, m.index);
      const wm = before.match(/([\p{L}][\p{L}.]*)$/u);
      if (wm) {
        const w = wm[1].toLowerCase().replace(/\.$/, '');
        if (ABBREVIATIONS.has(w) || /^\p{L}$/u.test(w)) continue;
      }
    }
    ranges.push([start, next]);
    start = next;
  }
  ranges.push([start, text.length]);
  return ranges;
}

export function isCapitalized(word) {
  const c = word[0];
  return !!c && c !== c.toLowerCase() && c === c.toUpperCase();
}

export function matchCase(source, replacement) {
  if (!replacement) return replacement;
  const letters = source.replace(/[^\p{L}]/gu, '');
  if (letters.length > 1 && letters === letters.toUpperCase() && letters !== letters.toLowerCase()) {
    return replacement.toUpperCase();
  }
  if (isCapitalized(source)) return replacement[0].toUpperCase() + replacement.slice(1);
  return replacement;
}

export function lowerFirst(s) {
  return s ? s[0].toLowerCase() + s.slice(1) : s;
}

export function upperFirst(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function mergeRanges(ranges) {
  const sorted = ranges.slice().sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}

// Quotations and the citations that follow them come straight from a source,
// so the rough draft never touches them. Returns quote ranges and citations,
// where each citation's range starts at the space before "(" (the spot where
// the writer stops to look up the page number).
export function findProtected(text) {
  const quotes = [];
  let open = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '“' && open < 0) open = i;
    else if (text[i] === '”' && open >= 0) {
      quotes.push([open, i + 1]);
      open = -1;
    }
  }
  if (open >= 0) quotes.push([open, text.length]);
  open = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '"') continue;
    if (open < 0) open = i;
    else {
      quotes.push([open, i + 1]);
      open = -1;
    }
  }
  if (open >= 0) quotes.push([open, text.length]);
  // ‘single quotes’: only when they open after a space and close before a non-letter.
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '‘' || (i > 0 && !/[\s(\[“"—–-]/.test(text[i - 1]))) continue;
    let j = i + 1;
    while (j < text.length && text[j] !== '\n' && !(text[j] === '’' && !/\p{L}/u.test(text[j + 1] || ''))) j++;
    if (text[j] === '’') {
      quotes.push([i, j + 1]);
      i = j;
    }
  }
  const merged = mergeRanges(quotes);

  const cites = [];
  const paren = /\(([^()\n]{1,80})\)/g;
  const pageLike = /(?:^|[\s,])(?:pp?\.\s*|lines?\s+|ll?\.\s*)?\d+(?:\.\d+)*[a-z]?(?:\s*[-–]\s*\d+(?:\.\d+)*[a-z]?)?(?:,\s*\d+(?:\.\d+)*)*$/;
  let m;
  while ((m = paren.exec(text))) {
    const s = m.index;
    const e = s + m[0].length;
    let j = s - 1;
    if (text[j] === ' ') j--;
    const afterQuote = merged.some(([, qe]) => qe === j + 1);
    if (!afterQuote && !pageLike.test(m[1].trim())) continue;
    cites.push({ s, e, pauseAt: text[s - 1] === ' ' ? s - 1 : s });
  }
  return { quotes: merged, cites };
}

export function articleFor(word) {
  const w = word.toLowerCase();
  if (/^(hour|honest|honor|honour|heir)/.test(w)) return 'an';
  if (/^(uni|use|usu|uti|ure|eu|one|once|ewe|ufo)/.test(w)) return 'a';
  if (/^[aeiou]/.test(w)) return 'an';
  return 'a';
}

// Short fingerprint so the panel can tell whether a running job uses the same
// text, seed and roughness it is previewing.
export function draftKey(text, seed, roughness) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return `${(h >>> 0).toString(36)}:${text.length}:${seed}:${roughness}`;
}
