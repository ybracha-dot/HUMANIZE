import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, FileText, Upload } from 'lucide-react';
import { get, post, put, upload } from '@/lib/api';
import { ErrorNote, Section, Spinner, cx, useAsync } from '@/lib/ui';

const KINDS = ['reading', 'assignment', 'rubric', 'syllabus', 'feedback', 'note'];

export default function Course() {
  const { id = '' } = useParams();
  const c = useAsync(() => get(`/courses/${id}`), [id]);
  const [kind, setKind] = useState('reading');
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [paste, setPaste] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [asgTitle, setAsgTitle] = useState('');
  const [genre, setGenre] = useState('academic_argument');
  const [fb, setFb] = useState({ comment: '', explanation: '' });
  const [manual, setManual] = useState<{
    id: string;
    text: string;
    page: string;
    label: string;
  } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  if (c.loading)
    return (
      <div className="p-6">
        <Spinner />
      </div>
    );
  if (c.error)
    return (
      <div className="p-6">
        <ErrorNote error={c.error} />
      </div>
    );
  const d = c.data;
  const doUpload = async () => {
    setBusy(true);
    setErr(null);
    try {
      const files = fileRef.current?.files;
      if (files?.length) {
        const f = new FormData();
        f.append('kind', kind);
        if (title) f.append('title', title);
        if (date) f.append('date', date);
        for (const file of Array.from(files)) f.append('file', file);
        setResults((await upload(`/courses/${id}/sources`, f)).results);
        if (fileRef.current) fileRef.current.value = '';
      } else if (paste.trim()) {
        setResults(
          (
            await post(`/courses/${id}/sources`, {
              kind,
              title: title || 'Pasted text',
              text: paste,
              date: date || undefined,
            })
          ).results,
        );
        setPaste('');
      }
      await c.reload();
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mx-auto max-w-4xl p-6">
      <Link to="/" className="btn btn-quiet mb-3 px-2">
        <ArrowLeft size={16} /> Home
      </Link>
      <h1 className="text-2xl font-semibold">{d.course.name}</h1>
      <p className="muted mb-6">{[d.course.instructor, d.course.term].filter(Boolean).join(' · ')}</p>
      <ErrorNote error={err} />

      <Section title="Assignments">
        <ul className="mb-2 space-y-2">
          {d.assignments.map((a: any) => (
            <li key={a.id}>
              <Link to={`/assignments/${a.id}`} className="card block p-3 hover:bg-stone-50 dark:hover:bg-stone-800/40">
                {a.title}
              </Link>
            </li>
          ))}
        </ul>
        <form
          className="flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!asgTitle.trim()) return;
            await post(`/courses/${id}/assignments`, {
              title: asgTitle,
              genre,
            });
            setAsgTitle('');
            c.reload();
          }}
        >
          <input
            className="input"
            placeholder="New assignment title"
            value={asgTitle}
            onChange={(e) => setAsgTitle(e.target.value)}
            aria-label="New assignment title"
          />
          <select className="input w-56" value={genre} onChange={(e) => setGenre(e.target.value)} aria-label="Genre">
            <option value="academic_argument">Academic argument</option>
            <option value="case_memo">Case memo</option>
            <option value="personal_narrative">Personal narrative</option>
            <option value="fiction">Fiction</option>
          </select>
          <button className="btn btn-primary" type="submit">
            Add
          </button>
        </form>
      </Section>

      <Section title="Course material">
        <ul className="mb-3 space-y-2" data-testid="source-list">
          {d.sources.map((s: any) => (
            <li key={s.id} className="card p-3 text-sm" data-testid="source-row">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <FileText size={14} />
                  <b>{s.title}</b>
                  <span className="chip">{s.kind}</span>
                  {s.doc_date && <span className="muted">{s.doc_date}</span>}
                </span>
                <span
                  className={cx(
                    'chip',
                    s.status === 'ok'
                      ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
                      : s.status === 'superseded'
                        ? 'border-amber-300 bg-amber-50'
                        : 'border-red-300 bg-red-50 text-red-900',
                  )}
                >
                  {s.status} · {s.passages} passages · {s.page_count ?? 0} pages · v{s.versions}
                </span>
              </div>
              {s.error && <p className="mt-1 text-red-900">{s.error}</p>}
              {(s.status === 'needs_ocr' || s.status === 'unreadable') && (
                <button className="btn mt-2" onClick={() => setManual({ id: s.id, text: '', page: '1', label: '' })}>
                  Enter a passage by hand
                </button>
              )}
              <label className="btn btn-quiet mt-2 cursor-pointer px-2 text-xs">
                Replace with a new version
                <input
                  type="file"
                  className="sr-only"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    const fd = new FormData();
                    fd.append('file', f);
                    try {
                      await upload(`/sources/${s.id}/replace`, fd);
                      c.reload();
                    } catch (x) {
                      setErr(x);
                    }
                  }}
                />
              </label>
            </li>
          ))}
        </ul>
        {manual && (
          <div className="card mb-3 space-y-2 p-3">
            <h3 className="font-semibold">Enter a passage from a scanned page</h3>
            <textarea
              className="input"
              placeholder="Type or paste the passage exactly as printed"
              value={manual.text}
              onChange={(e) => setManual({ ...manual, text: e.target.value })}
            />
            <div className="flex gap-2">
              <input className="input" placeholder="Viewer page number" value={manual.page} onChange={(e) => setManual({ ...manual, page: e.target.value })} />
              <input
                className="input"
                placeholder="Printed page label (optional)"
                value={manual.label}
                onChange={(e) => setManual({ ...manual, label: e.target.value })}
              />
            </div>
            <div className="flex gap-2">
              <button
                className="btn btn-primary"
                onClick={async () => {
                  try {
                    await post(`/sources/${manual.id}/passages`, {
                      text: manual.text,
                      pageIndex: Number(manual.page) || 1,
                      pageLabel: manual.label || null,
                    });
                    setManual(null);
                    c.reload();
                  } catch (x) {
                    setErr(x);
                  }
                }}
              >
                Save passage
              </button>
              <button className="btn" onClick={() => setManual(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="card space-y-3 p-4">
          <h3 className="font-semibold">Add material</h3>
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="text-sm">
              Type
              <select className="input mt-1" value={kind} onChange={(e) => setKind(e.target.value)} data-testid="source-kind">
                {KINDS.map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              Title (optional)
              <input className="input mt-1" value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <label className="text-sm">
              Document date (optional)
              <input className="input mt-1" placeholder="e.g. Oct 3" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
          </div>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept=".pdf,.docx,.txt,.md,.markdown,application/pdf"
            aria-label="Choose files"
            data-testid="file-input"
            className="text-sm"
          />
          <textarea className="input min-h-20" placeholder="…or paste text here" value={paste} onChange={(e) => setPaste(e.target.value)} />
          <button className="btn btn-primary" onClick={doUpload} disabled={busy} data-testid="upload-go">
            <Upload size={14} /> {busy ? 'Importing…' : 'Import'}
          </button>
          <p className="muted">
            PDF, DOCX, TXT or Markdown, up to 25 MB. Imported text is treated as data: instructions inside a document are only ever quoted. Nothing leaves this
            machine unless you switch to Live mode and run a review.
          </p>
          {results.length > 0 && (
            <ul className="space-y-1 text-sm" data-testid="upload-results">
              {results.map((r, i) => (
                <li key={i} className={r.status === 'ok' ? 'text-emerald-900' : 'text-red-900'}>
                  <b>{r.file}</b>: {r.status === 'ok' ? `${r.passages} passages, ${r.pageCount} page(s)` : r.error}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Section>

      <Section title="What your instructor has said before">
        <p className="muted mb-2">
          Feedback stays scoped to this course. Only comments you mark “recurring” are ever used in a review. One rejected suggestion never becomes a rule.
        </p>
        <ul className="mb-3 space-y-2">
          {d.feedback.map((f: any) => (
            <li key={f.id} className="card p-3 text-sm" data-testid="feedback-row">
              <p>“{f.comment}”</p>
              {f.explanation && <p className="muted">{f.explanation}</p>}
              <div className="mt-2 flex flex-wrap gap-1.5">
                {(['one_off', 'recurring', 'irrelevant'] as const).map((s) => (
                  <button
                    key={s}
                    className={cx('btn px-2 py-1', f.scope === s && f.confirmed && 'btn-primary')}
                    onClick={async () => {
                      await put(`/feedback/${f.id}`, { scope: s });
                      c.reload();
                    }}
                  >
                    {s.replace('_', '-')}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
        <div className="card space-y-2 p-3">
          <textarea
            className="input"
            placeholder="Paste a comment from your professor"
            value={fb.comment}
            onChange={(e) => setFb({ ...fb, comment: e.target.value })}
            aria-label="Professor comment"
          />
          <input
            className="input"
            placeholder="Which paragraph or why it applies (optional)"
            value={fb.explanation}
            onChange={(e) => setFb({ ...fb, explanation: e.target.value })}
          />
          <button
            className="btn"
            disabled={!fb.comment.trim()}
            onClick={async () => {
              await post(`/courses/${id}/feedback`, fb);
              setFb({ comment: '', explanation: '' });
              c.reload();
            }}
          >
            Save comment
          </button>
        </div>
        {d.preferences.length > 0 && (
          <p className="muted mt-2">{d.preferences.length} confirmed recurring preference(s) will be shown to reviews of this course only.</p>
        )}
      </Section>
    </div>
  );
}
