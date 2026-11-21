import { useEffect, useRef, useState } from 'react';
import { Check, ChevronRight } from 'lucide-react';
import { del, post, put, upload } from '@/lib/api';
import { useShell, plural } from '@/lib/shell';
import { ErrorNote, cx } from '@/lib/ui';
import { Intake } from '@/components/Intake';
import { BriefView, ConflictChooser, openConflict, PROMOTED } from '@/components/BriefView';

type Row = 'syllabus' | 'instructions' | 'rubric' | 'readings';

function StatusText({ it }: { it: any }) {
  return (
    <span className={cx('text-sm', it.status === 'ready' ? 'text-ok' : 'text-err')}>
      {it.status === 'ready' && `Ready · ${plural(it.passages, 'passage')}${it.pages ? `, ${plural(it.pages, 'page')}` : ''}`}
      {it.status === 'needs_text' && 'Not readable yet. This looks like a scan: paste its text or replace the file.'}
      {it.status === 'failed' && `Could not be read.${it.error ? ' ' + it.error : ''}`}
      {it.status === 'superseded' && 'An older version.'}
    </span>
  );
}

/** One uploaded item with the actions that matter: replace the file, paste its text, remove it. */
function MaterialItem({ it }: { it: any }) {
  const { reload, o } = useShell();
  const [pasting, setPasting] = useState(false);
  const [text, setText] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setErr(null);
    try {
      await fn();
      await reload();
      setPasting(false);
    } catch (e) {
      setErr(e);
    }
  };
  return (
    <li className="py-3" data-testid="material-item" data-status={it.status}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <span className="min-w-0 break-all font-medium">
          {it.title}
          {it.filename && it.filename !== it.title && it.filename !== `${it.title}.md` ? (
            <span className="ml-2 text-sm font-normal text-ink2">{it.filename}</span>
          ) : null}
        </span>
        <span className="text-sm text-ink2" data-testid="material-origin">
          {it.origin}
        </span>
      </div>
      <StatusText it={it} />
      <div className="mt-1 flex flex-wrap items-center gap-4 text-sm">
        <label className="link">
          Replace file
          <input
            type="file"
            className="sr-only"
            accept=".pdf,.docx,.txt,.md,.markdown"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              const fd = new FormData();
              fd.append('file', f);
              run(() => upload(`/sources/${it.id}/replace`, fd));
              e.target.value = '';
            }}
          />
        </label>
        {it.status !== 'ready' && (
          <button className="link" onClick={() => setPasting((v) => !v)}>
            Paste the text instead
          </button>
        )}
        <button
          className="link text-err"
          onClick={() =>
            confirm(
              `Remove “${it.title}” from this ${it.scope === 'course' ? 'course' : 'paper'}? Other papers in the course ${it.scope === 'course' ? 'will lose it too' : 'are not affected'}.`,
            ) &&
            run(() =>
              del(`/sources/${it.id}`).then(() =>
                it.kind === 'syllabus' || it.kind === 'assignment' || it.kind === 'rubric' ? post(`/assignments/${o.assignment.id}/brief/extract`) : null,
              ),
            )
          }
        >
          Remove
        </button>
      </div>
      {pasting && (
        <div className="mt-2">
          <textarea className="input min-h-28" value={text} onChange={(e) => setText(e.target.value)} aria-label={`Text of ${it.title}`} />
          <button
            className="btn btn-primary mt-2"
            disabled={!text.trim()}
            onClick={() =>
              run(async () => {
                const fd = new FormData();
                fd.append('text', text);
                await upload(`/sources/${it.id}/replace`, fd);
                await post(`/assignments/${o.assignment.id}/brief/extract`);
              })
            }
          >
            Use this text
          </button>
        </div>
      )}
      <ErrorNote error={err} />
    </li>
  );
}

function RowShell({
  n,
  title,
  summary,
  open,
  onToggle,
  done,
  children,
}: {
  n: number;
  title: string;
  summary: string;
  open: boolean;
  onToggle: () => void;
  done: boolean;
  children?: React.ReactNode;
}) {
  return (
    <li className="border-t border-rule" data-testid={`row-${title.toLowerCase().split(' ')[0]}`}>
      <h3>
        <button className="flex min-h-[56px] w-full items-center gap-3 py-3 text-left" aria-expanded={open} onClick={onToggle}>
          <span
            aria-hidden
            className={cx(
              'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-sm',
              done ? 'border-accent bg-accent text-accent-ink' : 'border-edge',
            )}
          >
            {done ? <Check size={14} /> : n}
          </span>
          <span className="flex-1">
            <span className="block text-lg font-semibold">{title}</span>
            <span className="block text-sm text-ink2" data-testid="row-summary">
              {summary}
            </span>
          </span>
          <ChevronRight size={18} aria-hidden className={cx('shrink-0 transition-transform', open && 'rotate-90')} />
        </button>
      </h3>
      {open && <div className="pb-5 pl-10">{children}</div>}
    </li>
  );
}

export default function Materials() {
  const { o, reload, go, announce } = useShell();
  const m = o.materials;
  const hasInstr = o.facts.hasInstructions;
  const cf = openConflict(o.brief);
  const [chooser, setChooser] = useState(false);
  const [draftOpen, setDraftOpen] = useState(false);
  const [draftText, setDraftText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const firstOpen: Row = !hasInstr && !m.syllabi.some((s: any) => s.counted) && !m.syllabusSkipped ? 'syllabus' : 'instructions';
  const [open, setOpen] = useState<Row | null>(hasInstr ? null : firstOpen);
  const chooserRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (chooser) chooserRef.current?.scrollIntoView({ block: 'center' });
  }, [chooser]);
  const toggle = (r: Row) => setOpen((cur) => (cur === r ? null : r));
  const readyInstr = m.instructions.find((i: any) => i.status === 'ready');
  const syl = m.syllabi.find((s: any) => s.counted);
  const rubricFound = m.foundInInstructions.length > 0 || m.foundInRubric.length > 0;

  const importDraft = async () => {
    setBusy(true);
    setErr(null);
    try {
      await post(`/assignments/${o.assignment.id}/document`, { text: draftText });
    } catch (e: any) {
      if (e?.code !== 'document_exists') {
        setErr(e);
        setBusy(false);
        return;
      }
    }
    await reload();
    announce('Your draft is open in the editor.');
    await go('draft');
  };

  // one next action per state
  const primary = (() => {
    if (!hasInstr) return null; // the open row carries its own button
    if (cf)
      return {
        label:
          { word_range: 'Choose word limit', page_range: 'Choose page limit', citation_style: 'Choose citation style', deadline: 'Choose due date' }[
            cf.kind as string
          ] ?? 'Resolve the difference',
        run: () => setChooser(true),
      };
    if (o.facts.hasDraft) return { label: 'Continue writing', run: () => go('draft') };
    if (o.plan.idea?.thesis) return { label: o.plan.outline?.items?.length ? 'Open outline' : 'Finish my outline', run: () => go('plan') };
    return { label: 'Start my plan', run: () => go('plan') };
  })();

  return (
    <div className="mx-auto max-w-desk px-4 py-8 md:px-6 md:py-12" data-testid="stage-materials">
      <div className="flex flex-wrap items-start justify-between gap-3">
        {!hasInstr ? (
          <h1 className="title text-[2rem] leading-tight md:text-[2.8rem]" tabIndex={-1} data-stage-heading>
            Set up your paper
          </h1>
        ) : (
          <h1 className="sr-only" data-stage-heading tabIndex={-1}>
            Materials
          </h1>
        )}
        {!o.facts.hasDraft && (
          <button className="link text-sm" onClick={() => setDraftOpen((v) => !v)} aria-expanded={draftOpen} data-testid="have-draft">
            I already have a draft
          </button>
        )}
      </div>

      {draftOpen && !o.facts.hasDraft && (
        <div className="mt-4 rounded-md border border-edge p-4" data-testid="draft-first">
          <label className="label" htmlFor="draft-paste">
            Paste your draft
          </label>
          <p className="muted">
            It opens straight in the editor. Nothing is generated or rewritten, and it is recorded as an import: the app can’t see how it was written before
            now.
          </p>
          <textarea
            id="draft-paste"
            className="input mt-2 min-h-40"
            value={draftText}
            onChange={(e) => setDraftText(e.target.value)}
            data-testid="draft-paste"
          />
          <button className="btn btn-primary mt-3" disabled={!draftText.trim() || busy} onClick={importDraft} data-testid="draft-open">
            Open my draft
          </button>
          <ErrorNote error={err} />
        </div>
      )}

      {hasInstr && (
        <div className="mt-6">
          <BriefView conflictOpen={!!cf} onChooseConflict={() => setChooser(true)} />
          {chooser && (
            <div ref={chooserRef}>
              <ConflictChooser onClose={() => setChooser(false)} />
            </div>
          )}
          {primary && (
            <div className="mt-6">
              <button className="btn btn-primary !px-6 text-base" onClick={primary.run} data-testid="primary-action">
                {primary.label}
              </button>
              {!o.facts.hasDraft && !cf && <p className="muted mt-2">Next: say what you think, and get two directions to choose from.</p>}
              {cf && <p className="muted mt-2">You can also start writing now and decide later.</p>}
            </div>
          )}
          <div className="mt-8 flex flex-wrap items-center gap-4 text-sm">
            <button
              className="link"
              onClick={async () => {
                await post(`/assignments/${o.assignment.id}/brief/extract`);
                await reload();
                announce('Materials re-read. Your corrections were kept.');
              }}
            >
              Re-read my materials
            </button>
            <span className="text-ink2">Your corrections are kept when materials are re-read.</span>
          </div>
        </div>
      )}

      <section className={hasInstr ? 'mt-10' : 'mt-8'} aria-label="Materials">
        {hasInstr && <h2 className="title text-2xl">Materials</h2>}
        <ol className="mt-3 border-b border-rule">
          <RowShell
            n={1}
            title="Syllabus"
            done={!!syl || m.syllabusSkipped}
            open={open === 'syllabus'}
            onToggle={() => toggle('syllabus')}
            summary={syl ? `${syl.origin}: ${syl.filename ?? syl.title}` : m.syllabusSkipped ? 'Skipped for now' : 'Not added yet'}
          >
            <p className="max-w-measure">Add the syllabus you use for this course. It is saved to the course once, and other papers reuse it.</p>
            {m.syllabi.length > 0 && (
              <ul className="mt-2 divide-y divide-rule" data-testid="syllabus-list">
                {m.syllabi.length > 1 && <li className="pb-2 text-sm text-ink2">More than one syllabus is on file. Choose the one for this paper:</li>}
                {m.syllabi.map((s: any) => (
                  <li key={s.id} className="flex items-center gap-3 py-2">
                    {m.syllabi.length > 1 && (
                      <input
                        type="radio"
                        name="syllabus"
                        aria-label={`Use ${s.title}`}
                        checked={m.syllabusChosenId === s.id}
                        onChange={async () => {
                          await put(`/assignments/${o.assignment.id}/ui-state`, { syllabusSourceId: s.id });
                          await reload();
                        }}
                      />
                    )}
                    <div className="flex-1">
                      <MaterialItem it={s} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3">
              <Intake
                assignmentId={o.assignment.id}
                defaultKind="syllabus"
                label="Add syllabus"
                pasteLabel="Paste the syllabus instead"
                onDone={async () => {
                  await reload();
                  setOpen('instructions');
                }}
              />
              {!syl && !m.syllabusSkipped && (
                <button
                  className="link mt-3 text-sm"
                  onClick={async () => {
                    await put(`/assignments/${o.assignment.id}/ui-state`, { skipSyllabus: true });
                    await reload();
                    setOpen('instructions');
                  }}
                  data-testid="skip-syllabus"
                >
                  Skip for now
                </button>
              )}
            </div>
          </RowShell>

          <RowShell
            n={2}
            title="Assignment instructions"
            done={!!readyInstr}
            open={open === 'instructions'}
            onToggle={() => toggle('instructions')}
            summary={readyInstr ? `${readyInstr.origin}: ${readyInstr.title}` : 'Not added yet'}
          >
            <p className="max-w-measure">What did your professor ask you to write? Paste the text from your course site, or add the file.</p>
            <p className="muted mt-1 max-w-measure">With instructions, you get a short brief of what’s asked, and Review can check your draft against it.</p>
            {m.instructions.length > 0 && (
              <ul className="mt-2 divide-y divide-rule">
                {m.instructions.map((i: any) => (
                  <MaterialItem key={i.id} it={i} />
                ))}
              </ul>
            )}
            {m.legacyAttachable.length > 0 && (
              <div className="mt-3 rounded-md border border-edge p-3 text-sm" data-testid="legacy-attach">
                <p>Older files on this course are not used for this paper unless you say so:</p>
                <ul className="mt-1">
                  {m.legacyAttachable.map((l: any) => (
                    <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-1">
                      <span>
                        {l.title} ({l.kind})
                      </span>
                      <button
                        className="btn"
                        onClick={async () => {
                          await post(`/assignments/${o.assignment.id}/materials/${l.id}/attach`);
                          await reload();
                        }}
                      >
                        Use for this paper
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="mt-3">
              <Intake
                assignmentId={o.assignment.id}
                defaultKind="assignment"
                label="Add assignment instructions"
                pasteLabel="Paste the instructions instead"
                onDone={async () => {
                  await reload();
                  setOpen(null);
                  announce('Your assignment brief is ready.');
                }}
              />
            </div>
          </RowShell>

          <RowShell
            n={3}
            title="Grading rubric"
            done={rubricFound}
            open={open === 'rubric'}
            onToggle={() => toggle('rubric')}
            summary={
              m.foundInRubric.length
                ? `${plural(m.foundInRubric.length, 'criterion', 'criteria')} from ${m.rubricFiles[0]?.title ?? 'your rubric'}`
                : m.foundInInstructions.length
                  ? `Found in ${m.instructions[0]?.title ?? 'the assignment sheet'}: ${plural(m.foundInInstructions.length, 'criterion', 'criteria')}`
                  : 'None found yet'
            }
          >
            <p className="max-w-measure">Have a separate grading rubric?</p>
            {m.foundInInstructions.length > 0 && (
              <div className="mt-2" data-testid="rubric-found">
                <p className="text-sm font-semibold text-ok">Found in {m.instructions[0]?.title ?? 'the assignment sheet'}</p>
                <ul className="mt-1 text-sm">
                  {m.foundInInstructions.map((c: any) => (
                    <li key={c.id}>
                      {c.label}: {String(c.value).replace(/ — .*$/, '')}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {m.rubricFiles.length > 0 && (
              <ul className="mt-2 divide-y divide-rule">
                {m.rubricFiles.map((i: any) => (
                  <MaterialItem key={i.id} it={i} />
                ))}
              </ul>
            )}
            <div className="mt-3">
              <Intake assignmentId={o.assignment.id} defaultKind="rubric" label="Add rubric" pasteLabel="Paste the rubric instead" onDone={reload} />
            </div>
          </RowShell>

          <RowShell
            n={4}
            title="Readings"
            done={m.readings.some((r: any) => r.status === 'ready')}
            open={open === 'readings'}
            onToggle={() => toggle('readings')}
            summary={
              m.readings.length
                ? `${plural(m.readings.filter((r: any) => r.status === 'ready').length, 'reading')} ready${m.readings.some((r: any) => r.status !== 'ready') ? `, ${m.readings.filter((r: any) => r.status !== 'ready').length} need attention` : ''}`
                : 'None added yet. You can add them any time.'
            }
          >
            <p className="max-w-measure">Which sources should this paper use? They let Review check your claims against the actual pages.</p>
            {m.readings.length > 0 && (
              <ul className="mt-2 divide-y divide-rule" data-testid="readings-list">
                {m.readings.map((i: any) => (
                  <MaterialItem key={i.id} it={i} />
                ))}
              </ul>
            )}
            <div className="mt-3">
              <Intake assignmentId={o.assignment.id} defaultKind="reading" label="Add readings" pasteLabel="Paste a reading instead" onDone={reload} />
            </div>
          </RowShell>
        </ol>
      </section>

      {!hasInstr && (
        <p className="muted mt-6 max-w-measure">
          You can skip all of this and start with your own idea or a finished draft. Adding instructions unlocks a review aligned with what your professor
          asked.
        </p>
      )}
      {!hasInstr && (
        <div className="mt-3 flex flex-wrap gap-4 text-sm">
          <button className="link" onClick={() => go('plan')}>
            Start with my own idea instead
          </button>
        </div>
      )}
      <span hidden>{PROMOTED.length}</span>
    </div>
  );
}
