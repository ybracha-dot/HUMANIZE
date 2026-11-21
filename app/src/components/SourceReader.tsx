import { useEffect, useRef } from 'react';
import { ArrowLeft, AlertTriangle } from 'lucide-react';
import { get } from '@/lib/api';
import { ErrorNote, Spinner, useAsync, cx } from '@/lib/ui';
import { findQuote, splitSentences } from '@shared/text';
import { tokenize } from '@shared/evidence';

export interface JumpTarget {
  passageId: string;
  quote?: { start: number; end: number; text?: string } | null;
  quoteText?: string;
  /** text the evidence is meant to support; the best-matching sentence is highlighted */ hint?: string;
}

function bestSentence(text: string, hint: string): { start: number; end: number } | null {
  const h = new Set(tokenize(hint));
  let best: { start: number; end: number } | null = null;
  let score = 0;
  for (const s of splitSentences(text)) {
    const n = tokenize(s.text).filter((t) => h.has(t)).length;
    if (n > score) {
      score = n;
      best = { start: s.start, end: s.end };
    }
  }
  return score >= 2 ? best : null;
}

/** Source reader: evidence is highlighted in context, viewer page index and printed page label are shown separately, stale sources stay visible and labelled. */
export function SourceReader({ target, onBack, backLabel = 'Back to draft' }: { target: JumpTarget; onBack: () => void; backLabel?: string }) {
  const p = useAsync(() => get(`/passages/${target.passageId}`), [target.passageId]);
  const src = useAsync(
    async () => (p.data ? get(`/sources/${p.data.source.id}?version=${p.data.source_version_id}`) : null),
    [p.data?.source?.id, p.data?.source_version_id],
  );
  const hit = useRef<HTMLDivElement>(null);
  useEffect(() => {
    hit.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [src.data, target.passageId]);
  if (p.error || src.error) return <ErrorNote error={p.error ?? src.error} />;
  if (!p.data || !src.data) return <Spinner label="Opening source" />;
  const detail = src.data!;
  const stale = p.data.stale || detail.stale;
  const pages = new Map<number, any[]>();
  for (const x of detail.passages) {
    if (!pages.has(x.page_index)) pages.set(x.page_index, []);
    pages.get(x.page_index)!.push(x);
  }
  const render = (x: any) => {
    if (x.id !== target.passageId) return x.text;
    const r = target.quote ?? (target.quoteText ? findQuote(x.text, target.quoteText) : null) ?? (target.hint ? bestSentence(x.text, target.hint) : null);
    if (!r) return <span className="src-hit">{x.text}</span>;
    return (
      <>
        {x.text.slice(0, r.start)}
        <mark className="src-hit" data-testid="evidence-highlight">
          {x.text.slice(r.start, r.end)}
        </mark>
        {x.text.slice(r.end)}
      </>
    );
  };
  return (
    <div data-testid="source-reader">
      <button className="btn mb-3" onClick={onBack} data-testid="back-to-draft">
        <ArrowLeft size={14} /> {backLabel}
      </button>
      <h3 className="text-sm font-semibold">{detail.source.title}</h3>
      <p className="muted mb-2">
        {detail.source.kind} · {detail.versions.length} version
        {detail.versions.length === 1 ? '' : 's'}
      </p>
      {stale && (
        <p role="alert" className="mb-3 flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          This is an older version of the source. It was replaced after this evidence was checked. Accepted text is unchanged; run Evidence review to re-check
          it against the new version.
        </p>
      )}
      {[...pages.entries()].map(([idx, ps]) => (
        <div key={idx} className="mb-4">
          <div className="label mb-1" data-testid="page-heading">
            {ps[0].page_label && String(ps[0].page_label) !== String(idx) ? `PDF viewer page ${idx} · printed page ${ps[0].page_label}` : `Page ${idx}`}
          </div>
          {ps.map((x) => (
            <div
              key={x.id}
              ref={x.id === target.passageId ? hit : undefined}
              className={cx(
                'mb-2 rounded-md border p-2 text-sm leading-relaxed',
                x.id === target.passageId ? 'border-amber-400 bg-amber-50/60' : 'border-transparent',
              )}
              data-passage={x.id}
            >
              <span className="mr-1 text-[10px] text-stone-400">{x.id}</span>
              {render(x)}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
