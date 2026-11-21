import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { Link } from 'react-router-dom';
import { download, get, post, put } from '@/lib/api';
import { useShell, plural } from '@/lib/shell';
import { ErrorNote, Spinner, useAsync } from '@/lib/ui';

/** Export: exactly what will be downloaded, one obvious primary action, and the honest caveats beside it. A download counts only after it succeeds. */
export default function Export() {
  const { o, reload, go, announce } = useShell();
  const docId = o.document?.id ?? null;
  const prev = useAsync(() => (docId ? get(`/documents/${docId}/export-preview`) : Promise.resolve(null)), [docId]);
  const d = prev.data as any;
  const [include, setInclude] = useState(false);
  const [statement, setStatement] = useState<string | null>(null);
  const [excerpts, setExcerpts] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<{ name: string; hash: string | null; revisionId: string | null } | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const st = statement ?? d?.assistanceStatement ?? '';
  useEffect(() => {
    if (d?.assistanceStatement) setInclude(true);
  }, [d?.assistanceStatement]);

  const run = async (format: string, fallback: string) => {
    if (!docId) return;
    setErr(null);
    setDone(null);
    setBusy(format);
    try {
      if (include && st.trim()) await put(`/assignments/${o.assignment.id}/assistance-statement`, { text: st });
      const r = await download(`/documents/${docId}/export`, { format, includeStatement: include && !!st.trim(), includeText: excerpts }, fallback);
      if (r.exportId) await post(`/documents/${docId}/export-confirm`, { exportId: r.exportId });
      setDone({ name: r.name, hash: r.hash, revisionId: r.revisionId });
      announce(`Downloaded ${r.name}.`);
      await reload();
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(null);
    }
  };

  if (!docId)
    return (
      <div className="mx-auto max-w-[680px] px-4 py-10" data-testid="stage-export">
        <h1 className="title text-3xl" tabIndex={-1} data-stage-heading>
          Export
        </h1>
        <p className="mt-2 text-ink2">There is nothing to export yet.</p>
        <button className="btn btn-primary mt-4" onClick={() => go('draft')}>
          Go to Draft
        </button>
      </div>
    );
  if (prev.loading && !d)
    return (
      <div className="p-8">
        <Spinner label="Preparing your paper" />
      </div>
    );

  const open = o.review.pending;
  const empty = !d || d.words === 0;
  return (
    <div className="mx-auto max-w-[760px] px-4 py-8 md:py-10" data-testid="stage-export">
      <h1 className="title text-3xl" tabIndex={-1} data-stage-heading>
        Export
      </h1>
      <p className="mt-1 text-ink2" data-testid="export-summary">
        {o.document?.title} · {d ? plural(d.words, 'word') : ''} · your latest saved version
      </p>
      <div className="mt-3">
        <ErrorNote error={prev.error ?? err} />
      </div>

      {(open > 0 || (d?.unresolvedEvidence ?? 0) > 0 || (d?.staleEvidence ?? 0) > 0) && (
        <div className="mt-4 rounded-md border border-warn p-3 text-sm" data-testid="export-notes">
          {open > 0 && (
            <p>
              {plural(open, 'recommendation')} still open.{' '}
              <button className="link" onClick={() => go('review')}>
                Go back to Review
              </button>{' '}
              or export as it is.
            </p>
          )}
          {d?.unresolvedEvidence > 0 && (
            <p>{plural(d.unresolvedEvidence, 'claim')} not fully supported by your readings. You can still export; the process report will say so.</p>
          )}
          {d?.staleEvidence > 0 && <p>{plural(d.staleEvidence, 'claim')} rely on a source that has since been replaced.</p>}
        </div>
      )}

      {d && (
        <section className="mt-6" aria-labelledby="prev-h">
          <h2 id="prev-h" className="label">
            What will be downloaded
          </h2>
          <div
            className="mt-2 max-h-[46vh] overflow-auto whitespace-pre-wrap rounded-md border border-rule bg-surface p-5 leading-relaxed"
            style={{ fontFamily: 'Spectral, Georgia, serif' }}
            tabIndex={0}
            role="region"
            aria-label="Exact text of your paper"
            data-testid="export-text"
          >
            {d.text || 'Your draft is empty.'}
            {include && st.trim() && (
              <>
                {'\n\n'}
                <span data-testid="export-statement-preview">{st}</span>
              </>
            )}
          </div>
          <p className="mt-2 text-sm text-ink2">
            Citations found in the text: {d.citations.length ? d.citations.join(', ') : 'none'}.
            {d.citationStyle ? ` Your assignment names ${d.citationStyle}; the app does not check citation format.` : ''}
          </p>
        </section>
      )}

      <section className="mt-6">
        <label className="flex items-start gap-2">
          <input type="checkbox" className="mt-1" checked={include} onChange={(e) => setInclude(e.target.checked)} data-testid="include-statement" />
          <span>Add an assistance statement after the paper</span>
        </label>
        {d?.assistanceRequirement?.length > 0 && (
          <p className="mt-2 text-sm text-ink2">Your assignment says: {d.assistanceRequirement.map((a: string) => `“${a}”`).join(' ')}</p>
        )}
        {include && (
          <>
            <label className="label mt-3 block" htmlFor="statement">
              Your statement, in your words
            </label>
            <textarea
              id="statement"
              className="input mt-1 min-h-20"
              value={st}
              onChange={(e) => setStatement(e.target.value)}
              placeholder="For example: I used an AI tool to suggest edits and checked each against the readings."
              data-testid="statement"
            />
          </>
        )}
      </section>

      <section className="mt-8 flex flex-wrap items-center gap-3" data-testid="export-actions">
        <button className="btn btn-primary" disabled={empty || !!busy} onClick={() => run('docx', 'essay.docx')} data-testid="export-docx">
          <Download size={16} aria-hidden /> Download Word document
        </button>
        <button className="btn" disabled={empty || !!busy} onClick={() => run('txt', 'essay.txt')} data-testid="export-txt">
          Plain text
        </button>
        <button className="btn" disabled={empty || !!busy} onClick={() => run('report-pdf', 'report.pdf')} data-testid="export-report-pdf">
          Process report (PDF)
        </button>
        {busy && <Spinner label="Preparing the file" />}
      </section>
      {empty && <p className="mt-2 text-sm text-ink2">Write something in Draft first.</p>}
      {done && (
        <div role="status" className="mt-4" data-testid="export-done">
          <p className="text-ok">Downloaded {done.name}.</p>
          <p className="mt-1 text-sm text-ink2">
            That is the version above. If you change your draft later, come back here and download again.{' '}
            <Link className="link" to="/" data-testid="export-home">
              Back to your papers
            </Link>
          </p>
        </div>
      )}

      <details className="mt-8 text-sm">
        <summary className="cursor-pointer font-medium" data-testid="export-more">
          More options and details
        </summary>
        <div className="mt-3 space-y-3">
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-1" checked={excerpts} onChange={(e) => setExcerpts(e.target.checked)} data-testid="report-excerpts" />
            <span>Include short text excerpts in the process report. Your private notes are never included.</span>
          </label>
          <button className="btn" disabled={empty || !!busy} onClick={() => run('report', 'report.html')} data-testid="export-report-html">
            Process report (printable HTML)
          </button>
          <p className="text-ink2">
            The report states what this editor observed, where text was imported whole, which steps used a model, and what you decided. It is not proof of
            authorship.
          </p>
          {d && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-ink2" data-testid="export-details">
              <dt>Version</dt>
              <dd>
                <code>{d.revisionId}</code>
              </dd>
              <dt>Text fingerprint</dt>
              <dd>
                <code data-testid="export-hash">{d.hash}</code>
              </dd>
              <dt>Paragraphs</dt>
              <dd>{d.paragraphs}</dd>
            </dl>
          )}
        </div>
      </details>
    </div>
  );
}
