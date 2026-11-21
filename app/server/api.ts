import { Hono } from 'hono';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ZodError, z } from 'zod';
import { all, getDb, j, one, own, unj, uid, clock, DATA_DIR, type DB } from './db.ts';
import * as S from './store.ts';
import * as J from './jobs.ts';
import * as F from './flows.ts';
import { estimateRun } from './review.ts';
import { exportDocument, exportPreview, buildReport } from './exporter.ts';
import { providerStatus, selectProviders } from './providers/index.ts';
import { compareRevisions } from '../shared/compare.ts';
import { suggestProfile, voiceEdit, clarityFlags, structureFlags, POLICY_PROVENANCE, POLICY_VERSION, FOUNDER_PROFILE, type VoiceProfile, type VoiceSample } from '../shared/voice.ts';
import { auditUnicode } from '../shared/unicode.ts';
import { runSpend, usedUsd } from './spend.ts';
import { checkNarrative } from '../shared/storyscope.ts';
import { LIMITS } from './ingest.ts';

type Env = { Variables: { ctx: S.Ctx } };

export function buildApi(db: DB = getDb()) {
  const api = new Hono<Env>();

  api.onError((err, c) => {
    if (err instanceof S.HttpError) return c.json({ error: { code: err.code, message: err.message, ...err.extra } }, err.status as any);
    if (err instanceof ZodError) return c.json({ error: { code: 'invalid_input', message: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') } }, 422);
    const m = String((err as Error)?.message ?? err);
    if ((err as any)?.code === 'price_unconfigured') return c.json({ error: { code: 'price_unconfigured', message: m } }, 409);
    console.error('[api]', m.replace(/(sk-|key[_-]?)[A-Za-z0-9_-]{8,}/gi, '[redacted]'));
    return c.json({ error: { code: 'server_error', message: 'Something went wrong on the server. Your saved work is unchanged.' } }, 500);
  });

  // ---- public ---------------------------------------------------------------------------------
  api.get('/health', (c) => c.json({ ok: true, time: clock.now() }));
  api.post('/session', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    // Personal local install (STUDIO_LOCAL_MODE=1, bound to loopback): one device-owner workspace shared by every browser on this machine.
    if (process.env.STUDIO_LOCAL_MODE === '1' && body.local) {
      const file = path.join(DATA_DIR, 'local-token');
      let token = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() : '';
      if (!token) { token = 'st_' + crypto.randomBytes(24).toString('hex'); fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 }); fs.writeFileSync(file, token, { mode: 0o600 }); }
      const ctx = S.resolveToken(db, token);
      if (ctx) return c.json({ token, userId: ctx.userId, workspaceId: ctx.ws });
      return c.json(S.createUser(db, 'Me', token));
    }
    const u = S.createUser(db, typeof body.name === 'string' ? body.name.slice(0, 60) : 'Writer');
    return c.json(u);
  });

  api.use('*', async (c, next) => {
    const h = c.req.header('authorization') ?? '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : c.req.header('x-studio-token') ?? '';
    const ctx = token ? S.resolveToken(db, token, c.req.header('x-workspace') || undefined) : null;
    if (!ctx) return c.json({ error: { code: 'unauthenticated', message: 'No valid session. Reload to start one.' } }, 401);
    c.set('ctx', ctx);
    await next();
  });
  const X = (c: { get: (k: 'ctx') => S.Ctx }) => c.get('ctx');

  api.get('/me', (c) => { const x = X(c); return c.json({ userId: x.userId, workspaceId: x.ws, role: x.role }); });

  // ---- home -----------------------------------------------------------------------------------
  api.get('/home', (c) => {
    const x = X(c);
    const assignments = all(db, `SELECT a.id, a.title, a.course_id, c.name course_name, a.created_at,
        (SELECT id FROM documents d WHERE d.assignment_id=a.id AND d.workspace_id=a.workspace_id ORDER BY created_at LIMIT 1) document_id
      FROM assignments a JOIN courses c ON c.id=a.course_id AND c.workspace_id=a.workspace_id WHERE a.workspace_id=? ORDER BY a.created_at DESC LIMIT 8`, x.ws);
    const courses = all(db, 'SELECT id, name FROM courses WHERE workspace_id=? ORDER BY created_at DESC', x.ws);
    const running = J.listRuns(x, undefined, 10).filter((r) => ['queued', 'running', 'blocked', 'paused'].includes(r.status));
    const pending = all(db, "SELECT document_id, COUNT(*) n FROM proposals WHERE workspace_id=? AND decision='pending' GROUP BY document_id", x.ws);
    let first: { label: string; to: string } = { label: 'Load the sample assignment', to: '/?demo=1' };
    if (courses.length && !assignments.length) first = { label: 'Add an assignment to your course', to: `/courses/${courses[0].id}` };
    else if (assignments.length) {
      const a = assignments[0];
      const p = pending.find((q) => q.document_id === a.document_id);
      first = p ? { label: `Review ${p.n} suggestion${p.n === 1 ? '' : 's'}`, to: `/assignments/${a.id}` } : a.document_id ? { label: 'Continue writing', to: `/assignments/${a.id}` } : { label: 'Start from an idea or a draft', to: `/assignments/${a.id}` };
    }
    return c.json({ assignments, courses, running, firstAction: first, pending });
  });
  api.post('/demo/seed', async (c) => c.json(await F.seedDemo(X(c))));

  // ---- settings -------------------------------------------------------------------------------
  const settingsView = (x: S.Ctx) => {
    const s = S.getSettings(x);
    let providers: any = null;
    try { const p = selectProviders(s.mode); providers = { editor: p.editor.id, critic: p.critic.id, independent: p.independent, independence: p.independence, notes: p.notes }; } catch (e: any) { providers = { error: e.message }; }
    return { ...s, providerStatus: providerStatus(), providers, policyVersion: POLICY_VERSION, provenance: POLICY_PROVENANCE, limits: LIMITS, usedUsd: usedUsd(db, x.ws) };
  };
  api.get('/settings', (c) => c.json(settingsView(X(c))));
  api.put('/settings', async (c) => {
    const body = z.object({ mode: z.enum(['demo', 'live']).optional(), prices: z.record(z.string(), z.object({ inputPerMTok: z.number().nonnegative(), outputPerMTok: z.number().nonnegative(), cachedPerMTok: z.number().nonnegative().optional(), rev: z.string().optional() })).optional(), monthlyLimitUsd: z.number().nonnegative().nullable().optional(), defaultBudgetUsd: z.number().nonnegative().nullable().optional() }).parse(await c.req.json());
    S.updateSettings(X(c), body);
    return c.json(settingsView(X(c)));
  });
  api.delete('/data/:what', (c) => { S.deleteDerived(X(c), z.enum(['passages', 'voice', 'feedback', 'cache', 'everything']).parse(c.req.param('what'))); return c.json({ ok: true }); });

  // ---- voice ----------------------------------------------------------------------------------
  api.get('/voice', (c) => {
    const x = X(c);
    return c.json({ profile: S.getSettings(x).voiceProfile, samples: all(db, 'SELECT id, text, genre, language, audience, register FROM voice_samples WHERE workspace_id=? ORDER BY created_at', x.ws), founderPreset: FOUNDER_PROFILE });
  });
  api.post('/voice/samples', async (c) => {
    const x = X(c); S.requireWrite(x);
    const b = z.object({ text: z.string().min(20).max(20000), genre: z.string().default('essay'), language: z.string().default('en'), audience: z.string().default('instructor'), register: z.string().default('academic') }).parse(await c.req.json());
    if ((one(db, 'SELECT COUNT(*) n FROM voice_samples WHERE workspace_id=?', x.ws)!.n as number) >= 3) throw new S.HttpError(409, 'too_many', 'Keep at most three samples. Remove one first.');
    const id = uid('vs');
    db.prepare('INSERT INTO voice_samples(id,workspace_id,user_id,text,genre,language,audience,register,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id, x.ws, x.userId, b.text, b.genre, b.language, b.audience, b.register, clock.now());
    return c.json({ id });
  });
  api.delete('/voice/samples/:id', (c) => { const x = X(c); S.requireWrite(x); db.prepare('DELETE FROM voice_samples WHERE id=? AND workspace_id=?').run(c.req.param('id'), x.ws); return c.json({ ok: true }); });
  api.post('/voice/suggest', (c) => {
    const x = X(c);
    const samples = all(db, 'SELECT id, text, genre, language, audience, register FROM voice_samples WHERE workspace_id=?', x.ws) as unknown as VoiceSample[];
    if (!samples.length) return c.json({ profile: S.getSettings(x).voiceProfile, stats: null, previews: [], note: 'No samples yet. Prose will be neutral and genre-appropriate.' });
    return c.json(suggestProfile(samples));
  });
  api.put('/voice/profile', async (c) => {
    const x = X(c);
    const p = z.object({ directness: z.enum(['direct', 'neutral', 'formal']), firstPerson: z.enum(['avoid', 'allow', 'prefer']), avoidEmDash: z.boolean(), preferredTerms: z.record(z.string(), z.string()).default({}), openings: z.array(z.string()).default([]), language: z.string().default('auto'), notes: z.string().default(''), confirmed: z.record(z.string(), z.boolean()).default({}) }).parse(await c.req.json());
    return c.json(S.updateSettings(x, { voiceProfile: p as VoiceProfile }).voiceProfile);
  });
  api.post('/voice/preview', async (c) => {
    const b = z.object({ text: z.string().max(20000) }).parse(await c.req.json());
    const profile = S.getSettings(X(c)).voiceProfile;
    const r = voiceEdit(b.text, profile);
    return c.json({ ...r, flags: clarityFlags(b.text, profile), hygiene: auditUnicode(b.text) });
  });

  // ---- courses / sources ----------------------------------------------------------------------
  api.get('/courses', (c) => c.json(all(db, 'SELECT * FROM courses WHERE workspace_id=? ORDER BY created_at DESC', X(c).ws)));
  api.post('/courses', async (c) => c.json(S.createCourse(X(c), z.object({ name: z.string().min(1).max(120), instructor: z.string().max(120).optional(), term: z.string().max(60).optional() }).parse(await c.req.json()))));
  api.get('/courses/:id', (c) => {
    const x = X(c); const id = c.req.param('id');
    const course = own(db, 'courses', id, x.ws);
    if (!course) throw new S.HttpError(404, 'not_found', 'course not found');
    return c.json({ course, sources: S.listSources(x, id), assignments: all(db, 'SELECT * FROM assignments WHERE workspace_id=? AND course_id=? ORDER BY created_at DESC', x.ws, id), feedback: S.listFeedback(x, id), preferences: S.confirmedPreferences(x, id) });
  });
  api.post('/courses/:id/assignments', async (c) => c.json(S.createAssignment(X(c), c.req.param('id'), z.object({ title: z.string().min(1).max(160), genre: z.string().optional(), language: z.string().optional() }).parse(await c.req.json()))));

  const KINDS = ['syllabus', 'assignment', 'rubric', 'reading', 'feedback', 'note'] as const;
  api.post('/courses/:id/sources', async (c) => {
    const x = X(c); const courseId = c.req.param('id');
    const ct = c.req.header('content-type') ?? '';
    const results: any[] = [];
    if (ct.includes('multipart/form-data')) {
      const len = Number(c.req.header('content-length') ?? 0);
      if (len > LIMITS.maxBytes * 4) throw new S.HttpError(413, 'too_large', 'Upload is too large.');
      const form = await c.req.parseBody({ all: true });
      const kind = z.enum(KINDS).parse(String(form.kind ?? 'reading'));
      const files = ([] as any[]).concat(form.file ?? []).filter((f) => f && typeof f === 'object' && 'arrayBuffer' in f);
      const assignmentId = form.assignmentId ? String(form.assignmentId) : null;
      for (const f of files) {
        const buf = Buffer.from(await f.arrayBuffer());
        try {
          const r = await S.addSource(x, { courseId, assignmentId, kind, title: String(form.title || f.name).slice(0, 160), date: form.date ? String(form.date) : undefined, filename: f.name, mime: f.type, bytes: buf });
          results.push({ file: f.name, ...r });
        } catch (e: any) { results.push({ file: f.name, status: 'unreadable', error: e?.message ?? 'failed' }); }
      }
    } else {
      const b = z.object({ kind: z.enum(KINDS), title: z.string().min(1).max(160), text: z.string().min(1).max(2_000_000), date: z.string().max(40).optional(), assignmentId: z.string().nullable().optional() }).parse(await c.req.json());
      results.push({ file: b.title, ...(await S.addSource(x, { courseId, assignmentId: b.assignmentId ?? null, kind: b.kind, title: b.title, date: b.date, text: b.text })) });
    }
    return c.json({ results });
  });
  api.get('/sources/:id', (c) => c.json(S.getSourceDetail(X(c), c.req.param('id'), c.req.query('version') || undefined)));
  api.post('/sources/:id/replace', async (c) => {
    const x = X(c); const s = own(db, 'sources', c.req.param('id'), x.ws);
    if (!s) throw new S.HttpError(404, 'not_found', 'source not found');
    const form = await c.req.parseBody();
    const f: any = form.file;
    const r = f && typeof f === 'object' && 'arrayBuffer' in f
      ? await S.addSource(x, { courseId: s.course_id, assignmentId: s.assignment_id, kind: s.kind, title: s.title, filename: f.name, mime: f.type, bytes: Buffer.from(await f.arrayBuffer()) }, s.id)
      : await S.addSource(x, { courseId: s.course_id, assignmentId: s.assignment_id, kind: s.kind, title: s.title, text: String(form.text ?? '') }, s.id);
    return c.json(r);
  });
  api.post('/sources/:id/passages', async (c) => c.json(S.addManualPassage(X(c), c.req.param('id'), z.object({ text: z.string().min(5).max(20000), pageIndex: z.number().int().min(1), pageLabel: z.string().nullable().optional() }).parse(await c.req.json()))));
  api.get('/passages/:id', (c) => c.json(S.getPassage(X(c), c.req.param('id'))));
  api.get('/assignments/:id/search', async (c) => c.json(await S.searchPassages(X(c), c.req.param('id'), c.req.query('q') ?? '')));

  // ---- assignment: brief, idea, outline, draft ------------------------------------------------
  api.get('/assignments/:id', (c) => {
    const x = X(c); const id = c.req.param('id');
    const a = own(db, 'assignments', id, x.ws);
    if (!a) throw new S.HttpError(404, 'not_found', 'assignment not found');
    const course = own(db, 'courses', a.course_id, x.ws);
    const doc = one(db, 'SELECT id FROM documents WHERE workspace_id=? AND assignment_id=? ORDER BY created_at LIMIT 1', x.ws, id);
    return c.json({ assignment: { ...a, state: unj(a.state, {}) }, course, brief: S.getBrief(x, id), documentId: doc?.id ?? null, sources: S.listSources(x, a.course_id), evidence: S.evidencePassages(x, id).map((p) => ({ id: p.id, sourceTitle: p.sourceTitle, pageIndex: p.pageIndex, pageLabel: p.pageLabel })) });
  });
  api.post('/assignments/:id/brief/extract', (c) => c.json(S.runBriefExtraction(X(c), c.req.param('id'))));
  api.post('/assignments/:id/brief/correct', async (c) => { S.correctBrief(X(c), c.req.param('id'), z.object({ kind: z.string(), key: z.string(), value: z.string().max(2000), status: z.enum(['confirmed', 'corrected', 'rejected']).optional() }).parse(await c.req.json())); return c.json(S.getBrief(X(c), c.req.param('id'))); });
  api.post('/assignments/:id/brief/resolve', async (c) => { S.resolveConflict(X(c), c.req.param('id'), z.object({ kind: z.string(), chosenSourceId: z.string(), note: z.string().optional() }).parse(await c.req.json())); return c.json(S.getBrief(X(c), c.req.param('id'))); });
  api.put('/assignments/:id/assistance-statement', async (c) => { S.setAssignmentState(X(c), c.req.param('id'), { assistanceStatement: z.object({ text: z.string().max(2000) }).parse(await c.req.json()).text }); return c.json({ ok: true }); });

  api.post('/assignments/:id/idea', async (c) => c.json(await F.ideaToThesisOptions(X(c), c.req.param('id'), z.object({ note: z.string().min(1).max(5000) }).parse(await c.req.json()).note)));
  api.post('/assignments/:id/idea/choose', async (c) => { const b = z.object({ optionId: z.string(), thesis: z.string().max(1000).optional() }).parse(await c.req.json()); return c.json(F.chooseThesis(X(c), c.req.param('id'), b.optionId, b.thesis)); });
  api.post('/assignments/:id/outline', async (c) => c.json(await F.generateOutline(X(c), c.req.param('id'))));
  api.put('/assignments/:id/outline', async (c) => { F.saveOutline(X(c), c.req.param('id'), z.object({ items: z.array(z.any()) }).parse(await c.req.json()).items); return c.json({ ok: true }); });
  api.post('/assignments/:id/draft', async (c) => c.json(await F.generateDraft(X(c), c.req.param('id'))));
  api.post('/assignments/:id/document', async (c) => {
    const b = z.object({ text: z.string().max(500000).default(''), title: z.string().optional() }).parse(await c.req.json());
    return c.json({ documentId: S.createDocument(X(c), c.req.param('id'), { text: b.text, title: b.title, cause: 'import' }) });
  });

  // ---- feedback memory ------------------------------------------------------------------------
  api.post('/courses/:id/feedback', async (c) => c.json(S.addFeedback(X(c), c.req.param('id'), z.object({ comment: z.string().min(1).max(2000), instructor: z.string().optional(), assignmentId: z.string().optional(), linkedParagraph: z.string().optional(), explanation: z.string().max(2000).optional(), scope: z.enum(['one_off', 'recurring', 'irrelevant']).optional() }).parse(await c.req.json()))));
  api.put('/feedback/:id', async (c) => { S.setFeedbackScope(X(c), c.req.param('id'), z.object({ scope: z.enum(['one_off', 'recurring', 'irrelevant']) }).parse(await c.req.json()).scope); return c.json({ ok: true }); });

  // ---- documents ------------------------------------------------------------------------------
  const docView = (x: S.Ctx, id: string, branchId?: string) => {
    const doc = S.getDocumentRow(x, id);
    const { branch, revision } = S.headRevision(x, id, branchId);
    const locks = S.activeLocks(x, id);
    const brief = S.getBrief(x, doc.assignment_id);
    const prefs = all(db, 'SELECT * FROM lock_notes WHERE workspace_id=? AND lock_id IN (SELECT id FROM locks WHERE document_id=? AND workspace_id=?) ORDER BY created_at', x.ws, id, x.ws);
    return {
      document: { id: doc.id, title: doc.title, assignmentId: doc.assignment_id, activeBranchId: doc.active_branch_id },
      branch, revision: { id: revision.id, hash: revision.text_hash, cause: revision.cause, label: revision.label, paragraphs: revision.paragraphs, createdAt: revision.created_at },
      branches: all(db, 'SELECT id, name, head_revision_id FROM branches WHERE workspace_id=? AND document_id=? ORDER BY created_at', x.ws, id),
      locks, lockNotes: prefs, proposals: S.listProposals(x, id).filter((p) => ['pending', 'conflict'].includes(p.decision)), resolved: S.listProposals(x, id).filter((p) => !['pending', 'conflict'].includes(p.decision)).slice(0, 30),
      audits: S.listAudits(x, id, revision.id), requirementsHint: brief.items.filter((i) => i.kind === 'criterion').length,
      structure: [...structureFlags(revision.paragraphs.filter((p) => p.text.trim())), ...checkNarrative(revision.paragraphs, own(db, 'assignments', doc.assignment_id, x.ws)?.genre ?? 'academic_argument').checks.map((n) => ({ paragraphId: n.paragraphId, rule: n.rule, quote: n.quote, effect: n.effect }))],
      mode: S.getSettings(x).mode,
    };
  };
  api.get('/documents/:id', (c) => c.json(docView(X(c), c.req.param('id'), c.req.query('branch') || undefined)));
  api.post('/documents/:id/revisions', async (c) => {
    const b = z.object({ baseRevisionId: z.string(), paragraphs: z.array(z.object({ id: z.string(), text: z.string().max(200000), kind: z.enum(['p', 'h']).optional() })).min(1), label: z.string().max(80).optional() }).parse(await c.req.json());
    const r = S.saveRevision(X(c), c.req.param('id'), b);
    return c.json(r);
  });
  api.post('/documents/:id/restore', async (c) => c.json(S.restoreRevision(X(c), c.req.param('id'), z.object({ revisionId: z.string() }).parse(await c.req.json()).revisionId)));
  api.get('/documents/:id/history', (c) => c.json(S.history(X(c), c.req.param('id'))));
  api.get('/documents/:id/revisions/:rid', (c) => { const r = S.revisionRow(X(c), c.req.param('rid')); if (r.document_id !== c.req.param('id')) throw new S.HttpError(404, 'not_found', 'revision not found'); return c.json({ id: r.id, paragraphs: r.paragraphs, cause: r.cause, label: r.label, createdAt: r.created_at, hash: r.text_hash, meta: r.meta }); });
  api.get('/documents/:id/compare', (c) => {
    const x = X(c); const a = S.revisionRow(x, c.req.query('a') ?? ''); const b = S.revisionRow(x, c.req.query('b') ?? '');
    if (a.document_id !== c.req.param('id') || b.document_id !== c.req.param('id')) throw new S.HttpError(404, 'not_found', 'revision not found');
    const imp = all(db, "SELECT created_at, kind FROM events WHERE workspace_id=? AND document_id=? AND kind IN ('import','draft_generated') ORDER BY created_at", x.ws, c.req.param('id'));
    return c.json({ a: { id: a.id, cause: a.cause, label: a.label, createdAt: a.created_at }, b: { id: b.id, cause: b.cause, label: b.label, createdAt: b.created_at }, changes: compareRevisions(a.paragraphs, b.paragraphs), importBoundary: { events: imp, note: 'Imported or generated snapshots carry their import time. Edits made before an import were not observed, and who wrote them cannot be recovered.' }, importOnly: a.cause === 'import' || b.cause === 'import' });
  });
  api.post('/documents/:id/branches', async (c) => { const b = z.object({ name: z.string().min(1).max(60), fromRevisionId: z.string().optional(), makeActive: z.boolean().optional() }).parse(await c.req.json()); return c.json({ branchId: S.createBranch(X(c), c.req.param('id'), b) }); });
  api.post('/documents/:id/branches/:bid/switch', (c) => { S.switchBranch(X(c), c.req.param('id'), c.req.param('bid')); return c.json({ ok: true }); });
  api.post('/documents/:id/take', async (c) => c.json(S.takeParagraph(X(c), c.req.param('id'), z.object({ fromRevisionId: z.string(), paragraphId: z.string(), idempotencyKey: z.string().min(6) }).parse(await c.req.json()))));
  api.post('/documents/:id/locks', async (c) => c.json(S.addLock(X(c), c.req.param('id'), z.object({ paragraphId: z.string(), kind: z.enum(['paragraph', 'span']), start: z.number().int().optional(), end: z.number().int().optional(), note: z.string().max(300).optional(), thesis: z.boolean().optional() }).parse(await c.req.json()))));
  api.delete('/documents/:id/locks/:lid', (c) => { S.removeLock(X(c), c.req.param('id'), c.req.param('lid')); return c.json({ ok: true }); });
  api.post('/locks/:lid/notes', async (c) => { S.addLockNote(X(c), c.req.param('lid'), z.object({ note: z.string().min(1).max(500) }).parse(await c.req.json()).note); return c.json({ ok: true }); });
  api.post('/documents/:id/paragraphs/:pid/revise', async (c) => c.json(await F.reviseParagraph(X(c), c.req.param('id'), c.req.param('pid'))));
  api.post('/documents/:id/events', async (c) => {
    const x = X(c); S.requireWrite(x); S.getDocumentRow(x, c.req.param('id'));
    const b = z.object({ kind: z.enum(['typing_batch', 'paste', 'automated_input']), inserted: z.number().int().min(0).max(1e6).optional(), deleted: z.number().int().min(0).max(1e6).optional(), activeMs: z.number().int().min(0).max(3.6e6).optional(), chars: z.number().int().min(0).max(1e7).optional(), tool: z.string().max(60).optional(), simulated: z.boolean().optional() }).parse(await c.req.json());
    // Replayed or simulated input can never become an authorship event.
    const kind = b.simulated ? 'automated_input' : b.kind;
    S.logEvent(x, c.req.param('id'), kind, { inserted: b.inserted, deleted: b.deleted, activeMs: b.activeMs, chars: b.chars, tool: b.tool, simulated: !!b.simulated || kind === 'automated_input' });
    return c.json({ ok: true, recordedAs: kind });
  });

  // ---- proposals, decisions -------------------------------------------------------------------
  api.get('/documents/:id/proposals', (c) => c.json(S.listProposals(X(c), c.req.param('id'), c.req.query('decision') || undefined)));
  api.post('/proposals/:id/decision', async (c) => {
    const b = z.object({ action: z.enum(['accept', 'reject', 'edit']), finalText: z.string().max(100000).optional(), idempotencyKey: z.string().min(6).max(80), note: z.string().max(500).optional() }).parse(await c.req.json());
    const r = S.decideProposal(X(c), c.req.param('id'), b);
    return c.json(r, r.status === 'conflict' ? 409 : 200);
  });

  // ---- runs -----------------------------------------------------------------------------------
  api.post('/documents/:id/runs/estimate', async (c) => c.json(estimateRun(X(c), c.req.param('id'), z.object({ mode: z.enum(['quick', 'evidence', 'deep']) }).parse(await c.req.json()).mode)));
  api.post('/documents/:id/runs', async (c) => {
    const x = X(c);
    const b = z.object({ mode: z.enum(['quick', 'evidence', 'deep']), idempotencyKey: z.string().min(6).max(80).optional(), budgetUsd: z.number().nonnegative().nullable().optional() }).parse(await c.req.json());
    const est = estimateRun(x, c.req.param('id'), b.mode);
    if ((est as any).error) throw new S.HttpError(409, 'provider_unavailable', (est as any).error);
    return c.json(J.createRun(x, { documentId: c.req.param('id'), mode: b.mode, idempotencyKey: b.idempotencyKey, estimate: est, budgetUsd: b.budgetUsd }), 202);
  });
  api.get('/documents/:id/runs', (c) => c.json(J.listRuns(X(c), c.req.param('id'))));
  api.get('/runs/:id', (c) => { const x = X(c); const r = J.getRun(x, c.req.param('id')); return c.json({ ...r, spend: runSpend(db, r.id) }); });
  api.post('/runs/:id/cancel', (c) => { J.cancelRun(X(c), c.req.param('id')); return c.json(J.getRun(X(c), c.req.param('id'))); });
  api.post('/runs/:id/pause', (c) => { J.pauseRun(X(c), c.req.param('id'), true); return c.json(J.getRun(X(c), c.req.param('id'))); });
  api.post('/runs/:id/resume', (c) => { J.pauseRun(X(c), c.req.param('id'), false); J.resumeBlocked(X(c), c.req.param('id')); return c.json(J.getRun(X(c), c.req.param('id'))); });

  // ---- narrative checks (fiction / personal narrative) ----------------------------------------
  api.get('/documents/:id/narrative', (c) => {
    const x = X(c); const doc = S.getDocumentRow(x, c.req.param('id'));
    const a = own(db, 'assignments', doc.assignment_id, x.ws)!;
    return c.json(checkNarrative(S.headRevision(x, c.req.param('id')).revision.paragraphs, a.genre));
  });

  // ---- export ---------------------------------------------------------------------------------
  api.get('/documents/:id/export-preview', (c) => c.json(exportPreview(X(c), c.req.param('id'), c.req.query('revision') || undefined)));
  api.get('/documents/:id/report', (c) => { const x = X(c); const rev = S.headRevision(x, c.req.param('id')).revision; return c.json({ lines: buildReport(x, c.req.param('id'), rev.id, c.req.query('text') !== '0').lines }); });
  api.post('/documents/:id/export', async (c) => {
    const b = z.object({ format: z.enum(['docx', 'txt', 'report', 'report-pdf']), revisionId: z.string().optional(), includeStatement: z.boolean().optional(), includeText: z.boolean().optional() }).parse(await c.req.json());
    const r = await exportDocument(X(c), c.req.param('id'), b);
    return new Response(new Uint8Array(r.body), { headers: { 'content-type': r.mime, 'content-disposition': `attachment; filename="${r.filename}"`, 'x-text-hash': r.hash, 'x-revision-id': r.revisionId, 'access-control-expose-headers': 'x-text-hash, x-revision-id, content-disposition' } });
  });

  // ---- pilot instrument (local, no raw text) --------------------------------------------------
  api.get('/pilot/summary', (c) => {
    const x = X(c);
    const decided = all(db, "SELECT decision, COUNT(*) n FROM proposals WHERE workspace_id=? AND decision IN ('accepted','rejected','edited') GROUP BY decision", x.ws);
    const events = all(db, "SELECT kind, COUNT(*) n, SUM(CAST(COALESCE(json_extract(data,'$.activeMs'),0) AS INTEGER)) ms FROM events WHERE workspace_id=? GROUP BY kind", x.ws);
    const evidenceJumps = events.find((e) => e.kind === 'evidence_jump')?.n ?? 0;
    const spend = all(db, 'SELECT SUM(CASE WHEN state=\'settled\' THEN actual_usd ELSE 0 END) usd, SUM(paid) paid FROM spend WHERE workspace_id=?', x.ws)[0];
    return c.json({ decisions: decided, events, activation: { evidenceJumps, decisions: decided.reduce((a, d) => a + d.n, 0), activated: evidenceJumps > 0 && decided.length > 0 }, paidSpendUsd: spend?.usd ?? 0, note: 'Counts only. No essay text or notes leave this machine.' });
  });
  api.post('/documents/:id/log', async (c) => { // lightweight client interaction events (no text)
    const b = z.object({ kind: z.enum(['evidence_jump', 'review_started', 'compare_opened', 'export_previewed']) }).parse(await c.req.json());
    S.logEvent(X(c), c.req.param('id'), b.kind, {});
    return c.json({ ok: true });
  });

  void j;
  return api;
}
