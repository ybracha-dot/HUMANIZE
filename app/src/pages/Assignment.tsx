import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, BookOpen, Clock, Download, Lock, Save, Unlock, Undo2 } from 'lucide-react';
import { get, post, del, newKey } from '@/lib/api';
import { ErrorNote, Modal, ProviderBadge, Spinner, cx, useAsync, useInterval } from '@/lib/ui';
import { Editor, type EditorHandle, type Mark } from '@/components/Editor';
import { ProposalCard, ResolvedRow } from '@/components/DecisionQueue';
import { SourceReader, type JumpTarget } from '@/components/SourceReader';
import { BriefPanel } from '@/components/BriefPanel';
import { IdeaPanel } from '@/components/IdeaPanel';
import { RunPanel } from '@/components/RunPanel';
import { ExportModal } from '@/components/ExportModal';

type Side = 'queue' | 'evidence' | 'source' | 'review' | 'brief' | 'idea';
const VERDICT: Record<string, string> = { supported: 'Supported', partial: 'Partly supported', contradicted: 'Contradicted', insufficient: 'Not established', unreadable: 'Source unreadable' };

export default function Assignment() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const asg = useAsync(() => get(`/assignments/${id}`), [id]);
  const documentId: string | null = asg.data?.documentId ?? null;
  const doc = useAsync(() => (documentId ? get(`/documents/${documentId}`) : Promise.resolve(null)), [documentId]);
  const settings = useAsync(() => get('/settings'), []);
  const [side, setSide] = useState<Side>('queue');
  const [mobileSide, setMobileSide] = useState(false);
  const [jump, setJump] = useState<JumpTarget | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [conflict, setConflict] = useState<any>(null);
  const [stale, setStale] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [lastAction, setLastAction] = useState<{ text: string; revisionId?: string } | null>(null);
  const editor = useRef<EditorHandle>(null);
  const returnTo = useRef<{ paragraphId: string; offset: number } | null>(null);
  const keys = useRef(new Map<string, string>());

  const reloadAll = useCallback(async () => { await Promise.all([asg.reload(), doc.reload()]); setDirty(false); }, [asg.reload, doc.reload]);
  useEffect(() => { if (asg.data && !asg.data.documentId && side === 'queue') setSide('idea'); }, [asg.data?.documentId]); // eslint-disable-line
  const d = doc.data;

  // ---- saving -------------------------------------------------------------------------------
  const flushMetrics = useCallback(async () => {
    if (!documentId) return;
    const m = editor.current?.takeMetrics();
    if (m && (m.inserted || m.deleted)) { try { await post(`/documents/${documentId}/events`, { kind: 'typing_batch', inserted: m.inserted, deleted: m.deleted, activeMs: m.activeMs }); } catch { /* metrics are best-effort */ } }
  }, [documentId]);

  const save = useCallback(async (label = 'Saved version') => {
    if (!d || !editor.current) return;
    setSaving(true);
    try {
      const paragraphs = editor.current.getParagraphs();
      const r = await post(`/documents/${documentId}/revisions`, { baseRevisionId: d.revision.id, paragraphs, label });
      await flushMetrics();
      if (!r.unchanged) await doc.reload();
      setDirty(false); setStale(false);
    } catch (e: any) { if (e?.code === 'stale_revision') setStale(true); else setErr(e); }
    finally { setSaving(false); }
  }, [d, documentId, doc.reload, flushMetrics]);

  const dirtyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onDirty = useCallback(() => {
    setDirty(true);
    if (dirtyTimer.current) clearTimeout(dirtyTimer.current);
    dirtyTimer.current = setTimeout(() => { saveRef.current('Autosave'); }, 4000);
  }, []);
  const saveRef = useRef(save); saveRef.current = save;
  useEffect(() => () => { if (dirtyTimer.current) clearTimeout(dirtyTimer.current); }, []);
  useEffect(() => { const h = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); }; window.addEventListener('beforeunload', h); return () => window.removeEventListener('beforeunload', h); }, [dirty]);

  // ---- marks ----------------------------------------------------------------------------------
  const marks: Mark[] = useMemo(() => {
    if (!d || dirty) return [];
    const out: Mark[] = [];
    for (const l of d.locks) out.push({ paragraphId: l.paragraphId, start: l.start, end: l.end, cls: 'lock-span' });
    for (const a of d.audits) if (a.verdict !== 'supported') out.push({ paragraphId: a.paragraphId, start: a.start, end: a.end, cls: `claim-${a.verdict === 'unreadable' ? 'insufficient' : a.verdict}`, claimId: a.id });
    const sel = d.proposals.find((p: any) => p.id === selected);
    if (sel) out.push({ paragraphId: sel.paragraphId, start: sel.start, end: sel.start + sel.original.length, cls: 'proposal-anchor' });
    return out;
  }, [d, dirty, selected]);

  // ---- evidence jump + return ---------------------------------------------------------------
  const openSource = useCallback((t: JumpTarget) => {
    const sel = editor.current?.selection(); const cur = editor.current?.cursorParagraph();
    const sp = d?.proposals.find((p: any) => p.id === selected);
    returnTo.current = sel ? { paragraphId: sel.paragraphId, offset: sel.start } : sp ? { paragraphId: sp.paragraphId, offset: sp.start } : cur ? { paragraphId: cur, offset: 0 } : null;
    setJump(t); setSide('source'); setMobileSide(true);
    if (documentId) post(`/documents/${documentId}/log`, { kind: 'evidence_jump' }).catch(() => {});
  }, [d, selected, documentId]);
  const backToDraft = useCallback(() => {
    setMobileSide(false); setSide('queue');
    setTimeout(() => { const r = returnTo.current; if (r) editor.current?.focusAt(r.paragraphId, r.offset); }, 50);
  }, []);
  const onClaimClick = useCallback((auditId: string) => {
    const a = d?.audits.find((x: any) => x.id === auditId);
    if (!a) return;
    if (a.passageId) openSource({ passageId: a.passageId, quote: a.quote ? { start: a.quote.start, end: a.quote.end } : null });
    else { setSide('evidence'); setMobileSide(true); }
  }, [d, openSource]);

  // ---- decisions ----------------------------------------------------------------------------
  const decide = async (p: any, action: 'accept' | 'reject' | 'edit', finalText?: string) => {
    setBusy(p.id); setErr(null);
    try {
      if (dirty) await save('Before decision');
      const k = `${p.id}:${action}`;
      if (!keys.current.has(k)) keys.current.set(k, newKey('dec'));
      const r = await post(`/proposals/${p.id}/decision`, { action, finalText, idempotencyKey: keys.current.get(k) });
      if (r.status === 'conflict') { setConflict(r.conflict); }
      else setLastAction({ text: action === 'reject' ? 'Kept your original wording.' : action === 'edit' ? 'Saved your edited version.' : 'Accepted.', revisionId: r.revisionId });
      await reloadAll();
    } catch (e) { setErr(e); } finally { setBusy(null); }
  };
  const undo = async () => {
    if (!lastAction?.revisionId || !documentId) return;
    try {
      const h = await get(`/documents/${documentId}/history`);
      const rev = h.revisions.find((r: any) => r.id === lastAction.revisionId);
      if (rev?.parent_id) await post(`/documents/${documentId}/restore`, { revisionId: rev.parent_id });
      setLastAction(null); await reloadAll();
    } catch (e) { setErr(e); }
  };

  // ---- locks ----------------------------------------------------------------------------------
  const lock = async (kind: 'span' | 'paragraph', thesis = false) => {
    if (!d) return; setErr(null);
    try {
      await save('Before lock');
      const fresh = editor.current!;
      if (kind === 'span') {
        const s = fresh.selection();
        if (!s) { setErr(new Error('Select some words inside one paragraph first.')); return; }
        await post(`/documents/${documentId}/locks`, { paragraphId: s.paragraphId, kind: 'span', start: s.start, end: s.end });
      } else {
        const pid = fresh.cursorParagraph() ?? d.revision.paragraphs[0].id;
        await post(`/documents/${documentId}/locks`, { paragraphId: pid, kind: 'paragraph', thesis });
      }
      await doc.reload();
    } catch (e) { setErr(e); }
  };

  const criteria: Record<string, string> = useMemo(() => Object.fromEntries((asg.data?.brief.items ?? []).filter((i: any) => i.kind === 'criterion').map((i: any) => [i.key, i.label])), [asg.data]);
  const pending = d?.proposals.filter((p: any) => p.decision === 'pending' || p.decision === 'conflict') ?? [];
  const mode = settings.data?.mode ?? 'demo';
  // keyboard: Alt+ArrowDown/Up moves between suggestions
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!e.altKey || !pending.length) return;
      const i = pending.findIndex((p: any) => p.id === selected);
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(pending[Math.min(pending.length - 1, i + 1)].id); setSide('queue'); }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSelected(pending[Math.max(0, i - 1)].id); setSide('queue'); }
    };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  }, [pending, selected]);
  useInterval(() => { if (documentId && !dirty) doc.reload(); }, null);

  if (asg.loading) return <div className="p-6"><Spinner label="Opening assignment" /></div>;
  if (asg.error) return <div className="p-6"><ErrorNote error={asg.error} /></div>;
  const a = asg.data;
  const tabs: [Side, string, number?][] = [['queue', 'Suggestions', pending.length], ['evidence', 'Evidence'], ['source', 'Source'], ['review', 'Review'], ['brief', 'Brief'], ['idea', 'Idea & outline']];

  return (
    <div className="mx-auto flex min-h-screen max-w-[1500px] flex-col">
      <header className="sticky top-0 z-20 flex flex-wrap items-center gap-2 border-b border-stone-200 bg-paper/95 px-4 py-2 backdrop-blur dark:border-stone-800 dark:bg-[#151311]/95">
        <Link to={`/courses/${a.course.id}`} className="btn btn-quiet px-2" aria-label="Back to course"><ArrowLeft size={16} /></Link>
        <div className="min-w-0"><h1 className="truncate text-base font-semibold">{a.assignment.title}</h1><p className="truncate text-xs text-stone-500">{a.course.name}</p></div>
        <span className={cx('chip ml-2', mode === 'live' ? 'border-emerald-300 bg-emerald-50 text-emerald-900' : 'border-amber-300 bg-amber-50 text-amber-900')} data-testid="mode-badge">{mode === 'live' ? 'Live mode' : 'Demo mode: fixture rules, no key'}</span>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {documentId && (<>
            <span className="muted mr-1" aria-live="polite" data-testid="save-state">{saving ? 'Saving…' : dirty ? 'Unsaved changes' : 'Saved'}</span>
            <button className="btn" onClick={() => save('Saved version')} disabled={saving} data-testid="save-version"><Save size={14} /> Save version</button>
            <button className="btn" onClick={() => lock('span')} title="Lock the selected words"><Lock size={14} /> Lock selection</button>
            <button className="btn" onClick={() => lock('paragraph', true)} title="Lock this paragraph as your thesis" data-testid="lock-thesis"><Lock size={14} /> Lock thesis</button>
            <Link className="btn" to={`/documents/${documentId}/history`} data-testid="history-link"><Clock size={14} /> History</Link>
            <button className="btn" onClick={() => setExporting(true)} data-testid="open-export"><Download size={14} /> Export</button>
          </>)}
          <button className="btn lg:hidden" onClick={() => setMobileSide((v) => !v)} aria-pressed={mobileSide}>{mobileSide ? 'Back to writing' : 'Panels'}</button>
        </div>
      </header>

      {stale && <p role="alert" className="m-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">This document changed in another tab or by a review. <button className="underline" onClick={async () => { await reloadAll(); setStale(false); }}>Reload the latest version</button> (your unsaved typing here will be replaced).</p>}
      <div className="px-4 pt-3"><ErrorNote error={err ?? doc.error} /></div>

      <div className="grid flex-1 gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(380px,460px)]">
        <main className={cx('min-w-0', mobileSide && 'hidden lg:block')} aria-label="Draft">
          {!documentId && (
            <div className="card p-6 text-center" data-testid="no-document">
              <h2 className="text-lg font-semibold">Nothing to edit yet</h2>
              <p className="muted mt-1">Start from an idea, or paste a draft, in the panel on the right.</p>
              <button className="btn btn-primary mt-3" onClick={() => { setSide('idea'); setMobileSide(true); }}>Open “Idea & outline”</button>
            </div>
          )}
          {d && (
            <div className="card p-6">
              <Editor ref={editor} revisionId={d.revision.id} paragraphs={d.revision.paragraphs} marks={marks} readOnly={false} onDirty={onDirty} onClaimClick={onClaimClick}
                onPaste={(chars) => { post(`/documents/${documentId}/events`, { kind: 'paste', chars }).catch(() => {}); }} />
              <p className="muted mt-2 text-xs">Revision {d.revision.id} · {d.revision.cause} · {d.branch.name}{d.branches.length > 1 ? ` (${d.branches.length} branches)` : ''}</p>
            </div>
          )}
          {d?.structure?.length > 0 && (
            <div className="card mt-3 p-3 text-sm"><h3 className="label mb-1">Structure notes</h3><ul className="space-y-1">{d.structure.map((s: any, i: number) => <li key={i}><b>{s.rule.replace(/_/g, ' ')}:</b> “{s.quote.slice(0, 90)}” {s.effect}</li>)}</ul></div>
          )}
        </main>

        <aside className={cx('min-w-0', !mobileSide && 'hidden lg:block')} aria-label="Panels">
          <div role="tablist" className="mb-3 flex flex-wrap gap-1">
            {tabs.map(([k, label, n]) => (
              <button key={k} role="tab" aria-selected={side === k} className={cx('btn px-2.5', side === k && 'btn-primary')} onClick={() => setSide(k)} data-testid={`tab-${k}`}>{label}{n ? <span className="ml-1 rounded-full bg-white/80 px-1.5 text-xs text-stone-900">{n}</span> : null}</button>
            ))}
          </div>

          {side === 'queue' && d && (
            <div className="space-y-3" data-testid="queue">
              {pending.length === 0 && <div className="card p-4 text-sm"><p>No open suggestions.</p><button className="btn mt-2" onClick={() => setSide('review')}>Run a review</button></div>}
              {pending.map((p: any) => <ProposalCard key={p.id} p={p} criteria={criteria} selected={selected === p.id} onSelect={() => setSelected(p.id)} busy={busy === p.id} onDecide={(act, t) => decide(p, act, t)} onJump={openSource} />)}
              {lastAction && <div role="status" className="card flex items-center justify-between p-2 text-sm"><span>{lastAction.text}</span>{lastAction.revisionId && <button className="btn" onClick={undo} data-testid="undo"><Undo2 size={14} /> Undo</button>}</div>}
              {d.locks.length > 0 && (
                <section>
                  <h3 className="label mb-1">Locked text</h3>
                  <ul className="space-y-1.5" data-testid="lock-list">{d.locks.map((l: any) => (
                    <li key={l.id} className="card flex items-start justify-between gap-2 p-2 text-sm">
                      <span><b>{l.thesis ? 'Thesis' : l.kind === 'paragraph' ? 'Paragraph' : 'Words'}</b>: “{l.text.slice(0, 80)}{l.text.length > 80 ? '…' : ''}”{d.lockNotes.filter((n: any) => n.lock_id === l.id).map((n: any) => <i key={n.id} className="mt-1 block text-violet-900">Reviewer note: {n.note}</i>)}</span>
                      <button className="btn btn-quiet px-2" aria-label="Remove lock" onClick={async () => { await del(`/documents/${documentId}/locks/${l.id}`); doc.reload(); }}><Unlock size={14} /></button>
                    </li>))}</ul>
                </section>
              )}
              {d.resolved.length > 0 && <section><h3 className="label mb-1">Decided</h3><ul className="space-y-1.5">{d.resolved.slice(0, 8).map((p: any) => <ResolvedRow key={p.id} p={p} />)}</ul></section>}
            </div>
          )}
          {side === 'evidence' && d && (
            <div className="space-y-2" data-testid="evidence-list">
              <p className="muted">Each claim in your draft is checked against the readings loaded for this assignment. “Not established” means the readings do not show it, not that it is false. Run Evidence review for a deeper check.</p>
              {d.audits.length === 0 && <p className="card p-3 text-sm">No evidence check yet. Run a review.</p>}
              {d.audits.map((au: any) => (
                <div key={au.id} className="card p-2.5 text-sm" data-testid="audit-row" data-verdict={au.verdict}>
                  <div className="flex items-center justify-between gap-2"><span className={cx('chip', au.verdict === 'supported' ? 'border-emerald-300 bg-emerald-50 text-emerald-900' : au.verdict === 'contradicted' ? 'border-red-300 bg-red-50 text-red-900' : 'border-amber-300 bg-amber-50 text-amber-900')}>{VERDICT[au.verdict]}</span>{au.stale && <span className="chip">source replaced</span>}</div>
                  <p className="mt-1">“{au.claim}”</p>
                  {au.reasons.map((r: string, i: number) => <p key={i} className="muted">{r}</p>)}
                  {au.passageId && <button className="btn btn-quiet mt-1 px-2" onClick={() => openSource({ passageId: au.passageId, quote: au.quote ? { start: au.quote.start, end: au.quote.end } : null })}><BookOpen size={13} /> Open passage</button>}
                </div>
              ))}
            </div>
          )}
          {side === 'source' && (jump ? <SourceReader target={jump} onBack={backToDraft} /> : <p className="card p-3 text-sm">Click a claim, an evidence link or a brief item to open the exact passage here.</p>)}
          {side === 'review' && documentId && <RunPanel documentId={documentId} onFinished={() => { reloadAll(); setSide('queue'); }} flushSave={async () => { if (dirty) await save('Before review'); }} />}
          {side === 'brief' && <BriefPanel assignmentId={id} brief={a.brief} reload={asg.reload} onJump={openSource} />}
          {side === 'idea' && <IdeaPanel assignmentId={id} state={a.assignment.state} hasDocument={!!documentId} reload={asg.reload} onJump={openSource} onDocument={async () => { await asg.reload(); setSide('queue'); }} />}
        </aside>
      </div>

      <Modal open={!!conflict} onClose={() => setConflict(null)} title="Two changes touch the same sentence" wide>
        {conflict && (<div className="space-y-3 text-sm" data-testid="conflict-modal">
          <p>{conflict.detail} Nothing was changed. Compare the three versions and edit your text by hand if you want to combine them.</p>
          <div><div className="label">When the suggestion was made</div><p className="card p-2">{conflict.baseText}</p></div>
          <div><div className="label">Your text now</div><p className="card p-2">{conflict.headText}</p></div>
          <div><div className="label">The suggested replacement</div><p className="card p-2">{conflict.replacement}</p></div>
          <button className="btn" onClick={() => setConflict(null)}>Keep my current text</button>
        </div>)}
      </Modal>
      {documentId && <ExportModal documentId={documentId} assignmentId={id} open={exporting} onClose={() => setExporting(false)} />}
      <div className="sr-only" aria-live="polite">{pending.length} open suggestions</div>
    </div>
  );
}
void useNavigate; void ProviderBadge;
