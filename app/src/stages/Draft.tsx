import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { BookOpen, Lock, Unlock, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { del, get, post } from '@/lib/api';
import { useShell } from '@/lib/shell';
import { ErrorNote, Spinner, cx, useAsync } from '@/lib/ui';
import { Editor, type EditorHandle, type Mark, type Para } from '@/components/Editor';
import { BriefView } from '@/components/BriefView';

type Tab = 'outline' | 'brief' | 'sources' | 'history';
const words = (ps: Para[]) => ps.reduce((n, p) => n + (p.text.trim() ? p.text.trim().split(/\s+/).length : 0), 0);
const backupKey = (docId: string) => `studio.backup.${docId}`;
const readBackup = (docId: string): { base: string; paragraphs: Para[]; at: number } | null => {
  try {
    const v = localStorage.getItem(backupKey(docId));
    return v ? JSON.parse(v) : null;
  } catch {
    return null;
  }
};
const writeBackup = (docId: string, v: { base: string; paragraphs: Para[]; at: number } | null) => {
  try {
    if (v) localStorage.setItem(backupKey(docId), JSON.stringify(v));
    else localStorage.removeItem(backupKey(docId));
  } catch {
    /* storage can be blocked; the page itself still holds the text */
  }
};
const sameText = (a: Para[], b: Para[]) => a.length === b.length && a.every((p, i) => p.text === b[i].text);
const range = (v: string) => {
  const m = String(v).match(/(\d[\d,]*)\s*[–-]\s*(\d[\d,]*)/);
  return m ? { min: Number(m[1].replace(/,/g, '')), max: Number(m[2].replace(/,/g, '')) } : null;
};

/** Draft: a quiet page. Save state, word count and tools stay at the edge; reference material opens beside the writing and returns you to the exact sentence. */
export default function Draft() {
  const { o, reload, go, openSource, announce, setLeaveGuard } = useShell();
  const docId = o.document?.id ?? null;
  const doc = useAsync(() => (docId ? get(`/documents/${docId}`) : Promise.resolve(null)), [docId]);
  const d = doc.data as any;
  const editor = useRef<EditorHandle>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  const [stale, setStale] = useState<null | { latest: any }>(null);
  const [err, setErr] = useState<unknown>(null);
  const [drawer, setDrawer] = useState<Tab | null>(null);
  const [recover, setRecover] = useState<{ paragraphs: Para[] } | null>(null);
  const [paste, setPaste] = useState('');
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  const dRef = useRef(d);
  dRef.current = d;

  useEffect(() => {
    if (d) setCount(words(d.revision.paragraphs));
  }, [d?.revision?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // A copy of unsaved text from an earlier visit is offered back, never silently dropped or applied.
  useEffect(() => {
    if (!d || !docId) return;
    const b = readBackup(docId);
    if (b && !sameText(b.paragraphs, d.revision.paragraphs)) setRecover({ paragraphs: b.paragraphs });
    else if (b) writeBackup(docId, null);
  }, [d?.revision?.id, docId]); // eslint-disable-line react-hooks/exhaustive-deps

  const flushMetrics = useCallback(async () => {
    const m = editor.current?.takeMetrics();
    if (docId && m && (m.inserted || m.deleted))
      await post(`/documents/${docId}/events`, { kind: 'typing_batch', inserted: m.inserted, deleted: m.deleted, activeMs: m.activeMs }).catch(() => {});
  }, [docId]);

  const save = useCallback(
    async (label = 'Autosave'): Promise<boolean> => {
      const cur = dRef.current;
      if (!cur || !editor.current || !docId) return true;
      const paragraphs = editor.current.getParagraphs();
      setSaving(true);
      try {
        const r = await post(`/documents/${docId}/revisions`, { baseRevisionId: cur.revision.id, paragraphs, label });
        await flushMetrics();
        writeBackup(docId, null);
        setDirty(false);
        setFailed(false);
        setStale(null);
        if (!r.unchanged) await doc.reload();
        return true;
      } catch (e: any) {
        if (e?.code === 'stale_revision') {
          const latest = await get(`/documents/${docId}`).catch(() => null);
          setStale({ latest });
          announce('This draft changed somewhere else. Your text here is kept.');
        } else {
          setFailed(true);
          setErr(e);
        }
        return false;
      } finally {
        setSaving(false);
      }
    },
    [docId, doc.reload, flushMetrics, announce], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const saveRef = useRef(save);
  saveRef.current = save;

  const onDirty = useCallback(() => {
    setDirty(true);
    const ps = editor.current?.getParagraphs() ?? [];
    setCount(words(ps));
    if (docId && dRef.current) writeBackup(docId, { base: dRef.current.revision.id, paragraphs: ps, at: Date.now() });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void saveRef.current('Autosave'), 2500);
  }, [docId]);

  // Leaving the stage saves first. If saving fails, the text stays in a local copy and is offered back on return.
  useEffect(() => {
    setLeaveGuard(async () => {
      if (timer.current) clearTimeout(timer.current);
      if (dirtyRef.current) await saveRef.current('Saved when leaving Draft');
    });
    return () => {
      setLeaveGuard(null);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [setLeaveGuard]);
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) e.preventDefault();
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, []);

  const marks: Mark[] = useMemo(
    () => (d && !dirty ? d.locks.map((l: any) => ({ paragraphId: l.paragraphId, start: l.start, end: l.end, cls: 'lock-span' })) : []),
    [d, dirty],
  );

  // ---- evidence from the page: remember the sentence, return to it
  const openFromDraft = useCallback(
    (t: Parameters<typeof openSource>[0]) => {
      const sel = editor.current?.selection();
      const cur = editor.current?.cursorParagraph();
      const at = sel ? { p: sel.paragraphId, off: sel.start } : cur ? { p: cur, off: 0 } : null;
      openSource(t, {
        backLabel: 'Back to my draft',
        onClose: () => {
          if (at) setTimeout(() => editor.current?.focusAt(at.p, at.off), 120);
        },
      });
    },
    [openSource],
  );

  const protect = async (thesis = false) => {
    if (!d || !editor.current || !docId) return;
    setErr(null);
    try {
      if (dirtyRef.current && !(await save('Before protecting wording'))) return;
      const s = editor.current.selection();
      if (s && !thesis) await post(`/documents/${docId}/locks`, { paragraphId: s.paragraphId, kind: 'span', start: s.start, end: s.end });
      else {
        const pid = editor.current.cursorParagraph() ?? d.revision.paragraphs[0].id;
        await post(`/documents/${docId}/locks`, { paragraphId: pid, kind: 'paragraph', thesis });
      }
      await doc.reload();
      announce(thesis ? 'Thesis paragraph protected.' : 'Wording protected.');
    } catch (e) {
      setErr(e);
    }
  };

  const eff = o.brief.effective ?? {};
  const target = eff.word_range as any | undefined;
  const tr = target ? range(target.value) : null;
  const lengthState =
    count == null || !tr
      ? ''
      : count < tr.min
        ? `${(tr.min - count).toLocaleString()} under the minimum`
        : count > tr.max
          ? `${(count - tr.max).toLocaleString()} over the maximum`
          : 'within the limit';
  const conflictOpen = (o.brief.conflicts as any[]).some((c) => c.kind === 'word_range' && c.decision === 'open');

  if (!docId)
    return (
      <div className="mx-auto max-w-[680px] px-4 py-10" data-testid="stage-draft">
        <h1 className="title text-3xl" tabIndex={-1} data-stage-heading>
          Draft
        </h1>
        <p className="mt-2 text-ink2">Nothing is written yet. Start on a blank page, or bring a draft you already have.</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <button
            className="btn btn-primary"
            disabled={busy}
            data-testid="blank-page"
            onClick={async () => {
              setBusy(true);
              try {
                await post(`/assignments/${o.assignment.id}/document`, { text: '', blank: true });
              } catch (e: any) {
                if (e?.code !== 'document_exists') setErr(e);
              }
              await reload();
              setBusy(false);
            }}
          >
            Start with a blank page
          </button>
          <button className="btn" onClick={() => go('plan')}>
            Make a plan first
          </button>
        </div>
        <div className="mt-8">
          <label className="label" htmlFor="draft-paste">
            Or paste a draft
          </label>
          <textarea id="draft-paste" className="input mt-1 min-h-32" value={paste} onChange={(e) => setPaste(e.target.value)} data-testid="draft-paste" />
          <button
            className="btn mt-2"
            disabled={!paste.trim() || busy}
            data-testid="draft-import"
            onClick={async () => {
              setBusy(true);
              try {
                await post(`/assignments/${o.assignment.id}/document`, { text: paste });
                await reload();
              } catch (e) {
                setErr(e);
              }
              setBusy(false);
            }}
          >
            Use this draft
          </button>
          <p className="mt-1 text-sm text-ink2">It is recorded as an import. The app cannot see how it was written before now.</p>
        </div>
        <div className="mt-4">
          <ErrorNote error={err} />
        </div>
      </div>
    );

  if (doc.loading && !d)
    return (
      <div className="p-8">
        <Spinner label="Opening your draft" />
      </div>
    );

  return (
    <div className="mx-auto w-full max-w-[46rem] px-4 pb-24 pt-6" data-testid="stage-draft">
      <h1 className="sr-only" tabIndex={-1} data-stage-heading>
        Draft
      </h1>
      {/* quiet status line */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink2" data-testid="draft-bar">
        <span data-testid="save-state">{failed ? 'Not saved. A copy is kept on this device.' : saving ? 'Saving…' : dirty ? 'Unsaved changes' : 'Saved'}</span>
        <span data-testid="word-count">
          {count ?? 0} {count === 1 ? 'word' : 'words'}
        </span>
        {tr && target && (
          <button
            className="link"
            onClick={() => openFromDraft({ passageId: target.passageId, quote: { start: target.start, end: target.end } })}
            data-testid="word-target"
            aria-label={`Word target ${target.value}, ${lengthState}. Open where this came from.`}
          >
            target {tr.min.toLocaleString()}–{tr.max.toLocaleString()} · {lengthState}
          </button>
        )}
        {conflictOpen && (
          <button className="link text-warn" onClick={() => go('materials')} data-testid="length-undecided">
            Word limit not chosen yet
          </button>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2" role="toolbar" aria-label="Draft tools">
        <button
          className="btn"
          onClick={() => protect(false)}
          data-testid="protect-wording"
          title="Select words first to protect just those, or leave the cursor in a paragraph"
        >
          <Lock size={14} aria-hidden /> Protect wording
        </button>
        <Dialog.Root open={drawer !== null} onOpenChange={(v) => !v && setDrawer(null)} modal={false}>
          <button
            className="btn"
            aria-haspopup="dialog"
            aria-expanded={drawer !== null}
            onClick={() => setDrawer(drawer ? null : 'outline')}
            data-testid="open-drawer"
          >
            Outline, brief and sources
          </button>
          <Dialog.Portal>
            <Dialog.Content
              aria-describedby={undefined}
              onInteractOutside={(e) => e.preventDefault()}
              className="fixed inset-y-0 right-0 z-30 flex w-full max-w-[420px] flex-col border-l border-rule bg-surface shadow-xl max-md:inset-x-0 max-md:bottom-0 max-md:top-auto max-md:h-[70vh] max-md:max-w-none max-md:rounded-t-xl max-md:border-l-0 max-md:border-t"
              data-testid="drawer"
            >
              <div className="flex items-center justify-between border-b border-rule px-3 py-2">
                <Dialog.Title className="font-semibold">While you write</Dialog.Title>
                <Dialog.Close className="btn btn-quiet px-2" aria-label="Close panel" data-testid="drawer-close">
                  <X size={18} />
                </Dialog.Close>
              </div>
              <div role="tablist" aria-label="Reference" className="flex gap-1 border-b border-rule px-2 py-1.5">
                {(['outline', 'brief', 'sources', 'history'] as Tab[]).map((t) => (
                  <button
                    key={t}
                    role="tab"
                    aria-selected={drawer === t}
                    className={cx('btn px-3 capitalize', drawer === t && 'bg-tint font-semibold')}
                    onClick={() => setDrawer(t)}
                    data-testid={`drawer-tab-${t}`}
                  >
                    {t}
                  </button>
                ))}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-4" role="tabpanel">
                {drawer === 'outline' && (
                  <OutlineTab
                    d={d}
                    onProtectThesis={() => protect(true)}
                    onUnlock={async (id) => {
                      await del(`/documents/${docId}/locks/${id}`);
                      await doc.reload();
                    }}
                  />
                )}
                {drawer === 'brief' && <BriefView conflictOpen={false} onChooseConflict={() => go('materials')} readOnly />}
                {drawer === 'sources' && <SourcesTab onOpen={openFromDraft} />}
                {drawer === 'history' && <HistoryTab docId={docId} assignmentId={o.assignment.id} />}
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
        <button className="btn btn-primary ml-auto" onClick={() => go('review')} data-testid="to-review">
          Review my draft
        </button>
      </div>

      {recover && (
        <div role="alert" className="mt-4 rounded-md border border-warn p-3 text-sm" data-testid="recover-banner">
          <p>
            <b>Text from your last visit was not saved.</b> A copy was kept on this device.
          </p>
          <div className="mt-2 flex gap-3">
            <button
              className="btn btn-primary"
              onClick={async () => {
                const next = recover.paragraphs;
                setRecover(null);
                // restore it as a normal save so history shows it
                const cur = dRef.current;
                if (cur) {
                  try {
                    await post(`/documents/${docId}/revisions`, { baseRevisionId: cur.revision.id, paragraphs: next, label: 'Recovered text' });
                    writeBackup(docId, null);
                    await doc.reload();
                  } catch (e) {
                    setErr(e);
                  }
                }
              }}
              data-testid="recover-restore"
            >
              Restore it
            </button>
            <button
              className="btn"
              onClick={() => {
                writeBackup(docId, null);
                setRecover(null);
              }}
              data-testid="recover-discard"
            >
              Discard it
            </button>
          </div>
        </div>
      )}

      {stale && (
        <div role="alert" className="mt-4 rounded-md border border-warn p-3 text-sm" data-testid="stale-banner">
          <p>
            <b>This draft changed somewhere else</b> (another tab or a review). Your text on this page is still here and was not saved over theirs.
          </p>
          <div className="mt-2 flex flex-wrap gap-3">
            <button
              className="btn btn-primary"
              data-testid="stale-mine"
              onClick={async () => {
                if (!stale.latest) return;
                setSaving(true);
                try {
                  const mine = editor.current!.getParagraphs();
                  await post(`/documents/${docId}/revisions`, {
                    baseRevisionId: stale.latest.revision.id,
                    paragraphs: mine,
                    label: 'Kept my text after a conflict',
                  });
                  writeBackup(docId, null);
                  setStale(null);
                  setDirty(false);
                  await doc.reload();
                } catch (e) {
                  setErr(e);
                } finally {
                  setSaving(false);
                }
              }}
            >
              Save my text on top
            </button>
            <button
              className="btn"
              data-testid="stale-copy"
              onClick={() => {
                const text = (editor.current?.getParagraphs() ?? []).map((p) => p.text).join('\n\n');
                const a = document.createElement('a');
                a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
                a.download = 'my-text.txt';
                a.click();
              }}
            >
              Download my text
            </button>
            <button
              className="btn"
              data-testid="stale-theirs"
              onClick={async () => {
                writeBackup(docId, null);
                setStale(null);
                setDirty(false);
                await doc.reload();
              }}
            >
              Load the other version
            </button>
          </div>
          {stale.latest && !sameText(stale.latest.revision.paragraphs, editor.current?.getParagraphs() ?? []) && (
            <details className="mt-2">
              <summary className="cursor-pointer">See the other version</summary>
              <div className="mt-1 space-y-2 whitespace-pre-wrap rounded border border-rule p-2">
                {stale.latest.revision.paragraphs.map((p: Para) => (
                  <p key={p.id}>{p.text}</p>
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      <div className="mt-3">
        <ErrorNote error={err ?? doc.error} />
      </div>

      <div className="mt-4">
        {d && (
          <div className="draft-page" data-testid="draft-page">
            <Editor
              ref={editor}
              revisionId={d.revision.id}
              paragraphs={d.revision.paragraphs}
              marks={marks}
              onDirty={onDirty}
              onClaimClick={() => {}}
              onPaste={(chars) => {
                void post(`/documents/${docId}/events`, { kind: 'paste', chars }).catch(() => {});
              }}
            />
          </div>
        )}
        {d && !count && <p className="mt-2 text-ink2">Begin anywhere. Your outline is in the panel above whenever you want it.</p>}
        {d && d.locks.length > 0 && (
          <p className="mt-3 text-sm text-ink2" data-testid="protected-count">
            <Lock size={12} className="mr-1 inline" aria-hidden />
            {d.locks.length} protected {d.locks.length === 1 ? 'passage' : 'passages'}. Reviews will not change {d.locks.length === 1 ? 'it' : 'them'}.
          </p>
        )}
      </div>
    </div>
  );
}

function OutlineTab({ d, onProtectThesis, onUnlock }: { d: any; onProtectThesis: () => void; onUnlock: (id: string) => void }) {
  const { o, go } = useShell();
  const idea = o.plan.idea;
  const items = o.plan.outline?.items ?? [];
  const locks = d?.locks ?? [];
  return (
    <div className="space-y-5" data-testid="outline-tab">
      <section>
        <h3 className="label">Thesis</h3>
        {idea?.thesis ? <p className="mt-1">{idea.thesis}</p> : <p className="mt-1 text-ink2">No thesis written yet.</p>}
        <button className="link mt-1 text-sm" onClick={onProtectThesis} data-testid="protect-thesis">
          Protect the paragraph my cursor is in as my thesis
        </button>
      </section>
      <section>
        <h3 className="label">Outline</h3>
        {items.length ? (
          <ol className="mt-1 list-decimal space-y-2 pl-5">
            {items.map((it: any) => (
              <li key={it.id}>
                <b>{it.purpose}</b>
                <p className="text-sm text-ink2">{it.claim}</p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-1 text-ink2">No outline yet.</p>
        )}
        <button className="link mt-2 text-sm" onClick={() => go('plan')}>
          Edit in Plan
        </button>
      </section>
      <section>
        <h3 className="label">Protected wording</h3>
        {locks.length === 0 ? (
          <p className="mt-1 text-ink2">Nothing protected. Select words and choose “Protect wording”.</p>
        ) : (
          <ul className="mt-1 space-y-2" data-testid="lock-list">
            {locks.map((l: any) => (
              <li key={l.id} className="flex items-start justify-between gap-2 text-sm">
                <span>
                  <b>{l.thesis ? 'Thesis' : l.kind === 'paragraph' ? 'Paragraph' : 'Words'}:</b> “{l.text.slice(0, 80)}
                  {l.text.length > 80 ? '…' : ''}”
                </span>
                <button className="btn btn-quiet px-2" aria-label="Stop protecting this" onClick={() => onUnlock(l.id)}>
                  <Unlock size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function SourcesTab({ onOpen }: { onOpen: (t: { passageId: string }) => void }) {
  const { o } = useShell();
  const m = o.materials;
  const rows: { id: string; title: string; kind: string }[] = [
    ...m.syllabi.filter((s: any) => s.id === m.syllabusChosenId).map((s: any) => ({ id: s.id, title: s.title, kind: 'Syllabus' })),
    ...m.instructions.map((s: any) => ({ id: s.id, title: s.title, kind: 'Assignment' })),
    ...m.rubricFiles.map((s: any) => ({ id: s.id, title: s.title, kind: 'Rubric' })),
    ...m.readings.map((s: any) => ({ id: s.id, title: s.title, kind: 'Reading' })),
  ];
  const [err, setErr] = useState<unknown>(null);
  return (
    <div data-testid="sources-tab">
      <ErrorNote error={err} />
      {rows.length === 0 ? (
        <p className="text-ink2">No materials added yet.</p>
      ) : (
        <ul className="divide-y divide-rule">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0">
                <span className="block truncate font-medium">{r.title}</span>
                <span className="text-sm text-ink2">{r.kind}</span>
              </span>
              <button
                className="btn px-3"
                onClick={async () => {
                  try {
                    const s = await get(`/sources/${r.id}`);
                    const first = s.passages?.[0]?.id;
                    if (first) onOpen({ passageId: first });
                    else setErr(new Error('This source has no readable text yet.'));
                  } catch (e) {
                    setErr(e);
                  }
                }}
              >
                <BookOpen size={14} aria-hidden /> Open
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function HistoryTab({ docId }: { docId: string; assignmentId: string }) {
  const h = useAsync(() => get(`/documents/${docId}/history`), [docId]);
  if (h.loading) return <Spinner />;
  const revs = [...(((h.data as any)?.revisions ?? []) as any[])].reverse().slice(0, 8);
  return (
    <div data-testid="history-tab">
      <ul className="divide-y divide-rule">
        {revs.map((r: any) => (
          <li key={r.id} className="py-2 text-sm">
            <span className="font-medium">{r.label || r.cause}</span>
            <span className="ml-2 text-ink2">{new Date(r.created_at).toLocaleString()}</span>
          </li>
        ))}
      </ul>
      <Link className="link mt-3 inline-block" to={`/documents/${docId}/history`} data-testid="history-link">
        Open full history
      </Link>
    </div>
  );
}
