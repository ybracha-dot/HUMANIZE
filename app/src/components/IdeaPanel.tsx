import { useState } from 'react';
import { BookOpen, Sparkles } from 'lucide-react';
import { post, put } from '@/lib/api';
import { ErrorNote, ProviderBadge, Spinner, cx } from '@/lib/ui';
import type { JumpTarget } from './SourceReader';

export function IdeaPanel({
  assignmentId,
  state,
  hasDocument,
  reload,
  onDocument,
  onJump,
}: {
  assignmentId: string;
  state: any;
  hasDocument: boolean;
  reload: () => void;
  onDocument: (id: string) => void;
  onJump: (t: JumpTarget) => void;
}) {
  const [note, setNote] = useState(state.idea?.originalNote ?? '');
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [thesis, setThesis] = useState<string>(state.idea?.thesis ?? '');
  const idea = state.idea;
  const outline = state.outline;
  const run = async (name: string, fn: () => Promise<any>) => {
    setBusy(name);
    setErr(null);
    try {
      const r = await fn();
      reload();
      return r;
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div data-testid="idea-panel" className="space-y-5">
      <ErrorNote error={err} />
      <section>
        <h3 className="label mb-1">1 · Your idea, in your words</h3>
        <textarea
          className="input min-h-20"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Type or dictate a thought. Dictation is not treated as your position until you read the transcript here and keep it."
          aria-label="Your idea"
          data-testid="idea-note"
        />
        <div className="mt-2 flex items-center gap-2">
          <button
            className="btn btn-primary"
            disabled={!note.trim() || !!busy}
            onClick={() =>
              run('idea', () =>
                post(`/assignments/${assignmentId}/idea`, {
                  note: [note, ...Object.values(answers)].filter(Boolean).join(' '),
                }),
              )
            }
            data-testid="find-directions"
          >
            <Sparkles size={14} /> Find two directions
          </button>
          {busy === 'idea' && <Spinner />}
          {idea && <span className="muted">Your original note is kept: “{String(idea.originalNote).slice(0, 80)}”</span>}
        </div>
      </section>

      {idea && (
        <section>
          <h3 className="label mb-1">
            2 · What I heard <ProviderBadge id={idea.provider} />
          </h3>
          <dl className="card grid gap-1 p-3 text-sm">
            <div>
              <dt className="inline font-semibold">Claim: </dt>
              <dd className="inline">{idea.extraction.claim}</dd>
            </div>
            <div>
              <dt className="inline font-semibold">Mechanism: </dt>
              <dd className="inline">{idea.extraction.mechanism ?? 'not stated yet'}</dd>
            </div>
            <div>
              <dt className="inline font-semibold">Strongest objection: </dt>
              <dd className="inline">{idea.extraction.objection ?? 'not stated yet'}</dd>
            </div>
            {idea.extraction.evidenceNeeded.map((e: string, i: number) => (
              <div key={i}>
                <dt className="inline font-semibold">Evidence needed: </dt>
                <dd className="inline">{e}</dd>
              </div>
            ))}
          </dl>
          {idea.questions.length > 0 && (
            <div className="mt-2 space-y-2">
              {idea.questions.map((q: string, i: number) => (
                <label key={i} className="block text-sm">
                  <span className="font-medium">{q}</span>
                  <input className="input mt-1" value={answers[i] ?? ''} onChange={(e) => setAnswers({ ...answers, [i]: e.target.value })} />
                </label>
              ))}
            </div>
          )}
        </section>
      )}

      {idea && (
        <section>
          <h3 className="label mb-1">3 · Choose a direction</h3>
          <div className="grid gap-3">
            {idea.options.map((o: any) => (
              <div key={o.id} className={cx('card p-3', idea.chosen === o.id && 'ring-2 ring-accent')} data-testid="thesis-option">
                <h4 className="font-semibold">{o.label}</h4>
                <p className="mt-1 text-sm">{o.thesis}</p>
                <p className="muted mt-1">{o.summary}</p>
                <p className="mt-2 text-sm">
                  <b>Would weaken it:</b> {o.weakeningFact}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="label">Readings</span>
                  {o.supportingPassageIds.length ? (
                    o.supportingPassageIds.map((id: string) => (
                      <button key={id} className="chip hover:bg-stone-100" onClick={() => onJump({ passageId: id })}>
                        <BookOpen size={12} />
                        {id}
                      </button>
                    ))
                  ) : (
                    <span className="muted">none found</span>
                  )}
                </div>
                <button
                  className="btn mt-3"
                  onClick={() =>
                    run('choose', async () => {
                      const r = await post(`/assignments/${assignmentId}/idea/choose`, { optionId: o.id });
                      setThesis(r.thesis);
                    })
                  }
                  data-testid={`choose-${o.id}`}
                >
                  {idea.chosen === o.id ? 'Chosen' : 'Choose this'}
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {idea?.chosen && (
        <section>
          <h3 className="label mb-1">4 · Your thesis (edit it freely)</h3>
          <textarea className="input min-h-16" value={thesis} onChange={(e) => setThesis(e.target.value)} aria-label="Thesis" data-testid="thesis-text" />
          <div className="mt-2 flex gap-2">
            <button
              className="btn"
              onClick={() =>
                run('thesis', () =>
                  post(`/assignments/${assignmentId}/idea/choose`, {
                    optionId: idea.chosen,
                    thesis,
                  }),
                )
              }
            >
              Save thesis
            </button>
            <button
              className="btn btn-primary"
              disabled={!!busy}
              onClick={() =>
                run('outline', async () => {
                  await post(`/assignments/${assignmentId}/idea/choose`, {
                    optionId: idea.chosen,
                    thesis,
                  });
                  await post(`/assignments/${assignmentId}/outline`);
                })
              }
              data-testid="build-outline"
            >
              Build outline
            </button>
            {busy === 'outline' && <Spinner />}
          </div>
        </section>
      )}

      {outline?.items?.length > 0 && (
        <section>
          <h3 className="label mb-1">
            5 · Outline <ProviderBadge id={outline.provider} />
          </h3>
          <ol className="space-y-2">
            {outline.items.map((it: any, i: number) => (
              <li key={it.id} className="card p-3 text-sm" data-testid="outline-item">
                <b>
                  {i + 1}. {it.purpose}
                </b>
                <p className="mt-1">{it.claim}</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {it.evidencePassageIds.map((id: string) => (
                    <button key={id} className="chip" onClick={() => onJump({ passageId: id })}>
                      <BookOpen size={12} />
                      {id}
                    </button>
                  ))}
                </div>
                {it.openQuestions.map((q: string, k: number) => (
                  <p key={k} className="muted mt-1">
                    ? {q}
                  </p>
                ))}
              </li>
            ))}
          </ol>
          <button
            className="btn btn-primary mt-3"
            disabled={!!busy}
            onClick={() =>
              run('draft', async () => {
                const r = await post(`/assignments/${assignmentId}/draft`);
                if (!hasDocument) onDocument(r.documentId);
                return r;
              })
            }
            data-testid="draft-from-outline"
          >
            {hasDocument ? 'Generate a draft on a separate branch' : 'Generate a reviewable draft'}
          </button>
          {busy === 'draft' && <Spinner />}
          <p className="muted mt-1">
            Drafts assemble your claims and quoted passages; a live model writes prose. Unsupported statements are underlined. A draft never overwrites your own
            text.
          </p>
        </section>
      )}

      {!hasDocument && (
        <section>
          <h3 className="label mb-1">Or start from a draft you already have</h3>
          <textarea
            className="input min-h-28"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Paste your draft. It is recorded as an import: the app cannot see how it was written before now."
            aria-label="Paste a draft"
            data-testid="paste-draft"
          />
          <button
            className="btn mt-2"
            disabled={!draft.trim() || !!busy}
            onClick={() =>
              run('import', async () => {
                const r = await post(`/assignments/${assignmentId}/document`, {
                  text: draft,
                });
                onDocument(r.documentId);
              })
            }
            data-testid="import-draft"
          >
            Import draft
          </button>
        </section>
      )}
    </div>
  );
}
void put;
