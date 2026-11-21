// Optional: run a live model as the evidence verifier over the frozen-22 and unseen inputs. Never prints a key.
//   ANTHROPIC_API_KEY=... STUDIO_PRICES_JSON='{"anthropic:<model>":{"inputPerMTok":X,"outputPerMTok":Y}}' STUDIO_EVAL_BUDGET_USD=1 npx tsx scripts/eval-live-verifier.ts [--dry-run]
import fs from 'node:fs';
import { FIXTURES } from '../fixtures/eval/corpus.ts';
import { DOCS2 } from '../fixtures/eval/corpus2.ts';
import { runLiveVerifierEval, type EvalDoc } from '../server/evalLive.ts';
import { selectProviders } from '../server/providers/index.ts';
import { envPrices } from '../server/spend.ts';
import { splitClaims } from '../shared/evidence.ts';

const docs: EvalDoc[] = [];
for (const fx of FIXTURES.filter((f) => f.split === 'heldout')) {
  const cl = splitClaims(fx.text, 'c');
  docs.push({
    group: fx.id,
    set: 'frozen22',
    passages: fx.passages,
    claims: fx.expect.map((e) => ({ text: cl.find((x) => x.text.includes(e.claim))?.text ?? e.claim, expected: e.verdict, id: `${fx.id}/${e.claim}` })),
  });
}
for (const d of DOCS2.filter((x) => x.split === 'unseen')) {
  docs.push({
    group: d.docId,
    set: 'unseen',
    passages: d.passages,
    claims: d.claims.map((c, i) => ({ text: c.text, expected: c.expected, id: `${d.docId}/${i}` })),
  });
}
let provider;
try {
  provider = selectProviders('live').editor;
} catch (e: any) {
  console.error(
    `NOT RUN: ${e.message}\nSetup: export ANTHROPIC_API_KEY=... (or OPENAI_API_KEY and STUDIO_OPENAI_MODEL=...), STUDIO_PRICES_JSON, STUDIO_EVAL_BUDGET_USD.`,
  );
  process.exit(3);
}
const r = await runLiveVerifierEval({
  provider,
  price: envPrices()[provider.id] ?? null,
  budgetUsd: Number(process.env.STUDIO_EVAL_BUDGET_USD) || null,
  docs,
  dryRun: process.argv.includes('--dry-run'),
});
if (r.refused) {
  console.error(`NOT RUN: ${r.refused} (planned upper bound ${Number.isFinite(r.plannedUpperBoundUsd) ? '$' + r.plannedUpperBoundUsd.toFixed(4) : 'unknown'})`);
  process.exit(r.refused === 'dry run' ? 0 : 3);
}
fs.mkdirSync('../.studio-build', { recursive: true });
fs.writeFileSync('../.studio-build/eval-live-verifier.json', JSON.stringify(r, null, 2));
console.log(`live verifier: ${r.receipts.length} calls, $${r.totalCostUsd.toFixed(4)} spent, model ${r.receipts[0]?.model}`);
