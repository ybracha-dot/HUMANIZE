import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { del, get, post, put } from '@/lib/api';
import { ErrorNote, Section, Spinner, cx, useAsync } from '@/lib/ui';

export default function Settings() {
  const s = useAsync(() => get('/settings'), []);
  const v = useAsync(() => get('/voice'), []);
  const pilot = useAsync(() => get('/pilot/summary'), []);
  const [err, setErr] = useState<unknown>(null);
  const [msg, setMsg] = useState('');
  const [sample, setSample] = useState({
    text: '',
    genre: 'essay',
    language: 'en',
    audience: 'instructor',
    register: 'academic',
  });
  const [suggest, setSuggest] = useState<any>(null);
  const [preview, setPreview] = useState<{ text: string; out: any } | null>(null);
  const [priceForm, setPriceForm] = useState({ id: '', input: '', output: '' });
  if (s.loading || v.loading)
    return (
      <div className="p-6">
        <Spinner />
      </div>
    );
  const st = s.data;
  const profile = v.data.profile;
  const act = async (fn: () => Promise<unknown>, ok = 'Saved.') => {
    try {
      setErr(null);
      await fn();
      setMsg(ok);
      await Promise.all([s.reload(), v.reload()]);
    } catch (e) {
      setErr(e);
    }
  };
  const setProfile = (patch: any) => act(() => put('/voice/profile', { ...profile, ...patch }));
  return (
    <div className="mx-auto max-w-3xl p-6">
      <Link to="/" className="btn btn-quiet mb-3 px-2">
        <ArrowLeft size={16} /> Home
      </Link>
      <h1 className="mb-4 text-2xl font-semibold">Settings</h1>
      <ErrorNote error={err} />
      {msg && (
        <p role="status" className="mb-3 text-sm text-emerald-900">
          {msg}
        </p>
      )}

      <Section title="Mode and providers">
        <div className="card space-y-3 p-4 text-sm">
          <div className="flex gap-2">
            {(['demo', 'live'] as const).map((m) => (
              <button
                key={m}
                className={cx('btn', st.mode === m && 'btn-primary')}
                onClick={() => act(() => put('/settings', { mode: m }))}
                data-testid={`mode-${m}`}
              >
                {m === 'demo' ? 'Demo (no key, fixture rules)' : 'Live (real providers)'}
              </button>
            ))}
          </div>
          <p>{st.providers?.error ?? st.providers?.independence}</p>
          {st.providers?.editor && (
            <p>
              Editor: <code>{st.providers.editor}</code> · Reviewer: <code>{st.providers.critic}</code>
            </p>
          )}
          <p className="muted">
            Keys are read from the server environment only, never from the browser: <code>ANTHROPIC_API_KEY</code>, <code>OPENAI_API_KEY</code> +{' '}
            <code>STUDIO_OPENAI_MODEL</code>, optional <code>STUDIO_ANTHROPIC_MODEL</code>. Anthropic:{' '}
            {st.providerStatus.anthropic.configured ? `configured (${st.providerStatus.anthropic.model})` : 'not configured'}. OpenAI:{' '}
            {st.providerStatus.openai.configured ? `configured (${st.providerStatus.openai.model || 'model not set'})` : 'not configured'}.
          </p>
        </div>
      </Section>

      <Section title="Budget and prices">
        <div className="card space-y-3 p-4 text-sm">
          <p>
            Spent or reserved so far: <b>${st.usedUsd.toFixed(4)}</b>. Deterministic fixtures never count. Unknown prices block paid calls; they are never
            guessed.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <label>
              Default per-assignment budget (USD)
              <input
                className="input mt-1"
                type="number"
                step="0.01"
                min="0"
                defaultValue={st.defaultBudgetUsd ?? ''}
                onBlur={(e) =>
                  act(() =>
                    put('/settings', {
                      defaultBudgetUsd: e.target.value === '' ? null : Number(e.target.value),
                    }),
                  )
                }
                data-testid="budget-input"
              />
            </label>
            <label>
              Monthly workspace limit (USD)
              <input
                className="input mt-1"
                type="number"
                step="0.01"
                min="0"
                defaultValue={st.monthlyLimitUsd ?? ''}
                onBlur={(e) =>
                  act(() =>
                    put('/settings', {
                      monthlyLimitUsd: e.target.value === '' ? null : Number(e.target.value),
                    }),
                  )
                }
              />
            </label>
          </div>
          <ul>
            {Object.entries(st.prices).map(([k, p]: any) => (
              <li key={k}>
                <code>{k}</code>: ${p.inputPerMTok}/M in, ${p.outputPerMTok}/M out {p.rev ? `(${p.rev})` : ''}
              </li>
            ))}
          </ul>
          <div className="grid gap-2 sm:grid-cols-4">
            <input
              className="input sm:col-span-2"
              placeholder="provider:model, e.g. anthropic:claude-sonnet-5-5"
              value={priceForm.id}
              onChange={(e) => setPriceForm({ ...priceForm, id: e.target.value })}
              aria-label="Provider and model"
            />
            <input className="input" placeholder="$/M input" value={priceForm.input} onChange={(e) => setPriceForm({ ...priceForm, input: e.target.value })} />
            <input
              className="input"
              placeholder="$/M output"
              value={priceForm.output}
              onChange={(e) => setPriceForm({ ...priceForm, output: e.target.value })}
            />
          </div>
          <button
            className="btn"
            disabled={!priceForm.id || !priceForm.input || !priceForm.output}
            onClick={() =>
              act(() =>
                put('/settings', {
                  prices: {
                    ...st.prices,
                    [priceForm.id]: {
                      inputPerMTok: Number(priceForm.input),
                      outputPerMTok: Number(priceForm.output),
                      rev: `entered ${new Date().toISOString().slice(0, 10)}`,
                    },
                  },
                }),
              )
            }
          >
            Save price (copy it from the provider's current price page)
          </button>
        </div>
      </Section>

      <Section title="Your voice">
        <div className="card space-y-3 p-4 text-sm" data-testid="voice-section">
          <p className="muted">
            Add one to three samples you wrote. Each is kept with its genre, language, audience and register. The profile never overrides a course's formal
            requirements, and a preference only applies after you confirm it against your own sentence.
          </p>
          <ul className="space-y-1">
            {v.data.samples.map((x: any) => (
              <li key={x.id} className="flex justify-between gap-2">
                <span>
                  “{x.text.slice(0, 90)}…”{' '}
                  <span className="chip">
                    {x.genre}/{x.language}
                  </span>
                </span>
                <button className="btn btn-quiet px-2" onClick={() => act(() => del(`/voice/samples/${x.id}`), 'Removed.')}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
          {v.data.samples.length < 3 && (
            <div className="space-y-2">
              <textarea
                className="input min-h-24"
                placeholder="Paste a paragraph you wrote"
                value={sample.text}
                onChange={(e) => setSample({ ...sample, text: e.target.value })}
                aria-label="Writing sample"
              />
              <div className="grid gap-2 sm:grid-cols-4">
                {(['genre', 'language', 'audience', 'register'] as const).map((k) => (
                  <input
                    key={k}
                    className="input"
                    value={sample[k]}
                    onChange={(e) => setSample({ ...sample, [k]: e.target.value })}
                    aria-label={k}
                    placeholder={k}
                  />
                ))}
              </div>
              <button
                className="btn"
                disabled={sample.text.trim().length < 20}
                onClick={() =>
                  act(async () => {
                    await post('/voice/samples', sample);
                    setSample({ ...sample, text: '' });
                    setSuggest(await post('/voice/suggest'));
                  }, 'Sample added.')
                }
              >
                Add sample
              </button>
            </div>
          )}
          <button className="btn" onClick={async () => setSuggest(await post('/voice/suggest'))} data-testid="suggest-profile">
            Suggest a profile from my samples
          </button>
          {suggest?.stats && (
            <div className="rounded-md border border-stone-200 p-3">
              <p>
                Samples average {suggest.stats.avgSentenceWords} words per sentence; em-dash rate {suggest.stats.emDashRate}.
              </p>
              {suggest.previews.map((p: any) => (
                <div key={p.preference} className="mt-2">
                  <b>{p.preference}</b>
                  {p.hasExample ? (
                    <>
                      <p>Your sentence: “{p.sample}”</p>
                      <p>Proposed: “{p.proposed}”</p>
                    </>
                  ) : (
                    <p className="muted">No example in your samples, so nothing to compare yet.</p>
                  )}
                  <button
                    className="btn mt-1"
                    onClick={() =>
                      setProfile({
                        ...suggest.profile,
                        confirmed: {
                          ...profile.confirmed,
                          [p.preference]: true,
                        },
                      })
                    }
                  >
                    Apply this preference
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="grid gap-2 sm:grid-cols-3">
            <label>
              Directness
              <select className="input mt-1" value={profile.directness} onChange={(e) => setProfile({ directness: e.target.value })}>
                {['direct', 'neutral', 'formal'].map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            </label>
            <label>
              First person
              <select className="input mt-1" value={profile.firstPerson} onChange={(e) => setProfile({ firstPerson: e.target.value })}>
                {['avoid', 'allow', 'prefer'].map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            </label>
            <label className="flex items-end gap-2">
              <input
                type="checkbox"
                checked={profile.avoidEmDash}
                onChange={(e) => setProfile({ avoidEmDash: e.target.checked })}
                data-testid="avoid-em-dash"
              />{' '}
              Avoid em dashes
            </label>
          </div>
          <button className="btn" onClick={() => setProfile(v.data.founderPreset)}>
            Use the concise-and-direct preset (no em dashes)
          </button>
          <div>
            <label className="text-sm font-medium">
              Try a sentence
              <textarea
                className="input mt-1"
                value={preview?.text ?? ''}
                onChange={(e) => setPreview({ text: e.target.value, out: preview?.out })}
                placeholder="Moreover, we utilize data in order to learn — quickly."
              />
            </label>
            <button
              className="btn mt-1"
              onClick={async () =>
                setPreview({
                  text: preview?.text ?? '',
                  out: await post('/voice/preview', {
                    text: preview?.text ?? '',
                  }),
                })
              }
            >
              Preview
            </button>
            {preview?.out && (
              <div className="mt-2">
                <p>
                  <b>{preview.out.noChange ? 'No change: ' : 'Proposed: '}</b>
                  {preview.out.replacement}
                </p>
                <p className="muted">{preview.out.reason}</p>
                {preview.out.flags.map((f: any, i: number) => (
                  <p key={i} className="muted">
                    “{f.quote}”: {f.effect}
                  </p>
                ))}
              </div>
            )}
          </div>
        </div>
      </Section>

      <Section title="How suggestions are cleaned (policy)">
        <div className="card p-4 text-sm">
          <p>
            Policy in force: <code>{st.policyVersion}</code>
          </p>
          <ul className="mt-1 list-disc pl-5">
            <li>
              Clarity rules: subset of{' '}
              <a className="underline" href={st.provenance.humanizer.repo}>
                blader/humanizer
              </a>{' '}
              ({st.provenance.humanizer.license}) @ {st.provenance.humanizer.sha.slice(0, 7)}, reimplemented here.
            </li>
            <li>
              Hygiene (invisible Unicode): behavior reviewed against{' '}
              <a className="underline" href={st.provenance.watermarksRemover.repo}>
                watermarks-remover
              </a>{' '}
              Layer A ({st.provenance.watermarksRemover.license}) @ {st.provenance.watermarksRemover.sha.slice(0, 7)}, reimplemented here.
            </li>
          </ul>
          <p className="muted mt-2">
            This policy edits for clarity and preserves meaning. It does not measure or optimise against AI detectors, and no detector result decides whether
            text is ready to submit.
          </p>
        </div>
      </Section>

      <Section title="Your data">
        <div className="card space-y-2 p-4 text-sm">
          <p>
            Everything is stored on this machine in <code>app/.data</code>. Delete derived data any time.
          </p>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ['passages', 'Source passages and evidence checks'],
                ['voice', 'Voice samples and profile'],
                ['feedback', 'Instructor feedback memory'],
                ['cache', 'Cached review outputs'],
              ] as const
            ).map(([k, l]) => (
              <button key={k} className="btn btn-danger" onClick={() => confirm(`Delete: ${l}?`) && act(() => del(`/data/${k}`), 'Deleted.')}>
                Delete {l.toLowerCase()}
              </button>
            ))}
          </div>
          <button
            className="btn btn-danger"
            onClick={() =>
              confirm('Delete ALL courses, drafts, history and files? This cannot be undone.') && act(() => del('/data/everything'), 'Everything deleted.')
            }
            data-testid="delete-all"
          >
            Delete everything
          </button>
        </div>
      </Section>

      <Section title="Pilot counts (no text)">
        <div className="card p-4 text-sm">
          {pilot.data ? (
            <>
              <p>
                Decisions: {pilot.data.decisions.map((d: any) => `${d.n} ${d.decision}`).join(', ') || 'none'}. Evidence jumps:{' '}
                {pilot.data.activation.evidenceJumps}. Activated: {pilot.data.activation.activated ? 'yes' : 'not yet'}. Paid spend: $
                {(pilot.data.paidSpendUsd ?? 0).toFixed(4)}.
              </p>
              <p className="muted">{pilot.data.note}</p>
            </>
          ) : (
            <Spinner />
          )}
        </div>
      </Section>
    </div>
  );
}
