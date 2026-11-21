// Durable job queue. A run is a DAG of short stages stored in SQLite. Workers lease ONE executable stage with an expiry,
// heartbeat while working, and commit output (plus its side effects) in a single transaction guarded by the lease token.
// A stage that was leased by a dead worker becomes claimable again once its lease expires. Duplicate delivery cannot
// produce a second output: stage_outputs.stage_id is the primary key and side effects only run on the first insert.
import { all, clock, j, one, own, run, tx, uid, unj, type DB, type Row } from './db.ts';
import { HttpError, type Ctx, requireWrite, headRevision, getDocumentRow } from './store.ts';

export type RunMode = 'quick' | 'evidence' | 'deep';
export const STAGE_PLAN: Record<RunMode, { name: string; deps: string[]; provider?: 'editor' | 'critic' | 'verifier' }[]> = {
  quick: [
    { name: 'assignment_check', deps: [] },
    { name: 'argument_edit', deps: [], provider: 'editor' },
    { name: 'finalize', deps: ['assignment_check', 'argument_edit'] },
  ],
  evidence: [
    { name: 'split_claims', deps: [] },
    { name: 'verify', deps: ['split_claims'], provider: 'verifier' },
    { name: 'edit_unsupported', deps: ['verify'], provider: 'editor' },
    { name: 'finalize', deps: ['edit_unsupported'] },
  ],
  deep: [
    { name: 'assignment_check', deps: [] },
    { name: 'argument_edit', deps: [], provider: 'editor' },
    { name: 'critic_blind', deps: [], provider: 'critic' },
    { name: 'critic_check', deps: ['argument_edit', 'critic_blind'], provider: 'critic' },
    { name: 'repair', deps: ['critic_check'], provider: 'editor' },
    { name: 'verify_final', deps: ['repair'], provider: 'verifier' },
    { name: 'finalize', deps: ['assignment_check', 'verify_final'] },
  ],
};

export function createRun(c: Ctx, input: { documentId: string; mode: RunMode; idempotencyKey?: string; estimate?: unknown; budgetUsd?: number | null }) {
  requireWrite(c);
  const doc = getDocumentRow(c, input.documentId);
  return tx(c.db, () => {
    if (input.idempotencyKey) {
      const prior = one(c.db, 'SELECT * FROM runs WHERE workspace_id=? AND idempotency_key=?', c.ws, input.idempotencyKey);
      if (prior) return { runId: prior.id as string, replayed: true };
    }
    const { revision } = headRevision(c, input.documentId);
    const runId = uid('run');
    run(c.db, "INSERT INTO runs(id,workspace_id,document_id,assignment_id,mode,status,base_revision,estimate,budget_usd,idempotency_key,created_at) VALUES(?,?,?,?,?,'queued',?,?,?,?,?)", runId, c.ws, input.documentId, doc.assignment_id, input.mode, revision.id, j(input.estimate), input.budgetUsd ?? null, input.idempotencyKey ?? null, clock.now());
    const ids = new Map<string, string>();
    STAGE_PLAN[input.mode].forEach((s, i) => {
      const id = uid('stg'); ids.set(s.name, id);
      run(c.db, 'INSERT INTO run_stages(id,run_id,workspace_id,name,ord,depends_on,status,created_at) VALUES(?,?,?,?,?,?,?,?)', id, runId, c.ws, s.name, i, j(s.deps.map((d) => ids.get(d))), s.deps.length ? 'pending' : 'ready', clock.now());
    });
    return { runId, replayed: false };
  });
}

export interface StageClaim { stageId: string; runId: string; workspaceId: string; name: string; attempt: number; leaseToken: string; leaseExpiresAt: number; mode: RunMode }

/** Atomically lease the next executable stage: a ready stage, or one whose lease expired (dead worker). */
export function claimStage(db: DB, opts: { leaseMs: number; now?: number }): StageClaim | null {
  const now = opts.now ?? clock.now();
  return tx(db, () => {
    const row = one(db, `SELECT s.*, r.mode FROM run_stages s JOIN runs r ON r.id=s.run_id
      WHERE r.status IN ('queued','running') AND r.paused=0 AND r.cancel_requested=0
        AND ((s.status='ready' AND s.not_before<=?) OR (s.status='leased' AND s.lease_expires_at<?))
      ORDER BY r.created_at, s.ord LIMIT 1`, now, now);
    if (!row) return null;
    if (row.attempts >= row.max_attempts) {
      run(db, "UPDATE run_stages SET status='failed', error=?, finished_at=? WHERE id=?", 'Gave up after repeated worker failures (lease expired).', now, row.id);
      run(db, "UPDATE runs SET status='failed', error='A stage kept failing; completed stages are kept.', finished_at=? WHERE id=?", now, row.run_id);
      return null;
    }
    const token = uid('lease');
    run(db, "UPDATE run_stages SET status='leased', attempts=attempts+1, lease_token=?, lease_expires_at=?, heartbeat_at=? WHERE id=?", token, now + opts.leaseMs, now, row.id);
    run(db, "UPDATE runs SET status='running' WHERE id=? AND status='queued'", row.run_id);
    return { stageId: row.id, runId: row.run_id, workspaceId: row.workspace_id, name: row.name, attempt: row.attempts + 1, leaseToken: token, leaseExpiresAt: now + opts.leaseMs, mode: row.mode };
  });
}

export function heartbeat(db: DB, claim: StageClaim, leaseMs: number): boolean {
  const r = run(db, "UPDATE run_stages SET lease_expires_at=?, heartbeat_at=? WHERE id=? AND lease_token=? AND status='leased'", clock.now() + leaseMs, clock.now(), claim.stageId, claim.leaseToken);
  return Number(r.changes) === 1;
}

export function stageOutput(db: DB, runId: string, name: string): any | null {
  const r = one(db, 'SELECT o.output FROM stage_outputs o JOIN run_stages s ON s.id=o.stage_id WHERE s.run_id=? AND s.name=?', runId, name);
  return r ? unj(r.output, null) : null;
}

/** Commit output + side effects atomically. Returns false when the lease was lost or the stage already has an output. */
export function commitStage(db: DB, claim: StageClaim, output: unknown, sideEffects?: () => void): boolean {
  return tx(db, () => {
    const st = one(db, 'SELECT * FROM run_stages WHERE id=?', claim.stageId);
    if (!st || st.lease_token !== claim.leaseToken || st.status !== 'leased') return false;
    const ins = run(db, 'INSERT OR IGNORE INTO stage_outputs(stage_id,workspace_id,output,created_at) VALUES(?,?,?,?)', claim.stageId, claim.workspaceId, j(output), clock.now());
    if (Number(ins.changes) === 1) sideEffects?.();
    run(db, "UPDATE run_stages SET status='done', finished_at=?, lease_token=NULL WHERE id=?", clock.now(), claim.stageId);
    advance(db, claim.runId);
    return true;
  });
}

/** Mark successors ready, and finish the run when every stage is done. */
function advance(db: DB, runId: string) {
  const stages = all(db, 'SELECT id, status, depends_on FROM run_stages WHERE run_id=?', runId);
  const done = new Set(stages.filter((s) => s.status === 'done' || s.status === 'skipped').map((s) => s.id));
  for (const s of stages) if (s.status === 'pending' && unj<string[]>(s.depends_on, []).every((d) => done.has(d))) run(db, "UPDATE run_stages SET status='ready' WHERE id=?", s.id);
  if (stages.every((s) => done.has(s.id))) {
    const fin = stageOutput(db, runId, 'finalize');
    run(db, "UPDATE runs SET status='done', summary=?, finished_at=? WHERE id=? AND status IN ('queued','running')", j(fin?.summary ?? null), clock.now(), runId);
  }
}

export function failStage(db: DB, claim: StageClaim, message: string, opts: { retry: boolean; backoffMs?: number } = { retry: false }) {
  tx(db, () => {
    const st = one(db, 'SELECT * FROM run_stages WHERE id=?', claim.stageId);
    if (!st || st.lease_token !== claim.leaseToken) return;
    const redacted = message.replace(/(sk-|key[_-]?)[A-Za-z0-9_-]{8,}/gi, '[redacted]').slice(0, 400);
    if (opts.retry && st.attempts < st.max_attempts) {
      run(db, "UPDATE run_stages SET status='ready', not_before=?, lease_token=NULL, error=? WHERE id=?", clock.now() + (opts.backoffMs ?? 1000 * 2 ** st.attempts), redacted, claim.stageId);
    } else {
      run(db, "UPDATE run_stages SET status='failed', error=?, finished_at=?, lease_token=NULL WHERE id=?", redacted, clock.now(), claim.stageId);
      run(db, "UPDATE runs SET status='failed', error=?, finished_at=? WHERE id=? AND status IN ('queued','running')", `Stage ${st.name} failed: ${redacted}. Earlier stages are kept.`, clock.now(), claim.runId);
    }
  });
}

/** Budget or missing price: not a user pause and not a failure. Completed work stays usable; resume after the cause is fixed. */
export function blockStage(db: DB, claim: StageClaim, reason: string) {
  tx(db, () => {
    run(db, "UPDATE run_stages SET status='blocked', block_reason=?, lease_token=NULL WHERE id=? AND lease_token=?", reason, claim.stageId, claim.leaseToken);
    run(db, "UPDATE runs SET status='blocked', error=? WHERE id=? AND status IN ('queued','running')", reason, claim.runId);
  });
}

export function resumeBlocked(c: Ctx, runId: string) {
  requireWrite(c);
  const r = need(own(c.db, 'runs', runId, c.ws));
  tx(c.db, () => {
    run(c.db, "UPDATE run_stages SET status='ready', block_reason=NULL, not_before=0 WHERE run_id=? AND workspace_id=? AND status='blocked'", runId, c.ws);
    run(c.db, "UPDATE runs SET status='queued', error=NULL WHERE id=? AND workspace_id=? AND status='blocked'", r.id, c.ws);
  });
}

export function cancelRun(c: Ctx, runId: string) {
  requireWrite(c);
  need(own(c.db, 'runs', runId, c.ws));
  tx(c.db, () => {
    run(c.db, 'UPDATE runs SET cancel_requested=1 WHERE id=? AND workspace_id=?', runId, c.ws);
    run(c.db, "UPDATE run_stages SET status='skipped' WHERE run_id=? AND workspace_id=? AND status IN ('pending','ready','blocked')", runId, c.ws);
    run(c.db, "UPDATE runs SET status='canceled', finished_at=? WHERE id=? AND workspace_id=? AND status IN ('queued','blocked','paused')", clock.now(), runId, c.ws);
  });
}
export function pauseRun(c: Ctx, runId: string, paused: boolean) {
  requireWrite(c);
  need(own(c.db, 'runs', runId, c.ws));
  run(c.db, 'UPDATE runs SET paused=? WHERE id=? AND workspace_id=? AND status IN (\'queued\',\'running\')', paused ? 1 : 0, runId, c.ws);
}
/** Called by a worker before committing: if the user canceled mid-stage the output is discarded. */
export function isCanceled(db: DB, runId: string): boolean {
  return one(db, 'SELECT cancel_requested FROM runs WHERE id=?', runId)?.cancel_requested === 1;
}
/** Finalize a cancel requested while a stage was executing. */
export function settleCancel(db: DB, claim: StageClaim) {
  tx(db, () => {
    run(db, "UPDATE run_stages SET status='skipped', lease_token=NULL, finished_at=? WHERE id=? AND lease_token=?", clock.now(), claim.stageId, claim.leaseToken);
    run(db, "UPDATE runs SET status='canceled', finished_at=? WHERE id=?", clock.now(), claim.runId);
  });
}

export function getRun(c: Ctx, runId: string) {
  const r = need(own(c.db, 'runs', runId, c.ws));
  const stages = all(c.db, "SELECT id, name, ord, status, attempts, block_reason, error, heartbeat_at, lease_expires_at, finished_at FROM run_stages WHERE run_id=? AND workspace_id=? ORDER BY ord", runId, c.ws);
  return { id: r.id, documentId: r.document_id, mode: r.mode, status: r.status, baseRevision: r.base_revision, paused: !!r.paused, cancelRequested: !!r.cancel_requested, estimate: unj(r.estimate, null), summary: unj(r.summary, null), error: r.error, createdAt: r.created_at, finishedAt: r.finished_at, stages };
}
export function listRuns(c: Ctx, docId?: string, limit = 20) {
  const rows = docId
    ? all(c.db, 'SELECT id FROM runs WHERE workspace_id=? AND document_id=? ORDER BY created_at DESC LIMIT ?', c.ws, docId, limit)
    : all(c.db, 'SELECT id FROM runs WHERE workspace_id=? ORDER BY created_at DESC LIMIT ?', c.ws, limit);
  return rows.map((r) => getRun(c, r.id));
}

function need(r: Row | undefined): Row { if (!r) throw new HttpError(404, 'not_found', 'run not found'); return r; }
