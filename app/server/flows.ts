// Short single-call writer flows (idea, thesis options, outline, drafting, paragraph revision). Each is one bounded provider
// call (never a long review held open on an HTTP connection) and goes through the same spend control as queued stages.
import fs from 'node:fs';
import path from 'node:path';
import { all, clock, own, uid, type DB } from './db.ts';
import { callRole, type StageCtx } from './review.ts';
import { selectProviders } from './providers/index.ts';
import { normalizeParagraph, activeLocks, addSource, createAssignment, createCourse, createDocument, createBranch, evidencePassages, getAssignmentState, getBrief, getSettings, headRevision, HttpError, insertProposals, logEvent, paraId, replaceAudits, requireWrite, runBriefExtraction, saveRevision, setAssignmentState, type Ctx } from './store.ts';
import { validateProposal, type Para } from '../shared/proposals.ts';
import { verifyParagraph } from '../shared/evidence.ts';
import { POLICY_VERSION } from '../shared/voice.ts';

function directCtx(c: Ctx, assignmentId: string, role: string): StageCtx {
  const providers = selectProviders(getSettings(c).mode);
  const asg = own(c.db, 'assignments', assignmentId, c.ws);
  if (!asg) throw new HttpError(404, 'not_found', 'assignment not found');
  const runId = `direct_${role}_${uid('x')}`;
  return { db: c.db, c, claim: { stageId: runId, runId, workspaceId: c.ws, name: role, attempt: 1, leaseToken: '', leaseExpiresAt: 0, mode: 'quick' }, run: { id: runId, assignment_id: assignmentId, budget_usd: null }, providers, heartbeat: () => {}, fault: async () => {} };
}
const idx = (c: Ctx, assignmentId: string) => evidencePassages(c, assignmentId);

/** Idea -> extraction, at most two questions, two thesis options with supporting readings and a weakening fact. The raw note is preserved. */
export async function ideaToThesisOptions(c: Ctx, assignmentId: string, note: string) {
  requireWrite(c);
  if (!note.trim()) throw new HttpError(422, 'empty_note', 'Write a sentence or two first.');
  const sc = directCtx(c, assignmentId, 'thesis_options');
  const r = await callRole(sc, 'editor', 'thesis_options', { note, passages: idx(c, assignmentId), brief: { criteria: getBrief(c, assignmentId).items.filter((i) => i.kind === 'criterion').map((i) => i.label) } });
  const allowed = new Set(idx(c, assignmentId).map((p) => p.id));
  const options = r.output.options.map((o: any) => ({ ...o, supportingPassageIds: o.supportingPassageIds.filter((id: string) => allowed.has(id)) }));
  const idea = { originalNote: note, extraction: r.output.extraction, questions: r.output.questions, options, chosen: null as string | null, provider: r.meta.provider, at: clock.now() };
  setAssignmentState(c, assignmentId, { idea });
  return idea;
}
export function chooseThesis(c: Ctx, assignmentId: string, optionId: string, editedThesis?: string) {
  requireWrite(c);
  const state = getAssignmentState(c, assignmentId);
  const idea = state.idea;
  const opt = idea?.options?.find((o: any) => o.id === optionId);
  if (!opt) throw new HttpError(404, 'not_found', 'thesis option not found');
  setAssignmentState(c, assignmentId, { idea: { ...idea, chosen: optionId, thesis: editedThesis?.trim() || opt.thesis } });
  return getAssignmentState(c, assignmentId).idea;
}

export async function generateOutline(c: Ctx, assignmentId: string) {
  requireWrite(c);
  const state = getAssignmentState(c, assignmentId);
  if (!state.idea?.thesis) throw new HttpError(409, 'no_thesis', 'Choose a thesis first.');
  const sc = directCtx(c, assignmentId, 'outline');
  const r = await callRole(sc, 'editor', 'outline', { thesis: state.idea.thesis, passages: idx(c, assignmentId), notes: { objection: state.idea.extraction?.objection } });
  const allowed = new Set(idx(c, assignmentId).map((p) => p.id));
  const items = r.output.items.map((i: any) => ({ ...i, evidencePassageIds: i.evidencePassageIds.filter((id: string) => allowed.has(id)) }));
  setAssignmentState(c, assignmentId, { outline: { items, provider: r.meta.provider } });
  return getAssignmentState(c, assignmentId).outline;
}
export function saveOutline(c: Ctx, assignmentId: string, items: any[]) {
  requireWrite(c);
  setAssignmentState(c, assignmentId, { outline: { ...(getAssignmentState(c, assignmentId).outline ?? {}), items } });
}

/**
 * Generate a reviewable draft from the outline. Writes to a NEW branch when a document exists, so the student's own
 * text is never overwritten; locked paragraphs are copied through unchanged. Unsupported statements are flagged by audit.
 */
export async function generateDraft(c: Ctx, assignmentId: string) {
  requireWrite(c);
  const state = getAssignmentState(c, assignmentId);
  const items = state.outline?.items as any[] | undefined;
  if (!items?.length) throw new HttpError(409, 'no_outline', 'Create an outline first.');
  const passages = idx(c, assignmentId);
  const texts: string[] = []; let provider = '';
  for (const item of items) {
    const sc = directCtx(c, assignmentId, 'draft_paragraph');
    const r = await callRole(sc, 'editor', 'draft_paragraph', { item, passages: passages.filter((p) => item.evidencePassageIds.includes(p.id)), profile: getSettings(c).voiceProfile, notes: { objection: state.idea?.extraction?.objection } });
    texts.push(normalizeParagraph(r.output.text)); provider = r.meta.provider;
  }
  const existing = one(c.db, 'SELECT id FROM documents WHERE workspace_id=? AND assignment_id=? ORDER BY created_at LIMIT 1', c.ws, assignmentId);
  let docId: string; let revisionId: string; let branchId: string | null = null;
  if (!existing) {
    docId = createDocument(c, assignmentId, { text: texts.join('\n\n'), cause: 'draft' });
    revisionId = headRevision(c, docId).revision.id;
  } else {
    docId = existing.id;
    const { revision } = headRevision(c, docId);
    const locks = activeLocks(c, docId);
    const paras: Para[] = revision.paragraphs.map((p) => ({ ...p }));
    texts.forEach((t, i) => {
      const cur = paras[i];
      if (!cur) paras.push({ id: paraId(), text: t });
      else if (!locks.some((l) => l.paragraphId === cur.id)) paras[i] = { ...cur, text: t };
    });
    const n = (one(c.db, "SELECT COUNT(*) n FROM branches WHERE workspace_id=? AND document_id=? AND name LIKE 'ai-draft%'", c.ws, docId)?.n as number) + 1;
    branchId = createBranch(c, docId, { name: `ai-draft-${n}`, makeActive: false });
    const saved = saveRevision(c, docId, { baseRevisionId: revision.id, paragraphs: paras, cause: 'draft', label: `Generated draft (${provider})`, branchId });
    revisionId = saved.revisionId;
    logEvent(c, docId, 'draft_generated', { provider, branch: `ai-draft-${n}`, words: texts.join(' ').split(/\s+/).length, note: 'Generated text arrived whole on a separate branch.' });
  }
  const rev = headRevision(c, docId, branchId ?? undefined).revision;
  const rows: Parameters<typeof replaceAudits>[4] = [];
  for (const p of rev.paragraphs) {
    const r = verifyParagraph(p.text, passages, `${p.id}_c`);
    r.claims.forEach((cl, i) => rows.push({ paragraphId: p.id, claimId: cl.id, claim: cl.text, start: cl.start, end: cl.end, verdict: r.verdicts[i].verdict, passageId: r.verdicts[i].passageId, quote: r.verdicts[i].quote, reasons: r.verdicts[i].reasons, stale: false, engine: r.verdicts[i].engine }));
  }
  replaceAudits(c, docId, rev.id, null, rows);
  void revisionId;
  return { documentId: docId, branchId, revisionId: rev.id, provider, unsupportedFlagged: rows.filter((r) => r.verdict !== 'supported').length };
}

/** Revise one UNLOCKED paragraph: the result is a proposal (original -> replacement), never a silent change. */
export async function reviseParagraph(c: Ctx, docId: string, paragraphId: string) {
  requireWrite(c);
  const d = own(c.db, 'documents', docId, c.ws);
  if (!d) throw new HttpError(404, 'not_found', 'document not found');
  const { revision } = headRevision(c, docId);
  const para = revision.paragraphs.find((p) => p.id === paragraphId);
  if (!para) throw new HttpError(404, 'not_found', 'paragraph not found');
  const locks = activeLocks(c, docId);
  if (locks.some((l) => l.paragraphId === paragraphId)) throw new HttpError(409, 'locked', 'This paragraph has locked text and will not be rewritten. Unlock it, or lock only the words you want kept.');
  const passages = idx(c, d.assignment_id);
  const sc = directCtx(c, d.assignment_id, 'draft_paragraph');
  const state = getAssignmentState(c, d.assignment_id);
  const best = (await import('../shared/evidence.ts')).PassageIndex;
  const hits = new best(passages).search(para.text, 2).map((h) => h.passage.id);
  const r = await callRole(sc, 'editor', 'draft_paragraph', { item: { id: 'revise', claim: para.text, evidencePassageIds: hits, purpose: 'revise' }, passages: passages.filter((p) => hits.includes(p.id)), profile: getSettings(c).voiceProfile, notes: { objection: state.idea?.extraction?.objection }, revise: true });
  const v = validateProposal({ paragraphId, original: para.text, replacement: r.output.text, issue: 'weak_argument', reason: 'Requested paragraph revision.', evidence: hits.map((id) => ({ passageId: id, relationship: 'context' as const })), meaningChange: 'Whole-paragraph rewrite: compare claims before accepting.', requiresDecision: true }, { baseRevision: revision.id, currentRevision: revision.id, paragraphs: revision.paragraphs, locks, allowedPassageIds: new Set(passages.map((p) => p.id)), provider: r.meta.provider, policyVersion: POLICY_VERSION });
  if (!v.ok) throw new HttpError(422, 'invalid_proposal', v.errors.join('; '));
  const [id] = insertProposals(c, docId, null, [{ ...v.proposal, rank: 1 }]);
  return { proposalId: id };
}

// ---- demo --------------------------------------------------------------------------------------
const SAMPLE = path.resolve(process.cwd(), 'fixtures/sample');
/** Creates the synthetic sample course (labelled fixture data). Idempotent per workspace. */
export async function seedDemo(c: Ctx) {
  requireWrite(c);
  const existing = all(c.db, "SELECT id FROM courses WHERE workspace_id=? AND name LIKE 'EDU 101%'", c.ws)[0];
  if (existing) { const a = all(c.db, 'SELECT id FROM assignments WHERE workspace_id=? AND course_id=?', c.ws, existing.id)[0]; return { courseId: existing.id as string, assignmentId: a?.id as string, created: false }; }
  const course = createCourse(c, { name: 'EDU 101: Education Policy (sample, synthetic data)', instructor: 'Sample Instructor', term: 'Fall' });
  const asg = createAssignment(c, course.id, { title: 'Assignment 2: Attendance and achievement', genre: 'academic_argument', language: 'en' });
  const rd = (f: string) => fs.readFileSync(path.join(SAMPLE, f));
  await addSource(c, { courseId: course.id, kind: 'syllabus', title: 'Syllabus', date: 'Aug 28', filename: 'syllabus.md', mime: 'text/markdown', bytes: rd('syllabus.md') });
  await addSource(c, { courseId: course.id, assignmentId: asg.id, kind: 'assignment', title: 'Assignment sheet', date: 'Oct 3', filename: 'assignment.md', mime: 'text/markdown', bytes: rd('assignment.md') });
  await addSource(c, { courseId: course.id, assignmentId: asg.id, kind: 'reading', title: 'Attendance and Achievement: A Survey of 180 Students', filename: 'reading-attendance.pdf', mime: 'application/pdf', bytes: rd('reading-attendance.pdf') });
  runBriefExtraction(c, asg.id);
  return { courseId: course.id, assignmentId: asg.id, created: true, note: fs.readFileSync(path.join(SAMPLE, 'student-note.txt'), 'utf8').trim() };
}
void (null as unknown as DB);

import { one } from './db.ts';
