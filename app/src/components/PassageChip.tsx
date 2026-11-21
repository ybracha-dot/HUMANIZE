import { useEffect, useState } from 'react';
import { BookOpen } from 'lucide-react';
import { get } from '@/lib/api';
import { useShell } from '@/lib/shell';

const cache = new Map<string, Promise<{ title: string; label: string }>>();

/** "Reading title · page 3", or "Reading title · PDF page 3 · printed page iv" when the two differ. */
function load(id: string) {
  if (!cache.has(id))
    cache.set(
      id,
      get(`/passages/${id}`).then((p: any) => {
        const idx = Number(p.page_index) + 1;
        const printed = p.page_label ? String(p.page_label) : null;
        const label = printed && printed !== String(idx) ? `PDF page ${idx} · printed page ${printed}` : `page ${printed ?? idx}`;
        return { title: String(p.source.title), label };
      }),
    );
  return cache.get(id)!;
}

export function usePassageLabel(id: string) {
  const [v, setV] = useState<{ title: string; label: string } | null>(null);
  useEffect(() => {
    let live = true;
    load(id)
      .then((x) => live && setV(x))
      .catch(() => live && setV({ title: 'Source', label: '' }));
    return () => {
      live = false;
    };
  }, [id]);
  return v;
}

/** A reading, named. Opens the original at that passage; returns the student to where they were. */
export function PassageChip({ id, backLabel, hint }: { id: string; backLabel: string; hint?: string }) {
  const { openSource } = useShell();
  const v = usePassageLabel(id);
  return (
    <button className="chip hover:bg-tint" onClick={() => openSource({ passageId: id, hint }, { backLabel })} data-testid="passage-chip">
      <BookOpen size={12} aria-hidden />
      {v ? `${v.title}${v.label ? ' · ' + v.label : ''}` : 'Reading…'}
    </button>
  );
}
