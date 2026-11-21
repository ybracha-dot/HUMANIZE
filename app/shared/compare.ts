// Compare two revisions (or branches): text changes AND substantive changes (claims, evidence, certainty, POV, citations).
import { diffWords } from 'diff';
import { compareMeaning } from './meaning.ts';
import type { Para } from './proposals.ts';

export type ChangeType = 'claim' | 'evidence' | 'certainty' | 'point_of_view' | 'citation' | 'wording';
export interface ParaChange {
  paragraphId: string;
  status: 'same' | 'modified' | 'added' | 'removed';
  a: string; b: string;
  parts: { kind: 'same' | 'add' | 'del'; text: string }[];
  substantive: { type: ChangeType; message: string }[];
}

const FIRST = /\b(I|me|my|mine|we|our|us)\b/gi;
const SECOND = /\byou(?:r|rs)?\b/gi;
const THIRD_ONLY = /\b(one|the (?:author|writer|student))\b/gi;

export function comparePara(a: string, b: string): Pick<ParaChange, 'parts' | 'substantive'> {
  const parts = diffWords(a, b).map((p) => ({ kind: (p.added ? 'add' : p.removed ? 'del' : 'same') as 'same' | 'add' | 'del', text: p.value }));
  const sub: ParaChange['substantive'] = [];
  const m = compareMeaning(a, b);
  const typeOf: Record<string, ChangeType> = {
    causal_introduced: 'claim', negation_changed: 'claim', attribution_dropped: 'claim', entity_removed: 'claim',
    number_removed: 'evidence', number_introduced: 'evidence', unit_changed: 'evidence', quote_changed: 'evidence',
    citation_changed: 'citation', hedge_dropped: 'certainty', qualification_dropped: 'certainty', condition_dropped: 'certainty', period_changed: 'certainty',
  };
  for (const f of m.findings) if (typeOf[f.category]) sub.push({ type: typeOf[f.category], message: f.message });
  // causal removed (certainty softened) is substantive too
  const rev = compareMeaning(b, a);
  for (const f of rev.findings) if (f.category === 'causal_introduced') sub.push({ type: 'claim', message: `Causal wording ("${f.candidate}") was removed or softened.` });
  const pov = (t: string) => ({ f: (t.match(FIRST) ?? []).length, s: (t.match(SECOND) ?? []).length, t: (t.match(THIRD_ONLY) ?? []).length });
  const pa = pov(a); const pb = pov(b);
  if ((pa.f > 0) !== (pb.f > 0) || (pa.s > 0) !== (pb.s > 0) || (pa.t > 0) !== (pb.t > 0)) sub.push({ type: 'point_of_view', message: 'Point of view changed (first, second or third person).' });
  if (!sub.length && a !== b) sub.push({ type: 'wording', message: 'Wording only; no change to claims, evidence, certainty or citations detected.' });
  return { parts, substantive: sub };
}

export function compareRevisions(a: Para[], b: Para[]): ParaChange[] {
  const out: ParaChange[] = [];
  const bmap = new Map(b.map((p) => [p.id, p]));
  const amap = new Map(a.map((p) => [p.id, p]));
  const order = [...a.map((p) => p.id), ...b.filter((p) => !amap.has(p.id)).map((p) => p.id)];
  for (const id of order) {
    const pa = amap.get(id); const pb = bmap.get(id);
    if (pa && pb) {
      if (pa.text === pb.text) out.push({ paragraphId: id, status: 'same', a: pa.text, b: pb.text, parts: [{ kind: 'same', text: pa.text }], substantive: [] });
      else out.push({ paragraphId: id, status: 'modified', a: pa.text, b: pb.text, ...comparePara(pa.text, pb.text) });
    } else if (pa) out.push({ paragraphId: id, status: 'removed', a: pa.text, b: '', parts: [{ kind: 'del', text: pa.text }], substantive: [{ type: 'claim', message: 'Paragraph removed.' }] });
    else if (pb) out.push({ paragraphId: id, status: 'added', a: '', b: pb.text, parts: [{ kind: 'add', text: pb.text }], substantive: [{ type: 'claim', message: 'Paragraph added.' }] });
  }
  return out;
}
