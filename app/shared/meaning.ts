// Deterministic meaning-preservation checker (the "Finalizer" core).
//
// It compares an original span with a candidate replacement and reports properties that changed,
// each checked independently: numbers/units, quotes, citations, negation, qualifications,
// hedges, attribution, conditions/horizons, periodicity, and introduced causal language.
// It is a lexical-structural check. It cannot prove semantic equivalence, and a pass here is
// not a claim of factual accuracy; ambiguous cases are reported, never silently accepted.
import { pctPointDiff, round } from './text.ts';
import { meaningfulChars } from './unicode.ts';

export type FindingCategory =
  | 'number_removed'
  | 'number_introduced'
  | 'unit_changed'
  | 'quote_changed'
  | 'citation_changed'
  | 'negation_changed'
  | 'qualification_dropped'
  | 'hedge_dropped'
  | 'attribution_dropped'
  | 'condition_dropped'
  | 'period_changed'
  | 'causal_introduced'
  | 'entity_removed'
  | 'character_lost';
export type Severity = 'material' | 'minor';

export interface Finding {
  category: FindingCategory;
  severity: Severity;
  original: string;
  candidate: string;
  message: string;
}

export interface NumFact {
  raw: string;
  value: number;
  unit: 'percent' | 'pp' | 'usd' | 'eur' | 'gbp' | 'count' | 'year';
  approx: boolean;
  index: number;
}

const SCALE: Record<string, number> = {
  thousand: 1e3,
  k: 1e3,
  million: 1e6,
  m: 1e6,
  mn: 1e6,
  billion: 1e9,
  bn: 1e9,
  b: 1e9,
  trillion: 1e12,
};
const APPROX_WORDS = /\b(about|approximately|roughly|around|nearly|almost|circa|some|an estimated|estimated at|or so)\b|~/i;

export function extractNumbers(text: string): NumFact[] {
  const out: NumFact[] = [];
  const re =
    /(?<![\w.])(?<cur>[$€£])?\s?(?<num>\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(?:\s?(?<scale>thousand|million|billion|trillion|bn|mn|k|m|b)\b)?(?<unit>\s?%|\s?percent(?:age)?\s+points?|\s?percentage\s+points?|\s?pp\b|\s?points?\b|\s?percent\b)?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const g = m.groups!;
    let value = parseFloat(g.num.replace(/,/g, ''));
    if (Number.isNaN(value)) continue;
    let scaleWord: string | undefined = g.scale?.toLowerCase();
    // "m"/"b"/"k" alone must be attached to a currency or be a clear suffix to avoid "5 m tall"
    if (scaleWord && ['m', 'b', 'k', 'mn', 'bn'].includes(scaleWord) && !g.cur) scaleWord = undefined;
    if (scaleWord) value *= SCALE[scaleWord];
    let unit: NumFact['unit'] = 'count';
    const u = (g.unit ?? '').trim().toLowerCase();
    if (g.cur) unit = g.cur === '$' ? 'usd' : g.cur === '€' ? 'eur' : 'gbp';
    else if (u === '%' || u === 'percent') unit = 'percent';
    else if (u) unit = 'pp';
    else if (/^(19|20)\d{2}$/.test(g.num) && !scaleWord) unit = 'year';
    const before = text.slice(Math.max(0, m.index - 24), m.index);
    out.push({
      raw: m[0].trim(),
      value,
      unit,
      approx: APPROX_WORDS.test(before),
      index: m.index,
    });
  }
  return out;
}

export interface Quote {
  text: string;
  start: number;
  end: number;
}
export function extractQuotes(text: string): Quote[] {
  const out: Quote[] = [];
  const re = /"([^"\n]{3,}?)"|“([^”\n]{3,}?)”/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)))
    out.push({
      text: (m[1] ?? m[2]).trim(),
      start: m.index,
      end: m.index + m[0].length,
    });
  return out;
}

export interface Citation {
  text: string;
  start: number;
  end: number;
}
export function extractCitations(text: string): Citation[] {
  const out: Citation[] = [];
  const res = [
    /\((?:[A-Z][\p{L}'’.\-]+(?:\s(?:and|&)\s[A-Z][\p{L}'’.\-]+)?(?:\set al\.)?)(?:,?\s(?:\d{4}[a-z]?))?(?:,?\s(?:pp?\.\s?)?\d+(?:[-–]\d+)?)?\)/gu,
    /\[\d+(?:\s*[,–-]\s*\d+)*\]/g,
    /\((?:lines?|ll\.)\s?\d+(?:[-–]\d+)?\)/gi,
  ];
  for (const re of res) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const t = m[0];
      // A parenthetical of one capitalised word with nothing else is not a citation.
      if (/^\([A-Z][\p{L}'’.\-]+\)$/u.test(t)) continue;
      out.push({ text: t, start: m.index, end: m.index + t.length });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

const NEG =
  /\b(not|no|never|none|neither|nor|cannot|without|fails? to|failed to|did not|does not|do not|isn't|aren't|wasn't|weren't|didn't|doesn't|don't|can't|won't|hasn't|haven't)\b/gi;
export function negations(text: string): string[] {
  return text.match(NEG)?.map((s) => s.toLowerCase()) ?? [];
}

export const QUALIFICATIONS = [
  'statistically significant',
  'on average',
  'in some cases',
  'in part',
  'partly',
  'preliminary',
  'self-reported',
  'observational',
  'pilot',
  'sample',
  'at least',
  'at most',
  'only',
  'mostly',
  'largely',
  'among',
];
const HEDGE_CLASSES: { id: string; label: string; re: RegExp }[] = [
  {
    id: 'approx',
    label: 'approximation (about, roughly...)',
    re: /\b(about|approximately|roughly|around|nearly|almost|circa|or so)\b|~/i,
  },
  {
    id: 'epistemic',
    label: 'uncertainty (may, suggests, likely...)',
    re: /\b(may|might|could|possibly|perhaps|likely|probably|appears?|seems?|suggests?|tends?|tend to|unclear|uncertain)\b/i,
  },
  {
    id: 'expectation',
    label: 'expectation or projection (expects, projects...)',
    re: /\b(expects?|expected|projects?|projected|forecasts?|anticipates?|anticipated|estimates?|estimated|plans? to|is set to|will|would|predict(?:s|ed)?)\b/i,
  },
];

const ATTR_VERBS =
  'expects|projects|reports|claims|argues|states|says|found|finds|estimates|forecasts|announced|notes|believes|predicts|suggests|contends|asserts|concludes|shows|showed';
export interface Attribution {
  subject: string;
  verb: string;
}
export function attributions(text: string): Attribution[] {
  const out: Attribution[] = [];
  const re1 = new RegExp(
    `(?:^|[.!?]\\s+|,\\s+)((?:The|A|An)?\\s?[A-Z][\\p{L}'’\\-]*(?:\\s[A-Z][\\p{L}'’\\-]*){0,3}|The\\s[\\p{L}\\-]+(?:\\s[\\p{L}\\-]+)?)\\s+(?:also\\s)?(${ATTR_VERBS})\\b`,
    'gu',
  );
  let m: RegExpExecArray | null;
  while ((m = re1.exec(text))) {
    const subj = m[1].trim();
    if (/^(it|this|that|which|who|they|we|i|he|she)$/i.test(subj)) continue;
    out.push({ subject: subj, verb: m[2].toLowerCase() });
  }
  const re2 = /\baccording to ([A-Z][\p{L}'’\- ]{1,40}?)(?:,|\s(?:the|a)\b)/gu;
  while ((m = re2.exec(text))) out.push({ subject: m[1].trim(), verb: 'according to' });
  return out;
}

const COND_RE = /\b(after|once|when|whenever|if|unless|following|upon|provided that|as long as|until|before|by the end of)\b/gi;
export function conditions(text: string): string[] {
  return text.match(COND_RE)?.map((s) => s.toLowerCase()) ?? [];
}

const PERIOD_CLASSES: [string, RegExp][] = [
  ['year', /\b(annual|annually|yearly|per year|a year|each year|every year|per annum|\/yr)\b/i],
  ['month', /\b(monthly|per month|a month|each month|every month)\b/i],
  ['quarter', /\b(quarterly|per quarter|a quarter|each quarter)\b/i],
  ['week', /\b(weekly|per week|a week|each week)\b/i],
  ['day', /\b(daily|per day|a day|each day)\b/i],
];
export function periodOf(text: string): string | null {
  for (const [id, re] of PERIOD_CLASSES) if (re.test(text)) return id;
  return null;
}

// --- causal language ---------------------------------------------------------------------------
const STRONG_CAUSAL =
  /\b(causes?|caused|causing|leads? to|led to|leading to|results? in|resulted in|because of|due to|owing to|thanks to|as a result of|effect of|effects of|impact of|impact on|drives?|drove|driven by|produces?|produced|responsible for)\b/i;
const AGENTIVE =
  /\b(rais(?:e|es|ed|ing)|improv(?:e|es|ed|ing)|boost(?:s|ed|ing)?|increas(?:e|es|ed|ing)|reduc(?:e|es|ed|ing)|lower(?:s|ed|ing)?|enhanc(?:e|es|ed|ing)|rais(?:e|ed))\s+(?!by\b|from\b|to\b|in\b|after\b|when\b|during\b|over\b|between\b|across\b|for\b|above\b|below\b|slightly\b|sharply\b|modestly\b|significantly\b|steadily\b|again\b|further\b|\d)([a-z][\p{L}'-]*)/iu;
const ASSOC =
  /\b(associated with|correlat\w+|linked to|related to|tend(?:s|ed)? to|coincid\w+|accompan\w+|higher (?:among|for|in)|co-occur\w*|goes? along with)\b/i;
export function causalMarker(text: string): string | null {
  const s = text.match(STRONG_CAUSAL);
  if (s) return s[0];
  const a = text.match(AGENTIVE);
  if (a) return a[0].trim();
  return null;
}
export function hasExpectation(text: string): boolean {
  return HEDGE_CLASSES.find((h) => h.id === 'expectation')!.re.test(text);
}
export function isAssociational(text: string): boolean {
  return ASSOC.test(text);
}

// --- comparison ---------------------------------------------------------------------------------
export interface MeaningReport {
  findings: Finding[];
  material: Finding[];
  outcome: 'acceptable' | 'decision_required' | 'failed';
}

function sameNumber(a: NumFact, b: NumFact): boolean {
  if (Math.abs(a.value - b.value) > 1e-9 * Math.max(1, Math.abs(a.value))) return false;
  if (a.unit === b.unit) return true;
  // "5" with no unit vs "5 points" is not interchangeable with percent; count vs year equal numerically is fine
  return (a.unit === 'count' && b.unit === 'year') || (a.unit === 'year' && b.unit === 'count');
}

function wordPresent(text: string, word: string): boolean {
  return new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text);
}

export function compareMeaning(original: string, candidate: string): MeaningReport {
  const findings: Finding[] = [];
  const add = (f: Finding) => findings.push(f);

  // Numbers and units ------------------------------------------------------------------------
  const on = extractNumbers(original);
  const cn = extractNumbers(candidate);
  const unmatchedC = [...cn];
  const missing: NumFact[] = [];
  for (const o of on) {
    const idx = unmatchedC.findIndex((c) => sameNumber(o, c));
    if (idx >= 0) unmatchedC.splice(idx, 1);
    else missing.push(o);
  }
  // Derived-percentage trap: two original percents, candidate offers a different percent.
  const origPercents = on.filter((n) => n.unit === 'percent');
  let explained = false;
  if (origPercents.length >= 2) {
    const [a, b] = origPercents;
    const { points, relativePct } = pctPointDiff(a.value, b.value);
    for (const c of unmatchedC.filter((x) => x.unit === 'percent' || x.unit === 'pp')) {
      if (Math.abs(c.value - Math.abs(points)) < 0.051 || Math.abs(c.value - Math.abs(relativePct)) < 0.051) {
        explained = true;
        add({
          category: 'unit_changed',
          severity: 'material',
          original: `${a.raw} to ${b.raw}`,
          candidate: c.raw,
          message: `"${c.raw}" is ambiguous. The original change is ${round(Math.abs(points), 2)} percentage points (${a.raw} to ${b.raw}) and about ${round(Math.abs(relativePct), 1)}% in relative terms. Do not assume which was intended.`,
        });
        unmatchedC.splice(unmatchedC.indexOf(c), 1);
        for (const mm of [a, b]) {
          const i = missing.indexOf(missing.find((x) => x.raw === mm.raw)!);
          if (i >= 0) missing.splice(i, 1);
        }
        break;
      }
    }
  }
  for (const o of missing) {
    // same value, different unit?
    const near = unmatchedC.find((c) => Math.abs(c.value - o.value) < 1e-9);
    if (near) {
      add({
        category: 'unit_changed',
        severity: 'material',
        original: o.raw,
        candidate: near.raw,
        message: `Unit or scale changed: "${o.raw}" became "${near.raw}".`,
      });
      unmatchedC.splice(unmatchedC.indexOf(near), 1);
    } else {
      add({
        category: 'number_removed',
        severity: 'material',
        original: o.raw,
        candidate: '',
        message: `The figure "${o.raw}" no longer appears.`,
      });
    }
  }
  if (!explained) {
    for (const c of unmatchedC) {
      if (c.unit === 'year' && !on.length) continue;
      add({
        category: 'number_introduced',
        severity: 'material',
        original: '',
        candidate: c.raw,
        message: `The figure "${c.raw}" is new and has no source in the original sentence.`,
      });
    }
  }

  // Quotes ------------------------------------------------------------------------------------
  const foldQ = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
  const cq = foldQ(candidate);
  for (const q of extractQuotes(original)) {
    if (!cq.includes(foldQ(q.text)))
      add({
        category: 'quote_changed',
        severity: 'material',
        original: q.text,
        candidate: '',
        message: `Quoted text "${q.text}" was altered or removed. Quotations must stay verbatim.`,
      });
  }
  // Citations ---------------------------------------------------------------------------------
  const ccit = extractCitations(candidate).map((c) => c.text.replace(/\s+/g, ' '));
  for (const c of extractCitations(original)) {
    if (!ccit.includes(c.text.replace(/\s+/g, ' ')))
      add({
        category: 'citation_changed',
        severity: 'material',
        original: c.text,
        candidate: '',
        message: `Citation ${c.text} was changed or removed.`,
      });
  }
  for (const c of ccit) {
    if (!extractCitations(original).some((o) => o.text.replace(/\s+/g, ' ') === c))
      add({
        category: 'citation_changed',
        severity: 'material',
        original: '',
        candidate: c,
        message: `Citation ${c} was added by the rewrite and must be checked against the source.`,
      });
  }

  // Negation and qualification -----------------------------------------------------------------
  const on0 = negations(original);
  const cn0 = negations(candidate);
  if (on0.length > 0 !== cn0.length > 0) {
    add({
      category: 'negation_changed',
      severity: 'material',
      original: on0.join(', '),
      candidate: cn0.join(', '),
      message: on0.length ? 'A negation in the original is missing from the rewrite.' : 'The rewrite introduces a negation.',
    });
  }
  for (const q of QUALIFICATIONS) {
    if (wordPresent(original, q) && !wordPresent(candidate, q)) {
      const strongInference = q === 'statistically significant' && on0.length > 0;
      add({
        category: 'qualification_dropped',
        severity: strongInference || q === 'statistically significant' || q === 'at least' || q === 'at most' ? 'material' : 'minor',
        original: q,
        candidate: '',
        message: strongInference
          ? `The qualification "${q}" was dropped. "Did not show a ${q} effect" is weaker than "no effect"; the rewrite changes the inference.`
          : `The qualification "${q}" no longer appears.`,
      });
    }
  }

  // Hedges ------------------------------------------------------------------------------------
  for (const h of HEDGE_CLASSES) {
    if (h.re.test(original) && !h.re.test(candidate)) {
      add({
        category: 'hedge_dropped',
        severity: 'material',
        original: original.match(h.re)![0],
        candidate: '',
        message: `Lost ${h.label}: "${original.match(h.re)![0]}" is not carried into the rewrite.`,
      });
    }
  }

  // Attribution -------------------------------------------------------------------------------
  for (const a of attributions(original)) {
    const head = a.subject.replace(/^(the|a|an)\s+/i, '');
    const ok = wordPresent(candidate, head) || /\baccording to\b/i.test(candidate);
    if (!ok)
      add({
        category: 'attribution_dropped',
        severity: 'material',
        original: `${a.subject} ${a.verb}`,
        candidate: '',
        message: `The attribution to "${a.subject}" is gone, so the claim now reads as established fact.`,
      });
  }

  // Conditions and period ---------------------------------------------------------------------
  if (conditions(original).length && !conditions(candidate).length) {
    add({
      category: 'condition_dropped',
      severity: 'material',
      original: conditions(original).join(', '),
      candidate: '',
      message: 'A time or condition clause ("' + conditions(original)[0] + '...") was dropped.',
    });
  }
  const po = periodOf(original);
  const pc = periodOf(candidate);
  if (po && po !== pc)
    add({
      category: 'period_changed',
      severity: 'material',
      original: po,
      candidate: pc ?? '',
      message: `The reporting period (${po}) was ${pc ? 'changed to ' + pc : 'dropped'}.`,
    });

  // Causal language ---------------------------------------------------------------------------
  const co = causalMarker(original);
  const cc = causalMarker(candidate);
  if (!co && cc)
    add({
      category: 'causal_introduced',
      severity: 'material',
      original: '',
      candidate: cc,
      message: `The rewrite asserts causation ("${cc}") where the original did not.`,
    });

  // Named entities (capitalised tokens not at sentence start) -----------------------------------
  const ents = (t: string) => new Set([...t.matchAll(/(?<![.!?]\s)(?<!^)\b([A-Z][\p{L}'’\-]{2,})\b/gu)].map((m) => m[1]));
  const ce = ents(candidate);
  for (const e of ents(original))
    if (!ce.has(e) && !candidate.includes(e))
      add({
        category: 'entity_removed',
        severity: 'minor',
        original: e,
        candidate: '',
        message: `The name "${e}" no longer appears.`,
      });

  // Meaningful characters ---------------------------------------------------------------------
  const mo = meaningfulChars(original);
  const mc = meaningfulChars(candidate);
  for (const [ch, n] of mo) {
    if ((mc.get(ch) ?? 0) < n && !/[‘’“”—–…]/.test(ch)) {
      add({
        category: 'character_lost',
        severity: 'material',
        original: ch,
        candidate: '',
        message: `The character "${ch}" (U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}) was lost. Accents, other scripts and emoji must survive a rewrite.`,
      });
    }
  }

  const material = findings.filter((f) => f.severity === 'material');
  const failed = findings.some((f) => f.category === 'quote_changed');
  return {
    findings,
    material,
    outcome: failed ? 'failed' : material.length ? 'decision_required' : 'acceptable',
  };
}

/** Spans that drafting/revision must not rewrite on their own: quotes, citations and figures. */
export interface ProtectedSpan {
  start: number;
  end: number;
  kind: 'quote' | 'citation' | 'number';
  text: string;
}
export function protectedSpans(text: string): ProtectedSpan[] {
  const spans: ProtectedSpan[] = [];
  for (const q of extractQuotes(text))
    spans.push({
      start: q.start,
      end: q.end,
      kind: 'quote',
      text: text.slice(q.start, q.end),
    });
  for (const c of extractCitations(text)) spans.push({ start: c.start, end: c.end, kind: 'citation', text: c.text });
  for (const n of extractNumbers(text))
    if (n.unit !== 'year')
      spans.push({
        start: n.index,
        end: n.index + n.raw.length,
        kind: 'number',
        text: n.raw,
      });
  return spans.sort((a, b) => a.start - b.start);
}
