import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { diffWords } from 'diff';
import { AlertTriangle, Ban, Pause, Play, Undo2 } from 'lucide-react';
import { get, newKey, post } from '@/lib/api';
import { useShell, plural } from '@/lib/shell';
import { ErrorNote, Spinner, cx, useAsync, useInterval } from '@/lib/ui';
import { RunPanel } from '@/components/RunPanel';
import { PassageChip } from '@/components/PassageChip';

const ISSUE: Record<string, string> = {
  unsupported_causality: 'Overstated cause',
  unsupported_claim: 'Unsupported claim',
  number_mismatch: 'Figure differs from source',
  citation_missing: 'Missing citation',
  missing_requirement: 'Missing requirement',
  weak_argument: 'Argument',
  unclear_sentence: 'Clarity',
  stock_phrase: 'Stock phrasing',
  style: 'Style',
  structure: 'Structure',
  other: 'Other',
};
const VERDICT: Record<string, string> = {
  supported: 'Supported',
  partial: 'Partly supported',
  contradicted: 'Contradicted',
  insufficient: 'Not established',
  unreadable: 'Source unreadable',
};
const STAGE_WORDS: Record<string, string> = {
  requirements: 'Checking the assignment',
  requirement_check: 'Checking the assignment',
  critique: 'Reading for your best edits',
  editor: 'Reading for your best edits',
  claim_split: 'Finding your claims',
  claims: 'Finding your claims',
  evidence: 'Checking claims against readings',
  evidence_verifier: 'Checking claims against readings',
  verify: 'Verifying each suggestion',
  repair: 'Repairing one weak spot',
  independent_critic: 'Getting a second opinion',
  critic: 'Getting a second opinion',
};
const stageWord = (n: string) => STAGE_WORDS[n] ?? n.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
const STATE_WORD: Record<string, string> = {
  queued: 'waiting',
  leased: 'working',
  done: 'done',
  failed: 'failed',
  skipped: 'skipped',
  pending: 'waiting',
  running: 'working',
};

function Diff({ a, b }: { a: string; b: string }) {
  const parts = diffWords(a, b);
  return (
    <div className="space-y-2 leading-relaxed" data-testid="diff">
      <p>
        <span className="label mr-2">Now</span>
        {parts
          .filter((p) => !p.added)
          .map((p, i) => (
            <span key={i} className={p.removed ? 'diff-del' : ''}>
              {p.value}
            </span>
          ))}
      </p>
      <p>
        <span className="label mr-2">Suggested</span>
        {parts
          .filter((p) => !p.removed)
          .map((p, i) => (
            <span key={i} className={p.added ? 'diff-add' : ''}>
              {p.value}
            </span>
          ))}
      </p>
    </div>
  );
}

const typing = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  if (!el) return false;
  return !!el.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]');
};

/** Review: start a review, watch real stages, then decide on one recommendation at a time. Keeping your wording is as easy as changing it. */
export default function Review() {
  const { o, reload, go, openSource, announce } = useShell();
  const docId = o.document?.id ?? null;
  const doc = useAsync(() => (docId ? get(`/documents/${docId}`) : Promise.resolve(null)), [docId]);
  const runs = useAsync(() => (docId ? get(`/documents/${docId}/runs`) : Promise.resolve([])), [docId]);
  const d = doc.data as any;
  const [opts, setOpts] = useState(false);
  const [starting, setStarting] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<any>(null);
  const [last, setLast] = useState<{ text: string; revisionId?: string } | null>(null);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [skipped, setSkipped] = useState<string[]>([]);
  const [viewAll, setViewAll] = useState(false);
  const [index, setIndex] = useState(0);
  const keys = useRef(new Map<string, string>());
  const head = useRef<HTMLHeadingElement>(null);
  const est = useAsync(() => (docId ? post(`/documents/${docId}/runs/estimate`, { mode: 'quick' }) : Promise.resolve(null)), [docId, d?.revision?.id]);

  const active = ((runs.data as any[]) ?? []).find((r) => ['queued', 'running', 'paused', 'blocked'].includes(r.status));
  useInterval(() => void runs.reload(), active ? 800 : null);
  const seenDone = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const done = ((runs.data as any[]) ?? []).find((r) => r.status === 'done');
    if (runs.data === undefined || runs.data === null) return;
    if (seenDone.current === undefined) {
      seenDone.current = done?.id ?? null;
      return;
    }
    if (done && done.id !== seenDone.current) {
      seenDone.current = done.id;
      void Promise.all([doc.reload(), reload()]).then(() => announce('Review finished.'));
    }
  }, [runs.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const pendingAll: any[] = useMemo(() => (d?.proposals ?? []).filter((p: any) => p.decision === 'pending' || p.decision === 'conflict'), [d]);
  const pending = useMemo(
    () => [...pendingAll.filter((p) => !skipped.includes(p.id)), ...pendingAll.filter((p) => skipped.includes(p.id))],
    [pendingAll, skipped],
  );
  const cur = pending[Math.min(index, Math.max(0, pending.length - 1))];
  const criteria: Record<string, string> = useMemo(
    () => Object.fromEntries((o.brief.items as any[]).filter((i) => i.kind === 'criterion').map((i) => [i.key, i.label])),
    [o.brief.items],
  );
  const resolved: any[] = d?.resolved ?? [];
  const outcome = useMemo(() => {
    const applied = resolved.filter((p) => p.decision === 'accepted' || p.decision === 'edited').length;
    const kept = resolved.filter((p) => p.decision === 'rejected').length;
    return { applied, kept };
  }, [resolved]);

  const startQuick = async () => {
    if (!docId) return;
    setStarting(true);
    setErr(null);
    try {
      await post(`/documents/${docId}/log`, { kind: 'review_started' });
      await post(`/documents/${docId}/runs`, { mode: 'quick', idempotencyKey: newKey('run') });
      setSkipped([]);
      setIndex(0);
      await runs.reload();
    } catch (e) {
      setErr(e);
    } finally {
      setStarting(false);
    }
  };

  const decide = useCallback(
    async (p: any, action: 'accept' | 'reject' | 'edit', finalText?: string) => {
      if (!docId || busy) return;
      setBusy(true);
      setErr(null);
      try {
        const k = `${p.id}:${action}`;
        if (!keys.current.has(k)) keys.current.set(k, newKey('dec'));
        const r = await post(`/proposals/${p.id}/decision`, { action, finalText, idempotencyKey: keys.current.get(k) });
        if (r.status === 'conflict') {
          setConflict({ id: p.id, ...r.conflict });
        } else {
          const t = action === 'reject' ? 'Kept your wording.' : action === 'edit' ? 'Saved your version.' : 'Used the change.';
          setLast({ text: t, revisionId: r.revisionId });
          setEditing(false);
          const left = pending.length - 1;
          announce(`${t} ${left === 0 ? 'That was the last one.' : plural(left, 'recommendation') + ' left.'}`);
        }
        await Promise.all([doc.reload(), reload()]);
        setIndex(0);
        setTimeout(() => head.current?.focus(), 60);
      } catch (e) {
        setErr(e);
      } finally {
        setBusy(false);
      }
    },
    [docId, busy, pending.length, announce, doc.reload, reload], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const undo = async () => {
    if (!last?.revisionId || !docId) return;
    try {
      const h = await get(`/documents/${docId}/history`);
      const rev = h.revisions.find((r: any) => r.id === last.revisionId);
      if (rev?.parent_id) await post(`/documents/${docId}/restore`, { revisionId: rev.parent_id });
      setLast(null);
      await Promise.all([doc.reload(), reload()]);
      announce('Undone.');
    } catch (e) {
      setErr(e);
    }
  };

  const showEvidence = useCallback(
    (p: any) => {
      const e = (p.evidence ?? []).find((x: any) => x.relationship !== 'contradicts_original');
      if (e) openSource({ passageId: e.passageId, hint: p.replacement }, { backLabel: 'Back to this recommendation' });
    },
    [openSource],
  );

  // a / r / e / s: only when nobody is typing, no dialog is open, and no modifier is held.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target) || document.querySelector('[role="dialog"]')) return;
      if (!cur || editing || conflict) return;
      if (e.key === 'a' && cur.applicable !== false) {
        e.preventDefault();
        void decide(cur, 'accept');
      } else if (e.key === 'r') {
        e.preventDefault();
        void decide(cur, 'reject');
      } else if (e.key === 'e') {
        e.preventDefault();
        setText(cur.replacement);
        setEditing(true);
      } else if (e.key === 's') {
        e.preventDefault();
        showEvidence(cur);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [cur, editing, conflict, decide, showEvidence]);

  if (!docId)
    return (
      <div className="mx-auto max-w-[680px] px-4 py-10" data-testid="stage-review">
        <h1 className="title text-3xl" tabIndex={-1} data-stage-heading>
          Review
        </h1>
        <p className="mt-2 text-ink2">There is nothing to review yet.</p>
        <button className="btn btn-primary mt-4" onClick={() => go('draft')}>
          Go to Draft
        </button>
      </div>
    );
  if ((doc.loading && !d) || runs.loading)
    return (
      <div className="p-8">
        <Spinner label="Opening review" />
      </div>
    );

  const lastRun = ((runs.data as any[]) ?? []).find((r) => r.status === 'done');
  const e = est.data as any;
  const weak = (d?.audits ?? []).filter((a: any) => a.verdict !== 'supported');

  return (
    <div className="mx-auto max-w-[760px] px-4 py-8 md:py-10" data-testid="stage-review">
      <h1 className="title text-3xl" tabIndex={-1} data-stage-heading ref={head}>
        Review
      </h1>
      <div className="mt-3">
        <ErrorNote error={err ?? doc.error} />
      </div>

      {/* 1 · nothing running and nothing open */}
      {!active && pending.length === 0 && !lastRun && (
        <section className="mt-4" data-testid="review-start">
          <p className="text-lg">Find the few edits that matter most, with the exact sentence and the reason for each. You decide on every one.</p>
          {e && !e.error && (
            <p className="mt-3 text-sm text-ink2" data-testid="review-estimate">
              Looks at about {e.words} words.{' '}
              {e.paid
                ? e.priceMissing
                  ? 'Cost unknown: set prices in Settings before paid use.'
                  : `Costs up to $${e.costUsd.toFixed(4)}.`
                : 'Free in this setup: it uses sample feedback, not a live AI model.'}
            </p>
          )}
          {e?.error && <p className="mt-3 text-sm text-err">{e.error}</p>}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              className="btn btn-primary"
              onClick={startQuick}
              disabled={starting || !!e?.error || !!(e?.paid && e?.priceMissing)}
              data-testid="start-quick"
            >
              Review my draft
            </button>
            {starting && <Spinner />}
          </div>
        </section>
      )}

      {/* 2 · real stages while it runs */}
      {active && (
        <section className="mt-4 panel p-4" data-testid="run-progress" data-status={active.status} aria-live="polite">
          <h2 className="font-semibold">
            {active.status === 'paused' ? 'Paused' : active.status === 'blocked' ? 'Stopped before finishing' : 'Reviewing your draft'}
          </h2>
          <ol className="mt-3 space-y-1.5">
            {active.stages.map((s: any) => (
              <li key={s.id} className="flex items-center gap-2 text-sm" data-testid="run-stage" data-status={s.status}>
                <span
                  className={cx(
                    'inline-block h-2 w-2 rounded-full',
                    s.status === 'done' ? 'bg-ok' : s.status === 'failed' ? 'bg-err' : s.status === 'leased' ? 'bg-accent' : 'bg-edge',
                  )}
                  aria-hidden
                />
                <span>{stageWord(s.name)}</span>
                <span className="text-ink2">· {STATE_WORD[s.status] ?? s.status}</span>
              </li>
            ))}
          </ol>
          {active.preliminary && active.status !== 'done' && (
            <p className="mt-2 text-sm text-ink2">
              A first pass is ready ({plural(active.preliminary.count, 'candidate edit')}). It is not verified yet, so it stays hidden until the checks finish.
            </p>
          )}
          {active.error && <p className="mt-2 text-sm text-err">{active.error}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            {['queued', 'running'].includes(active.status) && (
              <button
                className="btn"
                onClick={async () => {
                  await post(`/runs/${active.id}/pause`);
                  await runs.reload();
                }}
                data-testid="run-pause"
              >
                <Pause size={14} aria-hidden /> Pause
              </button>
            )}
            {(active.status === 'paused' || active.status === 'blocked') && (
              <button
                className="btn btn-primary"
                onClick={async () => {
                  await post(`/runs/${active.id}/resume`);
                  await runs.reload();
                }}
                data-testid="run-resume"
              >
                <Play size={14} aria-hidden /> {active.status === 'blocked' ? 'Try again' : 'Resume'}
              </button>
            )}
            {['queued', 'running', 'blocked', 'paused'].includes(active.status) && (
              <button
                className="btn"
                onClick={async () => {
                  await post(`/runs/${active.id}/cancel`);
                  await runs.reload();
                }}
                data-testid="run-cancel"
              >
                <Ban size={14} aria-hidden /> Cancel
              </button>
            )}
          </div>
        </section>
      )}

      {/* 3 · one recommendation at a time */}
      {!active && cur && (
        <section className="mt-4" aria-labelledby="rec-h" data-testid="recommendation" data-issue={cur.issue}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="rec-h" className="text-xl font-semibold" tabIndex={-1}>
              Recommendation {Math.min(index, pending.length - 1) + 1} of {pending.length}
            </h2>
            <button className="link text-sm" onClick={() => setViewAll((v) => !v)} aria-expanded={viewAll} data-testid="view-all">
              {viewAll ? 'Hide the list' : 'View all'}
            </button>
          </div>
          {viewAll && (
            <ol className="mt-2 divide-y divide-rule rounded-md border border-rule" data-testid="all-list">
              {pending.map((p, i) => (
                <li key={p.id}>
                  <button
                    className={cx('block w-full px-3 py-2 text-left text-sm hover:bg-tint', p.id === cur.id && 'bg-tint font-medium')}
                    onClick={() => {
                      setIndex(i);
                      setViewAll(false);
                      setEditing(false);
                    }}
                  >
                    {i + 1}. {ISSUE[p.issue] ?? p.issue}: {p.original.slice(0, 70)}
                    {p.original.length > 70 ? '…' : ''}
                  </button>
                </li>
              ))}
            </ol>
          )}
          <Recommendation
            p={cur}
            criteria={criteria}
            busy={busy}
            editing={editing}
            text={text}
            setText={setText}
            setEditing={(v) => {
              setEditing(v);
              if (v) setText(cur.replacement);
            }}
            onDecide={(a, t) => decide(cur, a, t)}
            onEvidence={() => showEvidence(cur)}
            onSkip={
              pending.length > 1
                ? () => {
                    setSkipped((s) => [...s, cur.id]);
                    setIndex(0);
                    announce('Skipped for now.');
                  }
                : undefined
            }
          />
        </section>
      )}

      {conflict && (
        <section className="mt-4 panel p-4" role="alert" data-testid="conflict-panel">
          <h2 className="font-semibold">Two changes touch the same sentence</h2>
          <p className="mt-1 text-sm">{conflict.detail} Nothing was changed.</p>
          <dl className="mt-2 space-y-2 text-sm">
            <div>
              <dt className="label">When this was suggested</dt>
              <dd>{conflict.baseText}</dd>
            </div>
            <div>
              <dt className="label">Your text now</dt>
              <dd>{conflict.headText}</dd>
            </div>
            <div>
              <dt className="label">The suggested replacement</dt>
              <dd>{conflict.replacement}</dd>
            </div>
          </dl>
          <button className="btn mt-3" onClick={() => setConflict(null)}>
            Keep my current text
          </button>
        </section>
      )}

      {last && !active && (
        <p className="mt-4 flex items-center gap-3 text-sm" role="status" data-testid="last-action">
          <span>{last.text}</span>
          {last.revisionId && (
            <button className="btn btn-quiet px-2" onClick={undo} data-testid="undo">
              <Undo2 size={14} aria-hidden /> Undo
            </button>
          )}
        </p>
      )}

      {/* 4 · outcome */}
      {!active && pending.length === 0 && (lastRun || resolved.length > 0) && (
        <section className="mt-4" data-testid="review-outcome">
          <h2 className="text-xl font-semibold">{outcome.applied + outcome.kept > 0 ? 'Review finished' : 'No changes to suggest'}</h2>
          <p className="mt-1 text-lg" data-testid="outcome-line">
            {outcome.applied + outcome.kept > 0
              ? `${plural(outcome.applied, 'change')} applied · ${outcome.kept} kept as written`
              : 'This review found nothing that needs changing right now.'}
          </p>
          {lastRun?.summary?.requirements?.length > 0 && (
            <ul className="mt-3 space-y-1 text-sm">
              {lastRun.summary.requirements.map((q: any) => (
                <li key={q.id}>
                  {q.status === 'met' ? 'Met' : q.status === 'missing' ? 'Missing' : 'Check'}: {q.message}
                </li>
              ))}
            </ul>
          )}
          {lastRun?.summary?.degraded?.length > 0 && (
            <p className="mt-2 text-sm text-warn">
              Finished with the first pass only. Skipped: {lastRun.summary.degraded.map((x: any) => `${stageWord(x.stage)} (${x.reason})`).join('; ')}
            </p>
          )}
          {weak.length > 0 && (
            <details className="mt-3" data-testid="claims-to-check">
              <summary className="cursor-pointer text-sm font-medium">{plural(weak.length, 'claim')} your readings do not fully support</summary>
              <ul className="mt-2 space-y-2 text-sm">
                {weak.map((a: any) => (
                  <li key={a.id} className="panel p-2">
                    <b>{VERDICT[a.verdict]}</b>: “{a.claim}”
                    {a.reasons?.map((r: string, i: number) => (
                      <span key={i} className="block text-ink2">
                        {r}
                      </span>
                    ))}
                    {a.passageId && (
                      <span className="mt-1 block">
                        <PassageChip id={a.passageId} hint={a.claim} backLabel="Back to review" />
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <div className="mt-5 flex flex-wrap gap-3">
            <button className="btn btn-primary" onClick={() => go('export')} data-testid="to-export">
              Continue to Export
            </button>
            <button className="btn" onClick={() => go('draft')}>
              Back to my draft
            </button>
            <button className="btn btn-quiet" onClick={startQuick} disabled={starting} data-testid="review-again">
              Review again
            </button>
          </div>
        </section>
      )}
      {!active && pending.length > 0 && (
        <p className="mt-6 text-sm text-ink2">
          Not ready to decide on everything?{' '}
          <button className="link" onClick={() => go('export')} data-testid="finish-unresolved">
            Continue to Export
          </button>{' '}
          with {plural(pending.length, 'open recommendation')}. They will be here when you come back.
        </p>
      )}

      {/* 5 · everything else stays one step away */}
      <div className="mt-10 border-t border-rule pt-4">
        <button className="link" aria-expanded={opts} onClick={() => setOpts((v) => !v)} data-testid="review-options">
          Review options
        </button>
        {opts && (
          <div className="mt-3">
            <p className="mb-3 text-sm text-ink2">
              Evidence review checks every claim against your readings. Deep review adds an independent second opinion. Both take longer.
            </p>
            <RunPanel
              documentId={docId}
              assignmentId={o.assignment.id}
              onStarted={() => void runs.reload()}
              onFinished={() => {
                void Promise.all([doc.reload(), reload(), runs.reload()]);
              }}
              flushSave={async () => {}}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/** high: the change could alter meaning or reviewers disagree, so keeping your wording leads. neutral: it adds something you must decide on. low: a plain edit. */
const riskOf = (p: any): 'high' | 'neutral' | 'low' =>
  (p.findings ?? []).some((f: any) => f.severity === 'material') || p.disagreement
    ? 'high'
    : p.requiresDecision || (p.meaningChange && p.issue !== 'style' && p.issue !== 'stock_phrase')
      ? 'neutral'
      : 'low';

function Recommendation({
  p,
  criteria,
  busy,
  editing,
  text,
  setText,
  setEditing,
  onDecide,
  onEvidence,
  onSkip,
}: {
  p: any;
  criteria: Record<string, string>;
  busy: boolean;
  editing: boolean;
  text: string;
  setText: (t: string) => void;
  setEditing: (v: boolean) => void;
  onDecide: (a: 'accept' | 'reject' | 'edit', t?: string) => void;
  onEvidence: () => void;
  onSkip?: () => void;
}) {
  const material = (p.findings ?? []).filter((f: any) => f.severity === 'material');
  const evid = (p.evidence ?? []).filter((x: any) => x.relationship !== 'contradicts_original');
  const risk = riskOf(p);
  const useBtn = (primary: boolean) => (
    <button className={cx('btn', primary && 'btn-primary')} disabled={busy || p.applicable === false} onClick={() => onDecide('accept')} data-testid="accept">
      Use this change <kbd className="ml-1 hidden text-[10px] opacity-70 md:inline">a</kbd>
    </button>
  );
  const keepBtn = (primary: boolean) => (
    <button className={cx('btn', primary && 'btn-primary')} disabled={busy} onClick={() => onDecide('reject')} data-testid="reject">
      Keep my wording <kbd className="ml-1 hidden text-[10px] opacity-70 md:inline">r</kbd>
    </button>
  );
  return (
    <article className="panel mt-3 p-4" aria-label={`Recommendation: ${ISSUE[p.issue] ?? p.issue}`}>
      <p className="text-sm">
        <b>{ISSUE[p.issue] ?? p.issue}</b>
        {p.rubricCriterionId && criteria[p.rubricCriterionId] ? <span className="text-ink2"> · {criteria[p.rubricCriterionId]}</span> : null}
      </p>
      {p.reason && <p className="mt-1 text-ink2">{p.reason}</p>}
      {(p.contextBefore || p.contextAfter) && (
        <p className="mt-3 text-sm text-ink2" data-testid="sentence-context">
          …{String(p.contextBefore ?? '').slice(-140)}
          <b className="text-ink">{p.original}</b>
          {String(p.contextAfter ?? '').slice(0, 140)}…
        </p>
      )}
      <div className="mt-3">
        <Diff a={p.original} b={editing ? text : p.replacement} />
      </div>
      {material.length > 0 && (
        <ul className="mt-3 space-y-1 rounded-md border border-warn p-3 text-sm" data-testid="meaning-warnings">
          {material.map((f: any, i: number) => (
            <li key={i} className="flex gap-2">
              <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warn" aria-hidden />
              <span>
                <b>This could change your meaning.</b> {f.message}
              </span>
            </li>
          ))}
        </ul>
      )}
      {p.meaningChange && material.length === 0 && (
        <p className="mt-3 text-sm">
          <b>What changes:</b> {p.meaningChange}
        </p>
      )}
      {p.disagreement && (
        <div className="mt-3 rounded-md border border-edge p-3 text-sm" data-testid="disagreement">
          <b>Two reviewers disagree.</b> The second says <i>{p.disagreement.critic.verdict}</i>: {p.disagreement.critic.reasons.join(' ')}
          <p className="mt-1">
            <b>What would settle it:</b> {p.disagreement.settleBy}
          </p>
        </div>
      )}
      {p.applicable === false && (
        <p className="mt-3 text-sm text-err">The text has changed since this was suggested, so it can no longer be applied. You can keep your wording.</p>
      )}
      {editing && (
        <textarea
          className="input mt-3 min-h-24"
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label="Your version of this sentence"
          data-testid="edit-text"
        />
      )}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {editing ? (
          <>
            <button className="btn btn-primary" disabled={busy || !text.trim()} onClick={() => onDecide('edit', text)} data-testid="save-mine">
              Save my version
            </button>
            <button className="btn" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </>
        ) : (
          <>
            {risk === 'high' ? (
              <>
                {keepBtn(true)}
                {useBtn(false)}
              </>
            ) : (
              <>
                {useBtn(risk === 'low')}
                {keepBtn(false)}
              </>
            )}
            <button className="btn" disabled={busy} onClick={() => setEditing(true)} data-testid="edit">
              Edit it myself <kbd className="ml-1 hidden text-[10px] opacity-70 md:inline">e</kbd>
            </button>
            {onSkip && (
              <button className="btn btn-quiet" onClick={onSkip} data-testid="skip">
                Skip for now
              </button>
            )}
          </>
        )}
      </div>
      {evid.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2 text-sm" data-testid="evidence-row">
          <span className="text-ink2">Evidence</span>
          {evid.slice(0, 2).map((x: any) => (
            <PassageChip key={x.passageId + x.relationship} id={x.passageId} hint={p.replacement} backLabel="Back to this recommendation" />
          ))}
          <button className="link" onClick={onEvidence} data-testid="open-evidence">
            Open the evidence <kbd className="ml-1 hidden text-[10px] opacity-70 md:inline">s</kbd>
          </button>
        </div>
      )}
    </article>
  );
}
