import { useState } from 'react';
import { Download } from 'lucide-react';
import { download, get, put, post } from '@/lib/api';
import { ErrorNote, Modal, Spinner, useAsync } from '@/lib/ui';

export function ExportModal({ documentId, assignmentId, open, onClose }: { documentId: string; assignmentId: string; open: boolean; onClose: () => void }) {
  const prev = useAsync(() => (open ? get(`/documents/${documentId}/export-preview`) : Promise.resolve(null)), [open, documentId]);
  const [statement, setStatement] = useState<string | null>(null);
  const [include, setInclude] = useState(false);
  const [includeText, setIncludeText] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const d = prev.data;
  const st = statement ?? d?.assistanceStatement ?? '';
  const go = async (format: string, fallback: string) => {
    setErr(null);
    setMsg(null);
    try {
      if (include)
        await put(`/assignments/${assignmentId}/assistance-statement`, {
          text: st,
        });
      const r = await download(`/documents/${documentId}/export`, { format, includeStatement: include, includeText }, fallback);
      setMsg(`Saved ${r.name}. Text hash ${r.hash?.slice(0, 12)}… from revision ${r.revisionId}.`);
    } catch (e) {
      setErr(e);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title="Export the approved paper" wide>
      {prev.loading && <Spinner />}
      <ErrorNote error={prev.error ?? err} />
      {d && (
        <div className="space-y-3 text-sm" data-testid="export-preview">
          <p>
            Revision <code>{d.revisionId}</code> · {d.words} words · {d.paragraphs} paragraphs · hash{' '}
            <code data-testid="export-hash">{d.hash.slice(0, 16)}…</code>
          </p>
          <div
            className="max-h-56 overflow-auto whitespace-pre-wrap rounded-md border border-stone-200 p-3 font-serif dark:border-stone-700"
            data-testid="export-text"
          >
            {d.text}
          </div>
          <p>
            <b>Citations in the text:</b> {d.citations.length ? d.citations.join(', ') : 'none'}{' '}
            {d.citationStyle ? `(assignment names ${d.citationStyle}; format is not verified)` : ''}
          </p>
          {d.unresolvedEvidence > 0 && (
            <p className="text-orange-900">
              {d.unresolvedEvidence} claim(s) are not fully supported by your readings. You can still export; the report will say so.
            </p>
          )}
          {d.staleEvidence > 0 && <p className="text-amber-900">{d.staleEvidence} claim(s) rely on a source that has since been replaced.</p>}
          {d.assistanceRequirement.length > 0 && (
            <div className="rounded-md border border-stone-200 p-2 dark:border-stone-700">
              <b>Assistance, as your assignment states it:</b>
              <ul className="list-disc pl-5">
                {d.assistanceRequirement.map((a: string, i: number) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </div>
          )}
          <label className="block">
            <span className="font-medium">Assistance statement (optional, you write it)</span>
            <textarea
              className="input mt-1"
              value={st}
              onChange={(e) => setStatement(e.target.value)}
              placeholder="e.g. I used an AI tool to suggest edits and checked each against the readings."
            />
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={include} onChange={(e) => setInclude(e.target.checked)} /> Add this statement after the essay in the DOCX/TXT
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={includeText} onChange={(e) => setIncludeText(e.target.checked)} /> Include short text excerpts in the process report
            (your private notes are never included)
          </label>
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-primary" onClick={() => go('docx', 'essay.docx')} data-testid="export-docx">
              <Download size={14} /> DOCX
            </button>
            <button className="btn" onClick={() => go('txt', 'essay.txt')} data-testid="export-txt">
              <Download size={14} /> Plain text
            </button>
            <button className="btn" onClick={() => go('report-pdf', 'report.pdf')} data-testid="export-report-pdf">
              <Download size={14} /> Process report (PDF)
            </button>
            <button className="btn" onClick={() => go('report', 'report.html')}>
              <Download size={14} /> Report (HTML, printable)
            </button>
          </div>
          {msg && (
            <p role="status" className="text-emerald-900">
              {msg}
            </p>
          )}
          <p className="muted">
            The report states what this editor observed, where text was imported whole, which stages used a model, and what you decided. It is not proof of
            authorship.
          </p>
        </div>
      )}
    </Modal>
  );
}
void post;
