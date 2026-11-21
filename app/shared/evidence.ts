// Claim splitting, lexical retrieval (BM25 + phrase boost) and a deterministic evidence verifier.
// Baseline before any embeddings or model votes. The verifier can answer "insufficient".
import { extractNumbers, extractCitations, causalMarker, isAssociational, negations, hasExpectation, QUALIFICATIONS, type NumFact } from './meaning.ts';
import { findQuote, splitSentences } from './text.ts';
import { detectLanguage } from './lang.ts';

// ---------------------------------------------------------------------------------------------
export interface Claim {
  id: string;
  text: string;
  start: number;
  end: number;
  citations: string[];
}

const VERBISH =
  /\b(is|are|was|were|has|have|had|will|would|can|could|should|may|might|rose|fell|grew|shows?|showed|found|says?|said|argues?|argued|caused?|raises?|raised|improv\w+|increas\w+|decreas\w+|reduc\w+|led|leads?|means?|meant|makes?|made|did|does|do)\b|\w+(?:ed|es)\b/i;

/** Split a paragraph into checkable claims. Compound sentences are split at ; , and/but/while/whereas and "and" between clauses. */
export function splitClaims(paragraph: string, idPrefix = 'c'): Claim[] {
  const claims: Claim[] = [];
  let n = 0;
  for (const s of splitSentences(paragraph)) {
    const cuts: number[] = [];
    const re = /;\s+|,\s+(?:and|but|while|whereas|yet|so)\s+|\s+(?:and|but|whereas)\s+(?=\S)/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s.text))) {
      const left = s.text.slice(cuts.at(-1) ?? 0, m.index);
      const right = s.text.slice(m.index + m[0].length);
      const lw = left.split(/\s+/).filter(Boolean).length;
      const rw = right.split(/\s+/).filter(Boolean).length;
      const bare = /^\s+(?:and|but)\s+$/i.test(m[0]);
      // bare " and " only splits when both halves look like clauses
      if (bare && !(lw >= 4 && rw >= 4 && VERBISH.test(right))) continue;
      if (lw < 3 || rw < 2) continue;
      // Do not split inside a parenthetical citation or quotation
      const upTo = s.text.slice(0, m.index);
      if ((upTo.match(/\(/g)?.length ?? 0) > (upTo.match(/\)/g)?.length ?? 0)) continue;
      if ((upTo.match(/"/g)?.length ?? 0) % 2 === 1) continue;
      cuts.push(m.index + m[0].length);
    }
    const bounds = [0, ...cuts, s.text.length];
    for (let i = 0; i < bounds.length - 1; i++) {
      const rawStart = bounds[i];
      const rawEnd = bounds[i + 1];
      let t = s.text.slice(rawStart, rawEnd);
      const lead = t.length - t.trimStart().length;
      t = t
        .trim()
        .replace(/[;,]+$/, '')
        .trim();
      if (!t) continue;
      claims.push({
        id: `${idPrefix}${++n}`,
        text: t,
        start: s.start + rawStart + lead,
        end: s.start + rawStart + lead + t.length,
        citations: extractCitations(t).map((c) => c.text),
      });
    }
  }
  return claims;
}

// ---------------------------------------------------------------------------------------------
export interface IndexedPassage {
  id: string;
  text: string;
  sourceVersionId?: string;
  unreadable?: boolean;
  stale?: boolean;
}

const STOP = new Set(
  'a an the and or but of in on at to for from by with as is are was were be been being it its this that these those which who whom than then there their they them he she his her we our you your i me my not no do does did has have had will would can could should may might also into over under about after before during between among both each other such so very more most some any all one two three'.split(
    ' ',
  ),
);
export function tokenize(s: string): string[] {
  return (s.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'’]*/gu) ?? []).map(stem).filter((t) => t.length > 1 && !STOP.has(t));
}
function stem(w: string): string {
  w = w.replace(/['’]s$/, '');
  if (/^\d/.test(w)) return w;
  for (const suf of ['ations', 'ation', 'ings', 'ing', 'edly', 'ed', 'ies', 's']) {
    if (w.length > suf.length + 3 && w.endsWith(suf)) {
      w = suf === 'ies' ? w.slice(0, -3) + 'y' : w.slice(0, -suf.length);
      break;
    }
  }
  if (w.length > 4 && w.endsWith('e')) w = w.slice(0, -1);
  return w.length > 6 ? w.slice(0, 6) : w; // prefix stem: attendance/attendees -> attend
}

export class PassageIndex {
  private docs: {
    p: IndexedPassage;
    tf: Map<string, number>;
    len: number;
    tokens: string[];
  }[] = [];
  private df = new Map<string, number>();
  private avgLen = 1;
  constructor(passages: IndexedPassage[]) {
    for (const p of passages) {
      const tokens = tokenize(p.text);
      const tf = new Map<string, number>();
      for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
      for (const t of tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
      this.docs.push({ p, tf, len: tokens.length, tokens });
    }
    this.avgLen = this.docs.reduce((a, d) => a + d.len, 0) / Math.max(1, this.docs.length);
  }
  search(query: string, k = 5): { passage: IndexedPassage; score: number; coverage: number }[] {
    const q = tokenize(query);
    const qset = new Set(q);
    const N = this.docs.length;
    const bigrams = q.slice(0, -1).map((t, i) => t + ' ' + q[i + 1]);
    const out = this.docs.map((d) => {
      let score = 0;
      for (const t of qset) {
        const f = d.tf.get(t) ?? 0;
        if (!f) continue;
        const idf = Math.log(1 + (N - (this.df.get(t) ?? 0) + 0.5) / ((this.df.get(t) ?? 0) + 0.5));
        score += idf * ((f * 2.2) / (f + 1.2 * (0.25 + 0.75 * (d.len / this.avgLen))));
      }
      const joined = d.tokens.join(' ');
      for (const b of bigrams) if (joined.includes(b)) score += 1.5;
      const covered = [...qset].filter((t) => d.tf.has(t)).length;
      return {
        passage: d.p,
        score,
        coverage: qset.size ? covered / qset.size : 0,
      };
    });
    return out
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }
}

// ---------------------------------------------------------------------------------------------
export type Verdict = 'supported' | 'partial' | 'contradicted' | 'insufficient' | 'unreadable';
export interface ClaimVerdict {
  claimId: string;
  claim: string;
  verdict: Verdict;
  passageId: string | null;
  quote: { start: number; end: number; text: string } | null;
  reasons: string[];
  stale: boolean;
  /** 'deterministic' here; live providers add their own and the combined result is the more cautious one. */
  engine: string;
}

const OPPOSITES: [RegExp, RegExp][] = [
  [
    /\b(higher|more|greater|increas\w*|rose|rise[sn]?|up|gain\w*|grew|growth)\b/i,
    /\b(lower|less|fewer|smaller|decreas\w*|fell|fall[sn]?|down|declin\w*|drop\w*)\b/i,
  ],
];
/** Revised direction lexicon: "cooler/warmer" are directions; "or more" ("30% or more") and "at least" are thresholds, not directions. */
const OPPOSITES_REVISED: [RegExp, RegExp][] = [
  [
    /\b(higher|more(?=\s+(?:\w+\s+){0,3}than\b)|greater|increas\w*|rose|rise[sn]?|up|gain\w*|grew|growth|warmer|hotter)\b/i,
    /\b(lower|less(?=\s+(?:\w+\s+){0,3}than\b)|fewer(?=\s+(?:\w+\s+){0,3}than\b)|smaller|decreas\w*|fell|fall[sn]?|down|declin\w*|drop\w*|cooler|colder)\b/i,
  ],
];
const NEG_BEFORE = '(?<!\\bnot\\s)(?<!\\bnever\\s)(?<!\\bno\\s)(?<!\\bwithout\\s)';
const EXPERIMENTAL = new RegExp(
  NEG_BEFORE +
    '\\b(randomi[sz]ed|randomly assigned|assigned at random|random assignment|controlled (?:trial|experiment)|experiment(?:al)?(?: group)?|instrument(?:al)? variable|natural experiment|difference-in-differences)\\b',
  'i',
);
const OBSERVATIONAL =
  /\b(chose whether|self[- ]select\w*|volunt\w+|survey(?:ed)?|observational|correlat\w+|associated|not randomly|not (?:assigned )?at random|did not assign|cross-sectional|opt(?:ed)? in|their own choice)\b/i;

function bestSentence(passageText: string, claim: string): string {
  const sents = splitSentences(passageText);
  const ct = new Set(tokenize(claim));
  let best = sents[0]?.text ?? passageText;
  let bs = -1;
  for (const s of sents) {
    const sc = tokenize(s.text).filter((t) => ct.has(t)).length;
    if (sc > bs) {
      bs = sc;
      best = s.text;
    }
  }
  return best;
}

const STRONG_MARKER_RE =
  /^(causes?|caused|causing|leads? to|led to|leading to|results? in|resulted in|because of|due to|owing to|thanks to|as a result of|effects? of|impact (?:of|on)|drives?|drove|driven by|produces?|produced|responsible for)$/i;
function unitClass(n: NumFact): string {
  return n.unit === 'pp' ? 'percent' : n.unit;
}

/** Words that state a direction or comparison. A claim that states one is best supported by a sentence that states one too (lower <-> cooler). */
const DIRECTION =
  /\b(higher|lower|more|less|fewer|greater|smaller|cooler|warmer|faster|slower|better|worse|increas\w*|decreas\w*|reduc\w*|rais\w*|cool\w*|warm\w*|rose|rise[sn]?|fell|falls?|gain\w*|drop\w*|declin\w*)\b/i;
function pickHit<T extends { passage: IndexedPassage; score: number }>(hits: T[], claimText: string): T {
  if (hits.length < 2 || !DIRECTION.test(claimText)) return hits[0];
  let best = hits[0];
  let bestScore = -Infinity;
  for (const h of hits) {
    const score = h.score + (DIRECTION.test(bestSentence(h.passage.text, claimText)) ? 1.5 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = h;
    }
  }
  return best;
}

/** Rule sets. 'baseline' is the first-pass verifier, kept byte-for-byte in behaviour so revisions can be compared on identical inputs. */
export type Rules = 'baseline' | 'revised';

const CLAUSE_SPLIT = /;|,?\s+(?:though|although|but|while|whereas|however|aunque|pero)\s+|\s+[—–]\s+/i;
/** The clause of a sentence that the claim is actually about (shared vocabulary); negations and figures elsewhere in the sentence do not apply to it. */
export function bestClause(sentence: string, claimText: string): string {
  const parts = sentence
    .split(CLAUSE_SPLIT)
    .map((x) => x.trim())
    .filter(Boolean);
  if (parts.length < 2) return sentence;
  const c = new Set(tokenize(claimText));
  let best = parts[0];
  let score = -1;
  for (const part of parts) {
    const n = tokenize(part).filter((t) => c.has(t)).length;
    if (n > score) {
      score = n;
      best = part;
    }
  }
  return best;
}
/** Tokens that mix letters and digits (B4, 1O5) are typical OCR damage to a figure. */
const DAMAGED_FIGURE = /\b(?=[0-9A-Za-z]*\d)(?=[0-9A-Za-z]*[A-Za-z])[0-9A-Za-z]{2,}\b/g;
function damagedFigures(text: string): string[] {
  return (text.match(DAMAGED_FIGURE) ?? []).filter((t) => !/^\d+(st|nd|rd|th|s|k|m|bn)$/i.test(t));
}

export function verifyClaim(claim: Claim, index: PassageIndex, all: IndexedPassage[], opts: { rules?: Rules } = {}): ClaimVerdict {
  const rules = opts.rules ?? 'revised';
  const revised = rules === 'revised';
  const base = {
    claimId: claim.id,
    claim: claim.text,
    engine: revised ? 'deterministic-revised/2' : 'deterministic-baseline/1',
  };
  if (!all.length)
    return {
      ...base,
      verdict: 'insufficient',
      passageId: null,
      quote: null,
      reasons: ['No source passages are available for this assignment.'],
      stale: false,
    };
  // Coverage is measured on the claim's subject matter; the causal verb itself ("raised") is what the passage may lack.
  const marker = causalMarker(claim.text);
  const subject = marker ? claim.text.replace(STRONG_MARKER_RE.test(marker) ? marker : marker.split(/\s+/)[0], ' ') : claim.text;
  const hits = index.search(subject, 3);
  if (!hits.length) {
    const anyUnreadable = all.some((p) => p.unreadable);
    return {
      ...base,
      verdict: anyUnreadable ? 'unreadable' : 'insufficient',
      passageId: null,
      quote: null,
      reasons: [anyUnreadable ? 'A source could not be read; add its text or run OCR.' : 'No passage shares meaningful vocabulary with this claim.'],
      stale: false,
    };
  }
  const top = revised ? pickHit(hits, claim.text) : hits[0];
  const p = top.passage;
  // A study's design is described once for the whole source, so look at the same source's top hits, never other sources.
  const srcKey = (id: string) => id.replace(/_p\d+$/, '');
  const designText = hits
    .filter((h) => srcKey(h.passage.id) === srcKey(p.id))
    .map((h) => h.passage.text)
    .join(' ');
  const sent = bestSentence(p.text, claim.text);
  const reasons: string[] = [];
  let verdict: Verdict = 'supported';
  const cov = top.coverage;
  // Revised: a claim and passage in different languages cannot be compared word for word. Abstain rather than judge on figures alone.
  if (revised) {
    const lc = detectLanguage(claim.text);
    const lp = detectLanguage(p.text);
    if (lc !== 'other' && lp !== 'other' && lc !== lp)
      return {
        ...base,
        verdict: 'insufficient',
        passageId: p.id,
        quote: null,
        reasons: [
          `The claim is in ${lc} and the passage is in ${lp}. This checker compares wording, so it cannot judge support across languages. Read the passage yourself.`,
        ],
        stale: !!p.stale,
      };
  }
  const scope = revised ? bestClause(sent, claim.text) : sent;
  const damaged = revised ? damagedFigures(scope) : [];
  if (p.unreadable)
    return {
      ...base,
      verdict: 'unreadable',
      passageId: p.id,
      quote: null,
      reasons: ['The matching source could not be read.'],
      stale: !!p.stale,
    };

  const claimNums = extractNumbers(claim.text);
  const passNums = extractNumbers(damaged.length ? damaged.reduce((t, d) => t.split(d).join(' '), scope) : scope);
  const passPercents = passNums.filter((n) => n.unit === 'percent');
  for (const cn of claimNums) {
    const same = passNums.find((pn) => Math.abs(pn.value - cn.value) < 1e-9 && unitClass(pn) === unitClass(cn));
    if (same) continue;
    // A figure derived from two figures in the passage (a difference in points, or a relative change) is a calculation, not a new fact.
    if ((cn.unit === 'pp' || cn.unit === 'percent') && passPercents.length >= 2) {
      const [a, b] = passPercents;
      const pts = Math.abs(b.value - a.value);
      const rel = Math.abs(((b.value - a.value) / a.value) * 100);
      if (Math.abs(cn.value - pts) < 0.051 || Math.abs(cn.value - rel) < 0.06) {
        if (cn.unit === 'percent' && Math.abs(cn.value - pts) < 0.051) {
          if (verdict === 'supported') verdict = 'partial';
          reasons.push(
            `"${cn.raw}" is ambiguous: the passage's ${a.raw} to ${b.raw} is ${pts} percentage points and about ${Math.round(rel * 10) / 10}% in relative terms.`,
          );
        } else reasons.push(`"${cn.raw}" is derived from ${a.raw} and ${b.raw} in the passage.`);
        continue;
      }
    }
    if (damaged.length && cn.unit !== 'year') {
      if (verdict !== 'contradicted') verdict = 'insufficient';
      reasons.push(
        `The source text has a damaged figure (${damaged.map((d) => `"${d}"`).join(', ')}), possibly an OCR error. Check the original page before relying on ${cn.raw}.`,
      );
      continue;
    }
    const comparable = passNums.filter((pn) => unitClass(pn) === unitClass(cn));
    if (comparable.length && cov >= 0.4) {
      verdict = 'contradicted';
      reasons.push(`The claim says ${cn.raw} but the passage gives ${comparable.map((c) => c.raw).join(' / ')}.`);
    } else if (verdict !== 'contradicted' && cn.unit !== 'year') {
      verdict = 'insufficient';
      reasons.push(`The figure ${cn.raw} does not appear in the best-matching passage.`);
    }
  }
  // A projection or expectation in the source must not become a plain statement of fact in the claim.
  if (verdict === 'supported' && hasExpectation(scope) && !hasExpectation(claim.text)) {
    verdict = 'partial';
    reasons.push('The passage states an expectation or projection; the claim states it as established fact.');
  }
  // A qualifier such as "statistically significant" or "on average" that the source attaches must survive in the claim.
  if (verdict === 'supported') {
    for (const q of QUALIFICATIONS) {
      if (['only', 'among', 'sample', 'some', 'pilot'].includes(q)) continue;
      if (new RegExp(`\\b${q}\\b`, 'i').test(sent) && !new RegExp(`\\b${q}\\b`, 'i').test(claim.text)) {
        verdict = 'partial';
        reasons.push(`The passage qualifies this with "${q}"; the claim drops that qualification.`);
        break;
      }
    }
  }
  const cNeg = negations(claim.text).length > 0;
  const pNeg = negations(scope).length > 0;
  if (cov >= 0.4 && cNeg !== pNeg) {
    verdict = 'contradicted';
    reasons.push(cNeg ? 'The claim negates something the passage states.' : 'The passage negates something the claim states.');
  }
  for (const [a, b] of revised ? OPPOSITES_REVISED : OPPOSITES) {
    if (cov >= 0.4 && ((a.test(claim.text) && b.test(scope) && !a.test(scope)) || (b.test(claim.text) && a.test(scope) && !b.test(scope)))) {
      verdict = 'contradicted';
      reasons.push('The claim and the passage point in opposite directions.');
    }
  }
  if (verdict === 'supported') {
    if (cov < 0.34) {
      verdict = 'insufficient';
      reasons.push('Only a small part of the claim is covered by the best passage.');
    } else if (cov < 0.6) {
      verdict = 'partial';
      reasons.push(`The passage covers about ${Math.round(cov * 100)}% of the claim's terms; the rest is not supported there.`);
    }
  }
  // Causal overreach: association in the source, causation in the claim.
  const cm = causalMarker(claim.text);
  if (cm && verdict !== 'contradicted' && verdict !== 'insufficient') {
    if (!EXPERIMENTAL.test(designText) && !(causalMarker(sent) && !isAssociational(sent))) {
      verdict = 'partial';
      reasons.push(
        OBSERVATIONAL.test(designText)
          ? `"${cm}" asserts causation, but the passage describes a comparison where participants chose their own group. It supports an association, not a cause.`
          : `"${cm}" asserts causation, but the passage does not describe a design that can establish a cause.`,
      );
    }
  }
  if (!reasons.length) reasons.push('Terms, figures and direction match the passage.');
  const q = findQuote(p.text, sent);
  return {
    ...base,
    verdict,
    passageId: p.id,
    quote: q ? { ...q, text: p.text.slice(q.start, q.end) } : null,
    reasons,
    stale: !!p.stale,
  };
}

export function verifyParagraph(
  paragraph: string,
  passages: IndexedPassage[],
  idPrefix = 'c',
  opts: { rules?: Rules } = {},
): { claims: Claim[]; verdicts: ClaimVerdict[] } {
  const index = new PassageIndex(passages);
  const claims = splitClaims(paragraph, idPrefix);
  return {
    claims,
    verdicts: claims.map((c) => verifyClaim(c, index, passages, opts)),
  };
}

/** Cautious merge of two verdicts about the same claim (deterministic + model). The worse outcome wins; disagreement is reported. */
const SEVERITY: Record<Verdict, number> = {
  supported: 0,
  partial: 1,
  insufficient: 2,
  unreadable: 2,
  contradicted: 3,
};
export function mergeVerdicts(a: ClaimVerdict, b: ClaimVerdict): ClaimVerdict & { disagreement: boolean } {
  const worse = SEVERITY[b.verdict] > SEVERITY[a.verdict] ? b : a;
  return {
    ...worse,
    reasons: [...new Set([...a.reasons, ...b.reasons])],
    engine: `${a.engine}+${b.engine}`,
    disagreement: a.verdict !== b.verdict,
  };
}
