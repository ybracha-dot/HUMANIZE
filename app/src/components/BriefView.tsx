import { useState } from 'react';
import { del, post } from '@/lib/api';
import { useShell, plural } from '@/lib/shell';
import { ErrorNote } from '@/lib/ui';

const CONFLICT_ACTION: Record<string, string> = {
  word_range: 'Choose word limit',
  page_range: 'Choose page limit',
  citation_style: 'Choose citation style',
  deadline: 'Choose due date',
};
const CONFLICT_TITLE: Record<string, string> = {
  word_range: 'Two word limits',
  page_range: 'Two page limits',
  citation_style: 'Two citation styles',
  deadline: 'Two due dates',
};
/** only conflicts that change what the student should write are promoted */
export const PROMOTED = ['word_range', 'page_range', 'citation_style', 'deadline'];

export function openConflict(brief: any) {
  return (brief.conflicts as any[]).find((c) => PROMOTED.includes(c.kind) && c.decision === 'open') ?? null;
}

function FactRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 border-t border-rule py-3 sm:grid-cols-[170px_1fr] sm:gap-6">
      <dt className="label">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

/** What the app understood, in the student's terms. Every requirement can open the exact passage it came from. */
export function BriefView({ conflictOpen, onChooseConflict, readOnly }: { conflictOpen: boolean; onChooseConflict: () => void; readOnly?: boolean }) {
  const { o, reload, openSource } = useShell();
  const b = o.brief;
  const [all, setAll] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [val, setVal] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const eff = b.effective ?? {};
  const criteria = (b.items as any[]).filter((i) => i.kind === 'criterion');
  const assist = (b.items as any[]).find((i) => i.kind === 'assistance');
  const later = (b.conflicts as any[]).find((c) => PROMOTED.includes(c.kind) && c.decision === 'later');
  const src = (i: any) => (
    <button
      className="link ml-2 text-sm"
      onClick={() => openSource({ passageId: i.passageId, quote: { start: i.start, end: i.end } }, { backLabel: 'Back to my brief' })}
      data-testid="brief-source"
    >
      See in {i.sourceTitle}
    </button>
  );
  const save = async (item: any) => {
    setErr(null);
    try {
      await post(`/assignments/${o.assignment.id}/brief/correct`, { kind: item.kind, key: item.key, value: val, status: 'corrected' });
      setEditing(null);
      await reload();
    } catch (e) {
      setErr(e);
    }
  };
  const lengthItem = eff.word_range ?? eff.page_range;
  const editable = (item: any, empty: string, extra?: React.ReactNode) =>
    !item ? (
      <span className="text-ink2">{empty}</span>
    ) : editing === item.id ? (
      <span className="flex flex-wrap items-center gap-2">
        <input className="input !w-64" value={val} onChange={(e) => setVal(e.target.value)} aria-label={`Corrected ${item.label}`} />
        <button className="btn btn-primary" onClick={() => save(item)}>
          Save my correction
        </button>
        <button className="btn" onClick={() => setEditing(null)}>
          Cancel
        </button>
      </span>
    ) : (
      <>
        <span data-testid={`brief-${item.kind}`}>{item.value}</span>
        {item.status === 'corrected' ? (
          <span className="ml-2 text-sm text-ink2">
            (your correction;{' '}
            <button
              className="link"
              onClick={async () => {
                await del(`/assignments/${o.assignment.id}/brief/correct?kind=${item.kind}&key=${encodeURIComponent(item.key)}`);
                await reload();
              }}
            >
              use the extracted text again
            </button>
            )
          </span>
        ) : (
          src(item)
        )}
        {extra}
        {!readOnly && editing !== item.id && (
          <button
            className="link ml-3 text-sm"
            onClick={() => {
              setEditing(item.id);
              setVal(item.value);
            }}
          >
            Correct
          </button>
        )}
      </>
    );

  return (
    <section aria-labelledby="brief-h" data-testid="brief-view">
      <h2 id="brief-h" className="title text-[1.9rem] leading-tight md:text-[2.4rem]">
        Your assignment at a glance
      </h2>
      <p className="mt-3 max-w-measure text-lg" data-testid="brief-deliverable">
        {eff.deliverable ? (
          <>
            {eff.deliverable.value}
            {src(eff.deliverable)}
          </>
        ) : (
          <span className="text-ink2">The instructions don’t say what to submit. Not specified.</span>
        )}
      </p>
      <dl className="mt-6">
        <FactRow label="Length">
          {conflictOpen ? (
            <>
              <ul data-testid="brief-length-conflict">
                {((b.conflicts as any[]).find((c) => c.kind === 'word_range' || c.kind === 'page_range')
                  ? [
                      (b.conflicts as any[]).find((c) => c.kind === 'word_range' || c.kind === 'page_range').a,
                      (b.conflicts as any[]).find((c) => c.kind === 'word_range' || c.kind === 'page_range').b,
                    ]
                  : []
                ).map((it: any) => (
                  <li key={it.sourceId}>
                    {it.value} <span className="text-ink2">in the {it.sourceTitle.toLowerCase()}</span>
                    {src(it)}
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-sm text-accent">
                These disagree.{' '}
                <button className="link font-semibold" onClick={onChooseConflict}>
                  {CONFLICT_ACTION.word_range}
                </button>
              </p>
            </>
          ) : (
            editable(lengthItem, 'Not specified')
          )}
          {later && !conflictOpen && (
            <p className="mt-1 text-sm text-ink2">
              Two limits were found and you haven’t chosen yet.{' '}
              <button className="link" onClick={onChooseConflict}>
                Choose now
              </button>
            </p>
          )}
        </FactRow>
        <FactRow label="Due">
          {editable(
            eff.deadline,
            'Not specified',
            eff.deadline && !eff.deadline.data?.timezone ? <span className="ml-2 text-sm text-warn">time zone not stated</span> : null,
          )}
        </FactRow>
        <FactRow label="Citation style">{editable(eff.citation_style, 'Not specified')}</FactRow>
        <FactRow label="How it’s graded">
          {criteria.length === 0 ? (
            <span className="text-ink2">Not specified. Add a rubric if you have one.</span>
          ) : (
            <>
              <ul data-testid="brief-criteria">
                {(all ? criteria : criteria.slice(0, 4)).map((c) => (
                  <li key={c.id} className="flex flex-wrap items-baseline justify-between gap-x-4 py-0.5">
                    <span>
                      {c.label}
                      <button
                        className="link ml-2 text-sm"
                        onClick={() => openSource({ passageId: c.passageId, quote: { start: c.start, end: c.end } }, { backLabel: 'Back to my brief' })}
                      >
                        See where
                      </button>
                    </span>
                    <span className="text-ink2">{String(c.value).replace(/ — .*$/, '')}</span>
                  </li>
                ))}
              </ul>
              {criteria.length > 4 && (
                <button className="link mt-1 text-sm" onClick={() => setAll((v) => !v)}>
                  {all ? 'Show fewer' : `View rubric (${plural(criteria.length, 'criterion', 'criteria')})`}
                </button>
              )}
            </>
          )}
        </FactRow>
        <FactRow label="AI tools, in your instructor’s words">
          {assist ? (
            <>
              <span>“{String(assist.value).slice(0, 220)}”</span>
              {src(assist)}
            </>
          ) : (
            <span className="text-ink2">Not specified. If you plan to use AI help, ask your instructor first.</span>
          )}
        </FactRow>
      </dl>
      <ErrorNote error={err} />
    </section>
  );
}

/** One specific, cited choice. Both original quotes are shown; "Decide later" keeps it visible without blocking writing. */
export function ConflictChooser({ onClose }: { onClose: () => void }) {
  const { o, reload, openSource } = useShell();
  const cf = (o.brief.conflicts as any[]).find((c) => PROMOTED.includes(c.kind) && c.decision !== 'chosen');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  if (!cf) return null;
  const choose = async (sourceId: string | null) => {
    setBusy(true);
    setErr(null);
    try {
      await post(`/assignments/${o.assignment.id}/brief/resolve`, { kind: cf.kind, chosenSourceId: sourceId });
      await reload();
      onClose();
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="my-6 border-y border-rule py-5" aria-labelledby="cf-h" data-testid="conflict-chooser">
      <h3 id="cf-h" className="title text-xl">
        {CONFLICT_TITLE[cf.kind]}. Which one applies to this paper?
      </h3>
      <p className="muted mt-1">Your own instructor decides. Pick the one your professor said counts, or decide later.</p>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {[cf.a, cf.b].map((it: any) => (
          <div key={it.sourceId} className="rounded-md border border-edge p-4" data-testid="conflict-option">
            <p className="text-lg font-semibold">{it.value}</p>
            <p className="muted">
              {it.sourceTitle}
              {it.sourceDate ? `, dated ${it.sourceDate}` : ''}
            </p>
            <blockquote className="mt-2 border-l-2 border-rule pl-3 text-sm italic">“{it.quote}”</blockquote>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button className="btn btn-primary" disabled={busy} onClick={() => choose(it.sourceId)} data-testid="conflict-choose">
                Use this limit
              </button>
              <button
                className="link text-sm"
                onClick={() => openSource({ passageId: it.passageId, quote: { start: it.start, end: it.end } }, { backLabel: 'Back to the choice' })}
              >
                Open the original
              </button>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-4">
        <button className="btn btn-quiet" disabled={busy} onClick={() => choose(null)} data-testid="conflict-later">
          Decide later
        </button>
        <button className="btn btn-quiet" onClick={onClose}>
          Close
        </button>
      </div>
      <ErrorNote error={err} />
    </section>
  );
}
