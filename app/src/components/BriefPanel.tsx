import { useState } from 'react';
import { BookOpen, Check, RefreshCw } from 'lucide-react';
import { post } from '@/lib/api';
import { ErrorNote, Section, cx } from '@/lib/ui';
import type { JumpTarget } from './SourceReader';

const LABEL: Record<string, string> = { deliverable: 'Deliverable', word_range: 'Length', page_range: 'Pages', citation_style: 'Citation system', deadline: 'Deadline', criterion: 'Rubric criteria', assistance: 'Assistance, as stated', format: 'Format' };
const ORDER = ['deliverable', 'word_range', 'page_range', 'citation_style', 'deadline', 'criterion', 'assistance', 'format'];

export function BriefPanel({ assignmentId, brief, reload, onJump }: { assignmentId: string; brief: any; reload: () => void; onJump: (t: JumpTarget) => void }) {
  const [err, setErr] = useState<unknown>(null);
  const [edit, setEdit] = useState<string | null>(null);
  const [val, setVal] = useState('');
  const act = async (fn: () => Promise<unknown>) => { try { setErr(null); await fn(); reload(); } catch (e) { setErr(e); } };
  const groups = ORDER.map((k) => ({ k, items: brief.items.filter((i: any) => i.kind === k) })).filter((g) => g.items.length);
  return (
    <div data-testid="brief-panel">
      <div className="mb-3 flex items-center justify-between">
        <p className="muted">Everything below is quoted from your uploaded material. Confirm or correct it.</p>
        <button className="btn" onClick={() => act(() => post(`/assignments/${assignmentId}/brief/extract`))}><RefreshCw size={14} /> Re-read</button>
      </div>
      <ErrorNote error={err} />
      {brief.conflicts.length > 0 && (
        <Section title="Conflicts to resolve">
          {brief.conflicts.map((c: any, i: number) => (
            <div key={i} className="card mb-2 border-amber-300 p-3 text-sm" data-testid="brief-conflict">
              <p className="mb-2">{c.note}</p>
              <div className="flex flex-wrap gap-2">
                {[c.a, c.b].map((it: any) => (
                  <button key={it.sourceId} className={cx('btn', c.resolution?.chosen_source_id === it.sourceId && 'btn-primary')} onClick={() => act(() => post(`/assignments/${assignmentId}/brief/resolve`, { kind: c.kind, chosenSourceId: it.sourceId }))}>
                    Use {it.sourceTitle}{it.sourceDate ? ` (${it.sourceDate})` : ''}: {it.value}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </Section>
      )}
      {groups.map((g) => (
        <Section key={g.k} title={LABEL[g.k]}>
          <ul className="space-y-2">
            {g.items.map((it: any) => (
              <li key={it.id} className="card p-2.5 text-sm" data-testid="brief-item">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    {it.kind === 'criterion' && <b className="mr-1">{it.label}</b>}
                    {edit === it.id ? <input className="input mt-1" value={val} onChange={(e) => setVal(e.target.value)} aria-label="Corrected value" /> : <span>{it.value}</span>}
                    <p className="mt-1 text-xs text-stone-500">“{String(it.quote).slice(0, 140)}” · {it.sourceTitle}</p>
                  </div>
                  <span className="chip shrink-0">{it.status}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <button className="btn btn-quiet px-2" onClick={() => onJump({ passageId: it.passageId, quote: { start: it.start, end: it.end } })} data-testid="brief-jump"><BookOpen size={13} /> Source</button>
                  {edit === it.id ? (<>
                    <button className="btn btn-primary px-2" onClick={() => act(async () => { await post(`/assignments/${assignmentId}/brief/correct`, { kind: it.kind, key: it.key, value: val, status: 'corrected' }); setEdit(null); })}>Save correction</button>
                    <button className="btn px-2" onClick={() => setEdit(null)}>Cancel</button>
                  </>) : (<>
                    <button className="btn px-2" onClick={() => act(() => post(`/assignments/${assignmentId}/brief/correct`, { kind: it.kind, key: it.key, value: it.value, status: 'confirmed' }))}><Check size={13} /> Confirm</button>
                    <button className="btn px-2" onClick={() => { setEdit(it.id); setVal(it.value); }}>Correct</button>
                  </>)}
                </div>
              </li>
            ))}
          </ul>
        </Section>
      ))}
      {brief.missing.length > 0 && (
        <Section title="Not found">
          <ul className="list-disc space-y-1 pl-5 text-sm text-stone-700 dark:text-stone-300">{brief.missing.map((m: any, i: number) => <li key={i}>{m.note}</li>)}</ul>
        </Section>
      )}
    </div>
  );
}
