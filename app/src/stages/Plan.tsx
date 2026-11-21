import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react';
import { post, put } from '@/lib/api';
import { useShell } from '@/lib/shell';
import { ErrorNote, Spinner, cx } from '@/lib/ui';
import { PassageChip } from '@/components/PassageChip';

const SAMPLE_IDEA = 'I think attendance helps, but motivated students might also show up more.';

/** Plan: say what you think, pick a direction, own the thesis, shape the outline. Nothing here writes your paper. */
export default function Plan() {
  const { o, reload, go } = useShell();
  const idea = o.plan.idea;
  const outline = o.plan.outline;
  const id = o.assignment.id;
  const [note, setNote] = useState<string>(idea?.originalNote ?? '');
  const [ownOpen, setOwnOpen] = useState(false);
  const [thesis, setThesis] = useState<string>(idea?.thesis ?? '');
  const [items, setItems] = useState<any[]>(outline?.items ?? []);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [confirmDraft, setConfirmDraft] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [showOthers, setShowOthers] = useState(false);
  const outlineRef = useRef<HTMLDivElement>(null);

  useEffect(() => setThesis(idea?.thesis ?? ''), [idea?.thesis]);
  useEffect(() => setItems(outline?.items ?? []), [outline]);

  const run = async (name: string, fn: () => Promise<unknown>) => {
    setBusy(name);
    setErr(null);
    try {
      await fn();
      await reload();
      return true;
    } catch (e) {
      setErr(e);
      return false;
    } finally {
      setBusy(null);
    }
  };
  const saveItems = async (next: any[]) => {
    setItems(next);
    try {
      await put(`/assignments/${id}/outline`, { items: next });
      await reload();
    } catch (e) {
      setErr(e);
    }
  };
  const patch = (i: number, p: Record<string, unknown>) => setItems((cur) => cur.map((it, k) => (k === i ? { ...it, ...p } : it)));
  const move = (i: number, d: -1 | 1) => {
    const next = items.slice();
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    void saveItems(next);
  };

  const startWriting = () =>
    run('start', async () => {
      if (!o.document) {
        try {
          await post(`/assignments/${id}/document`, { text: '', blank: true });
        } catch (e: any) {
          if (e?.code !== 'document_exists') throw e;
        }
      }
    }).then((ok) => {
      if (ok) void go('draft');
    });

  const draftFromOutline = () =>
    run('draft', async () => {
      await post(`/assignments/${id}/draft`);
    }).then((ok) => {
      if (ok) void go('draft');
    });

  const assist = (o.brief.items as any[]).find((i) => i.kind === 'assistance');
  const chosen = idea?.options?.find((x: any) => x.id === idea?.chosen);
  const others = (idea?.options ?? []).filter((x: any) => x.id !== idea?.chosen);
  const hasThesis = !!idea?.thesis;

  return (
    <div className="mx-auto max-w-[760px] px-4 py-8 md:py-10" data-testid="stage-plan">
      <h1 className="title text-3xl" tabIndex={-1} data-stage-heading>
        Plan
      </h1>
      <p className="mt-1 text-ink2">Say what you think. You choose the direction and the words; nothing here writes your paper for you.</p>
      <div className="mt-4">
        <ErrorNote error={err} />
      </div>

      {/* 1 · the student's own thought */}
      <section className="mt-6" aria-labelledby="think-h">
        <h2 id="think-h" className="text-xl font-semibold">
          What do you think?
        </h2>
        <label className="sr-only" htmlFor="idea-note">
          What do you think so far
        </label>
        <textarea
          id="idea-note"
          className="input mt-2 min-h-24"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="A rough thought is enough. You can type or dictate it. Your words are kept exactly as you wrote them."
          data-testid="idea-note"
        />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            className="btn btn-primary"
            disabled={!note.trim() || !!busy}
            onClick={() => run('idea', () => post(`/assignments/${id}/idea`, { note }))}
            data-testid="explore-directions"
          >
            {idea ? 'Explore directions again' : 'Explore two directions'}
          </button>
          {busy === 'idea' && <Spinner label="Reading your materials" />}
          {o.isSample && !note && (
            <button className="btn btn-quiet" onClick={() => setNote(SAMPLE_IDEA)} data-testid="sample-idea">
              Use the sample idea
            </button>
          )}
          {!hasThesis && !ownOpen && (
            <button className="link" onClick={() => setOwnOpen(true)} data-testid="own-thesis-open">
              I already know my thesis
            </button>
          )}
        </div>
        {ownOpen && !hasThesis && (
          <div className="mt-4">
            <label className="label" htmlFor="own-thesis">
              Your thesis, in your words
            </label>
            <textarea id="own-thesis" className="input mt-1 min-h-16" value={thesis} onChange={(e) => setThesis(e.target.value)} data-testid="own-thesis" />
            <button
              className="btn mt-2"
              disabled={thesis.trim().length < 3 || !!busy}
              onClick={() => run('own', () => put(`/assignments/${id}/thesis`, { thesis, note }))}
              data-testid="own-thesis-save"
            >
              Use my thesis
            </button>
          </div>
        )}
      </section>

      {/* 2 · two directions */}
      {idea && idea.options?.length > 0 && !chosen && (
        <section className="mt-10" aria-labelledby="dir-h" data-testid="directions">
          <h2 id="dir-h" className="text-xl font-semibold">
            Two directions
          </h2>
          <p className="text-sm text-ink2">
            What I heard: <span className="text-ink">{idea.extraction.claim}</span>
            {idea.extraction.objection && <> The strongest objection: {idea.extraction.objection}</>}
          </p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {idea.options.map((x: any) => (
              <article key={x.id} className="panel p-4" data-testid="direction">
                <h3 className="font-semibold">{x.label}</h3>
                <p className="mt-2">{x.thesis}</p>
                <p className="mt-2 text-sm text-ink2">{x.summary}</p>
                <p className="mt-2 text-sm">
                  <b>What would weaken it:</b> {x.weakeningFact}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {x.supportingPassageIds.length ? (
                    x.supportingPassageIds.map((p: string) => <PassageChip key={p} id={p} backLabel="Back to my plan" />)
                  ) : (
                    <span className="text-sm text-ink2">No reading supports this yet.</span>
                  )}
                </div>
                <button
                  className="btn btn-primary mt-3"
                  disabled={!!busy}
                  onClick={() => run('choose', () => post(`/assignments/${id}/idea/choose`, { optionId: x.id }))}
                  data-testid={`choose-${x.id}`}
                >
                  Work from this one
                </button>
              </article>
            ))}
          </div>
        </section>
      )}

      {/* 3 · the thesis is the student's */}
      {hasThesis && (
        <section className="mt-10" aria-labelledby="thesis-h" data-testid="thesis-block">
          <h2 id="thesis-h" className="text-xl font-semibold">
            Your thesis
          </h2>
          <p className="text-sm text-ink2">{chosen ? `Started from “${chosen.label}”. Change any word.` : 'In your words. Change it whenever you like.'}</p>
          <label className="sr-only" htmlFor="thesis-text">
            Your thesis
          </label>
          <textarea
            id="thesis-text"
            className="input mt-2 min-h-20 text-lg"
            style={{ fontFamily: 'var(--font-serif, Spectral, Georgia, serif)' }}
            value={thesis}
            onChange={(e) => setThesis(e.target.value)}
            onBlur={() => thesis.trim() && thesis.trim() !== idea.thesis && void run('thesis', () => put(`/assignments/${id}/thesis`, { thesis }))}
            data-testid="thesis-text"
          />
          {others.length > 0 && (
            <div className="mt-2">
              <button className="link text-sm" aria-expanded={showOthers} onClick={() => setShowOthers((v) => !v)} data-testid="other-directions">
                {showOthers ? 'Hide the other direction' : 'See the other direction'}
              </button>
              {showOthers &&
                others.map((x: any) => (
                  <div key={x.id} className="panel mt-2 p-3 text-sm">
                    <b>{x.label}</b>
                    <p className="mt-1">{x.thesis}</p>
                    <button className="btn mt-2" onClick={() => run('choose', () => post(`/assignments/${id}/idea/choose`, { optionId: x.id }))}>
                      Switch to this direction
                    </button>
                  </div>
                ))}
            </div>
          )}
          {!outline?.items?.length && (
            <button
              className="btn btn-primary mt-4"
              disabled={!!busy}
              onClick={() =>
                run('outline', async () => {
                  if (thesis.trim() && thesis.trim() !== idea.thesis) await put(`/assignments/${id}/thesis`, { thesis });
                  await post(`/assignments/${id}/outline`);
                }).then(() => outlineRef.current?.scrollIntoView({ block: 'start' }))
              }
              data-testid="build-outline"
            >
              Build an outline
            </button>
          )}
          {busy === 'outline' && <Spinner label="Building the outline" />}
        </section>
      )}

      {/* 4 · outline the student can edit */}
      {items.length > 0 && (
        <section className="mt-10" aria-labelledby="outline-h" ref={outlineRef} data-testid="outline">
          <h2 id="outline-h" className="text-xl font-semibold">
            Outline
          </h2>
          <p className="text-sm text-ink2">Edit, reorder or remove anything. A point marked “Source needed” has no reading behind it yet.</p>
          <ol className="mt-3 space-y-3">
            {items.map((it, i) => (
              <li key={it.id} className="panel p-3" data-testid="outline-item">
                <div className="flex items-start gap-2">
                  <span className="mt-2 w-5 shrink-0 text-ink2">{i + 1}.</span>
                  <div className="min-w-0 flex-1">
                    <label className="sr-only" htmlFor={`op-${it.id}`}>
                      Point {i + 1} title
                    </label>
                    <input
                      id={`op-${it.id}`}
                      className="input font-semibold"
                      value={it.purpose}
                      onChange={(e) => patch(i, { purpose: e.target.value })}
                      onBlur={() => void saveItems(items)}
                    />
                    <label className="sr-only" htmlFor={`oc-${it.id}`}>
                      Point {i + 1} claim
                    </label>
                    <textarea
                      id={`oc-${it.id}`}
                      className="input mt-1 min-h-16"
                      value={it.claim}
                      onChange={(e) => patch(i, { claim: e.target.value })}
                      onBlur={() => void saveItems(items)}
                    />
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {it.evidencePassageIds.length ? (
                        it.evidencePassageIds.map((p: string) => <PassageChip key={p} id={p} backLabel="Back to my plan" />)
                      ) : (
                        <span className="chip border-warn text-warn" data-testid="source-needed">
                          Source needed
                        </span>
                      )}
                    </div>
                    {it.openQuestions?.map((q: string, k: number) => (
                      <p key={k} className="mt-1 text-sm text-ink2">
                        To settle: {q}
                      </p>
                    ))}
                  </div>
                  <div className="flex shrink-0 flex-col">
                    <button className="btn btn-quiet px-2" aria-label={`Move point ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                      <ArrowUp size={16} />
                    </button>
                    <button className="btn btn-quiet px-2" aria-label={`Move point ${i + 1} down`} disabled={i === items.length - 1} onClick={() => move(i, 1)}>
                      <ArrowDown size={16} />
                    </button>
                    <button className="btn btn-quiet px-2" aria-label={`Remove point ${i + 1}`} onClick={() => void saveItems(items.filter((_, k) => k !== i))}>
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ol>
          <button
            className="btn mt-3"
            onClick={() =>
              void saveItems([...items, { id: `pt_${Date.now().toString(36)}`, purpose: 'New point', claim: '', evidencePassageIds: [], openQuestions: [] }])
            }
            data-testid="add-point"
          >
            Add a point
          </button>
        </section>
      )}

      {/* the way forward: writing is the default, generating is a deliberate second choice */}
      <section className="mt-12 border-t border-rule pt-6" data-testid="plan-actions">
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn btn-primary" disabled={!!busy} onClick={startWriting} data-testid="start-writing">
            {o.document ? 'Continue writing' : 'Start writing'}
          </button>
          {items.length > 0 && !confirmDraft && (
            <button className="btn" onClick={() => setConfirmDraft(true)} data-testid="draft-from-outline-open">
              Draft from this outline
            </button>
          )}
          {busy === 'start' && <Spinner />}
        </div>
        <p className="mt-2 text-sm text-ink2">
          {o.document ? 'Your draft is waiting.' : 'Start with a blank page. Your outline stays beside you in the Draft step.'}
        </p>
        {confirmDraft && (
          <div className={cx('panel mt-4 p-4')} role="group" aria-labelledby="gen-h" data-testid="draft-confirm">
            <h3 id="gen-h" className="font-semibold">
              Before an outline becomes text
            </h3>
            {assist ? (
              <p className="mt-2 text-sm">
                Your instructor’s words: <q>{String(assist.value)}</q>
              </p>
            ) : (
              <p className="mt-2 text-sm">Your materials do not say whether AI drafting is allowed. Ask your instructor before you use generated text.</p>
            )}
            <p className="mt-2 text-sm text-ink2">
              Generated text arrives whole{o.document ? ' on a separate branch, so what you wrote is never overwritten' : ''}. You can edit or discard it. It is
              recorded in your history{o.mode === 'demo' ? ', and in this sample setup it is placeholder text assembled from your outline and readings' : ''}.
            </p>
            <label className="mt-3 flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={allowed} onChange={(e) => setAllowed(e.target.checked)} data-testid="draft-allowed" />
              <span>I have checked that this is allowed for this assignment.</span>
            </label>
            <div className="mt-3 flex gap-3">
              <button className="btn btn-primary" disabled={!allowed || !!busy} onClick={draftFromOutline} data-testid="draft-from-outline">
                Draft from this outline
              </button>
              <button className="btn btn-quiet" onClick={() => setConfirmDraft(false)}>
                Not now
              </button>
              {busy === 'draft' && <Spinner />}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
