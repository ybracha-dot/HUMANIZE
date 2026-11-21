import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { get, put } from '@/lib/api';
import { ErrorNote, Spinner, useAsync } from '@/lib/ui';
import { ShellContext, type Overview, type OpenSourceOpts, type Shell } from '@/lib/shell';
import { ThemeControl } from '@/lib/theme';
import { Stepper } from '@/components/Stepper';
import { SourceSheet } from '@/components/SourceSheet';
import type { JumpTarget } from '@/components/SourceReader';
import { STAGES, STAGE_LABEL, computeStages, isStage, stageAvailable, type Stage } from '@shared/stages';
import Materials from '@/stages/Materials';
import Plan from '@/stages/Plan';
import Draft from '@/stages/Draft';
import Review from '@/stages/Review';
import Export from '@/stages/Export';

function Locked({ stage, facts, go }: { stage: Stage; facts: Overview['facts']; go: (s: Stage) => Promise<void> }) {
  const info = computeStages(stage, facts).find((s) => s.id === stage)!;
  return (
    <div className="mx-auto max-w-desk px-4 py-12 md:px-6" data-testid={`locked-${stage}`}>
      <h1 className="title text-[2rem] md:text-[2.6rem]" tabIndex={-1} data-stage-heading>
        {STAGE_LABEL[stage]} isn’t ready yet
      </h1>
      <p className="mt-3 max-w-measure text-lg">{info.unlock?.text}</p>
      <button className="btn btn-primary mt-5" onClick={() => go(info.unlock!.to)} data-testid="unlock-action">
        {info.unlock?.action}
      </button>
    </div>
  );
}

export default function Assignment() {
  const { id = '', stage: stageParam } = useParams();
  const nav = useNavigate();
  const ov = useAsync<Overview>(() => get(`/assignments/${id}/overview`), [id]);
  const guard = useRef<(() => Promise<void>) | null>(null);
  const [sheet, setSheet] = useState<{ target: JumpTarget; opts: OpenSourceOpts } | null>(null);
  const [live, setLive] = useState('');
  const savedResume = useRef<string | null>(null);

  const o = ov.data;
  const current: Stage | null = o ? (isStage(stageParam) ? stageParam : o.entry) : null;

  const go = useCallback(
    async (s: Stage) => {
      try {
        await guard.current?.();
      } catch {
        /* the stage keeps a local copy and says so; never block navigation on a failed save */
      }
      nav(`/assignments/${id}/${s}`);
    },
    [nav, id],
  );
  const reload = useCallback(async () => {
    await ov.reload();
  }, [ov.reload]);

  // remember where the student was (separately from what is complete)
  useEffect(() => {
    if (!o || !current || !isStage(stageParam)) return;
    if (!stageAvailable(current, o.facts)) return;
    const saved = o.ui.resume?.stage ?? savedResume.current;
    if (saved === current) return;
    savedResume.current = current;
    put(`/assignments/${id}/ui-state`, { resumeStage: current }).catch(() => {});
  }, [o, current, stageParam, id]);

  // move focus to the stage heading after a stage change, for keyboard and screen reader users
  useEffect(() => {
    if (!current) return;
    const t = setTimeout(() => document.querySelector<HTMLElement>('[data-stage-heading]')?.focus({ preventScroll: true }), 60);
    return () => clearTimeout(t);
  }, [current]);

  const shell: Shell | null = useMemo(
    () =>
      o && current
        ? {
            o,
            reload,
            go,
            openSource: (target, opts = {}) => setSheet({ target, opts }),
            announce: (m) => setLive(m),
            setLeaveGuard: (fn) => {
              guard.current = fn;
            },
          }
        : null,
    [o, current, reload, go],
  );

  if (ov.loading && !o)
    return (
      <div className="p-8">
        <Spinner label="Opening your paper" />
      </div>
    );
  if (ov.error && !o)
    return (
      <div className="mx-auto max-w-desk p-8">
        <ErrorNote error={ov.error} />
        <Link className="link" to="/">
          Back to home
        </Link>
      </div>
    );
  if (!o || !current || !shell) return null;
  if (!isStage(stageParam)) return <Navigate to={`/assignments/${id}/${o.entry}`} replace />;
  const available = stageAvailable(current, o.facts);
  const idx = STAGES.indexOf(current);

  return (
    <ShellContext.Provider value={shell}>
      <div className="min-h-screen bg-page">
        <a href="#stage" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-surface focus:p-2">
          Skip to your paper
        </a>
        <header className="border-b border-rule">
          <div className="mx-auto flex max-w-desk flex-wrap items-center justify-between gap-x-6 gap-y-1 px-4 py-3 md:px-6">
            <div className="min-w-0">
              <p className="truncate text-sm text-ink2">
                <Link className="hover:underline" to="/">
                  Home
                </Link>{' '}
                ›{' '}
                <Link className="hover:underline" to={`/courses/${o.course.id}`}>
                  {o.course.name}
                </Link>
              </p>
              <p className="title break-words text-lg font-semibold md:text-xl" data-testid="assignment-title">
                {o.assignment.title}
              </p>
            </div>
            <div className="flex w-full items-center justify-between gap-3 md:w-auto">
              {o.mode === 'demo' ? (
                <span
                  className="text-sm text-ink2"
                  data-testid="mode-badge"
                  title="No AI key is set. Feedback comes from fixed rules so you can try every step."
                >
                  Sample feedback · no AI key
                </span>
              ) : (
                <span className="text-sm text-ok" data-testid="mode-badge">
                  Live AI feedback
                </span>
              )}
              <ThemeControl />
            </div>
          </div>
        </header>
        <div className="md:sticky md:top-0 md:z-30">
          <Stepper current={current} facts={o.facts} onGo={go} />
        </div>
        <main
          id="stage"
          tabIndex={-1}
          className="outline-none"
          aria-label={`${STAGE_LABEL[current]}, step ${idx + 1} of 5`}
          data-testid="stage"
          data-stage={current}
        >
          {!available ? (
            <Locked stage={current} facts={o.facts} go={go} />
          ) : current === 'materials' ? (
            <Materials />
          ) : current === 'plan' ? (
            <Plan />
          ) : current === 'draft' ? (
            <Draft />
          ) : current === 'review' ? (
            <Review />
          ) : (
            <Export />
          )}
        </main>
        <SourceSheet
          target={sheet?.target ?? null}
          backLabel={sheet?.opts.backLabel ?? 'Back'}
          onClose={() => {
            const cb = sheet?.opts.onClose;
            setSheet(null);
            cb?.();
          }}
        />
        <div className="sr-only-live" role="status" aria-live="polite" data-testid="live-region">
          {live}
        </div>
      </div>
    </ShellContext.Provider>
  );
}
