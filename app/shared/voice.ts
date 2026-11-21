// Voice profile + clarity policy ("Humanizer" step) + hygiene step, as server-side functionality.
//
// Policy provenance (see POLICY_PROVENANCE): clarity rules are an independent TypeScript implementation of
// a subset of the pattern catalog in blader/humanizer (MIT, SKILL.md v4.0.0 @ a32f244); hygiene is
// shared/unicode.ts (behavior reviewed against guillaumemeyer/watermarks-remover Layer A @ 5a62be6, MIT).
// This module is a clarity editor. It does not measure or optimise against AI detectors, does not inject
// typos, random rhythm, slang or invented specifics, and never claims a result is "undetectable".
import { compareMeaning, protectedSpans, type MeaningReport } from './meaning.ts';
import { cleanUnicode } from './unicode.ts';
import { splitSentences, splitParagraphs } from './text.ts';
import { tokenize } from './evidence.ts';

export const POLICY_VERSION = 'writing-studio-policy/1 (humanizer-rules@a32f244 subset + hygiene@5a62be6 layer-A port)';
export const POLICY_PROVENANCE = {
  humanizer: {
    repo: 'https://github.com/blader/humanizer',
    sha: 'a32f24407364c74c812b43c15926d638bee1e072',
    license: 'MIT',
    used: 'pattern catalog subset, reimplemented',
  },
  watermarksRemover: {
    repo: 'https://github.com/guillaumemeyer/watermarks-remover',
    sha: '5a62be6338d2812372b1da440e55c82922f97d53',
    license: 'MIT',
    used: 'clean-user-facing-text Layer A (invisible Unicode) behavior, reimplemented; detector-lever workflow, remove-ai-marks and stealer NOT used',
  },
};

export interface VoiceSample {
  id: string;
  text: string;
  genre: string;
  language: string;
  audience: string;
  register: string;
}
export interface VoiceProfile {
  directness: 'direct' | 'neutral' | 'formal';
  firstPerson: 'avoid' | 'allow' | 'prefer';
  avoidEmDash: boolean;
  preferredTerms: Record<string, string>;
  openings: string[];
  language: string;
  notes: string;
  /** set true only after the writer confirmed each preference against a real sample */
  confirmed: Record<string, boolean>;
}
export const NEUTRAL_PROFILE: VoiceProfile = {
  directness: 'neutral',
  firstPerson: 'allow',
  avoidEmDash: false,
  preferredTerms: {},
  openings: [],
  language: 'auto',
  notes: '',
  confirmed: {},
};
export const FOUNDER_PROFILE: VoiceProfile = {
  ...NEUTRAL_PROFILE,
  directness: 'direct',
  avoidEmDash: true,
  notes: 'Concise direct prose; no em dashes.',
};

export function detectLanguage(text: string): 'en' | 'es' | 'he' | 'other' {
  if (/[֐-׿]/.test(text) && (text.match(/[֐-׿]/g)?.length ?? 0) > text.length * 0.2) return 'he';
  const words = text.toLowerCase().match(/\p{L}+/gu) ?? [];
  const score = (set: string[]) => words.filter((w) => set.includes(w)).length;
  const en = score(['the', 'and', 'of', 'to', 'is', 'in', 'that', 'was', 'for', 'with', 'are', 'it']);
  const es = score(['el', 'la', 'los', 'las', 'de', 'que', 'y', 'es', 'en', 'un', 'una', 'por', 'con', 'para', 'mi', 'su']);
  if (!words.length) return 'other';
  if (es > en && es >= 2) return 'es';
  if (en >= 2) return 'en';
  return 'other';
}

export interface ClarityFlag {
  rule: string;
  quote: string;
  start: number;
  end: number;
  effect: string;
  fix?: { replacement: string; mechanical: true };
}

const STOCK_FIX: [RegExp, string][] = [
  [/\bin order to\b/gi, 'to'],
  [/\bdue to the fact that\b/gi, 'because'],
  [/\bin spite of the fact that\b/gi, 'although'],
  [/\bat this point in time\b/gi, 'now'],
  [/\bhas the ability to\b/gi, 'can'],
  [/\butili[sz](e|es|ed|ing)\b/gi, 'use'],
];
const STOCK_WORDS =
  /\b(delve[sd]?|delving|tapestry|testament|underscore[sd]?|underscoring|foster(?:s|ed|ing)?|seamless(?:ly)?|multifaceted|myriad|paradigm shift|realm|intricate|navigate the complexities|in today[’']s fast-paced world|plays? a (?:crucial|vital|pivotal|key) role|it is important to note that|it(?:[’']s| is) worth noting that|stands? as a testament|a rich tapestry|ever-evolving|game-chang\w+)\b/gi;
const TRANSITIONS = /(^|[.!?]\s+)(Moreover|Furthermore|Additionally|In addition|Overall|In conclusion|In summary|Ultimately),\s+/g;
const NOMINAL: [RegExp, string][] = [
  [/\bconduct(?:ed)? an analysis of\b/gi, 'analyzed'],
  [/\bperform(?:ed)? an examination of\b/gi, 'examined'],
  [/\bmade a decision to\b/gi, 'decided to'],
  [/\bgive(?:s|n)? consideration to\b/gi, 'consider'],
  [/\bgave consideration to\b/gi, 'considered'],
];
const CHATBOT = /\b(I hope this helps|As an AI(?: language model)?|Certainly!|Great question!?|Let me know if you(?:'d| would) like)\b[^.]*\.?\s*/gi;
const BORROWED = /\b(studies show|research shows|experts (?:say|agree)|many (?:people )?believe|it is (?:widely|well) known|everyone knows)\b/gi;

function flag(text: string, m: RegExpMatchArray | RegExpExecArray, rule: string, effect: string, fix?: string): ClarityFlag {
  const start = m.index!;
  return {
    rule,
    quote: m[0],
    start,
    end: start + m[0].length,
    effect,
    fix: fix === undefined ? undefined : { replacement: fix, mechanical: true },
  };
}

/** Flags passages that read as stock phrasing. Every flag quotes the passage and says what it costs the reader. */
export function clarityFlags(text: string, profile: VoiceProfile = NEUTRAL_PROFILE): ClarityFlag[] {
  const lang = profile.language !== 'auto' ? profile.language : detectLanguage(text);
  const flags: ClarityFlag[] = [];
  if (profile.avoidEmDash) {
    for (const m of text.matchAll(/\s?—\s?/g)) {
      const after = text.slice(m.index! + m[0].length, m.index! + m[0].length + 1);
      flags.push(
        flag(text, m, 'em_dash', 'You asked to avoid em dashes; this one joins two ideas without saying how they relate.', /[a-z]/.test(after) ? ', ' : '. '),
      );
    }
  }
  if (lang !== 'en') return flags; // English-specific rules never run on other languages
  for (const [re, rep] of STOCK_FIX)
    for (const m of text.matchAll(re))
      flags.push(flag(text, m, 'wordy_phrase', 'A longer phrase says what a shorter one says; the reader spends effort on nothing.', rep));
  for (const m of text.matchAll(STOCK_WORDS)) {
    const fix = /it is important to note that|it(?:[’']s| is) worth noting that/i.test(m[0]) ? '' : undefined;
    flags.push(flag(text, m, 'stock_vocabulary', 'Stock phrasing the reader has seen in many other places; it signals importance without giving a fact.', fix));
  }
  for (const m of text.matchAll(TRANSITIONS))
    flags.push({
      rule: 'stock_transition',
      quote: m[2] + ',',
      start: m.index! + m[1].length,
      end: m.index! + m[0].length,
      effect: 'The transition names no relationship the reader cannot already see between the two sentences.',
      fix: { replacement: '', mechanical: true },
    });
  for (const [re, rep] of NOMINAL)
    for (const m of text.matchAll(re))
      flags.push(flag(text, m, 'nominalization', 'The action is buried in a noun, so the sentence is longer and the actor is harder to find.', rep));
  for (const m of text.matchAll(/\bnot (?:just|only|merely) [^.,;]{3,60}, but (?:also )?/gi))
    flags.push(flag(text, m, 'not_x_but_y', 'Stages a contrast with a claim nobody made, then states the real point.'));
  for (const m of text.matchAll(/\b(?:marks?|represents?|serves? as) a (?:pivotal|significant|crucial|key) (?:moment|step|milestone|turning point)\b/gi))
    flags.push(flag(text, m, 'inflated_significance', 'Labels something as important instead of showing why.'));
  for (const m of text.matchAll(BORROWED)) flags.push(flag(text, m, 'unattributed_authority', 'Appeals to unnamed authority; the reader cannot check it.'));
  for (const m of text.matchAll(CHATBOT))
    flags.push(flag(text, m, 'chat_residue', "A leftover from a chat conversation; it is addressed to nobody in your reader's position.", ''));
  for (const m of text.matchAll(/\b(?:very|extremely|highly) (?:important|significant|crucial|essential)\b/gi))
    flags.push(flag(text, m, 'vague_importance', 'Claims importance without a figure, example or consequence.'));
  // Repeated sentence openings (3 in a row)
  const sents = splitSentences(text);
  for (let i = 0; i + 2 < sents.length; i++) {
    const w = (s: { text: string }) => s.text.split(/\s+/)[0]?.toLowerCase();
    if (w(sents[i]) && w(sents[i]) === w(sents[i + 1]) && w(sents[i]) === w(sents[i + 2])) {
      flags.push({
        rule: 'repeated_openings',
        quote: sents[i].text.split(/\s+/)[0],
        start: sents[i].start,
        end: sents[i + 2].end,
        effect: 'Three sentences in a row open the same way, so the paragraph reads as a list.',
      });
      break;
    }
  }
  return flags.sort((a, b) => a.start - b.start);
}

/** Cross-paragraph checks: conclusions that merely repeat an earlier insight, and repeated endings. */
export function structureFlags(paragraphs: { id: string; text: string }[]): { paragraphId: string; rule: string; quote: string; effect: string }[] {
  const out: {
    paragraphId: string;
    rule: string;
    quote: string;
    effect: string;
  }[] = [];
  const overlap = (a: string, b: string) => {
    const A = new Set(tokenize(a));
    const B = new Set(tokenize(b));
    if (A.size < 4 || B.size < 4) return 0;
    let n = 0;
    for (const t of A) if (B.has(t)) n++;
    return n / Math.min(A.size, B.size);
  };
  const lastOf = (t: string) => splitSentences(t).at(-1)?.text ?? '';
  paragraphs.forEach((p, i) => {
    const last = lastOf(p.text);
    const sents = splitSentences(p.text);
    if (sents.length >= 3 && overlap(last, sents[0].text) >= 0.6)
      out.push({
        paragraphId: p.id,
        rule: 'conclusion_repeats_opening',
        quote: last,
        effect: 'The closing sentence repeats the opening one, so the paragraph ends where it began.',
      });
    if (i > 0 && last && overlap(last, lastOf(paragraphs[i - 1].text)) >= 0.6)
      out.push({
        paragraphId: p.id,
        rule: 'repeated_paragraph_ending',
        quote: last,
        effect: 'This paragraph ends on the same note as the previous one; the reader meets the same ending twice.',
      });
    if (i === paragraphs.length - 1 && paragraphs.length > 2) {
      for (const earlier of paragraphs.slice(0, -1)) {
        for (const s of splitSentences(earlier.text))
          if (overlap(last, s.text) >= 0.75 && last.length > 20) {
            out.push({
              paragraphId: p.id,
              rule: 'conclusion_repeats_insight',
              quote: last,
              effect: 'The conclusion restates an insight from earlier without adding to it.',
            });
            return;
          }
      }
    }
  });
  return out;
}

export interface VoiceEditResult {
  replacement: string;
  changes: { rule: string; before: string; after: string; effect: string }[];
  noChange: boolean;
  meaning: MeaningReport;
  hygieneRemoved: number;
  policyVersion: string;
  reason: string;
}

/** Apply only mechanical fixes outside protected spans, then verify. Falls back to no change if anything material shifts. */
export function voiceEdit(text: string, profile: VoiceProfile = NEUTRAL_PROFILE, lockedRanges: { start: number; end: number }[] = []): VoiceEditResult {
  const prot = [...protectedSpans(text).filter((s) => s.kind !== 'number'), ...lockedRanges];
  const flags = clarityFlags(text, profile).filter((f) => f.fix && !prot.some((p) => f.start < p.end && f.end > p.start));
  // non-overlapping, apply right to left
  const picked: ClarityFlag[] = [];
  for (const f of flags) if (!picked.some((p) => f.start < p.end && f.end > p.start)) picked.push(f);
  let out = text;
  const changes: VoiceEditResult['changes'] = [];
  for (const f of [...picked].sort((a, b) => b.start - a.start)) {
    let rep = f.fix!.replacement;
    let end = f.end;
    if (f.rule === 'stock_transition' || (f.rule === 'stock_vocabulary' && rep === '')) {
      // capitalise what follows a removed lead-in
      const rest = out.slice(end);
      out = out.slice(0, f.start) + rep + rest.charAt(0).toUpperCase() + rest.slice(1);
    } else out = out.slice(0, f.start) + rep + out.slice(end);
    changes.unshift({
      rule: f.rule,
      before: f.quote,
      after: rep,
      effect: f.effect,
    });
  }
  const cleaned = cleanUnicode(out);
  out = cleaned.text;
  const meaning = compareMeaning(text, out);
  if (meaning.outcome !== 'acceptable' || out === text) {
    return {
      replacement: text,
      changes: [],
      noChange: true,
      meaning: compareMeaning(text, text),
      hygieneRemoved: 0,
      policyVersion: POLICY_VERSION,
      reason: out === text ? 'Already clear; keeping your wording.' : 'A mechanical edit would have changed meaning; keeping your wording.',
    };
  }
  return {
    replacement: out,
    changes,
    noChange: false,
    meaning,
    hygieneRemoved: cleaned.removed.length,
    policyVersion: POLICY_VERSION,
    reason: changes.map((c) => c.rule).join(', '),
  };
}

// --- profile calibration ------------------------------------------------------------------------
export interface ProfileSuggestion {
  profile: VoiceProfile;
  stats: {
    avgSentenceWords: number;
    firstPersonRate: number;
    emDashRate: number;
    contractionRate: number;
    samples: number;
  };
  previews: {
    preference: string;
    sample: string;
    proposed: string;
    hasExample: boolean;
  }[];
}

export function suggestProfile(samples: VoiceSample[]): ProfileSuggestion {
  const text = samples.map((s) => s.text).join('\n\n');
  const sents = splitSentences(text);
  const words = text.match(/\p{L}[\p{L}'’]*/gu) ?? [];
  const avg = sents.length ? words.length / sents.length : 0;
  const fp = words.filter((w) => /^(i|my|me|we|our)$/i.test(w)).length / Math.max(1, words.length);
  const em = (text.match(/—/g)?.length ?? 0) / Math.max(1, sents.length);
  const contr = (text.match(/\b\w+['’](?:t|s|re|ve|ll|d|m)\b/gi)?.length ?? 0) / Math.max(1, words.length);
  const openings = [...new Set(sents.map((s) => s.text.split(/\s+/)[0]).filter(Boolean))].slice(0, 5);
  const lang = samples[0] ? detectLanguage(samples[0].text) : 'auto';
  const profile: VoiceProfile = {
    ...NEUTRAL_PROFILE,
    directness: avg > 0 && avg < 15 ? 'direct' : avg > 24 ? 'formal' : 'neutral',
    firstPerson: fp > 0.02 ? 'allow' : 'avoid',
    avoidEmDash: em === 0 && sents.length >= 3,
    openings,
    language: lang === 'other' ? 'auto' : lang,
    confirmed: {},
  };
  const previews: ProfileSuggestion['previews'] = [];
  const sentWithEm = sents.find((s) => s.text.includes('—'));
  const pe: VoiceProfile = { ...profile, avoidEmDash: true };
  previews.push({
    preference: 'avoidEmDash',
    sample: sentWithEm?.text ?? '',
    proposed: sentWithEm ? voiceEdit(sentWithEm.text, pe).replacement : '',
    hasExample: !!sentWithEm,
  });
  const wordy = sents.find((s) => clarityFlags(s.text, profile).some((f) => f.fix));
  previews.push({
    preference: 'clearerPhrasing',
    sample: wordy?.text ?? '',
    proposed: wordy ? voiceEdit(wordy.text, profile).replacement : '',
    hasExample: !!wordy,
  });
  return {
    profile,
    stats: {
      avgSentenceWords: Math.round(avg * 10) / 10,
      firstPersonRate: Math.round(fp * 1000) / 1000,
      emDashRate: Math.round(em * 100) / 100,
      contractionRate: Math.round(contr * 1000) / 1000,
      samples: samples.length,
    },
    previews,
  };
}

export { splitParagraphs };
