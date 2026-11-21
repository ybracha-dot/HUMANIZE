import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, FlaskConical, Plus } from 'lucide-react';
import { get, post } from '@/lib/api';
import { ErrorNote, Spinner, useAsync, useInterval } from '@/lib/ui';

export default function Home() {
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const home = useAsync(() => get('/home'), []);
  const settings = useAsync(() => get('/settings'), []);
  const [name, setName] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const [seeding, setSeeding] = useState(false);
  useInterval(() => home.reload(), home.data?.running?.length ? 1500 : null);
  const loadSample = async () => { setSeeding(true); try { const r = await post('/demo/seed'); nav(`/assignments/${r.assignmentId}`); } catch (e) { setErr(e); setSeeding(false); } };
  useEffect(() => { if (sp.get('demo') === '1') loadSample(); /* eslint-disable-next-line */ }, []);
  if (home.loading) return <div className="p-6"><Spinner label="Loading" /></div>;
  const h = home.data;
  return (
    <div className="mx-auto max-w-4xl p-6">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-2xl font-semibold">Writing Studio</h1><p className="muted">Your readings, rubric, draft and every decision in one place.</p></div>
        <div className="flex items-center gap-2">
          <span className="chip" data-testid="home-mode">{settings.data?.mode === 'live' ? 'Live mode' : 'Demo mode: no key needed'}</span>
          <Link className="btn" to="/settings">Settings</Link>
        </div>
      </header>
      <ErrorNote error={err ?? home.error} />
      <Link to={h.firstAction.to.startsWith('/?') ? '#' : h.firstAction.to} onClick={(e) => { if (h.firstAction.to.startsWith('/?')) { e.preventDefault(); loadSample(); } }} className="card mb-6 flex items-center justify-between p-5 hover:bg-stone-50 dark:hover:bg-stone-800/40" data-testid="first-action">
        <div><div className="label">Next useful step</div><div className="mt-1 text-lg font-semibold">{seeding ? 'Loading the sample…' : h.firstAction.label}</div></div>
        <ArrowRight />
      </Link>

      {h.running.length > 0 && (<section className="mb-6"><h2 className="label mb-2">Running now</h2>
        <ul className="space-y-2">{h.running.map((r: any) => <li key={r.id} className="card p-3 text-sm">{r.mode} review · <b>{r.status}</b> · {r.stages.filter((s: any) => s.status === 'done').length}/{r.stages.length} stages</li>)}</ul></section>)}

      <section className="mb-6">
        <h2 className="label mb-2">Recent assignments</h2>
        {h.assignments.length === 0 ? <p className="muted">None yet. Load the sample or create a course.</p> : (
          <ul className="grid gap-2 sm:grid-cols-2">{h.assignments.map((a: any) => (
            <li key={a.id}><Link to={`/assignments/${a.id}`} className="card block p-3 hover:bg-stone-50 dark:hover:bg-stone-800/40" data-testid="assignment-link"><div className="font-medium">{a.title}</div><div className="muted">{a.course_name}{(h.pending.find((p: any) => p.document_id === a.document_id)?.n ?? 0) > 0 ? ` · ${h.pending.find((p: any) => p.document_id === a.document_id).n} suggestions waiting` : ''}</div></Link></li>))}</ul>)}
      </section>

      <section className="mb-6">
        <h2 className="label mb-2">Courses</h2>
        <ul className="mb-3 grid gap-2 sm:grid-cols-2">{h.courses.map((c: any) => <li key={c.id}><Link className="card block p-3 hover:bg-stone-50 dark:hover:bg-stone-800/40" to={`/courses/${c.id}`}>{c.name}</Link></li>)}</ul>
        <form className="flex gap-2" onSubmit={async (e) => { e.preventDefault(); if (!name.trim()) return; try { const c = await post('/courses', { name }); nav(`/courses/${c.id}`); } catch (x) { setErr(x); } }}>
          <input className="input" placeholder="New course name" value={name} onChange={(e) => setName(e.target.value)} aria-label="New course name" />
          <button className="btn btn-primary" type="submit"><Plus size={14} /> Add</button>
        </form>
      </section>
      <button className="btn" onClick={loadSample} disabled={seeding} data-testid="load-sample"><FlaskConical size={14} /> Load the sample assignment (synthetic fixture data)</button>
    </div>
  );
}
