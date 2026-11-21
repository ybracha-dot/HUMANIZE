// Model spend: conservative reservation before dispatch, settlement to observed usage, per-attempt ledger rows.
// A deterministic fixture is never paid traffic and never counts against a cap.
import { all, clock, one, run, tx, uid, type DB } from './db.ts';

export interface Price {
  inputPerMTok: number;
  outputPerMTok: number;
  cachedPerMTok?: number;
  rev?: string;
}
export class BudgetError extends Error {
  constructor(
    public code: 'assignment_budget' | 'monthly_limit' | 'price_unconfigured',
    message: string,
  ) {
    super(message);
  }
}

export function envPrices(): Record<string, Price> {
  try {
    return process.env.STUDIO_PRICES_JSON ? JSON.parse(process.env.STUDIO_PRICES_JSON) : {};
  } catch {
    return {};
  }
}
export function priceFor(prices: Record<string, Price>, providerId: string): Price | null {
  return prices[providerId] ?? envPrices()[providerId] ?? null;
}

export function costOf(price: Price, u: { inputTokens: number; outputTokens: number; cachedTokens?: number }): number {
  const cached = u.cachedTokens ?? 0;
  const fresh = Math.max(0, u.inputTokens - cached);
  return (fresh * price.inputPerMTok + cached * (price.cachedPerMTok ?? price.inputPerMTok) + u.outputTokens * price.outputPerMTok) / 1e6;
}

export function usedUsd(db: DB, ws: string, opts: { assignmentId?: string | null; sinceMs?: number } = {}): number {
  const where = ['workspace_id=?'];
  const args: any[] = [ws];
  if (opts.assignmentId) {
    where.push('assignment_id=?');
    args.push(opts.assignmentId);
  }
  if (opts.sinceMs) {
    where.push('created_at>=?');
    args.push(opts.sinceMs);
  }
  const r = one(
    db,
    `SELECT COALESCE(SUM(CASE WHEN state='settled' THEN actual_usd WHEN state IN ('reserved','uncertain') THEN reserved_usd ELSE 0 END),0) AS used FROM spend WHERE ${where.join(' AND ')}`,
    ...args,
  );
  return (r?.used as number) ?? 0;
}

export interface ReserveInput {
  ws: string;
  assignmentId: string | null;
  runId: string;
  stageId: string;
  attempt: number;
  provider: string;
  model: string;
  upperBoundUsd: number;
  assignmentCap: number | null;
  monthlyCap: number | null;
}

/** Atomically reserve a conservative upper bound. Refuses when it would exceed the assignment or monthly cap. */
export function reserve(db: DB, r: ReserveInput): string {
  return tx(db, () => {
    if (r.assignmentCap != null && r.assignmentId) {
      const used = usedUsd(db, r.ws, { assignmentId: r.assignmentId });
      if (used + r.upperBoundUsd > r.assignmentCap + 1e-12)
        throw new BudgetError(
          'assignment_budget',
          `This call could cost up to $${r.upperBoundUsd.toFixed(4)}; $${used.toFixed(4)} of the $${r.assignmentCap.toFixed(2)} assignment budget is already used or reserved.`,
        );
    }
    if (r.monthlyCap != null) {
      const monthStart = new Date();
      monthStart.setUTCDate(1);
      monthStart.setUTCHours(0, 0, 0, 0);
      const used = usedUsd(db, r.ws, { sinceMs: monthStart.getTime() });
      if (used + r.upperBoundUsd > r.monthlyCap + 1e-12)
        throw new BudgetError('monthly_limit', `Monthly workspace limit of $${r.monthlyCap.toFixed(2)} would be exceeded.`);
    }
    const id = uid('sp');
    run(
      db,
      "INSERT INTO spend(id,workspace_id,assignment_id,run_id,stage_id,attempt,provider,model,state,reserved_usd,paid,created_at) VALUES(?,?,?,?,?,?,?,?,'reserved',?,1,?)",
      id,
      r.ws,
      r.assignmentId,
      r.runId,
      r.stageId,
      r.attempt,
      r.provider,
      r.model,
      r.upperBoundUsd,
      clock.now(),
    );
    return id;
  });
}
export function settle(
  db: DB,
  id: string,
  s: {
    actualUsd: number;
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
    latencyMs: number;
    priceRev?: string;
  },
) {
  run(
    db,
    "UPDATE spend SET state='settled', actual_usd=?, input_tokens=?, output_tokens=?, cached_tokens=?, latency_ms=?, price_rev=?, settled_at=? WHERE id=? AND state IN ('reserved','uncertain')",
    s.actualUsd,
    s.inputTokens,
    s.outputTokens,
    s.cachedTokens,
    s.latencyMs,
    s.priceRev ?? null,
    clock.now(),
    id,
  );
}
export function release(db: DB, id: string) {
  run(db, "UPDATE spend SET state='released', actual_usd=0, settled_at=? WHERE id=? AND state='reserved'", clock.now(), id);
}
/** Network timeout or dead worker: we cannot know whether the provider billed. Keep the reservation counted until reconciled. */
export function markUncertain(db: DB, id: string) {
  run(db, "UPDATE spend SET state='uncertain' WHERE id=? AND state='reserved'", id);
}

/** Record a deterministic (unpaid) call for the ledger and the cost report. */
export function recordFree(
  db: DB,
  x: {
    ws: string;
    assignmentId: string | null;
    runId: string;
    stageId: string;
    attempt: number;
    provider: string;
    model: string;
    latencyMs: number;
  },
) {
  run(
    db,
    "INSERT INTO spend(id,workspace_id,assignment_id,run_id,stage_id,attempt,provider,model,state,reserved_usd,actual_usd,latency_ms,paid,created_at,settled_at) VALUES(?,?,?,?,?,?,?,?,'settled',0,0,?,0,?,?)",
    uid('sp'),
    x.ws,
    x.assignmentId,
    x.runId,
    x.stageId,
    x.attempt,
    x.provider,
    x.model,
    x.latencyMs,
    clock.now(),
    clock.now(),
  );
}

export function runSpend(db: DB, runId: string) {
  const rows = all(
    db,
    'SELECT provider, model, state, reserved_usd, actual_usd, input_tokens, output_tokens, cached_tokens, latency_ms, paid, attempt, stage_id FROM spend WHERE run_id=? ORDER BY created_at',
    runId,
  );
  const paid = rows.filter((r) => r.paid);
  return {
    calls: rows.length,
    paidCalls: paid.length,
    settledUsd: paid.reduce((a, r) => a + (r.state === 'settled' ? (r.actual_usd ?? 0) : 0), 0),
    uncertainUsd: paid.reduce((a, r) => a + (r.state === 'uncertain' ? r.reserved_usd : 0), 0),
    rows,
  };
}
