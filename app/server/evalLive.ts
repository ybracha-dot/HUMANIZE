// Optional live-verifier measurement on the SAME inputs as the deterministic baseline and revised rules.
// Spending is guarded: nothing is called unless a budget, a price and a key exist, and the upper bound of the whole plan fits the budget.
import { verifyParagraph, mergeVerdicts, type ClaimVerdict, type IndexedPassage, type Verdict } from '../shared/evidence.ts';
import type { Provider } from './providers/types.ts';
import { costOf, type Price } from './spend.ts';
import { EvidenceVerifierOut } from './roles.ts';

export interface EvalDoc {
  group: string;
  set: string;
  passages: IndexedPassage[];
  claims: { text: string; expected: Verdict; id: string }[];
}
export interface Receipt {
  group: string;
  provider: string;
  model: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  requestRef?: string;
}
export interface LiveEvalRow {
  set: string;
  id: string;
  expected: Verdict;
  deterministic: Verdict;
  live: Verdict | 'missing';
  combined: Verdict;
}
export interface LiveEvalResult {
  refused?: string;
  plannedUpperBoundUsd: number;
  receipts: Receipt[];
  rows: LiveEvalRow[];
  totalCostUsd: number;
}

const none = (refused: string, planned: number): LiveEvalResult => ({ refused, plannedUpperBoundUsd: planned, receipts: [], rows: [], totalCostUsd: 0 });

export async function runLiveVerifierEval(opts: {
  provider: Provider;
  price: Price | null;
  budgetUsd: number | null;
  docs: EvalDoc[];
  dryRun?: boolean;
}): Promise<LiveEvalResult> {
  const { provider, price, budgetUsd, docs } = opts;
  if (!provider.paid) return none('The fixture provider is not a live verifier.', 0);
  if (!price) return none(`No price configured for ${provider.id}. Set STUDIO_PRICES_JSON; prices are never assumed.`, NaN);
  const plan = docs.map((d) => ({ d, est: provider.estimate('evidence_verifier', { claims: d.claims, passages: d.passages }) }));
  const planned = plan.reduce((a, p) => a + costOf(price, { inputTokens: p.est.inputTokens, outputTokens: p.est.outputTokens }) * 1.1, 0);
  if (budgetUsd == null || !(budgetUsd > 0)) return none('No spending authorization: set STUDIO_EVAL_BUDGET_USD to a positive number.', planned);
  if (planned > budgetUsd)
    return none(`The plan's upper bound $${planned.toFixed(4)} exceeds the authorized budget $${budgetUsd.toFixed(4)}. Nothing was called.`, planned);
  if (opts.dryRun) return none('dry run', planned);
  const receipts: Receipt[] = [];
  const rows: LiveEvalRow[] = [];
  let spent = 0;
  for (const { d } of plan) {
    const claims = d.claims.map((c) => ({ claimId: c.id, text: c.text }));
    const res = await provider.call('evidence_verifier', { claims, paragraphs: claims.map((c) => ({ id: c.claimId, text: c.text })), passages: d.passages });
    const cost = costOf(price, res.usage);
    spent += cost;
    receipts.push({
      group: d.group,
      provider: res.provider,
      model: res.model,
      latencyMs: res.latencyMs,
      inputTokens: res.usage.inputTokens,
      outputTokens: res.usage.outputTokens,
      costUsd: cost,
      requestRef: res.requestRef,
    });
    const parsed = EvidenceVerifierOut.safeParse(res.output);
    const live = new Map((parsed.success ? parsed.data.verdicts : []).map((v) => [v.claimId, v]));
    for (const c of d.claims) {
      const det = verifyParagraph(c.text, d.passages, 'c', { rules: 'revised' }).verdicts[0] as ClaimVerdict;
      const lv = live.get(c.id);
      const combined = lv ? mergeVerdicts(det, { ...det, verdict: lv.verdict, reasons: lv.reasons, engine: res.provider }).verdict : det.verdict;
      rows.push({ set: d.set, id: c.id, expected: c.expected, deterministic: det.verdict, live: lv?.verdict ?? 'missing', combined });
    }
  }
  return { plannedUpperBoundUsd: planned, receipts, rows, totalCostUsd: spent };
}
