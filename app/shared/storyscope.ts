// Editorial checks for personal narrative and fiction, linked to StoryScope taxonomy features (see storyscope-manifest.json).
//
// Scope and honesty: the taxonomy was built for a human-vs-AI classification study of long fiction. These checks are ordinary
// writing feedback (does the ending say what the action already showed?). They are NOT a measure of "human-ness", they are
// never used to lower a detector score, and each one has an example where the wording should stay. Academic arguments and
// business memos get their own checks (assignment requirements, evidence support, and the memo check below).
import type { Para } from './proposals.ts';
import { splitSentences } from './text.ts';
import { tokenize } from './evidence.ts';
import { CHECK_TAXONOMY_LINKS } from './storyscope-links.ts';

export interface NarrativeFlag { id: string; paragraphId: string; quote: string; effect: string; rule: string; taxonomyIds: string[] }
export interface NarrativeCheck {
  id: string; genres: string[]; taxonomyIds: string[]; title: string;
  detect(paragraphs: Para[]): Omit<NarrativeFlag, 'taxonomyIds' | 'rule'>[];
  /** text on which this check must stay silent */
  keep: string[];
  /** text on which it should speak */
  flag: string[];
}

const overlap = (a: string, b: string) => {
  const A = new Set(tokenize(a)); const B = new Set(tokenize(b));
  if (A.size < 3 || B.size < 3) return 0;
  let n = 0; for (const t of A) if (B.has(t)) n++;
  return n / Math.min(A.size, B.size);
};
const MORAL = /\b(i (?:learned|realized|understood) that|taught me (?:that|to)|the (?:lesson|moral)(?: is| was)?|reminded me that|that(?:'s| is) when i (?:knew|realized)|in the end,? (?:it|what) (?:matters|mattered)|all that mattered)\b/i;
const EMOTION = /\b(?:i|she|he|they|we) (?:felt|was|were|am|is|are) (?:so |very |really |incredibly )?(sad|happy|angry|afraid|scared|nervous|anxious|proud|ashamed|lonely|furious|terrified|devastated|overjoyed|embarrassed)\b/gi;
const CLICHE = /\b(heart (?:pounded|raced|sank|skipped a beat)|time stood still|butterflies in (?:my|her|his) stomach|a lump in (?:my|her|his) throat|tears streamed down|blood ran cold|cold as ice|sigh of relief|pit of (?:my|her|his) stomach)\b/gi;
const VERDICT = /\b(?:what a (?:terrible|wonderful|foolish|brave)|how (?:foolish|cruel|kind|brave)|(?:he|she|they) (?:was|were) (?:clearly|obviously) (?:wrong|right|foolish|cruel|kind|brave)|it was (?:truly|simply) (?:wrong|unforgivable|admirable))\b/i;

const first = (re: RegExp, s: string) => { const m = re.exec(s); re.lastIndex = 0; return m?.[0] ?? null; };

export const NARRATIVE_CHECKS: NarrativeCheck[] = [
  {
    id: 'moral_restates_action', genres: ['personal_narrative', 'fiction'], taxonomyIds: CHECK_TAXONOMY_LINKS.moral_restates_action,
    title: 'Closing moral repeats what the scene already showed',
    detect(paras) {
      const out: ReturnType<NarrativeCheck['detect']> = [];
      const real = paras.filter((p) => p.text.trim());
      const last = real.at(-1); const prev = real.at(-2);
      if (!last || !prev) return out;
      const sents = splitSentences(last.text);
      const moral = sents.find((s) => MORAL.test(s.text));
      if (moral && overlap(moral.text, prev.text) >= 0.3) out.push({ id: 'moral_restates_action', paragraphId: last.id, quote: moral.text, effect: 'The ending states a lesson the previous paragraph already showed through action, so the reader is told what they just felt.' });
      return out;
    },
    flag: ['She handed him the keys and walked to the car without looking back.\n\nI learned that letting go means handing over the keys.'],
    keep: ['We argued until midnight about the house.\n\nI learned that my brother kept every receipt from our mother\'s hospital stay, and I had never once asked why.'],
  },
  {
    id: 'named_emotion', genres: ['personal_narrative', 'fiction'], taxonomyIds: CHECK_TAXONOMY_LINKS.named_emotion,
    title: 'Emotion named where an action could carry it',
    detect(paras) {
      const out: ReturnType<NarrativeCheck['detect']> = [];
      for (const p of paras) {
        const hits = [...p.text.matchAll(EMOTION)];
        if (hits.length >= 2) out.push({ id: 'named_emotion', paragraphId: p.id, quote: hits[0][0], effect: 'Two or more feelings are labelled outright in one paragraph; the reader gets the label but not the moment.' });
      }
      return out;
    },
    flag: ['I felt nervous. Then I was proud. Then I felt ashamed of being proud.'],
    keep: ['I was afraid, and I said so out loud, which was the first honest thing I had said all week.'],
  },
  {
    id: 'stock_figure', genres: ['personal_narrative', 'fiction'], taxonomyIds: CHECK_TAXONOMY_LINKS.stock_figure,
    title: 'Stock figure of speech',
    detect(paras) {
      const out: ReturnType<NarrativeCheck['detect']> = [];
      for (const p of paras) { const m = first(CLICHE, p.text); if (m) out.push({ id: 'stock_figure', paragraphId: p.id, quote: m, effect: 'A phrase the reader has met many times; it signals the emotion without adding anything specific to this scene.' }); }
      return out;
    },
    flag: ['When the results came in, my heart pounded and time stood still.'],
    keep: ['When the results came in, I counted the ceiling tiles twice.'],
  },
  {
    id: 'narrator_verdict', genres: ['personal_narrative', 'fiction'], taxonomyIds: CHECK_TAXONOMY_LINKS.narrator_verdict,
    title: 'Narrator hands down a verdict',
    detect(paras) {
      const out: ReturnType<NarrativeCheck['detect']> = [];
      for (const p of paras) for (const s of splitSentences(p.text)) if (VERDICT.test(s.text)) out.push({ id: 'narrator_verdict', paragraphId: p.id, quote: s.text, effect: 'The narrator judges the character for the reader instead of letting the scene do it.' });
      return out;
    },
    flag: ['He was clearly wrong to leave the dog behind.'],
    keep: ['He left the dog behind, and the dog was still waiting at the gate in the morning.'],
  },
  {
    id: 'recommendation_up_front', genres: ['case_memo'], taxonomyIds: [],
    title: 'Recommendation is not stated near the top',
    detect(paras) {
      const real = paras.filter((p) => p.text.trim());
      if (real.length < 2) return [];
      const head = real.slice(0, 2).map((p) => p.text).join(' ');
      if (/\b(recommend|we propose|i propose|should (?:adopt|choose|proceed|acquire|reject)|my recommendation)\b/i.test(head)) return [];
      return [{ id: 'recommendation_up_front', paragraphId: real[0].id, quote: real[0].text.slice(0, 80), effect: 'A case memo reader expects the recommendation first; here they must read on to find it.' }];
    },
    flag: ['The company faces rising costs in three regions. Costs rose 8% last year.\n\nWe examined two options in detail.'],
    keep: ['We recommend acquiring the smaller supplier. It cuts unit cost by 6% and keeps both plants open.\n\nThe larger deal costs twice as much.'],
  },
];

export function checkNarrative(paragraphs: Para[], genre: string) {
  const checks = NARRATIVE_CHECKS.filter((c) => c.genres.includes(genre));
  if (!checks.length) return { genre, applicable: false, note: 'Narrative checks apply to personal narrative and fiction. Academic arguments are checked against the assignment requirements and the readings; case memos get the recommendation check.', checks: [] as NarrativeFlag[] };
  const flags: NarrativeFlag[] = [];
  for (const c of checks) for (const f of c.detect(paragraphs)) flags.push({ ...f, rule: c.id, taxonomyIds: c.taxonomyIds });
  return { genre, applicable: true, note: '', checks: flags };
}
