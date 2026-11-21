import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, RotateCcw } from 'lucide-react';
import { get, post, newKey } from '@/lib/api';
import { ErrorNote, Section, Spinner, cx, useAsync } from '@/lib/ui';

const TYPE: Record<string, string> = {
  claim: 'Claim',
  evidence: 'Evidence',
  certainty: 'Certainty',
  point_of_view: 'Point of view',
  citation: 'Citation',
  wording: 'Wording only',
};

export default function History() {
  const { id = '' } = useParams();
  const h = useAsync(() => get(`/documents/${id}/history`), [id]);
  const doc = useAsync(() => get(`/documents/${id}`), [id]);
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const revs: any[] = h.data?.revisions ?? [];
  useEffect(() => {
    if (revs.length && !b) {
      setB(revs.at(-1).id);
      setA(revs.length > 1 ? revs[Math.max(0, revs.length - 2)].id : revs[0].id);
    }
  }, [revs.length]); // eslint-disable-line
  const cmp = useAsync(() => (a && b ? get(`/documents/${id}/compare?a=${a}&b=${b}`) : Promise.resolve(null)), [a, b, id]);
  if (h.loading)
    return (
      <div className="p-6">
        <Spinner />
      </div>
    );
  const branches: Record<string, string> = Object.fromEntries((h.data?.branches ?? []).map((x: any) => [x.id, x.name]));
  const act = async (fn: () => Promise<unknown>) => {
    try {
      setErr(null);
      await fn();
      await Promise.all([h.reload(), doc.reload(), cmp.reload()]);
    } catch (e) {
      setErr(e);
    }
  };
  const label = (r: any) => `${new Date(r.created_at).toLocaleString()} · ${r.cause}${r.label ? ' · ' + r.label : ''} · ${branches[r.branch_id] ?? ''}`;
  return (
    <div className="mx-auto max-w-5xl p-6">
      <Link to={`/assignments/${doc.data?.document.assignmentId ?? ''}/draft`} className="btn btn-quiet mb-3 px-2" data-testid="back-to-draft">
        <ArrowLeft size={16} /> Back to the draft
      </Link>
      <h1 className="mb-1 text-2xl font-semibold">History</h1>
      <p className="muted mb-4">Every version is kept. Restoring creates a new version with the old one as its parent; nothing is erased.</p>
      <ErrorNote error={err ?? h.error} />

      <Section title="Branches">
        <ul className="flex flex-wrap gap-2">
          {(h.data?.branches ?? []).map((br: any) => (
            <li
              key={br.id}
              className={cx('card flex items-center gap-2 p-2 text-sm', doc.data?.document.activeBranchId === br.id && 'ring-2 ring-accent')}
              data-testid="branch-row"
            >
              <b>{br.name}</b>
              {doc.data?.document.activeBranchId === br.id ? (
                <span className="chip">active</span>
              ) : (
                <button className="btn px-2 py-1" onClick={() => act(() => post(`/documents/${id}/branches/${br.id}/switch`))}>
                  Switch to this
                </button>
              )}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Versions">
        <ol className="space-y-1.5" data-testid="revision-list">
          {[...revs].reverse().map((r) => (
            <li key={r.id} className="card flex flex-wrap items-center justify-between gap-2 p-2 text-sm" data-testid="revision-row" data-cause={r.cause}>
              <span>
                <code className="text-xs text-stone-500">{r.id}</code> {label(r)}
              </span>
              <span className="flex gap-1.5">
                <button className="btn px-2 py-1" onClick={() => setA(r.id)}>
                  Compare from
                </button>
                <button className="btn px-2 py-1" onClick={() => setB(r.id)}>
                  Compare to
                </button>
                <button className="btn px-2 py-1" onClick={() => act(() => post(`/documents/${id}/restore`, { revisionId: r.id }))} data-testid="restore">
                  <RotateCcw size={13} /> Restore
                </button>
              </span>
            </li>
          ))}
        </ol>
      </Section>

      <Section title="Compare">
        <div className="mb-3 grid gap-2 sm:grid-cols-2">
          <label className="text-sm">
            From
            <select className="input mt-1" value={a} onChange={(e) => setA(e.target.value)}>
              {revs.map((r) => (
                <option key={r.id} value={r.id}>
                  {label(r)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            To
            <select className="input mt-1" value={b} onChange={(e) => setB(e.target.value)}>
              {revs.map((r) => (
                <option key={r.id} value={r.id}>
                  {label(r)}
                </option>
              ))}
            </select>
          </label>
        </div>
        {cmp.data && (
          <>
            <p className="muted mb-3" data-testid="import-boundary">
              {cmp.data.importBoundary.note}
              {cmp.data.importOnly ? ' One of these versions was imported whole, so changes between them are only what differs between the two snapshots.' : ''}
            </p>
            <ul className="space-y-3" data-testid="compare-list">
              {cmp.data.changes
                .filter((c: any) => c.status !== 'same')
                .map((c: any) => (
                  <li key={c.paragraphId} className="card p-3 text-sm" data-testid="compare-row">
                    <div className="mb-1 flex flex-wrap items-center gap-1.5">
                      <span className="chip font-semibold">{c.status}</span>
                      {c.substantive.map((s: any, i: number) => (
                        <span key={i} className={cx('chip', s.type !== 'wording' && 'border-orange-300 bg-orange-50 text-orange-900')} title={s.message}>
                          {TYPE[s.type]}
                        </span>
                      ))}
                    </div>
                    <p className="leading-relaxed">
                      {c.parts.map((p: any, i: number) => (
                        <span key={i} className={p.kind === 'add' ? 'diff-add' : p.kind === 'del' ? 'diff-del' : ''}>
                          {p.text}
                        </span>
                      ))}
                    </p>
                    {c.substantive
                      .filter((s: any) => s.type !== 'wording')
                      .map((s: any, i: number) => (
                        <p key={i} className="muted mt-1">
                          {s.message}
                        </p>
                      ))}
                    <div className="mt-2 flex gap-2">
                      {c.b && (
                        <button
                          className="btn"
                          onClick={() =>
                            act(() =>
                              post(`/documents/${id}/take`, {
                                fromRevisionId: b,
                                paragraphId: c.paragraphId,
                                idempotencyKey: newKey('take'),
                              }),
                            )
                          }
                          data-testid="take-b"
                        >
                          Take this paragraph from “To”
                        </button>
                      )}
                      {c.a && c.status === 'modified' && (
                        <button
                          className="btn"
                          onClick={() =>
                            act(() =>
                              post(`/documents/${id}/take`, {
                                fromRevisionId: a,
                                paragraphId: c.paragraphId,
                                idempotencyKey: newKey('take'),
                              }),
                            )
                          }
                        >
                          Keep the “From” paragraph
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              {cmp.data.changes.every((c: any) => c.status === 'same') && <li className="muted">No differences.</li>}
            </ul>
          </>
        )}
      </Section>
    </div>
  );
}
