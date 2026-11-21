// Unicode hygiene: contextual audit and conservative cleanup of invisible or confusable characters.
//
// Scope, stated plainly: this removes characters that are almost never intentional in prose
// (zero-width spaces, word joiners, stray BOMs, soft hyphens, tag characters, bidi overrides)
// and KEEPS characters that carry meaning (emoji joiners, variation selectors in emoji, Persian/Indic
// joiners, direction marks next to RTL text, NBSP). It does not "launder" text and says nothing about
// who wrote it. Behavior reviewed against the Layer-A pass of guillaumemeyer/watermarks-remover
// (clean-user-facing-text, MIT); this is an independent TypeScript implementation.

export type HitVerdict = 'remove' | 'keep';
export interface UnicodeHit {
  index: number;
  codePoint: number;
  hex: string;
  name: string;
  verdict: HitVerdict;
  reason: string;
}

const NAMES: Record<number, string> = {
  0x200b: 'ZERO WIDTH SPACE', 0x200c: 'ZERO WIDTH NON-JOINER', 0x200d: 'ZERO WIDTH JOINER', 0x200e: 'LEFT-TO-RIGHT MARK',
  0x200f: 'RIGHT-TO-LEFT MARK', 0x2060: 'WORD JOINER', 0xfeff: 'ZERO WIDTH NO-BREAK SPACE / BOM', 0x00ad: 'SOFT HYPHEN',
  0x180e: 'MONGOLIAN VOWEL SEPARATOR', 0x2061: 'FUNCTION APPLICATION', 0x2062: 'INVISIBLE TIMES', 0x2063: 'INVISIBLE SEPARATOR',
  0x2064: 'INVISIBLE PLUS', 0x202a: 'LRE', 0x202b: 'RLE', 0x202c: 'PDF', 0x202d: 'LRO', 0x202e: 'RLO', 0x2066: 'LRI', 0x2067: 'RLI',
  0x2068: 'FSI', 0x2069: 'PDI', 0xfe0f: 'VARIATION SELECTOR-16', 0xfe0e: 'VARIATION SELECTOR-15', 0x00a0: 'NO-BREAK SPACE',
  0x202f: 'NARROW NO-BREAK SPACE', 0x2007: 'FIGURE SPACE', 0x3000: 'IDEOGRAPHIC SPACE', 0x034f: 'COMBINING GRAPHEME JOINER',
};

const RTL = /[֐-׿؀-ۿ܀-ࣿיִ-﷿ﹰ-﻿]/;
const JOINING_SCRIPT = /[؀-ۿऀ-෿฀-๿ក-៿]/; // Arabic/Persian, Indic, Thai, Khmer
const EMOJI = /\p{Extended_Pictographic}/u;
const REGIONAL = /[\u{1F1E6}-\u{1F1FF}]/u;
const SKIN = /[\u{1F3FB}-\u{1F3FF}]/u;

function cpAt(text: string, i: number): number {
  return text.codePointAt(i) ?? 0;
}
function prevChar(text: string, i: number): string {
  if (i <= 0) return '';
  const lo = text.charCodeAt(i - 1);
  if (lo >= 0xdc00 && lo <= 0xdfff && i >= 2) return text.slice(i - 2, i);
  return text[i - 1];
}
function nextChar(text: string, i: number): string {
  const cp = text.codePointAt(i);
  return cp === undefined ? '' : String.fromCodePoint(cp);
}

export function auditUnicode(text: string): UnicodeHit[] {
  const hits: UnicodeHit[] = [];
  let i = 0;
  while (i < text.length) {
    const cp = cpAt(text, i);
    const width = cp > 0xffff ? 2 : 1;
    const at = i;
    i += width;
    const mk = (verdict: HitVerdict, reason: string) =>
      hits.push({ index: at, codePoint: cp, hex: 'U+' + cp.toString(16).toUpperCase().padStart(4, '0'), name: NAMES[cp] ?? (cp >= 0xe0000 && cp <= 0xe007f ? 'TAG CHARACTER' : 'CHARACTER'), verdict, reason });
    const before = prevChar(text, at);
    const after = nextChar(text, at + width);

    if (cp === 0x200b) { mk('remove', 'Zero-width space is not visible and rarely intentional in prose.'); continue; }
    if (cp === 0x2060 || (cp >= 0x2061 && cp <= 0x2064) || cp === 0x180e) { mk('remove', 'Invisible formatting character with no role in ordinary prose.'); continue; }
    if (cp === 0xfeff) { mk(at === 0 ? 'remove' : 'remove', at === 0 ? 'Byte-order mark at start of text.' : 'Stray zero-width no-break space inside text.'); continue; }
    if (cp === 0x00ad) { mk('remove', 'Soft hyphen is a layout hint, not part of the word.'); continue; }
    if (cp === 0x034f) { mk('remove', 'Combining grapheme joiner with no visible effect here.'); continue; }
    if (cp >= 0xe0000 && cp <= 0xe007f) {
      // Valid only inside subdivision flag sequences: base 🏴 followed by tags ending in U+E007F.
      const inFlag = /\u{1F3F4}[\u{E0020}-\u{E007E}]*$/u.test(text.slice(0, at)) ;
      mk(inFlag ? 'keep' : 'remove', inFlag ? 'Tag character inside a subdivision flag emoji.' : 'Tag character outside a flag emoji can hide data.');
      continue;
    }
    if (cp >= 0x202a && cp <= 0x202e) { mk('remove', 'Bidirectional embedding/override can reorder displayed text.'); continue; }
    if (cp >= 0x2066 && cp <= 0x2069) {
      mk(RTL.test(text) ? 'keep' : 'remove', RTL.test(text) ? 'Isolate in text that contains right-to-left script.' : 'Directional isolate in text with no right-to-left script.');
      continue;
    }
    if (cp === 0x200e || cp === 0x200f) {
      const near = RTL.test(before) || RTL.test(after) || RTL.test(text.slice(Math.max(0, at - 3), at + 3));
      mk(near ? 'keep' : 'remove', near ? 'Direction mark beside right-to-left script.' : 'Direction mark with no right-to-left text nearby.');
      continue;
    }
    if (cp === 0x200d) {
      const emojiSeq = (EMOJI.test(before) || SKIN.test(before) || before === '️') && EMOJI.test(after);
      const scriptSeq = JOINING_SCRIPT.test(before) && JOINING_SCRIPT.test(after);
      mk(emojiSeq || scriptSeq ? 'keep' : 'remove', emojiSeq ? 'Joiner inside an emoji sequence.' : scriptSeq ? 'Joiner required by the script.' : 'Joiner with no sequence to join.');
      continue;
    }
    if (cp === 0x200c) {
      const scriptSeq = JOINING_SCRIPT.test(before) && JOINING_SCRIPT.test(after);
      mk(scriptSeq ? 'keep' : 'remove', scriptSeq ? 'Non-joiner required by the script (e.g. Persian).' : 'Non-joiner with no script context.');
      continue;
    }
    if (cp === 0xfe0f || cp === 0xfe0e) {
      const ok = EMOJI.test(before) || /[#*0-9©®™←-⇿☀-➿]/.test(before) || REGIONAL.test(before);
      mk(ok ? 'keep' : 'remove', ok ? 'Variation selector on an emoji or symbol.' : 'Variation selector with nothing to modify.');
      continue;
    }
    if (cp === 0x00a0 || cp === 0x202f || cp === 0x2007) { mk('keep', 'Non-breaking space carries layout meaning (e.g. French typography).'); continue; }
  }
  return hits;
}

export interface CleanResult { text: string; removed: UnicodeHit[]; kept: UnicodeHit[] }

export function cleanUnicode(text: string): CleanResult {
  const hits = auditUnicode(text);
  const removed = hits.filter((h) => h.verdict === 'remove');
  const kept = hits.filter((h) => h.verdict === 'keep');
  if (!removed.length) return { text, removed, kept };
  const drop = new Set<number>();
  for (const h of removed) { drop.add(h.index); if (h.codePoint > 0xffff) drop.add(h.index + 1); }
  let out = '';
  for (let i = 0; i < text.length; i++) if (!drop.has(i)) out += text[i];
  return { text: out, removed, kept };
}

/**
 * "Meaningful" characters: anything outside printable ASCII that a rewrite must not silently lose.
 * Used by the finalizer to ensure accents, RTL text, emoji sequences and quote punctuation survive.
 */
export function meaningfulChars(text: string): Map<string, number> {
  const m = new Map<string, number>();
  const cleaned = cleanUnicode(text).text;
  for (const ch of cleaned) {
    if (/[\u0000-\u007f]/.test(ch) || /\s/.test(ch)) continue;
    m.set(ch, (m.get(ch) ?? 0) + 1);
  }
  return m;
}
