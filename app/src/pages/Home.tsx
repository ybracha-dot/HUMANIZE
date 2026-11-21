import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, FlaskConical } from 'lucide-react';
import { get, post } from '@/lib/api';
import { ErrorNote, Spinner, useAsync, useInterval } from '@/lib/ui';

const STAGE_WORD: Record<string, string> = { materials: 'Materials', plan: 'Plan', draft: 'Draft', review: 'Review', export: 'Export' };

/** One short form: what is the paper called, and which course is it for. A new course is a name, not a separate trip. */
function StartPaper({ courses, autoFocus }: { courses: { id: string; name: string }[]; autoFocus?: boolean }) {
  const nav = useNavigate();
  const [title, setTitle] = useState('');
  const [courseId, setCourseId] = useState(courses[0]?.id ?? 'new');
  const [courseName, setCourseName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const isNew = courseId === 'new';
  const ready = title.trim() && (!isNew || courseName.trim());
  return (
    <form
      className="panel p-5"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!ready || busy) return;
        setBusy(true);
        setErr(null);
        try {
          const cid = isNew ? (await post('/courses', { name: courseName.trim() })).id : courseId;
          const a = await post(`/courses/${cid}/assignments`, { title: title.trim(), genre: 'academic_argument' });
          nav(`/assignments/${a.id}/materials`);
        } catch (x) {
          setErr(x);
          setBusy(false);
        }
      }}
      data-testid="start-paper"
    >
      <h2 className="text-xl font-semibold">Start a paper</h2>
      <label className="label mt-4 block" htmlFor="start-title">
        What is it called?
      </label>
      <input
        id="start-title"
        className="input mt-1"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="For example: Paper 2, school start times"
        autoFocus={autoFocus}
        data-testid="start-title"
      />
      <label className="label mt-4 block" htmlFor="start-course">
        Which course is it for?
      </label>
      <select id="start-course" className="input mt-1" value={courseId} onChange={(e) => setCourseId(e.target.value)} data-testid="start-course">
        {courses.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
        <option value="new">A new course…</option>
      </select>
      {isNew && (
        <>
          <label className="label mt-4 block" htmlFor="start-course-name">
            Course name
          </label>
          <input
            id="start-course-name"
            className="input mt-1"
            value={courseName}
            onChange={(e) => setCourseName(e.target.value)}
            placeholder="For example: SOC 101"
            data-testid="start-course-name"
          />
        </>
      )}
      <div className="mt-4">
        <ErrorNote error={err} />
      </div>
      <button className="btn btn-primary mt-4 !px-6" type="submit" disabled={!ready || busy} data-testid="start-go">
        {busy ? 'Setting up…' : 'Start'}
      </button>
      <p className="mt-2 text-sm text-ink2">Next you add what your instructor gave you. Pasting the instructions is enough to begin.</p>
    </form>
  );
}

export default function Home() {
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const home = useAsync(() => get('/home'), []);
  const settings = useAsync(() => get('/settings'), []);
  const [err, setErr] = useState<unknown>(null);
  const [seeding, setSeeding] = useState(false);
  const [another, setAnother] = useState(false);
  useInterval(() => home.reload(), home.data?.running?.length ? 1500 : null);
  const loadSample = async () => {
    setSeeding(true);
    try {
      const r = await post('/demo/seed');
      nav(`/assignments/${r.assignmentId}`);
    } catch (e) {
      setErr(e);
      setSeeding(false);
    }
  };
  useEffect(() => {
    if (sp.get('demo') === '1') loadSample(); /* eslint-disable-next-line */
  }, []);
  if (home.loading)
    return (
      <div className="p-6">
        <Spinner label="Loading" />
      </div>
    );
  const h = home.data;
  const has = h.assignments.length > 0;
  return (
    <div className="mx-auto max-w-[760px] px-4 py-8 md:py-12">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="title text-3xl">Writing Studio</h1>
          <p className="mt-1 text-ink2">Your instructions, your draft and every decision in one place.</p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-ink2" data-testid="home-mode">
            {settings.data?.mode === 'live' ? 'Live AI feedback' : 'Sample feedback · no AI key'}
          </span>
          <Link className="btn" to="/settings">
            Settings
          </Link>
        </div>
      </header>
      <ErrorNote error={err ?? home.error} />

      {has ? (
        <>
          <Link to={h.firstAction.to} className="panel flex items-center justify-between gap-4 p-5 hover:bg-tint" data-testid="first-action">
            <div className="min-w-0">
              <div className="label">Pick up where you left off</div>
              <div className="mt-1 text-lg font-semibold">{h.firstAction.label}</div>
              <div className="truncate text-sm text-ink2">
                {h.assignments[0].title} · {h.assignments[0].course_name}
              </div>
            </div>
            <ArrowRight aria-hidden className="shrink-0" />
          </Link>
          {h.running.length > 0 && (
            <p className="mt-3 text-sm text-ink2" role="status">
              A review is running ({h.running[0].stages.filter((s: any) => s.status === 'done').length} of {h.running[0].stages.length} steps done).
            </p>
          )}
          <section className="mt-10" aria-labelledby="recent-h">
            <h2 id="recent-h" className="text-xl font-semibold">
              Your papers
            </h2>
            <ul className="mt-3 divide-y divide-rule border-y border-rule">
              {h.assignments.map((a: any) => {
                const n = h.pending.find((p: any) => p.document_id === a.document_id)?.n ?? 0;
                const stage = a.resumeStage ?? (a.document_id ? 'draft' : 'materials');
                return (
                  <li key={a.id}>
                    <Link
                      to={`/assignments/${a.id}/${stage}`}
                      className="flex flex-wrap items-baseline justify-between gap-x-4 py-3 hover:bg-tint"
                      data-testid="assignment-link"
                    >
                      <span className="font-medium">{a.title}</span>
                      <span className="text-sm text-ink2">
                        {a.course_name} · {STAGE_WORD[stage] ?? 'Draft'}
                        {n > 0 ? ` · ${n} ${n === 1 ? 'recommendation' : 'recommendations'} waiting` : ''}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
          <div className="mt-8">
            {another ? (
              <StartPaper courses={h.courses} autoFocus />
            ) : (
              <button className="btn" onClick={() => setAnother(true)} data-testid="start-another">
                Start another paper
              </button>
            )}
          </div>
        </>
      ) : (
        <StartPaper courses={h.courses} autoFocus />
      )}

      {h.courses.length > 0 && (
        <section className="mt-10" aria-labelledby="courses-h">
          <h2 id="courses-h" className="text-xl font-semibold">
            Courses
          </h2>
          <ul className="mt-3 flex flex-wrap gap-2">
            {h.courses.map((c: any) => (
              <li key={c.id}>
                <Link className="chip hover:bg-tint" to={`/courses/${c.id}`}>
                  {c.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mt-12 border-t border-rule pt-4">
        <button className="link inline-flex items-center gap-2 text-sm" onClick={loadSample} disabled={seeding} data-testid="load-sample">
          <FlaskConical size={14} aria-hidden /> {seeding ? 'Loading the sample…' : 'Try the sample paper (synthetic data)'}
        </button>
      </div>
    </div>
  );
}
