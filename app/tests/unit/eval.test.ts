// Evaluation harness. Writes ../.studio-build/eval-report.json and asserts (1) deterministic gates and (2) that the set of misses
// equals the recorded set, so any regression or silent improvement is visible. Semantic accuracy is REPORTED, not promised.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FIXTURES, DRIFT } from '../../fixtures/eval/corpus';
import { PassageIndex, verifyParagraph, type Verdict } from '../../shared/evidence';
import { compareMeaning } from '../../shared/meaning';
import { countWords } from '../../shared/text';

type Row = { fixture: string; split: string; family: string; claim: string; expected: Verdict; predicted: Verdict | 'claim_not_found'; ok: boolean; rankOfGold: number | null; knownMiss?: string };
const rows: Row[] = [];
for (const fx of FIXTURES) {
  const { claims, verdicts } = verifyParagraph(fx.text, fx.passages, 'c');
  const index = new PassageIndex(fx.passages);
  for (const e of fx.expect) {
    const i = claims.findIndex((c) => c.text.includes(e.claim));
    const predicted = i < 0 ? 'claim_not_found' : verdicts[i].verdict;
    let rank: number | null = null;
    if (e.gold && i >= 0) { const hits = index.search(claims[i].text, 5); const at = hits.findIndex((h) => h.passage.id === e.gold); rank = at < 0 ? null : at + 1; }
    rows.push({ fixture: fx.id, split: fx.split, family: fx.family, claim: e.claim, expected: e.verdict, predicted, ok: predicted === e.verdict, rankOfGold: rank, knownMiss: e.knownMiss });
  }
}
const summarize = (rs: Row[]) => {
  const n = rs.length; const ok = rs.filter((r) => r.ok).length;
  const by = (v: Verdict) => { const exp = rs.filter((r) => r.expected === v); const pred = rs.filter((r) => r.predicted === v); const tp = rs.filter((r) => r.expected === v && r.predicted === v).length; return { expected: exp.length, predicted: pred.length, truePositive: tp, recall: exp.length ? +(tp / exp.length).toFixed(3) : null, precision: pred.length ? +(tp / pred.length).toFixed(3) : null }; };
  const gold = rs.filter((r) => r.rankOfGold !== undefined && r.expected && r.predicted !== 'claim_not_found');
  const withGold = rs.filter((r) => FIXTURES.find((f) => f.id === r.fixture)!.expect.find((e) => e.claim === r.claim)!.gold);
  const unsafe = rs.filter((r) => r.expected !== 'supported' && r.predicted === 'supported');
  const falseAlarm = rs.filter((r) => r.expected === 'supported' && r.predicted !== 'supported');
  const supportedWords = FIXTURES.filter((f) => rs.some((r) => r.fixture === f.id)).reduce((a, f) => a + countWords(f.text), 0);
  void gold;
  return {
    claims: n, exact: ok, accuracy: +(ok / n).toFixed(3),
    perVerdict: { supported: by('supported'), partial: by('partial'), contradicted: by('contradicted'), insufficient: by('insufficient') },
    unsafeMisses: unsafe.map((r) => `${r.fixture}: expected ${r.expected}, said supported`),
    falseAlarms: falseAlarm.map((r) => `${r.fixture}: expected supported, said ${r.predicted}`),
    falseAlarmsPer1000Words: +((falseAlarm.length / Math.max(1, supportedWords)) * 1000).toFixed(1),
    retrieval: { withGold: withGold.length, hitAt1: withGold.filter((r) => r.rankOfGold === 1).length, hitAt3: withGold.filter((r) => r.rankOfGold !== null && r.rankOfGold <= 3).length },
    misses: rs.filter((r) => !r.ok).map((r) => ({ fixture: r.fixture, expected: r.expected, predicted: r.predicted, note: r.knownMiss ?? null })),
  };
};
const drift = (split: string) => {
  const ps = DRIFT.filter((d) => d.split === split);
  const res = ps.map((d) => ({ ...d, flagged: compareMeaning(d.orig, d.cand).material.length > 0 }));
  const mat = res.filter((r) => r.material); const clean = res.filter((r) => !r.material);
  const cleanWords = clean.reduce((a, r) => a + countWords(r.orig), 0);
  return { materialPairs: mat.length, materialFlagged: mat.filter((r) => r.flagged).length, recall: +(mat.filter((r) => r.flagged).length / Math.max(1, mat.length)).toFixed(3), missed: mat.filter((r) => !r.flagged).map((r) => r.id), cleanPairs: clean.length, cleanFlagged: clean.filter((r) => r.flagged).map((r) => r.id), falseAlarmsPer1000Words: +((clean.filter((r) => r.flagged).length / Math.max(1, cleanWords)) * 1000).toFixed(1) };
};

describe('evaluation corpus', () => {
  it('has at least 24 original fixtures across the required families, with a held-out split', () => {
    expect(FIXTURES.length).toBeGreaterThanOrEqual(24);
    const fam = new Set(FIXTURES.map((f) => f.family));
    for (const f of ['spanish_intro', 'ocr_error', 'history_cited', 'finance_memo', 'hebrew', 'long_work', 'bilingual']) expect(fam.has(f), f).toBe(true);
    expect(FIXTURES.filter((f) => f.split === 'heldout').length).toBeGreaterThanOrEqual(10);
  });
  it('reports metrics per split and the miss set matches the recorded one', () => {
    const report = {
      generated: new Date().toISOString(), note: 'Small synthetic fixture set; these numbers describe these fixtures only and are not a population accuracy claim. The held-out split was not used to tune any rule.',
      fixtures: { total: FIXTURES.length, dev: FIXTURES.filter((f) => f.split === 'dev').length, heldout: FIXTURES.filter((f) => f.split === 'heldout').length, languages: [...new Set(FIXTURES.map((f) => f.lang))] },
      verifier: { dev: summarize(rows.filter((r) => r.split === 'dev')), heldout: summarize(rows.filter((r) => r.split === 'heldout')) },
      meaningDrift: { dev: drift('dev'), heldout: drift('heldout') },
    };
    fs.mkdirSync('../.studio-build', { recursive: true });
    fs.writeFileSync('../.studio-build/eval-report.json', JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ verifier: { dev: { acc: report.verifier.dev.accuracy, misses: report.verifier.dev.misses }, heldout: { acc: report.verifier.heldout.accuracy, claims: report.verifier.heldout.claims, misses: report.verifier.heldout.misses, unsafe: report.verifier.heldout.unsafeMisses, falseAlarms: report.verifier.heldout.falseAlarms, retrieval: report.verifier.heldout.retrieval } }, drift: report.meaningDrift }, null, 1));
    // Regression pins: the exact miss sets are recorded. A change in either direction must be reviewed, not silently absorbed.
    expect(report.verifier.dev.misses.map((m) => m.fixture)).toEqual([]);
    expect(report.verifier.heldout.misses.map((m) => m.fixture)).toEqual(['h03', 'h04', 'h05', 'h07', 'h08']);
    expect(report.verifier.heldout.misses.every((m) => m.note)).toBe(true); // every miss is explained
    expect(report.verifier.dev.unsafeMisses).toEqual([]);
    expect(report.verifier.heldout.unsafeMisses).toEqual([]); // never says "supported" for an unsupported claim in this set
    expect(report.meaningDrift.dev.recall).toBe(1);
    expect(report.meaningDrift.heldout.missed).toEqual(['h_m07']);
    expect(report.meaningDrift.dev.cleanFlagged).toEqual([]);
    expect(report.meaningDrift.heldout.cleanFlagged).toEqual([]);
  });
});
