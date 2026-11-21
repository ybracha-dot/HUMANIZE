// Shared evaluation library: identical inputs and metrics for the harness and the optional live-verifier runner.
import fs from 'node:fs';
import { FIXTURES } from '../../fixtures/eval/corpus';
import { DOCS2 } from '../../fixtures/eval/corpus2';
import { verifyParagraph, type Rules, type Verdict } from '../../shared/evidence';

export const V: Verdict[] = ['supported', 'partial', 'contradicted', 'insufficient', 'unreadable'];
export interface Row {
  set: string;
  id: string;
  group: string;
  tag: string;
  expected: Verdict;
  predicted: Verdict | 'claim_not_found';
  reasons: string[];
}

export function runFx(fx: (typeof FIXTURES)[number], rules: Rules, set: string): Row[] {
  const { claims, verdicts } = verifyParagraph(fx.text, fx.passages, 'c', { rules });
  return fx.expect.map((e) => {
    const i = claims.findIndex((c) => c.text.includes(e.claim));
    return {
      set,
      id: `${fx.id}/${e.claim}`,
      group: fx.id,
      tag: fx.family,
      expected: e.verdict,
      predicted: i < 0 ? 'claim_not_found' : verdicts[i].verdict,
      reasons: i < 0 ? [] : verdicts[i].reasons,
    };
  });
}
export function runDocs(split: 'dev2' | 'unseen', rules: Rules): Row[] {
  const rows: Row[] = [];
  for (const d of DOCS2.filter((x) => x.split === split))
    for (const c of d.claims) {
      const { verdicts } = verifyParagraph(c.text, d.passages, 'c', { rules });
      rows.push({
        set: split,
        id: `${d.docId}/${c.text.slice(0, 40)}`,
        group: d.docId,
        tag: c.tag,
        expected: c.expected,
        predicted: verdicts[0]?.verdict ?? 'claim_not_found',
        reasons: verdicts[0]?.reasons ?? [],
      });
    }
  return rows;
}

export function measure(rows: Row[]) {
  const confusion: Record<string, Record<string, number>> = {};
  for (const e of V) {
    confusion[e] = {};
    for (const p of [...V, 'claim_not_found']) confusion[e][p] = 0;
  }
  for (const r of rows) confusion[r.expected][r.predicted]++;
  const unsupported = rows.filter((r) => r.expected !== 'supported');
  const supported = rows.filter((r) => r.expected === 'supported');
  const abstain = (p: string) => p === 'insufficient' || p === 'unreadable';
  const unsafe = unsupported.filter((r) => r.predicted === 'supported');
  const flagged = supported.filter((r) => r.predicted !== 'supported');
  return {
    claims: rows.length,
    sourceDocuments: new Set(rows.map((r) => r.group)).size,
    exact: rows.filter((r) => r.expected === r.predicted).length,
    confusion,
    genuinelyUnsupported: unsupported.length,
    unsafeApprovals: { count: unsafe.length, outOf: unsupported.length, items: unsafe.map((r) => r.id) },
    supportedClaims: supported.length,
    wronglyFlaggedSupported: {
      outOf: supported.length,
      total: flagged.length,
      calledContradicted: flagged.filter((r) => r.predicted === 'contradicted').length,
      calledPartial: flagged.filter((r) => r.predicted === 'partial').length,
      abstained: flagged.filter((r) => abstain(r.predicted)).length,
      items: flagged.map((r) => `${r.id}: ${r.predicted}`),
    },
    unsupportedButWrongKind: {
      outOf: unsupported.length,
      count: unsupported.filter((r) => r.predicted !== 'supported' && r.predicted !== r.expected).length,
      items: unsupported
        .filter((r) => r.predicted !== 'supported' && r.predicted !== r.expected)
        .map((r) => `${r.id}: expected ${r.expected}, said ${r.predicted}`),
    },
    abstentions: {
      total: rows.filter((r) => abstain(r.predicted)).length,
      correct: rows.filter((r) => abstain(r.predicted) && abstain(r.expected)).length,
      onUnsupported: unsupported.filter((r) => abstain(r.predicted)).length,
      onSupported: supported.filter((r) => abstain(r.predicted)).length,
    },
  };
}

export const frozen = JSON.parse(fs.readFileSync('fixtures/eval/frozen-heldout-22.json', 'utf8'));
export const FX = (split: string) => FIXTURES.filter((f) => f.split === split);
export const sets: Record<string, (r: Rules) => Row[]> = {
  frozen22: (r) => FX('heldout').flatMap((f) => runFx(f, r, 'frozen22')),
  dev15: (r) => FX('dev').flatMap((f) => runFx(f, r, 'dev15')),
  dev2: (r) => runDocs('dev2', r),
  unseen: (r) => runDocs('unseen', r),
};
export const result = Object.fromEntries(Object.entries(sets).map(([k, fn]) => [k, { baseline: fn('baseline'), revised: fn('revised') }]));
