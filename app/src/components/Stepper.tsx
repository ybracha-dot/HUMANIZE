import { useState } from 'react';
import { Check, ChevronDown, Lock } from 'lucide-react';
import { STAGES, STAGE_LABEL, computeStages, type Stage, type StageFacts } from '@shared/stages';
import { cx } from '@/lib/ui';

const STATE_WORD = { current: 'current step', complete: 'complete', available: 'available', unavailable: 'locked until you have a draft' } as const;

/** The five stages, in the same order everywhere. State is carried by text and by shape, never by colour alone. */
export function Stepper({ current, facts, onGo }: { current: Stage; facts: StageFacts; onGo: (s: Stage) => void }) {
  const [open, setOpen] = useState(false);
  const stages = computeStages(current, facts);
  const idx = STAGES.indexOf(current);
  return (
    <nav aria-label="Paper steps" className="border-b border-rule bg-page" data-testid="stepper">
      {/* desktop: all five names */}
      <ol className="mx-auto hidden max-w-desk items-stretch gap-0 px-6 md:flex">
        {stages.map((s, i) => (
          <li key={s.id} className="flex-1">
            <button
              onClick={() => onGo(s.id)}
              aria-current={s.state === 'current' ? 'step' : undefined}
              aria-label={`${s.label}, ${STATE_WORD[s.state]}`}
              className={cx(
                'flex min-h-[48px] w-full items-center gap-2 border-b-2 px-2 text-left text-sm',
                s.state === 'current' ? 'border-accent bg-tint font-semibold text-ink' : 'border-transparent hover:bg-tint',
                s.state === 'unavailable' ? 'text-ink2' : 'text-ink',
              )}
              data-testid={`step-${s.id}`}
              data-state={s.state}
            >
              <span
                aria-hidden
                className={cx(
                  'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs',
                  s.state === 'complete' ? 'border-accent bg-accent text-accent-ink' : 'border-edge',
                )}
              >
                {s.state === 'complete' ? <Check size={13} /> : s.state === 'unavailable' ? <Lock size={11} /> : i + 1}
              </span>
              <span>{s.label}</span>
            </button>
          </li>
        ))}
      </ol>
      {/* phone: one line plus a disclosure */}
      <div className="px-4 md:hidden">
        <div className="flex min-h-[48px] items-center justify-between">
          <p className="text-sm" data-testid="step-summary">
            <span className="text-ink2">Step {idx + 1} of 5</span> · <b>{STAGE_LABEL[current]}</b>
          </p>
          <button
            className="btn btn-quiet min-h-[44px] px-2"
            aria-expanded={open}
            aria-controls="steps-list"
            onClick={() => setOpen((v) => !v)}
            data-testid="steps-toggle"
          >
            Steps <ChevronDown size={16} className={open ? 'rotate-180' : ''} aria-hidden />
          </button>
        </div>
        {open && (
          <ol id="steps-list" className="pb-2" data-testid="steps-list">
            {stages.map((s, i) => (
              <li key={s.id}>
                <button
                  onClick={() => {
                    setOpen(false);
                    onGo(s.id);
                  }}
                  aria-current={s.state === 'current' ? 'step' : undefined}
                  className={cx(
                    'flex min-h-[44px] w-full items-center justify-between rounded px-2 text-left text-sm',
                    s.state === 'current' && 'bg-tint font-semibold',
                  )}
                  data-testid={`step-m-${s.id}`}
                >
                  <span>
                    {i + 1}. {s.label}
                  </span>
                  <span className="text-xs text-ink2">
                    {s.state === 'current' ? 'You are here' : s.state === 'complete' ? 'Complete' : s.state === 'unavailable' ? 'Locked' : 'Available'}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>
    </nav>
  );
}
