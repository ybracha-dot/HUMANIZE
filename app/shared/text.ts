// Pure text utilities shared by server and client.
//
// COORDINATE CONVENTION (used by every anchor in the app): offsets are UTF-16 code-unit
// indices (JavaScript string indices) into a paragraph's stored plain text. They are never
// computed on a normalized copy; normalized matches are mapped back to the original.

export interface NormalizedText {
  norm: string;
  /** map[i] = index in the original string of normalized char i. map[norm.length] = original length. */
  map: number[];
}

const QUOTE_FOLD: Record<string, string> = {
  '‘': "'", '’': "'", '‚': "'", '‛': "'", '′': "'",
  '“': '"', '”': '"', '„': '"', '‟': '"', '″': '"',
  '«': '"', '»': '"',
};

/**
 * Documented normalization used ONLY for matching (never for display or storage):
 *  1. any run of Unicode whitespace (incl. NBSP, newlines) collapses to one space
 *  2. soft hyphens (U+00AD) are dropped
 *  3. a hyphen at a line end ("exam-\nple") joins the word halves
 *  4. curly/straight quote variants fold to straight quotes
 *  5. letter case is preserved (callers lowercase explicitly when they want case-insensitive search)
 * The returned map lets callers translate a normalized match back to original offsets.
 */
export function normalizeWithMap(input: string): NormalizedText {
  const out: string[] = [];
  const map: number[] = [];
  let i = 0;
  let lastWasSpace = true; // trims leading whitespace
  while (i < input.length) {
    const ch = input[i];
    if (ch === '­') { i++; continue; }
    if (ch === '-' && /^-[ \t]*\r?\n[ \t]*/.test(input.slice(i, i + 8)) && /\p{L}/u.test(input[i - 1] ?? '')) {
      const m = /^-[ \t]*\r?\n[ \t]*/.exec(input.slice(i))!;
      i += m[0].length;
      continue;
    }
    if (/\s/u.test(ch)) {
      if (!lastWasSpace) { out.push(' '); map.push(i); lastWasSpace = true; }
      i++;
      continue;
    }
    lastWasSpace = false;
    out.push(QUOTE_FOLD[ch] ?? ch);
    map.push(i);
    i++;
  }
  if (out[out.length - 1] === ' ') { out.pop(); map.pop(); }
  map.push(input.length);
  return { norm: out.join(''), map };
}

export function normalizeForMatch(s: string): string {
  return normalizeWithMap(s).norm;
}

/** Find `quote` in `text` after normalization. Returns original-text offsets or null. */
export function findQuote(text: string, quote: string): { start: number; end: number } | null {
  const q = normalizeForMatch(quote);
  if (!q) return null;
  const n = normalizeWithMap(text);
  const at = n.norm.indexOf(q);
  if (at < 0) return null;
  const start = n.map[at];
  const end = n.map[at + q.length - 1] + 1;
  return { start, end };
}

export function countWords(s: string): number {
  const m = s.match(/[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu);
  return m ? m.length : 0;
}

export interface Sentence { text: string; start: number; end: number }

const ABBREV = /\b(?:e\.g|i\.e|etc|vs|Mr|Mrs|Ms|Dr|Prof|Fig|No|pp|p|al|St|Jr|Sr|U\.S|Inc|Ltd|cf)\.$/i;

/** Sentence split with offsets into the original string. Conservative around abbreviations and decimals. */
export function splitSentences(text: string): Sentence[] {
  const out: Sentence[] = [];
  const re = /[.!?…]+["'”’)\]]*(?=\s|$)|\n{2,}/g;
  let start = 0;
  let m: RegExpExecArray | null;
  const push = (s: number, e: number) => {
    let a = s; let b = e;
    while (a < b && /\s/.test(text[a])) a++;
    while (b > a && /\s/.test(text[b - 1])) b--;
    if (b > a) out.push({ text: text.slice(a, b), start: a, end: b });
  };
  while ((m = re.exec(text))) {
    const end = m.index + m[0].length;
    const before = text.slice(Math.max(0, m.index - 8), m.index + 1);
    if (m[0].startsWith('.') && ABBREV.test(before + '.')) continue;
    // a citation like (Miller 10). should stay attached; handled by lookahead of closing paren above
    push(start, end);
    start = end;
  }
  push(start, text.length);
  return out;
}

export function splitParagraphs(text: string): string[] {
  return text.replace(/\r\n?/g, '\n').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
}

/** Percent change helpers kept here because several modules need them. */
export function pctPointDiff(a: number, b: number): { points: number; relativePct: number } {
  return { points: round(b - a, 2), relativePct: round(((b - a) / a) * 100, 1) };
}
export function round(n: number, d = 2): number {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

export interface WordDiffPart { kind: 'same' | 'add' | 'del'; text: string }
