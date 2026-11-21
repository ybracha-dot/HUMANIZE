import { useRef, useState } from 'react';
import { FileText, Upload, X } from 'lucide-react';
import { suggestType, type FileType } from '@shared/stages';
import { post, upload } from '@/lib/api';
import { ErrorNote, Spinner, cx } from '@/lib/ui';

type Kind = FileType;
const TYPE_LABEL: Record<Kind, string> = { syllabus: 'Syllabus', assignment: 'Assignment instructions', rubric: 'Grading rubric', reading: 'Reading' };
interface Entry {
  key: string;
  file?: File;
  text?: string;
  name: string;
  kind: Kind | '';
  scope: 'course' | 'assignment';
  hint?: string;
  result?: { status: string; error?: string };
}
let seq = 0;

const FIXED_SCOPE: Kind[] = ['assignment', 'rubric'];

/**
 * Adds material to ONE assignment. Several files at once are fine: each gets a type (defaulted from the row, or suggested from a clear file name,
 * otherwise "Choose type") and a scope. An assignment sheet or rubric is always this paper only. Pasted text goes through the same import as a file.
 */
export function Intake({
  assignmentId,
  defaultKind,
  label,
  pasteLabel,
  onDone,
  allowedKinds,
}: {
  assignmentId: string;
  defaultKind: Kind | null;
  label: string;
  pasteLabel: string;
  onDone: () => void;
  allowedKinds?: Kind[];
}) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [pasting, setPasting] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const input = useRef<HTMLInputElement>(null);
  const kinds = allowedKinds ?? (['syllabus', 'assignment', 'rubric', 'reading'] as Kind[]);

  const add = (files: File[]) => {
    setEntries((cur) => [
      ...cur,
      ...files.map((file): Entry => {
        const suggested = suggestType(file.name);
        const kind = (defaultKind && !suggested ? defaultKind : suggested && kinds.includes(suggested) ? suggested : defaultKind) ?? '';
        return {
          key: `f${++seq}`,
          file,
          name: file.name,
          kind,
          scope: kind === 'syllabus' ? 'course' : 'assignment',
          hint: suggested && suggested !== defaultKind ? 'Suggested from the file name' : undefined,
        };
      }),
    ]);
  };
  const patch = (key: string, p: Partial<Entry>) => setEntries((cur) => cur.map((e) => (e.key === key ? { ...e, ...p } : e)));
  const send = async (list: Entry[]) => {
    setBusy(true);
    setErr(null);
    try {
      const files = list.filter((e) => e.file);
      const pasted = list.filter((e) => e.text !== undefined);
      const results: Record<string, any> = {};
      if (files.length) {
        const f = new FormData();
        for (const e of files) f.append('file', e.file!);
        f.append('plan', JSON.stringify(files.map((e) => ({ kind: e.kind, scope: e.scope }))));
        (await upload(`/assignments/${assignmentId}/materials`, f)).results.forEach((r: any, i: number) => (results[files[i].key] = r));
      }
      if (pasted.length) {
        const r = await post(`/assignments/${assignmentId}/materials`, {
          items: pasted.map((e) => ({ kind: e.kind, scope: e.scope, text: e.text, title: e.name })),
        });
        r.results.forEach((x: any, i: number) => (results[pasted[i].key] = x));
      }
      setEntries((cur) => cur.map((e) => (results[e.key] ? { ...e, result: results[e.key] } : e)));
      if (Object.values(results).some((r: any) => ['ready', 'duplicate', 'replaced'].includes(r.status))) onDone();
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  };
  const pending = entries.filter((e) => !e.result || ['failed', 'needs_text'].includes(e.result.status));
  const untyped = pending.some((e) => !e.kind);
  const failed = entries.filter((e) => e.result && ['failed', 'needs_text'].includes(e.result.status));
  const addPaste = () => {
    if (!text.trim() || !defaultKind) return;
    const e: Entry = {
      key: `t${++seq}`,
      text,
      name: defaultKind === 'assignment' ? 'Pasted instructions' : 'Pasted text',
      kind: defaultKind,
      scope: defaultKind === 'syllabus' ? 'course' : 'assignment',
    };
    setText('');
    setPasting(false);
    send([e]);
    setEntries((cur) => [...cur, e]);
  };

  return (
    <div data-testid="intake">
      <div
        className="rounded-md border border-dashed border-edge p-4"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          add(Array.from(e.dataTransfer.files));
        }}
      >
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn btn-primary" onClick={() => input.current?.click()} data-testid="intake-choose">
            <Upload size={16} aria-hidden /> {label}
          </button>
          <button className="link text-sm" onClick={() => setPasting((v) => !v)} aria-expanded={pasting} data-testid="intake-paste-toggle">
            {pasteLabel}
          </button>
          <input
            ref={input}
            type="file"
            multiple
            className="sr-only"
            accept=".pdf,.docx,.txt,.md,.markdown,application/pdf"
            aria-label={label}
            data-testid="intake-file-input"
            onChange={(e) => {
              add(Array.from(e.target.files ?? []));
              e.target.value = '';
            }}
          />
        </div>
        <p className="muted mt-2">PDF, Word, text or Markdown. Choose several files at once, or drop them here.</p>
        {pasting && (
          <div className="mt-3">
            <label className="label" htmlFor={`paste-${defaultKind}`}>
              Paste the text
            </label>
            <textarea
              id={`paste-${defaultKind}`}
              className="input mt-1 min-h-32"
              value={text}
              onChange={(e) => setText(e.target.value)}
              data-testid="intake-paste"
            />
            <button className="btn btn-primary mt-2" disabled={!text.trim() || busy} onClick={addPaste} data-testid="intake-paste-submit">
              {defaultKind === 'assignment' ? 'Create my brief' : 'Add this text'}
            </button>
          </div>
        )}
      </div>

      {entries.length > 0 && (
        <ul className="mt-3 divide-y divide-rule" data-testid="intake-list">
          {entries.map((e) => (
            <li key={e.key} className="py-3" data-testid="intake-entry" data-status={e.result?.status ?? 'queued'}>
              <div className="flex flex-wrap items-center gap-2">
                <FileText size={16} aria-hidden className="shrink-0 text-ink2" />
                <span className="min-w-0 flex-1 break-all text-sm font-medium">{e.name}</span>
                {!e.result && (
                  <button className="btn btn-quiet px-2" aria-label={`Remove ${e.name}`} onClick={() => setEntries((c) => c.filter((x) => x.key !== e.key))}>
                    <X size={16} />
                  </button>
                )}
              </div>
              {(!e.result || ['failed', 'needs_text'].includes(e.result.status)) && e.file && (
                <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
                  <label className="flex items-center gap-2">
                    <span className="text-ink2">Type</span>
                    <select
                      className="input !min-h-[40px] !w-auto"
                      value={e.kind}
                      onChange={(ev) => patch(e.key, { kind: ev.target.value as Kind, scope: ev.target.value === 'syllabus' ? 'course' : e.scope })}
                      aria-label={`Type of ${e.name}`}
                      data-testid="intake-type"
                    >
                      <option value="">Choose type</option>
                      {kinds.map((k) => (
                        <option key={k} value={k}>
                          {TYPE_LABEL[k]}
                        </option>
                      ))}
                    </select>
                  </label>
                  {e.kind &&
                    (FIXED_SCOPE.includes(e.kind as Kind) ? (
                      <span className="text-ink2">This paper only</span>
                    ) : (
                      <label className="flex items-center gap-2">
                        <span className="text-ink2">Share with</span>
                        <select
                          className="input !min-h-[40px] !w-auto"
                          value={e.scope}
                          onChange={(ev) => patch(e.key, { scope: ev.target.value as 'course' | 'assignment' })}
                          aria-label={`Who can use ${e.name}`}
                          data-testid="intake-scope"
                        >
                          <option value="course">This whole course</option>
                          <option value="assignment">This paper only</option>
                        </select>
                      </label>
                    ))}
                  {e.hint && <span className="text-ink2">{e.hint}</span>}
                  {e.result && (
                    <label className="link" data-testid="intake-replace">
                      Choose another file
                      <input
                        type="file"
                        className="sr-only"
                        accept=".pdf,.docx,.txt,.md,.markdown,application/pdf"
                        aria-label={`Choose another file instead of ${e.name}`}
                        data-testid="intake-replace-input"
                        onChange={(ev) => {
                          const f = ev.target.files?.[0];
                          if (f) patch(e.key, { file: f, name: f.name, result: undefined });
                          ev.target.value = '';
                        }}
                      />
                    </label>
                  )}
                </div>
              )}
              {e.result && (
                <p
                  className={cx('mt-1 text-sm', ['ready', 'replaced', 'duplicate'].includes(e.result.status) ? 'text-ok' : 'text-err')}
                  role="status"
                  data-testid="intake-result"
                >
                  {e.result.status === 'ready' && 'Ready.'}
                  {e.result.status === 'replaced' && 'Ready (replaced the version that could not be read).'}
                  {e.result.status === 'duplicate' && 'Already added. Nothing was duplicated.'}
                  {e.result.status === 'needs_text' && `Could not read this file. ${e.result.error ?? ''} Use "Retry" with a text version, or paste the text.`}
                  {e.result.status === 'failed' && `Could not import this. ${e.result.error ?? ''}`}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2">
        <ErrorNote error={err} />
      </div>
      {entries.some((e) => e.file && !e.result) && (
        <button
          className="btn btn-primary mt-3"
          disabled={busy || untyped}
          onClick={() => send(entries.filter((e) => e.file && !e.result))}
          data-testid="intake-import"
        >
          {busy ? (
            <Spinner label="Importing" />
          ) : (
            `Import ${pending.filter((e) => e.file && !e.result).length} ${pending.filter((e) => e.file && !e.result).length === 1 ? 'file' : 'files'}`
          )}
        </button>
      )}
      {untyped && entries.some((e) => !e.result) && (
        <p className="muted mt-1">Choose a type for each file so nothing is filed as the wrong kind of material.</p>
      )}
      {failed.some((e) => e.file) && (
        <button className="btn mt-3" disabled={busy} onClick={() => send(failed.filter((e) => e.file))} data-testid="intake-retry">
          Retry only the files that failed
        </button>
      )}
    </div>
  );
}
