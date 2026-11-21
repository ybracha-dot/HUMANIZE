import { useState } from 'react';
import { diffWords } from 'diff';
import { Check, X, Pencil, BookOpen, AlertTriangle, Undo2 } from 'lucide-react';
import { ProviderBadge, cx } from '@/lib/ui';
import type { JumpTarget } from './SourceReader';

const ISSUE: Record<string, string> = {
  unsupported_causality: 'Overstated cause',
  unsupported_claim: 'Unsupported claim',
  number_mismatch: 'Figure differs from source',
  citation_missing: 'Missing citation',
  missing_requirement: 'Missing requirement',
  weak_argument: 'Argument',
  unclear_sentence: 'Clarity',
  stock_phrase: 'Stock phrasing',
  style: 'Style',
  structure: 'Structure',
  other: 'Other',
};

function Diff({ a, b }: { a: string; b: string }) {
  const parts = diffWords(a, b);
  return (
    <div className="space-y-1 text-sm leading-relaxed">
      <p>
        <span className="label mr-2">Now</span>
        {parts
          .filter((p) => !p.added)
          .map((p, i) => (
            <span key={i} className={p.removed ? 'diff-del' : ''}>
              {p.value}
            </span>
          ))}
      </p>
      <p>
        <span className="label mr-2">Suggested</span>
        {parts
          .filter((p) => !p.removed)
          .map((p, i) => (
            <span key={i} className={p.added ? 'diff-add' : ''}>
              {p.value}
            </span>
          ))}
      </p>
    </div>
  );
}

export function ProposalCard({
  p,
  criteria,
  selected,
  onSelect,
  onDecide,
  onJump,
  busy,
}: {
  p: any;
  criteria: Record<string, string>;
  selected: boolean;
  onSelect: () => void;
  onDecide: (a: 'accept' | 'reject' | 'edit', text?: string) => void;
  onJump: (t: JumpTarget) => void;
  busy: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(p.replacement);
  const material = (p.findings ?? []).filter((f: any) => f.severity === 'material');
  const evid = (p.evidence ?? []).filter((e: any) => e.relationship !== 'contradicts_original');
  const keys = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === 'TEXTAREA' || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'a') {
      e.preventDefault();
      onDecide('accept');
    } else if (e.key === 'r') {
      e.preventDefault();
      onDecide('reject');
    } else if (e.key === 'e') {
      e.preventDefault();
      setEditing(true);
    } else if ((e.key === 's' || e.key === 'j') && evid[0]) {
      e.preventDefault();
      onJump({ passageId: evid[0].passageId, hint: p.replacement });
    }
  };
  return (
    <article
      className={cx('card p-3', selected && 'ring-2 ring-accent')}
      onClick={onSelect}
      onKeyDown={keys}
      tabIndex={0}
      aria-label={`Suggestion: ${ISSUE[p.issue] ?? p.issue}`}
      data-testid="proposal-card"
      data-issue={p.issue}
    >
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <span className="chip font-semibold">{ISSUE[p.issue] ?? p.issue}</span>
        {p.rubricCriterionId && criteria[p.rubricCriterionId] && <span className="chip">{criteria[p.rubricCriterionId]}</span>}
        <ProviderBadge id={p.provider} />
        {p.requiresDecision && <span className="chip border-orange-300 bg-orange-50 text-orange-900">your decision</span>}
        {p.applicable === false && <span className="chip border-red-300 bg-red-50 text-red-900">text has changed</span>}
      </div>
      {p.reason && <p className="muted mb-2">{p.reason}</p>}
      <Diff a={p.original} b={editing ? text : p.replacement} />
      {material.length > 0 && (
        <ul className="mt-2 space-y-1 rounded-md border border-orange-300 bg-orange-50 p-2 text-sm text-orange-950" data-testid="meaning-warnings">
          {material.map((f: any, i: number) => (
            <li key={i} className="flex gap-1.5">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              {f.message}
            </li>
          ))}
        </ul>
      )}
      {p.meaningChange && material.length === 0 && (
        <p className="mt-2 text-sm text-stone-700">
          <b>What changes:</b> {p.meaningChange}
        </p>
      )}
      {p.disagreement && (
        <div className="mt-2 rounded-md border border-violet-300 bg-violet-50 p-2 text-sm text-violet-950" data-testid="disagreement">
          <b>The reviewers disagree.</b> Editor ({p.disagreement.editor.provider}) proposed this; reviewer ({p.disagreement.critic.provider ?? 'second pass'})
          says <i>{p.disagreement.critic.verdict}</i>: {p.disagreement.critic.reasons.join(' ')}
          <div className="mt-1">
            <b>What would settle it:</b> {p.disagreement.settleBy}
          </div>
        </div>
      )}
      {editing && <textarea className="input mt-2 min-h-24" value={text} onChange={(e) => setText(e.target.value)} aria-label="Edit the replacement text" />}
      <div className="mt-3 flex flex-wrap gap-2">
        {editing ? (
          <>
            <button className="btn btn-primary" disabled={busy || !text.trim()} onClick={() => onDecide('edit', text)}>
              <Check size={14} /> Save my version
            </button>
            <button
              className="btn"
              onClick={() => {
                setEditing(false);
                setText(p.replacement);
              }}
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <button className="btn btn-primary" disabled={busy || p.applicable === false} onClick={() => onDecide('accept')} data-testid="accept">
              <Check size={14} /> Accept <kbd className="text-[10px] opacity-70">a</kbd>
            </button>
            <button className="btn" disabled={busy} onClick={() => setEditing(true)}>
              <Pencil size={14} /> Edit <kbd className="text-[10px] opacity-70">e</kbd>
            </button>
            <button className="btn" disabled={busy} onClick={() => onDecide('reject')} data-testid="reject">
              <X size={14} /> Keep original <kbd className="text-[10px] opacity-70">r</kbd>
            </button>
          </>
        )}
        {evid.slice(0, 2).map((e: any) => (
          <button
            key={e.passageId + e.relationship}
            className="btn btn-quiet"
            onClick={() => onJump({ passageId: e.passageId, hint: p.replacement })}
            data-testid="open-evidence"
          >
            <BookOpen size={14} /> Open evidence <span className="text-xs text-stone-500">{e.passageId}</span>
          </button>
        ))}
      </div>
    </article>
  );
}

export function ResolvedRow({ p, onUndo }: { p: any; onUndo?: () => void }) {
  return (
    <li className="flex items-center justify-between gap-2 rounded-md border border-stone-200 px-2 py-1.5 text-sm">
      <span>
        <b className="capitalize">{p.decision}</b> · {ISSUE[p.issue] ?? p.issue} <ProviderBadge id={p.provider} />
      </span>
      {onUndo && (
        <button className="btn btn-quiet px-2" onClick={onUndo} aria-label="Undo this change">
          <Undo2 size={14} /> Undo
        </button>
      )}
    </li>
  );
}
