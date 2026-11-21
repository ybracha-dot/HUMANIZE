// Freezes the labels and predictions of the previously inspected held-out claims, produced by the verifier AS IT IS NOW (baseline).
// Run once, before any rule change. The frozen file is never regenerated; it is the reference the revised rules are compared against.
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { FIXTURES } from '../fixtures/eval/corpus.ts';
import { verifyParagraph } from '../shared/evidence.ts';

const rows: any[] = [];
for (const fx of FIXTURES.filter((f) => f.split === 'heldout')) {
  const { claims, verdicts } = verifyParagraph(fx.text, fx.passages, 'c');
  for (const e of fx.expect) {
    const i = claims.findIndex((c) => c.text.includes(e.claim));
    rows.push({ id: `${fx.id}/${e.claim}`, fixture: fx.id, family: fx.family, lang: fx.lang, claimText: i >= 0 ? claims[i].text : null, expected: e.verdict, baselinePredicted: i >= 0 ? verdicts[i].verdict : 'claim_not_found', baselineReasons: i >= 0 ? verdicts[i].reasons : [] });
  }
}
const commit = execSync('git rev-parse HEAD').toString().trim();
fs.writeFileSync('fixtures/eval/frozen-heldout-22.json', JSON.stringify({ frozenAtCommit: commit, note: 'Labels and baseline predictions of the 22 held-out claims inspected in the first pass. Frozen before any rule revision. Do not regenerate.', claims: rows }, null, 1) + '\n');
console.log(rows.length, 'claims frozen at', commit.slice(0, 7), 'exact', rows.filter((r) => r.expected === r.baselinePredicted).length);
