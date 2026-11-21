import { useEffect, useState } from 'react';
import { Ban, Pause, Play, Search } from 'lucide-react';
import { get, post, newKey } from '@/lib/api';
import { ErrorNote, ProviderBadge, Spinner, cx, useAsync, useInterval } from '@/lib/ui';

const MODES = [
  { id: 'quick', title: 'Quick review', body: 'Checks the assignment and finds your three most consequential edits.' },
  { id: 'evidence', title: 'Evidence review', body: 'Splits every claim and checks it against your readings.' },
  { id: 'deep', title: 'Deep review', body: 'Adds an independent critique, a targeted repair, and another evidence check.' },
] as const;

export function RunPanel({ documentId, onFinished, flushSave }: { documentId: string; onFinished: () => void; flushSave: () => Promise<void> }) {
  const [mode, setMode] = useState<'quick' | 'evidence' | 'deep'>('quick');
  const [err, setErr] = useState<unknown>(null);
  const [starting, setStarting] = useState(false);
  const est = useAsync(() => post(`/documents/${documentId}/runs/estimate`, { mode }), [documentId, mode]);
  const runs = useAsync(() => get(`/documents/${documentId}/runs`), [documentId]);
  const active = (runs.data ?? []).some((r: any) => ['queued', 'running', 'paused'].includes(r.status));
  useInterval(() => { runs.reload(); }, active ? 800 : null);
  const [seen, setSeen] = useState<string | null>(null);
  useEffect(() => {
    const done = (runs.data ?? []).find((r: any) => r.status === 'done');
    if (done && done.id !== seen && seen !== null) onFinished();
    if (runs.data && seen === null) setSeen(done?.id ?? '');
    else if (done) setSeen(done.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runs.data]);
  const start = async () => {
    setStarting(true); setErr(null);
    try { await flushSave(); await post(`/documents/${documentId}/log`, { kind: 'review_started' }); await post(`/documents/${documentId}/runs`, { mode, idempotencyKey: newKey('run') }); runs.reload(); }
    catch (e) { setErr(e); } finally { setStarting(false); }
  };
  const e = est.data;
  return (
    <div data-testid="run-panel">
      <div className="grid gap-2">
        {MODES.map((m) => (
          <label key={m.id} className={cx('card cursor-pointer p-3', mode === m.id && 'ring-2 ring-accent')}>
            <input type="radio" name="mode" className="sr-only" checked={mode === m.id} onChange={() => setMode(m.id)} data-testid={`mode-${m.id}`} />
            <span className="font-semibold">{m.title}</span><span className="muted block">{m.body}</span>
          </label>
        ))}
      </div>
      <div className="card mt-3 p-3 text-sm" data-testid="estimate">
        {est.loading && <Spinner />}
        {e?.error && <p className="text-red-800">{e.error}</p>}
        {e && !e.error && (<>
          <p><b>Affects</b> about {e.words} words in {e.affectedParagraphs} paragraphs. <b>Cost:</b> {e.paid ? (e.priceMissing ? 'unknown: configure prices in Settings before paid use' : `up to $${e.costUsd.toFixed(4)} (${e.label})`) : 'free (deterministic fixture engine, no key)'}</p>
          <ul className="mt-1 flex flex-wrap gap-1.5">{e.stages.map((s: any) => <li key={s.name} className="chip">{s.name.replace(/_/g, ' ')} · {s.provider === 'deterministic' ? 'code' : s.provider.startsWith('fixture') ? 'fixture' : s.provider}</li>)}</ul>
          <p className="muted mt-1">{e.independence}</p>
          {e.notes?.map((n: string) => <p key={n} className="muted">{n}</p>)}
        </>)}
      </div>
      <button className="btn btn-primary mt-3" onClick={start} disabled={starting || !!e?.error} data-testid="start-review"><Search size={14} /> Start {MODES.find((m) => m.id === mode)!.title.toLowerCase()}</button>
      <div className="mt-2"><ErrorNote error={err} /></div>
      <h3 className="label mb-1 mt-5">Recent reviews</h3>
      <ul className="space-y-2">
        {(runs.data ?? []).slice(0, 5).map((r: any) => (
          <li key={r.id} className="card p-2.5 text-sm" data-testid="run-row" data-status={r.status}>
            <div className="flex items-center justify-between gap-2">
              <b className="capitalize">{r.mode} · {r.status}</b>
              <span className="flex gap-1">
                {['queued', 'running'].includes(r.status) && <button className="btn btn-quiet px-2" onClick={async () => { await post(`/runs/${r.id}/pause`); runs.reload(); }} aria-label="Pause review"><Pause size={13} /></button>}
                {r.status === 'paused' || r.paused ? <button className="btn btn-quiet px-2" onClick={async () => { await post(`/runs/${r.id}/resume`); runs.reload(); }} aria-label="Resume review"><Play size={13} /></button> : null}
                {['queued', 'running', 'blocked'].includes(r.status) && <button className="btn btn-quiet px-2" onClick={async () => { await post(`/runs/${r.id}/cancel`); runs.reload(); }} aria-label="Cancel review"><Ban size={13} /></button>}
                {r.status === 'blocked' && <button className="btn px-2" onClick={async () => { await post(`/runs/${r.id}/resume`); runs.reload(); }}>Retry</button>}
              </span>
            </div>
            <ol className="mt-1 flex flex-wrap gap-1">{r.stages.map((s: any) => <li key={s.id} className={cx('chip', s.status === 'done' && 'border-emerald-300 bg-emerald-50 text-emerald-900', s.status === 'leased' && 'border-amber-300 bg-amber-50', s.status === 'failed' && 'border-red-300 bg-red-50 text-red-900')}>{s.name.replace(/_/g, ' ')}: {s.status}</li>)}</ol>
            {r.preliminary && r.status !== 'done' && <p className="muted mt-1">First pass ready: {r.preliminary.count} candidate edit(s), <i>not yet verified</i>. Final checks are still running.</p>}
            {r.error && <p className="mt-1 text-red-800">{r.error}</p>}
            {r.summary && (<div className="mt-1 text-stone-700 dark:text-stone-300">
              <p>{r.summary.proposalCount} suggestion(s){r.summary.overflow ? `, ${r.summary.overflow} more held back` : ''}. <ProviderBadge id={r.summary.providers?.editor} /></p>
              {r.summary.degraded?.length > 0 && <p className="text-amber-900">Finished with the first pass only. Skipped: {r.summary.degraded.map((d: any) => `${d.stage} (${d.reason})`).join('; ')}</p>}
              {r.summary.requirements?.map((q: any) => <p key={q.id} className={q.status === 'missing' ? 'text-orange-900' : ''}>{q.status === 'met' ? '✓' : q.status === 'missing' ? '✗' : '·'} {q.message}</p>)}
            </div>)}
          </li>
        ))}
      </ul>
    </div>
  );
}
