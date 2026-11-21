// Worker: leases one short stage at a time from the durable queue. Safe to run as a separate process, in several copies,
// or to be killed at any point: the queue recovers abandoned leases and commits are idempotent.
import { clock, getDb, one, own, type DB } from './db.ts';
import { BudgetError } from './spend.ts';
import { blockStage, claimStage, commitStage, failStage, heartbeat, isCanceled, settleCancel, type StageClaim } from './jobs.ts';
import { executeStage, isOptionalStage, type StageCtx } from './review.ts';
import { selectProviders, type ProviderSet } from './providers/index.ts';
import { RetryableError, UncertainError } from './providers/types.ts';
import { getSettings, type Ctx } from './store.ts';

export interface WorkerOpts {
  leaseMs?: number;
  pollMs?: number;
  once?: boolean;
  providers?: (mode: 'demo' | 'live') => ProviderSet;
  log?: (m: string) => void;
}

/** STUDIO_FAULT="action@point@stage@arg" — test-only fault injection (sleep@before_commit@argument_edit@30000, die@...). */
function faultHook(stageName: string, onSleep: (ms: number) => Promise<void>) {
  const spec = process.env.STUDIO_FAULT?.split('@');
  return async (point: string) => {
    if (!spec) return;
    const [action, at, stage, arg] = spec;
    if (at !== point || (stage && stage !== '*' && stage !== stageName)) return;
    if (action === 'sleep') await onSleep(Number(arg ?? 10000));
    if (action === 'die') process.kill(process.pid, 'SIGKILL');
  };
}
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function processOne(db: DB, opts: WorkerOpts = {}): Promise<boolean> {
  const leaseMs = opts.leaseMs ?? Number(process.env.STUDIO_LEASE_MS ?? 60000);
  const claim = claimStage(db, { leaseMs });
  if (!claim) return false;
  const log = opts.log ?? (() => {});
  const run = one(db, 'SELECT * FROM runs WHERE id=?', claim.runId);
  // ownership checks inside the privileged worker: the stage, run, document and assignment must all be one tenant's
  const ws = run?.workspace_id as string | undefined;
  const doc = run ? own(db, 'documents', run.document_id, ws!) : undefined;
  const asg = run ? own(db, 'assignments', run.assignment_id, ws!) : undefined;
  if (!run || ws !== claim.workspaceId || !doc || !asg) {
    failStage(db, claim, 'tenant ownership check failed', { retry: false });
    return true;
  }
  const c: Ctx = { db, ws, userId: 'worker', role: 'owner' };
  let lost = false;
  const timer = setInterval(
    () => {
      if (!heartbeat(db, claim, leaseMs)) lost = true;
    },
    Math.max(200, Math.floor(leaseMs / 3)),
  );
  const beat = async (ms: number) => {
    const end = clock.now() + ms;
    while (clock.now() < end && !lost) await sleep(Math.min(250, end - clock.now()));
  };
  try {
    let providers: ProviderSet;
    try {
      providers = (opts.providers ?? selectProviders)(getSettings(c).mode);
    } catch (e: any) {
      blockStage(db, claim, e.message);
      return true;
    }
    const sc: StageCtx = {
      db,
      c,
      claim,
      run,
      providers,
      heartbeat: () => heartbeat(db, claim, leaseMs),
      fault: faultHook(claim.name, beat),
    };
    await sc.fault('after_lease');
    const result = await executeStage(sc);
    if (lost) {
      log(`lease lost on ${claim.name}; discarding output`);
      return true;
    }
    if (isCanceled(db, claim.runId)) {
      settleCancel(db, claim);
      return true;
    }
    const ok = commitStage(db, claim, result.output, result.sideEffects);
    log(`${claim.name} ${ok ? 'committed' : 'not committed (lease lost or already done)'}`);
  } catch (e: any) {
    handleFailure(db, claim, e);
  } finally {
    clearInterval(timer);
  }
  return true;
}

function handleFailure(db: DB, claim: StageClaim, e: any) {
  const message = String(e?.message ?? e);
  if (isOptionalStage(claim.name) && !(e instanceof RetryableError && claim.attempt < 2)) {
    // the second opinion / repair is optional: finish with what we have and say why
    const ok = commitStage(db, claim, {
      skipped: true,
      reason: message.slice(0, 300),
    });
    if (ok) return;
  }
  if (e instanceof BudgetError) return blockStage(db, claim, e.message);
  if (e instanceof RetryableError)
    return failStage(db, claim, message, {
      retry: true,
      backoffMs: e.retryAfterMs ?? 1000 * 2 ** claim.attempt,
    });
  if (e instanceof UncertainError) return failStage(db, claim, `${message} Spend for this attempt is marked uncertain.`, { retry: true, backoffMs: 5000 });
  failStage(db, claim, message, { retry: false });
}

export async function runWorker(db: DB, opts: WorkerOpts = {}, stop?: AbortSignal) {
  const poll = opts.pollMs ?? 300;
  for (;;) {
    if (stop?.aborted) return;
    const did = await processOne(db, opts);
    if (!did) {
      if (opts.once) return;
      await sleep(poll);
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const once = process.argv.includes('--once');
  const db = getDb();
  console.log(`[worker] started pid=${process.pid} lease=${process.env.STUDIO_LEASE_MS ?? 60000}ms${once ? ' (once)' : ''}`);
  const ac = new AbortController();
  process.on('SIGTERM', () => ac.abort());
  process.on('SIGINT', () => ac.abort());
  runWorker(db, { once, log: (m) => console.log('[worker]', m) }, ac.signal).then(() => process.exit(0));
}
