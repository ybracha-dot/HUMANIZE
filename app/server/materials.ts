// Assignment-scoped materials: one truthful overview per assignment, mixed-batch import with per-item results, and the UI state the
// shell needs. Scope rules live here and are enforced on the server, whatever the client sends.
import crypto from 'node:crypto';
import { all, clock, one, own, run, unj, type Row } from './db.ts';
import {
  addSource,
  getBrief,
  getSettings,
  headRevision,
  HttpError,
  listAudits,
  requireWrite,
  runBriefExtraction,
  setAssignmentState,
  type Ctx,
} from './store.ts';
import { listRuns } from './jobs.ts';
import { entryStage, isStage, type StageFacts } from '../shared/stages.ts';
import { countWords } from '../shared/text.ts';

export type Kind = 'syllabus' | 'assignment' | 'rubric' | 'reading';
export type Scope = 'course' | 'assignment';
const KINDS: Kind[] = ['syllabus', 'assignment', 'rubric', 'reading'];

export interface MaterialItem {
  id: string;
  kind: string;
  title: string;
  filename: string | null;
  scope: 'course' | 'assignment' | 'legacy';
  origin: string;
  status: 'ready' | 'needs_text' | 'failed' | 'superseded';
  error: string | null;
  passages: number;
  pages: number;
  versions: number;
  date: string | null;
  counted: boolean;
}

const sha = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');

function sourceRows(c: Ctx, courseId: string) {
  return all(
    c.db,
    `SELECT s.id, s.kind, s.title, s.doc_date, s.assignment_id, s.ordinal, s.created_at, v.status vstatus, v.error, v.filename, v.page_count, v.file_hash,
       (SELECT COUNT(*) FROM passages p WHERE p.workspace_id=s.workspace_id AND p.source_version_id=v.id) passages,
       (SELECT COUNT(*) FROM source_versions x WHERE x.source_id=s.id AND x.workspace_id=s.workspace_id) versions
     FROM sources s LEFT JOIN source_versions v ON v.id=s.current_version_id AND v.workspace_id=s.workspace_id
     WHERE s.workspace_id=? AND s.course_id=? ORDER BY s.ordinal`,
    c.ws,
    courseId,
  );
}

const statusOf = (r: Row): MaterialItem['status'] =>
  r.vstatus === 'ok' && r.passages > 0 ? 'ready' : r.vstatus === 'needs_ocr' ? 'needs_text' : r.vstatus === 'superseded' ? 'superseded' : 'failed';

export function overview(c: Ctx, assignmentId: string) {
  const a = own(c.db, 'assignments', assignmentId, c.ws);
  if (!a) throw new HttpError(404, 'not_found', 'assignment not found');
  const course = own(c.db, 'courses', a.course_id, c.ws)!;
  const state = unj<Record<string, any>>(a.state, {});
  const ui = state.ui ?? {};
  const siblings = (one(c.db, 'SELECT COUNT(*) n FROM assignments WHERE workspace_id=? AND course_id=?', c.ws, a.course_id)!.n as number) ?? 1;
  const rows = sourceRows(c, a.course_id);

  const item = (r: Row, scope: MaterialItem['scope'], counted: boolean): MaterialItem => ({
    id: r.id,
    kind: r.kind,
    title: r.title,
    filename: r.filename ?? null,
    scope,
    origin: scope === 'course' ? 'From this course' : scope === 'legacy' ? 'Older course file' : 'This assignment',
    status: statusOf(r),
    error: r.error ?? null,
    passages: r.passages,
    pages: r.page_count ?? 0,
    versions: r.versions,
    date: r.doc_date ?? null,
    counted,
  });
  const mine = (r: Row) => r.assignment_id === assignmentId;
  const shared = (r: Row) => r.assignment_id == null;
  const syllabiAll = rows.filter((r) => r.kind === 'syllabus' && (mine(r) || shared(r)));
  const chosenId = ui.syllabusSourceId ?? null;
  const sharedSyl = syllabiAll.filter(shared);
  const usedSyl =
    sharedSyl.length > 1 ? (sharedSyl.find((r) => r.id === chosenId) ?? [...sharedSyl].sort((x, y) => y.created_at - x.created_at)[0]) : sharedSyl[0];
  const syllabi = syllabiAll.map((r) => item(r, mine(r) ? 'assignment' : 'course', mine(r) || r.id === usedSyl?.id));
  const legacyCounts = siblings === 1;
  const pick = (kind: string) =>
    rows.filter((r) => r.kind === kind && (mine(r) || (shared(r) && legacyCounts))).map((r) => item(r, mine(r) ? 'assignment' : 'legacy', true));
  const instructions = pick('assignment');
  const rubricFiles = pick('rubric');
  const legacyAttachable =
    siblings > 1 ? rows.filter((r) => (r.kind === 'assignment' || r.kind === 'rubric') && shared(r)).map((r) => item(r, 'legacy', false)) : [];
  const readings = rows.filter((r) => r.kind === 'reading' && (mine(r) || shared(r))).map((r) => item(r, mine(r) ? 'assignment' : 'course', true));

  const brief = getBrief(c, assignmentId);
  const instructionIds = new Set(instructions.filter((i) => i.status === 'ready').map((i) => i.id));
  const rubricIds = new Set(rubricFiles.filter((i) => i.status === 'ready').map((i) => i.id));
  const criteria = brief.items.filter((i) => i.kind === 'criterion');
  const foundInInstructions = criteria.filter((i) => instructionIds.has(i.sourceId as string));
  const foundInRubric = criteria.filter((i) => rubricIds.has(i.sourceId as string));

  const doc = one(c.db, 'SELECT id FROM documents WHERE workspace_id=? AND assignment_id=? ORDER BY created_at LIMIT 1', c.ws, assignmentId);
  let document: any = null;
  let runs: any[] = [];
  let pending = 0;
  let exportsConfirmed = 0;
  if (doc) {
    const { revision, branch } = headRevision(c, doc.id);
    const words = revision.paragraphs.reduce((n, p) => n + countWords(p.text), 0);
    document = {
      id: doc.id,
      title: own(c.db, 'documents', doc.id, c.ws)!.title,
      words,
      paragraphs: revision.paragraphs.length,
      revisionId: revision.id,
      cause: revision.cause,
      label: revision.label,
      updatedAt: revision.created_at,
      branch: branch.name,
    };
    runs = listRuns(c, doc.id, 8);
    pending =
      (one(c.db, "SELECT COUNT(*) n FROM proposals WHERE workspace_id=? AND document_id=? AND decision IN ('pending','conflict')", c.ws, doc.id)!
        .n as number) ?? 0;
    exportsConfirmed = (one(c.db, 'SELECT COUNT(*) n FROM exports WHERE workspace_id=? AND document_id=? AND confirmed=1', c.ws, doc.id)!.n as number) ?? 0;
  }
  const idea = state.idea ?? null;
  const facts: StageFacts = {
    hasInstructions: instructions.some((i) => i.status === 'ready') || brief.items.some((i) => i.kind === 'deliverable'),
    hasPlan: !!idea?.thesis,
    hasDraft: !!document && document.words > 0,
    reviewDone: runs.some((r) => r.status === 'done'),
    exportDone: exportsConfirmed > 0,
  };
  const active = runs.find((r) => ['queued', 'running', 'blocked'].includes(r.status) || r.paused) ?? null;
  return {
    assignment: { id: a.id, title: a.title, genre: a.genre, courseId: a.course_id },
    course: { id: course.id, name: course.name },
    mode: getSettings(c).mode,
    materials: {
      syllabi,
      syllabusChosenId: usedSyl?.id ?? null,
      syllabusSkipped: !!ui.skipSyllabus,
      instructions,
      rubricFiles,
      foundInInstructions,
      foundInRubric,
      readings,
      legacyAttachable,
    },
    brief,
    plan: { idea, outline: state.outline ?? null },
    document,
    review: { active, last: runs.find((r) => r.status === 'done') ?? null, pending, runs: runs.slice(0, 5) },
    exports: { confirmed: exportsConfirmed },
    ui: { resume: ui.resume ?? null },
    facts,
    entry: entryStage(facts, null, ui.resume?.stage ?? null),
    unsupportedClaims: doc ? listAudits(c, doc.id).filter((x) => x.verdict !== 'supported').length : 0,
  };
}

// ---- import ---------------------------------------------------------------------------------------
export interface ImportItem {
  kind: Kind;
  scope?: Scope;
  title?: string;
  date?: string;
  filename?: string;
  mime?: string;
  bytes?: Buffer;
  text?: string;
}
export interface ImportResult {
  name: string;
  kind: Kind;
  scope: Scope;
  status: 'ready' | 'duplicate' | 'needs_text' | 'failed' | 'replaced';
  error?: string;
  sourceId?: string;
  passages?: number;
  pages?: number;
}

/** Scope is decided here, not by the client: an assignment sheet or rubric is never shared with the whole course. */
export function scopeFor(kind: Kind, requested?: Scope): Scope {
  if (kind === 'assignment' || kind === 'rubric') return 'assignment';
  return requested === 'assignment' ? 'assignment' : kind === 'reading' ? (requested ?? 'assignment') : 'course';
}

export async function importMaterials(c: Ctx, assignmentId: string, items: ImportItem[]): Promise<ImportResult[]> {
  requireWrite(c);
  const a = own(c.db, 'assignments', assignmentId, c.ws);
  if (!a) throw new HttpError(404, 'not_found', 'assignment not found');
  if (items.length > 20) throw new HttpError(413, 'too_many', 'Add up to 20 files at a time.');
  const results: ImportResult[] = [];
  let briefRelevant = false;
  for (const it of items) {
    const name = it.filename ?? it.title ?? 'Pasted text';
    const scope = scopeFor(it.kind, it.scope);
    const base = { name, kind: it.kind, scope };
    try {
      if (!KINDS.includes(it.kind)) throw new Error('Choose a type for this file.');
      const bytes = it.bytes ?? Buffer.from(it.text ?? '', 'utf8');
      if (!bytes.length) throw new Error('This file is empty.');
      const scopeId = scope === 'assignment' ? assignmentId : null;
      const hash = sha(bytes);
      // the same bytes already imported with the same type and scope: no second copy
      const dup = one(
        c.db,
        `SELECT s.id FROM sources s JOIN source_versions v ON v.id=s.current_version_id AND v.workspace_id=s.workspace_id
         WHERE s.workspace_id=? AND s.course_id=? AND s.kind=? AND COALESCE(s.assignment_id,'')=COALESCE(?, '') AND v.file_hash=? AND v.status='ok'`,
        c.ws,
        a.course_id,
        it.kind,
        scopeId,
        hash,
      );
      if (dup) {
        results.push({ ...base, status: 'duplicate', sourceId: dup.id as string });
        continue;
      }
      // retrying a file that failed before adds a new version to the SAME source instead of leaving a dead one behind
      const failed = it.filename
        ? one(
            c.db,
            `SELECT s.id FROM sources s JOIN source_versions v ON v.id=s.current_version_id AND v.workspace_id=s.workspace_id
             WHERE s.workspace_id=? AND s.course_id=? AND s.kind=? AND COALESCE(s.assignment_id,'')=COALESCE(?, '') AND v.filename=? AND v.status IN ('unreadable','needs_ocr')`,
            c.ws,
            a.course_id,
            it.kind,
            scopeId,
            it.filename,
          )
        : undefined;
      const title = (it.title || it.filename?.replace(/\.[A-Za-z0-9]+$/, '') || (it.kind === 'assignment' ? 'Assignment instructions' : 'Pasted text')).slice(
        0,
        160,
      );
      const r = await addSource(
        c,
        {
          courseId: a.course_id,
          assignmentId: scopeId,
          kind: it.kind,
          title,
          date: it.date,
          filename: it.filename,
          mime: it.mime,
          bytes: it.bytes,
          text: it.bytes ? undefined : it.text,
        },
        failed?.id as string | undefined,
      );
      const status: ImportResult['status'] =
        r.status === 'ok' && r.passages > 0 ? (failed ? 'replaced' : 'ready') : r.status === 'needs_ocr' ? 'needs_text' : 'failed';
      results.push({ ...base, status, error: r.error, sourceId: r.sourceId, passages: r.passages, pages: r.pageCount });
      if (status === 'ready' || status === 'replaced') briefRelevant ||= it.kind !== 'reading';
    } catch (e: any) {
      results.push({ ...base, status: 'failed', error: String(e?.message ?? e).slice(0, 200) });
    }
  }
  if (briefRelevant) runBriefExtraction(c, assignmentId);
  return results;
}

/** Claim an older course-level sheet or rubric for this assignment (only meaningful when the course has several assignments). */
export function attachLegacy(c: Ctx, assignmentId: string, sourceId: string) {
  requireWrite(c);
  const a = own(c.db, 'assignments', assignmentId, c.ws);
  const s = own(c.db, 'sources', sourceId, c.ws);
  if (!a || !s || s.course_id !== a.course_id) throw new HttpError(404, 'not_found', 'source not found');
  if (s.assignment_id != null || !['assignment', 'rubric'].includes(s.kind))
    throw new HttpError(409, 'not_attachable', 'Only older course-level instructions or rubrics can be attached.');
  run(c.db, 'UPDATE sources SET assignment_id=? WHERE id=? AND workspace_id=?', assignmentId, sourceId, c.ws);
  runBriefExtraction(c, assignmentId);
}

export interface UiPatch {
  resumeStage?: string;
  syllabusSourceId?: string | null;
  skipSyllabus?: boolean;
}
export function setUiState(c: Ctx, assignmentId: string, patch: UiPatch) {
  requireWrite(c);
  const a = own(c.db, 'assignments', assignmentId, c.ws);
  if (!a) throw new HttpError(404, 'not_found', 'assignment not found');
  const cur = unj<Record<string, any>>(a.state, {}).ui ?? {};
  const next = { ...cur };
  if (patch.resumeStage !== undefined) {
    if (!isStage(patch.resumeStage)) throw new HttpError(422, 'bad_stage', 'Unknown stage.');
    next.resume = { stage: patch.resumeStage, at: clock.now() };
  }
  if (patch.skipSyllabus !== undefined) next.skipSyllabus = patch.skipSyllabus;
  let reextract = false;
  if (patch.syllabusSourceId !== undefined) {
    if (patch.syllabusSourceId) {
      const s = own(c.db, 'sources', patch.syllabusSourceId, c.ws);
      if (!s || s.course_id !== a.course_id || s.kind !== 'syllabus') throw new HttpError(404, 'not_found', 'syllabus not found');
    }
    next.syllabusSourceId = patch.syllabusSourceId;
    reextract = true;
  }
  setAssignmentState(c, assignmentId, { ui: next });
  if (reextract) runBriefExtraction(c, assignmentId);
}
