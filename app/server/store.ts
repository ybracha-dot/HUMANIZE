import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, all, clock, j, nextSeq, one, own, run, sha256, tx, uid, unj, type DB, type Row } from './db.ts';
import { parseFile, parsePasted, PARSE_VERSION, type ParseResult } from './ingest.ts';
import { extractBrief, type BriefSource } from '../shared/brief.ts';
import { applyProposal, lockViolations, relocateLocks, validateProposal, type Lock, type Para, type Proposal } from '../shared/proposals.ts';
import { compareMeaning } from '../shared/meaning.ts';
import { NEUTRAL_PROFILE, type VoiceProfile } from '../shared/voice.ts';

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}
export interface Ctx {
  db: DB;
  ws: string;
  userId: string;
  role: 'owner' | 'editor' | 'viewer';
}
export const canWrite = (c: Ctx) => c.role === 'owner' || c.role === 'editor';
export function requireWrite(c: Ctx) {
  if (!canWrite(c)) throw new HttpError(403, 'read_only', 'This workspace role is read-only.');
}
function need<T>(v: T | undefined, what: string): T {
  if (v === undefined || v === null) throw new HttpError(404, 'not_found', `${what} not found`);
  return v;
}

// ---- users and workspaces -------------------------------------------------------------------
export function createUser(db: DB, name = 'Writer', fixedToken?: string): { userId: string; workspaceId: string; token: string } {
  const token = fixedToken ?? 'st_' + sha256(uid('tok') + Math.random() + clock.now()).slice(0, 40);
  const userId = uid('usr');
  const workspaceId = uid('ws');
  tx(db, () => {
    run(db, 'INSERT INTO users(id,name,token_hash,created_at) VALUES(?,?,?,?)', userId, name, sha256(token), clock.now());
    run(db, 'INSERT INTO workspaces(id,name,owner_id,created_at) VALUES(?,?,?,?)', workspaceId, `${name}'s workspace`, userId, clock.now());
    run(db, "INSERT INTO memberships(workspace_id,user_id,role) VALUES(?,?, 'owner')", workspaceId, userId);
    run(db, 'INSERT INTO settings(workspace_id,voice_profile,mode,updated_at) VALUES(?,?,?,?)', workspaceId, j(NEUTRAL_PROFILE), 'demo', clock.now());
  });
  return { userId, workspaceId, token };
}
export function addMember(db: DB, workspaceId: string, userId: string, role: 'editor' | 'viewer') {
  run(db, 'INSERT OR REPLACE INTO memberships(workspace_id,user_id,role) VALUES(?,?,?)', workspaceId, userId, role);
}
export function resolveToken(db: DB, token: string, wanted?: string): Ctx | null {
  const u = one(db, 'SELECT id FROM users WHERE token_hash=?', sha256(token));
  if (!u) return null;
  const m = wanted
    ? one(db, 'SELECT workspace_id, role FROM memberships WHERE user_id=? AND workspace_id=?', u.id, wanted)
    : one(db, 'SELECT workspace_id, role FROM memberships WHERE user_id=? ORDER BY role LIMIT 1', u.id);
  if (!m) return null;
  return { db, ws: m.workspace_id, userId: u.id, role: m.role };
}

// ---- settings -------------------------------------------------------------------------------
export function getSettings(c: Ctx) {
  const s = one(c.db, 'SELECT * FROM settings WHERE workspace_id=?', c.ws) ?? {};
  return {
    mode: (s.mode as 'demo' | 'live') ?? 'demo',
    voiceProfile: unj<VoiceProfile>(s.voice_profile, NEUTRAL_PROFILE),
    prices: unj<
      Record<
        string,
        {
          inputPerMTok: number;
          outputPerMTok: number;
          cachedPerMTok?: number;
          rev?: string;
        }
      >
    >(s.prices, {}),
    monthlyLimitUsd: (s.monthly_limit_usd as number | null) ?? null,
    defaultBudgetUsd: (s.default_budget_usd as number | null) ?? null,
  };
}
export function updateSettings(c: Ctx, patch: Partial<ReturnType<typeof getSettings>>) {
  requireWrite(c);
  const cur = getSettings(c);
  const next = { ...cur, ...patch };
  run(
    c.db,
    'UPDATE settings SET mode=?, voice_profile=?, prices=?, monthly_limit_usd=?, default_budget_usd=?, updated_at=? WHERE workspace_id=?',
    next.mode,
    j(next.voiceProfile),
    j(next.prices),
    next.monthlyLimitUsd,
    next.defaultBudgetUsd,
    clock.now(),
    c.ws,
  );
  return getSettings(c);
}

// ---- courses / assignments ------------------------------------------------------------------
export function createCourse(c: Ctx, input: { name: string; instructor?: string; term?: string }) {
  requireWrite(c);
  const id = uid('crs');
  run(
    c.db,
    'INSERT INTO courses(id,workspace_id,name,instructor,term,created_at) VALUES(?,?,?,?,?,?)',
    id,
    c.ws,
    input.name,
    input.instructor ?? null,
    input.term ?? null,
    clock.now(),
  );
  return own(c.db, 'courses', id, c.ws)!;
}
export function createAssignment(c: Ctx, courseId: string, input: { title: string; genre?: string; language?: string }) {
  requireWrite(c);
  need(own(c.db, 'courses', courseId, c.ws), 'course');
  const id = uid('asg');
  run(
    c.db,
    'INSERT INTO assignments(id,workspace_id,course_id,title,genre,language,budget_usd,state,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
    id,
    c.ws,
    courseId,
    input.title,
    input.genre ?? 'academic_argument',
    input.language ?? 'en',
    getSettings(c).defaultBudgetUsd,
    '{}',
    clock.now(),
  );
  return own(c.db, 'assignments', id, c.ws)!;
}
export function getAssignmentState(c: Ctx, assignmentId: string): Record<string, any> {
  return unj(need(own(c.db, 'assignments', assignmentId, c.ws), 'assignment').state, {});
}
export function setAssignmentState(c: Ctx, assignmentId: string, patch: Record<string, any>) {
  requireWrite(c);
  const a = need(own(c.db, 'assignments', assignmentId, c.ws), 'assignment');
  run(c.db, 'UPDATE assignments SET state=? WHERE id=? AND workspace_id=?', j({ ...unj(a.state, {}), ...patch }), assignmentId, c.ws);
}

// ---- sources --------------------------------------------------------------------------------
export interface AddSourceInput {
  courseId: string;
  assignmentId?: string | null;
  kind: string;
  title: string;
  date?: string;
  filename?: string;
  mime?: string;
  bytes?: Buffer;
  text?: string;
}
export interface AddSourceResult {
  sourceId: string;
  versionId: string;
  status: ParseResult['status'];
  error?: string;
  passages: number;
  pageCount: number;
}

export async function addSource(c: Ctx, input: AddSourceInput, replaceSourceId?: string): Promise<AddSourceResult> {
  requireWrite(c);
  need(own(c.db, 'courses', input.courseId, c.ws), 'course');
  if (input.assignmentId) need(own(c.db, 'assignments', input.assignmentId, c.ws), 'assignment');
  const bytes = input.bytes ?? Buffer.from(input.text ?? '', 'utf8');
  const parsed: ParseResult = input.bytes ? await parseFile(input.bytes, input.filename ?? 'upload', input.mime ?? '') : parsePasted(input.text ?? '');
  const fileHash = sha256(bytes);
  fs.mkdirSync(path.join(DATA_DIR, 'files'), { recursive: true, mode: 0o700 });
  if (parsed.status !== 'unreadable' || bytes.length < 25 * 1048576)
    fs.writeFileSync(path.join(DATA_DIR, 'files', `${c.ws}_${fileHash}`), bytes, { mode: 0o600 });
  return tx(c.db, () => {
    let sourceId = replaceSourceId;
    let ordinal: number;
    if (sourceId) {
      const s = need(own(c.db, 'sources', sourceId, c.ws), 'source');
      ordinal = s.ordinal;
      const prev = s.current_version_id as string | null;
      if (prev) {
        run(
          c.db,
          "UPDATE source_versions SET status='superseded', superseded_at=? WHERE id=? AND workspace_id=? AND status IN ('ok','needs_ocr','unreadable')",
          clock.now(),
          prev,
          c.ws,
        );
        // evidence that cited the old version is now stale; accepted text is untouched
        run(
          c.db,
          'UPDATE claim_audits SET stale=1 WHERE workspace_id=? AND passage_id IN (SELECT id FROM passages WHERE workspace_id=? AND source_version_id=?)',
          c.ws,
          c.ws,
          prev,
        );
      }
    } else {
      sourceId = uid('srcrow');
      ordinal = nextSeq(c.db, c.ws, 'source');
      run(
        c.db,
        'INSERT INTO sources(id,workspace_id,course_id,assignment_id,kind,title,doc_date,ordinal,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
        sourceId,
        c.ws,
        input.courseId,
        input.assignmentId ?? null,
        input.kind,
        input.title,
        input.date ?? null,
        ordinal,
        clock.now(),
      );
    }
    const versionId = uid('sv');
    run(
      c.db,
      'INSERT INTO source_versions(id,workspace_id,source_id,file_hash,parse_version,filename,mime,size,status,error,page_count,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
      versionId,
      c.ws,
      sourceId,
      fileHash,
      PARSE_VERSION,
      input.filename ?? null,
      parsed.mime,
      bytes.length,
      parsed.status,
      parsed.error ?? null,
      parsed.pageCount,
      clock.now(),
    );
    run(
      c.db,
      'UPDATE sources SET current_version_id=?, title=COALESCE(?,title), doc_date=COALESCE(?,doc_date) WHERE id=? AND workspace_id=?',
      versionId,
      input.title || null,
      input.date ?? null,
      sourceId,
      c.ws,
    );
    // Passage ids stay stable per source ordinal; a replaced version gets a version suffix so old evidence stays addressable.
    const versionNo = one(c.db, 'SELECT COUNT(*) n FROM source_versions WHERE source_id=? AND workspace_id=?', sourceId, c.ws)!.n as number;
    const prefix = versionNo > 1 ? `src_${ordinal}v${versionNo}_p` : `src_${ordinal}_p`;
    parsed.passages.forEach((p, i) => {
      run(
        c.db,
        'INSERT INTO passages(workspace_id,id,course_id,assignment_id,source_id,source_version_id,page_index,page_label,section,para_index,ord,text,page_offset) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
        c.ws,
        `${prefix}${String(i + 1).padStart(2, '0')}`,
        input.courseId,
        input.assignmentId ?? null,
        sourceId,
        versionId,
        p.pageIndex,
        p.pageLabel,
        p.section,
        p.paraIndex,
        i,
        p.text,
        p.pageOffset,
      );
    });
    return {
      sourceId: sourceId!,
      versionId,
      status: parsed.status,
      error: parsed.error,
      passages: parsed.passages.length,
      pageCount: parsed.pageCount,
    };
  });
}

/** Manual passage entry for scanned PDFs: stored against the current version with the page numbers the writer supplies. */
export function addManualPassage(c: Ctx, sourceId: string, input: { text: string; pageIndex: number; pageLabel?: string | null }) {
  requireWrite(c);
  const s = need(own(c.db, 'sources', sourceId, c.ws), 'source');
  const n = (one(c.db, 'SELECT COUNT(*) n FROM passages WHERE workspace_id=? AND source_version_id=?', c.ws, s.current_version_id)!.n as number) + 1;
  const id = `src_${s.ordinal}_p${String(n).padStart(2, '0')}`;
  run(
    c.db,
    'INSERT INTO passages(workspace_id,id,course_id,assignment_id,source_id,source_version_id,page_index,page_label,section,para_index,ord,text,page_offset) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
    c.ws,
    id,
    s.course_id,
    s.assignment_id,
    sourceId,
    s.current_version_id,
    input.pageIndex,
    input.pageLabel ?? null,
    'manual entry',
    n,
    n,
    input.text,
    0,
  );
  run(
    c.db,
    "UPDATE source_versions SET status='ok', error=NULL WHERE id=? AND workspace_id=? AND status IN ('needs_ocr','unreadable')",
    s.current_version_id,
    c.ws,
  );
  return { id };
}

export function listSources(c: Ctx, courseId: string) {
  need(own(c.db, 'courses', courseId, c.ws), 'course');
  return all(
    c.db,
    `SELECT s.id, s.kind, s.title, s.doc_date, s.ordinal, s.assignment_id, v.id version_id, v.status, v.error, v.page_count, v.filename, v.file_hash, v.created_at version_created,
      (SELECT COUNT(*) FROM source_versions WHERE source_id=s.id AND workspace_id=s.workspace_id) versions,
      (SELECT COUNT(*) FROM passages WHERE workspace_id=s.workspace_id AND source_version_id=v.id) passages
    FROM sources s LEFT JOIN source_versions v ON v.id=s.current_version_id WHERE s.workspace_id=? AND s.course_id=? ORDER BY s.ordinal`,
    c.ws,
    courseId,
  );
}

export function getSourceDetail(c: Ctx, sourceId: string, versionId?: string) {
  const s = need(own(c.db, 'sources', sourceId, c.ws), 'source');
  const vid = versionId ?? s.current_version_id;
  const version = need(one(c.db, 'SELECT * FROM source_versions WHERE id=? AND workspace_id=? AND source_id=?', vid, c.ws, sourceId), 'source version');
  const passages = all(
    c.db,
    'SELECT id, page_index, page_label, section, para_index, text FROM passages WHERE workspace_id=? AND source_version_id=? ORDER BY ord',
    c.ws,
    vid,
  );
  const versions = all(
    c.db,
    'SELECT id, status, created_at, superseded_at, file_hash FROM source_versions WHERE source_id=? AND workspace_id=? ORDER BY created_at',
    sourceId,
    c.ws,
  );
  return {
    source: s,
    version,
    versions,
    passages,
    stale: version.status === 'superseded',
  };
}

export function getPassage(c: Ctx, passageId: string) {
  const p = need(one(c.db, 'SELECT * FROM passages WHERE workspace_id=? AND id=?', c.ws, passageId), 'passage');
  const src = one(c.db, 'SELECT s.id, s.title, s.kind, s.doc_date, s.current_version_id FROM sources s WHERE s.id=? AND s.workspace_id=?', p.source_id, c.ws)!;
  const ver = one(c.db, 'SELECT status FROM source_versions WHERE id=? AND workspace_id=?', p.source_version_id, c.ws)!;
  return {
    ...p,
    source: src,
    stale: ver.status === 'superseded' || src.current_version_id !== p.source_version_id,
  };
}

export interface EvidencePassage {
  id: string;
  text: string;
  unreadable?: boolean;
  stale?: boolean;
  sourceTitle: string;
  pageIndex: number;
  pageLabel: string | null;
}
/** Passages the verifier may cite: readings of this assignment's course (and assignment-scoped readings), current versions only. Always tenant- and course-scoped. */
export function evidencePassages(c: Ctx, assignmentId: string): EvidencePassage[] {
  const a = need(own(c.db, 'assignments', assignmentId, c.ws), 'assignment');
  const rows = all(
    c.db,
    `SELECT p.id, p.text, p.page_index, p.page_label, s.title, v.status FROM passages p
    JOIN sources s ON s.id=p.source_id AND s.workspace_id=p.workspace_id
    JOIN source_versions v ON v.id=p.source_version_id AND v.workspace_id=p.workspace_id
    WHERE p.workspace_id=? AND p.course_id=? AND (p.assignment_id IS NULL OR p.assignment_id=?) AND s.kind='reading' AND s.current_version_id=p.source_version_id
    ORDER BY s.ordinal, p.ord`,
    c.ws,
    a.course_id,
    assignmentId,
  );
  return rows.map((r) => ({
    id: r.id,
    text: r.text,
    unreadable: r.status !== 'ok',
    sourceTitle: r.title,
    pageIndex: r.page_index,
    pageLabel: r.page_label,
  }));
}
export function searchPassages(c: Ctx, assignmentId: string, q: string, limit = 8) {
  // lazy import to keep the server graph acyclic
  const passages = evidencePassages(c, assignmentId);
  return import('../shared/evidence.ts').then(({ PassageIndex }) =>
    new PassageIndex(passages).search(q, limit).map((r) => ({
      ...passages.find((p) => p.id === r.passage.id)!,
      score: Math.round(r.score * 100) / 100,
    })),
  );
}

// ---- assignment brief -----------------------------------------------------------------------
export function runBriefExtraction(c: Ctx, assignmentId: string) {
  requireWrite(c);
  const a = need(own(c.db, 'assignments', assignmentId, c.ws), 'assignment');
  const sources = all(
    c.db,
    `SELECT s.id, s.title, s.kind, s.doc_date FROM sources s WHERE s.workspace_id=? AND s.course_id=? AND (s.assignment_id IS NULL OR s.assignment_id=?) AND s.kind IN ('syllabus','assignment','rubric') ORDER BY s.ordinal`,
    c.ws,
    a.course_id,
    assignmentId,
  );
  const bs: BriefSource[] = sources.map((s) => ({
    sourceId: s.id,
    title: s.title,
    kind: s.kind,
    date: s.doc_date ?? undefined,
    passages: all(
      c.db,
      'SELECT p.id, p.text FROM passages p JOIN sources x ON x.id=p.source_id AND x.workspace_id=p.workspace_id WHERE p.workspace_id=? AND p.source_id=? AND p.source_version_id=x.current_version_id ORDER BY p.ord',
      c.ws,
      s.id,
    ).map((p) => ({ id: p.id, text: p.text })),
  }));
  const result = extractBrief(bs);
  tx(c.db, () => {
    run(c.db, 'DELETE FROM brief_items WHERE workspace_id=? AND assignment_id=?', c.ws, assignmentId);
    for (const it of result.items) {
      run(
        c.db,
        'INSERT INTO brief_items(id,workspace_id,assignment_id,kind,key,label,value,data,source_id,source_title,passage_id,quote,start,end,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        uid('bi'),
        c.ws,
        assignmentId,
        it.kind,
        it.key,
        it.label,
        it.value,
        j(it.data),
        it.sourceId,
        it.sourceTitle,
        it.passageId,
        it.quote,
        it.start,
        it.end,
        'extracted',
        clock.now(),
      );
    }
  });
  return getBrief(c, assignmentId, result);
}

export function getBrief(c: Ctx, assignmentId: string, fresh?: ReturnType<typeof extractBrief>) {
  need(own(c.db, 'assignments', assignmentId, c.ws), 'assignment');
  const rows = all(c.db, 'SELECT * FROM brief_items WHERE workspace_id=? AND assignment_id=? ORDER BY kind, rowid', c.ws, assignmentId);
  const corrections = all(c.db, 'SELECT * FROM brief_corrections WHERE workspace_id=? AND assignment_id=?', c.ws, assignmentId);
  const resolutions = all(c.db, 'SELECT * FROM brief_resolutions WHERE workspace_id=? AND assignment_id=?', c.ws, assignmentId);
  const items = rows.map((r) => {
    const corr = corrections.find((x) => x.kind === r.kind && x.key === r.key);
    return {
      id: r.id,
      kind: r.kind,
      key: r.key,
      label: r.label,
      value: corr?.value ?? r.value,
      extractedValue: r.value,
      data: unj(corr?.data ?? r.data, {}),
      status: corr?.status ?? r.status,
      sourceId: r.source_id,
      sourceTitle: r.source_title,
      passageId: r.passage_id,
      quote: r.quote,
      start: r.start,
      end: r.end,
    };
  });
  // Conflicts/missing recomputed from stored items so corrections and resolutions are honored.
  const re = fresh ?? recompute(c, assignmentId);
  const conflicts = re.conflicts.map((cf) => ({
    ...cf,
    resolution: resolutions.find((r) => r.kind === cf.kind) ?? null,
  }));
  return {
    items,
    missing: re.missing,
    conflicts,
    corrections: corrections.length,
  };
}
function recompute(c: Ctx, assignmentId: string) {
  const a = own(c.db, 'assignments', assignmentId, c.ws)!;
  const sources = all(
    c.db,
    `SELECT s.id, s.title, s.kind, s.doc_date FROM sources s WHERE s.workspace_id=? AND s.course_id=? AND (s.assignment_id IS NULL OR s.assignment_id=?) AND s.kind IN ('syllabus','assignment','rubric') ORDER BY s.ordinal`,
    c.ws,
    a.course_id,
    assignmentId,
  );
  return extractBrief(
    sources.map((s) => ({
      sourceId: s.id,
      title: s.title,
      kind: s.kind,
      date: s.doc_date ?? undefined,
      passages: all(
        c.db,
        'SELECT p.id, p.text FROM passages p JOIN sources x ON x.id=p.source_id AND x.workspace_id=p.workspace_id WHERE p.workspace_id=? AND p.source_id=? AND p.source_version_id=x.current_version_id ORDER BY p.ord',
        c.ws,
        s.id,
      ).map((p) => ({ id: p.id, text: p.text })),
    })),
  );
}
export function correctBrief(
  c: Ctx,
  assignmentId: string,
  input: {
    kind: string;
    key: string;
    value: string;
    status?: 'confirmed' | 'corrected' | 'rejected';
  },
) {
  requireWrite(c);
  need(own(c.db, 'assignments', assignmentId, c.ws), 'assignment');
  run(
    c.db,
    'INSERT INTO brief_corrections(workspace_id,assignment_id,kind,key,value,data,status) VALUES(?,?,?,?,?,?,?) ON CONFLICT(assignment_id,kind,key) DO UPDATE SET value=excluded.value, status=excluded.status',
    c.ws,
    assignmentId,
    input.kind,
    input.key,
    input.value,
    null,
    input.status ?? 'corrected',
  );
}
export function resolveConflict(c: Ctx, assignmentId: string, input: { kind: string; chosenSourceId: string; note?: string }) {
  requireWrite(c);
  need(own(c.db, 'assignments', assignmentId, c.ws), 'assignment');
  run(
    c.db,
    'INSERT INTO brief_resolutions(workspace_id,assignment_id,kind,chosen_source_id,note) VALUES(?,?,?,?,?) ON CONFLICT(assignment_id,kind) DO UPDATE SET chosen_source_id=excluded.chosen_source_id, note=excluded.note',
    c.ws,
    assignmentId,
    input.kind,
    input.chosenSourceId,
    input.note ?? null,
  );
}

// ---- feedback memory ------------------------------------------------------------------------
export function addFeedback(
  c: Ctx,
  courseId: string,
  input: {
    comment: string;
    instructor?: string;
    assignmentId?: string;
    linkedParagraph?: string;
    explanation?: string;
    scope?: 'one_off' | 'recurring' | 'irrelevant';
  },
) {
  requireWrite(c);
  const course = need(own(c.db, 'courses', courseId, c.ws), 'course');
  const id = uid('fb');
  run(
    c.db,
    'INSERT INTO feedback_rules(id,workspace_id,course_id,instructor,assignment_id,comment,linked_paragraph,explanation,scope,confirmed,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
    id,
    c.ws,
    courseId,
    input.instructor ?? course.instructor ?? null,
    input.assignmentId ?? null,
    input.comment,
    input.linkedParagraph ?? null,
    input.explanation ?? null,
    input.scope ?? 'one_off',
    0,
    clock.now(),
  );
  return own(c.db, 'feedback_rules', id, c.ws)!;
}
export function setFeedbackScope(c: Ctx, id: string, scope: 'one_off' | 'recurring' | 'irrelevant') {
  requireWrite(c);
  need(own(c.db, 'feedback_rules', id, c.ws), 'feedback');
  run(c.db, 'UPDATE feedback_rules SET scope=?, confirmed=1 WHERE id=? AND workspace_id=?', scope, id, c.ws);
}
/** Only confirmed recurring rules from the same course are ever offered to a review. One rejected suggestion never creates a rule. */
export function confirmedPreferences(c: Ctx, courseId: string) {
  return all(
    c.db,
    "SELECT id, comment, instructor, explanation FROM feedback_rules WHERE workspace_id=? AND course_id=? AND scope='recurring' AND confirmed=1",
    c.ws,
    courseId,
  );
}
export function listFeedback(c: Ctx, courseId: string) {
  need(own(c.db, 'courses', courseId, c.ws), 'course');
  return all(c.db, 'SELECT * FROM feedback_rules WHERE workspace_id=? AND course_id=? ORDER BY created_at DESC', c.ws, courseId);
}

// ---- documents, revisions, branches ---------------------------------------------------------
export const paraId = () => uid('p');
/** Paragraphs are single-line text: a line break inside a paragraph (e.g. copied from a PDF) becomes one space, so DOCX/TXT export is exact. */
export const normalizeParagraph = (t: string) => t.replace(/[ \t]*\r?\n[ \t]*/g, ' ');
export const textHash = (paras: Para[]) => sha256(paras.map((p) => p.text).join('\n\n'));
export const joinText = (paras: Para[]) => paras.map((p) => p.text).join('\n\n');

export function textToParas(text: string): Para[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((t) => normalizeParagraph(t.trim()))
    .filter(Boolean)
    .map((t) => ({ id: paraId(), text: t }));
}

export function logEvent(c: Ctx, documentId: string, kind: string, data: Record<string, unknown> = {}) {
  run(
    c.db,
    'INSERT INTO events(id,workspace_id,document_id,kind,data,user_id,created_at) VALUES(?,?,?,?,?,?,?)',
    uid('ev'),
    c.ws,
    documentId,
    kind,
    j(data),
    c.userId,
    clock.now(),
  );
}

export function createDocument(c: Ctx, assignmentId: string, input: { title?: string; text?: string; paragraphs?: Para[]; cause?: string }) {
  requireWrite(c);
  const a = need(own(c.db, 'assignments', assignmentId, c.ws), 'assignment');
  const paras = (input.paragraphs ?? textToParas(input.text ?? '')).map((p) => ({ ...p, text: normalizeParagraph(p.text) }));
  const final = paras.length ? paras : [{ id: paraId(), text: '' }];
  return tx(c.db, () => {
    const docId = uid('doc');
    const branchId = uid('br');
    const revId = uid('rev');
    run(
      c.db,
      'INSERT INTO documents(id,workspace_id,assignment_id,title,active_branch_id,created_at) VALUES(?,?,?,?,?,?)',
      docId,
      c.ws,
      assignmentId,
      input.title ?? a.title,
      branchId,
      clock.now(),
    );
    run(
      c.db,
      'INSERT INTO branches(id,workspace_id,document_id,name,head_revision_id,created_at) VALUES(?,?,?,?,?,?)',
      branchId,
      c.ws,
      docId,
      'main',
      revId,
      clock.now(),
    );
    run(
      c.db,
      'INSERT INTO revisions(id,workspace_id,document_id,branch_id,parent_id,paragraphs,text_hash,cause,label,meta,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
      revId,
      c.ws,
      docId,
      branchId,
      null,
      j(final),
      textHash(final),
      input.cause ?? 'import',
      'Starting version',
      '{}',
      clock.now(),
    );
    const words = joinText(final).split(/\s+/).filter(Boolean).length;
    logEvent(c, docId, input.cause === 'draft' ? 'draft_generated' : 'import', {
      words,
      chars: joinText(final).length,
      source: input.cause ?? 'paste',
      note: 'Text arrived whole; earlier edits were not observed.',
    });
    return docId;
  });
}

export function getDocumentRow(c: Ctx, docId: string) {
  return need(own(c.db, 'documents', docId, c.ws), 'document');
}

export type RevisionRow = Row & {
  id: string;
  document_id: string;
  branch_id: string;
  text_hash: string;
  label: string | null;
  cause: string;
  paragraphs: Para[];
  meta: Record<string, any>;
};
export function revisionRow(c: Ctx, revId: string): RevisionRow {
  const r = need(own(c.db, 'revisions', revId, c.ws), 'revision');
  return {
    ...r,
    paragraphs: unj<Para[]>(r.paragraphs, []),
    meta: unj<Record<string, any>>(r.meta, {}),
  } as RevisionRow;
}

export function headRevision(c: Ctx, docId: string, branchId?: string) {
  const d = getDocumentRow(c, docId);
  const b = need(one(c.db, 'SELECT * FROM branches WHERE id=? AND workspace_id=? AND document_id=?', branchId ?? d.active_branch_id, c.ws, docId), 'branch');
  return { branch: b, revision: revisionRow(c, b.head_revision_id) };
}

export function activeLocks(c: Ctx, docId: string): Lock[] {
  return all(c.db, 'SELECT * FROM locks WHERE workspace_id=? AND document_id=? AND released_at IS NULL ORDER BY created_at', c.ws, docId).map((l) => ({
    id: l.id,
    paragraphId: l.paragraph_id,
    kind: l.kind,
    text: l.text,
    start: l.start,
    end: l.end,
    note: l.note ?? undefined,
    thesis: !!l.thesis,
  }));
}

export function addLock(
  c: Ctx,
  docId: string,
  input: {
    paragraphId: string;
    kind: 'paragraph' | 'span';
    start?: number;
    end?: number;
    note?: string;
    thesis?: boolean;
  },
) {
  requireWrite(c);
  const { revision } = headRevision(c, docId);
  const para = need(
    revision.paragraphs.find((p) => p.id === input.paragraphId),
    'paragraph',
  );
  const start = input.kind === 'paragraph' ? 0 : (input.start ?? 0);
  const end = input.kind === 'paragraph' ? para.text.length : (input.end ?? 0);
  if (end <= start || end > para.text.length) throw new HttpError(422, 'bad_range', 'Lock range is outside the paragraph.');
  const id = uid('lock');
  run(
    c.db,
    'INSERT INTO locks(id,workspace_id,document_id,paragraph_id,kind,text,start,end,note,thesis,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
    id,
    c.ws,
    docId,
    input.paragraphId,
    input.kind,
    para.text.slice(start, end),
    start,
    end,
    input.note ?? null,
    input.thesis ? 1 : 0,
    clock.now(),
  );
  logEvent(c, docId, 'lock_added', {
    kind: input.kind,
    thesis: !!input.thesis,
  });
  return activeLocks(c, docId).find((l) => l.id === id)!;
}
export function removeLock(c: Ctx, docId: string, lockId: string) {
  requireWrite(c);
  need(own(c.db, 'locks', lockId, c.ws), 'lock');
  run(c.db, 'UPDATE locks SET released_at=? WHERE id=? AND workspace_id=? AND document_id=?', clock.now(), lockId, c.ws, docId);
  logEvent(c, docId, 'lock_removed', {});
}
export function addLockNote(c: Ctx, lockId: string, note: string, source = 'reviewer') {
  requireWrite(c);
  need(own(c.db, 'locks', lockId, c.ws), 'lock');
  run(c.db, 'INSERT INTO lock_notes(id,workspace_id,lock_id,note,source,created_at) VALUES(?,?,?,?,?,?)', uid('ln'), c.ws, lockId, note, source, clock.now());
}

function commitRevision(
  c: Ctx,
  docId: string,
  branchId: string,
  parentId: string,
  paragraphs: Para[],
  cause: string,
  label: string,
  meta: Record<string, any> = {},
): string {
  const id = uid('rev');
  run(
    c.db,
    'INSERT INTO revisions(id,workspace_id,document_id,branch_id,parent_id,paragraphs,text_hash,cause,label,meta,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
    id,
    c.ws,
    docId,
    branchId,
    parentId,
    j(paragraphs),
    textHash(paragraphs),
    cause,
    label,
    j(meta),
    clock.now(),
  );
  run(c.db, 'UPDATE branches SET head_revision_id=? WHERE id=? AND workspace_id=?', id, branchId, c.ws);
  // keep span locks pointing at their text; release a lock if its text was removed by a manual edit
  for (const l of relocateLocks(paragraphs, activeLocks(c, docId))) {
    const para = paragraphs.find((p) => p.id === l.paragraphId);
    const gone = !para || (l.kind === 'paragraph' ? false : !para.text.includes(l.text));
    if (gone) run(c.db, 'UPDATE locks SET released_at=? WHERE id=? AND workspace_id=?', clock.now(), l.id, c.ws);
    else
      run(
        c.db,
        "UPDATE locks SET start=?, end=?, text=CASE WHEN kind='paragraph' THEN ? ELSE text END WHERE id=? AND workspace_id=?",
        l.kind === 'paragraph' ? 0 : l.start,
        l.kind === 'paragraph' ? (para?.text.length ?? 0) : l.end,
        para?.text ?? '',
        l.id,
        c.ws,
      );
  }
  return id;
}

/** Student edits from the editor. Optimistic concurrency on the branch head; identical text is a no-op. */
export function saveRevision(
  c: Ctx,
  docId: string,
  input: {
    baseRevisionId: string;
    paragraphs: Para[];
    label?: string;
    cause?: string;
    branchId?: string;
  },
) {
  requireWrite(c);
  return tx(c.db, () => {
    const { branch, revision } = headRevision(c, docId, input.branchId);
    if (revision.id !== input.baseRevisionId)
      throw new HttpError(409, 'stale_revision', 'The document changed in another tab or by a reviewer. Reload before saving.', { head: revision.id });
    let paras = input.paragraphs
      .map((p) => ({
        id: p.id || paraId(),
        text: normalizeParagraph(p.text),
        ...(p.kind ? { kind: p.kind } : {}),
      }))
      .filter((p) => p.text.trim());
    if (!paras.length) paras = [{ id: paraId(), text: '' }];
    if (textHash(paras) === revision.text_hash) return { revisionId: revision.id, unchanged: true };
    const id = commitRevision(c, docId, branch.id, revision.id, paras, input.cause ?? 'manual', input.label ?? 'Saved version');
    return { revisionId: id, unchanged: false };
  });
}

export function restoreRevision(c: Ctx, docId: string, revisionId: string) {
  requireWrite(c);
  return tx(c.db, () => {
    const target = revisionRow(c, revisionId);
    if (target.document_id !== docId) throw new HttpError(404, 'not_found', 'revision not found');
    const { branch, revision } = headRevision(c, docId);
    const id = commitRevision(c, docId, branch.id, revision.id, target.paragraphs, 'restore', `Restored ${target.label ?? target.id}`, {
      restoredFrom: revisionId,
    });
    logEvent(c, docId, 'restore', { from: revisionId, to: id });
    return { revisionId: id };
  });
}

export function createBranch(c: Ctx, docId: string, input: { name: string; fromRevisionId?: string; makeActive?: boolean }) {
  requireWrite(c);
  return tx(c.db, () => {
    const d = getDocumentRow(c, docId);
    const from = input.fromRevisionId ? revisionRow(c, input.fromRevisionId) : headRevision(c, docId).revision;
    const id = uid('br');
    run(
      c.db,
      'INSERT INTO branches(id,workspace_id,document_id,name,head_revision_id,parent_branch_id,created_at) VALUES(?,?,?,?,?,?,?)',
      id,
      c.ws,
      docId,
      input.name,
      from.id,
      d.active_branch_id,
      clock.now(),
    );
    if (input.makeActive) run(c.db, 'UPDATE documents SET active_branch_id=? WHERE id=? AND workspace_id=?', id, docId, c.ws);
    return id;
  });
}
export function switchBranch(c: Ctx, docId: string, branchId: string) {
  requireWrite(c);
  need(one(c.db, 'SELECT id FROM branches WHERE id=? AND workspace_id=? AND document_id=?', branchId, c.ws, docId), 'branch');
  run(c.db, 'UPDATE documents SET active_branch_id=? WHERE id=? AND workspace_id=?', branchId, docId, c.ws);
}
/** Take one paragraph from another revision into the active branch (compare view). */
export function takeParagraph(
  c: Ctx,
  docId: string,
  input: {
    fromRevisionId: string;
    paragraphId: string;
    idempotencyKey: string;
  },
) {
  requireWrite(c);
  return tx(c.db, () => {
    const prior = one(c.db, 'SELECT * FROM decisions WHERE workspace_id=? AND idempotency_key=?', c.ws, input.idempotencyKey);
    if (prior) return { revisionId: prior.revision_id as string, replayed: true };
    const src = revisionRow(c, input.fromRevisionId);
    if (src.document_id !== docId) throw new HttpError(404, 'not_found', 'revision not found');
    const sp = need(
      src.paragraphs.find((p) => p.id === input.paragraphId),
      'paragraph',
    );
    const { branch, revision } = headRevision(c, docId);
    const locks = activeLocks(c, docId);
    if (locks.some((l) => l.paragraphId === input.paragraphId)) throw new HttpError(409, 'locked', 'That paragraph has locked text. Unlock it first.');
    let paras = [...revision.paragraphs];
    const at = paras.findIndex((p) => p.id === sp.id);
    if (at >= 0) paras[at] = { ...paras[at], text: sp.text };
    else {
      const srcIdx = src.paragraphs.findIndex((p) => p.id === sp.id);
      const prevId = src.paragraphs[srcIdx - 1]?.id;
      const insertAt = prevId ? paras.findIndex((p) => p.id === prevId) + 1 : 0;
      paras = [...paras.slice(0, insertAt), { id: sp.id, text: sp.text }, ...paras.slice(insertAt)];
    }
    const id = commitRevision(c, docId, branch.id, revision.id, paras, 'take_paragraph', 'Took a paragraph from another version', {
      from: input.fromRevisionId,
      paragraphId: sp.id,
    });
    run(
      c.db,
      'INSERT INTO decisions(id,workspace_id,proposal_id,document_id,action,revision_id,idempotency_key,user_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
      uid('dec'),
      c.ws,
      null,
      docId,
      'take_paragraph',
      id,
      input.idempotencyKey,
      c.userId,
      clock.now(),
    );
    logEvent(c, docId, 'take_paragraph', { from: input.fromRevisionId });
    return { revisionId: id, replayed: false };
  });
}

export function history(c: Ctx, docId: string) {
  getDocumentRow(c, docId);
  const revs = all(
    c.db,
    'SELECT id, branch_id, parent_id, text_hash, cause, label, meta, created_at FROM revisions WHERE workspace_id=? AND document_id=? ORDER BY created_at, rowid',
    c.ws,
    docId,
  ).map((r): Row => ({ ...r, meta: unj(r.meta, {}) }));
  const branches = all(c.db, 'SELECT * FROM branches WHERE workspace_id=? AND document_id=? ORDER BY created_at', c.ws, docId);
  const decisions = all(c.db, 'SELECT * FROM decisions WHERE workspace_id=? AND document_id=? ORDER BY created_at, rowid', c.ws, docId);
  return { revisions: revs, branches, decisions };
}

// ---- proposals and atomic decisions ---------------------------------------------------------
export function insertProposals(
  c: Ctx,
  docId: string,
  runId: string | null,
  items: (Omit<Proposal, 'id'> & {
    rank?: number;
    disagreement?: unknown;
    critic?: unknown;
  })[],
) {
  const ids: string[] = [];
  for (const p of items) {
    const id = uid('prop');
    run(
      c.db,
      'INSERT INTO proposals(id,workspace_id,document_id,run_id,base_revision,paragraph_id,original,replacement,issue,reason,criterion_id,evidence,meaning_change,requires_decision,start,verifier,findings,provider,policy_version,context_before,context_after,decision,rank,disagreement,critic,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      id,
      c.ws,
      docId,
      runId,
      p.baseRevision,
      p.paragraphId,
      p.original,
      p.replacement,
      p.issue,
      p.reason ?? '',
      p.rubricCriterionId ?? null,
      j(p.evidence),
      p.meaningChange,
      p.requiresDecision ? 1 : 0,
      p.start,
      p.verifier,
      j(p.findings),
      p.provider,
      p.policyVersion,
      p.contextBefore,
      p.contextAfter,
      'pending',
      p.rank ?? null,
      j(p.disagreement ?? null),
      j(p.critic ?? null),
      clock.now(),
    );
    ids.push(id);
  }
  return ids;
}

function proposalOut(r: Row) {
  return {
    id: r.id,
    documentId: r.document_id,
    runId: r.run_id,
    baseRevision: r.base_revision,
    paragraphId: r.paragraph_id,
    original: r.original,
    replacement: r.replacement,
    issue: r.issue,
    reason: r.reason,
    rubricCriterionId: r.criterion_id,
    evidence: unj(r.evidence, []),
    meaningChange: r.meaning_change,
    requiresDecision: !!r.requires_decision,
    start: r.start,
    verifier: r.verifier,
    findings: unj(r.findings, []),
    provider: r.provider,
    policyVersion: r.policy_version,
    contextBefore: r.context_before,
    contextAfter: r.context_after,
    decision: r.decision,
    rank: r.rank,
    disagreement: unj(r.disagreement, null),
    critic: unj(r.critic, null),
    createdAt: r.created_at,
    resolvedAt: r.resolved_at,
  };
}
export function listProposals(c: Ctx, docId: string, decision?: string) {
  getDocumentRow(c, docId);
  const rows = decision
    ? all(c.db, 'SELECT * FROM proposals WHERE workspace_id=? AND document_id=? AND decision=? ORDER BY COALESCE(rank,99), created_at', c.ws, docId, decision)
    : all(c.db, 'SELECT * FROM proposals WHERE workspace_id=? AND document_id=? ORDER BY created_at DESC, COALESCE(rank,99)', c.ws, docId);
  const { revision } = headRevision(c, docId);
  const locks = activeLocks(c, docId);
  return rows.map(proposalOut).map((p) => ({
    ...p,
    applicable: p.decision === 'pending' ? applyProposal(p, revision.paragraphs, locks).ok : null,
  }));
}

export interface DecisionResult {
  status: 'accepted' | 'rejected' | 'edited' | 'conflict';
  revisionId?: string;
  replayed?: boolean;
  conflict?: {
    reason: string;
    detail: string;
    baseText: string | null;
    headText: string | null;
    replacement: string;
  };
}

export function decideProposal(
  c: Ctx,
  proposalId: string,
  input: {
    action: 'accept' | 'reject' | 'edit';
    finalText?: string;
    idempotencyKey: string;
    note?: string;
  },
): DecisionResult {
  requireWrite(c);
  return tx(c.db, () => {
    const prior = one(c.db, 'SELECT * FROM decisions WHERE workspace_id=? AND idempotency_key=?', c.ws, input.idempotencyKey);
    if (prior)
      return {
        status: (prior.action === 'accept' ? 'accepted' : prior.action === 'reject' ? 'rejected' : 'edited') as DecisionResult['status'],
        revisionId: prior.revision_id ?? undefined,
        replayed: true,
      };
    const row = need(own(c.db, 'proposals', proposalId, c.ws), 'proposal');
    const prop = proposalOut(row);
    if (prop.decision !== 'pending' && prop.decision !== 'conflict') {
      // a second click with a different key lands here: report the existing resolution, create nothing
      const d = one(c.db, 'SELECT * FROM decisions WHERE workspace_id=? AND proposal_id=? ORDER BY created_at DESC', c.ws, proposalId);
      return {
        status: prop.decision as DecisionResult['status'],
        revisionId: d?.revision_id ?? undefined,
        replayed: true,
      };
    }
    const baseRev = revisionRow(c, prop.baseRevision);
    const { branch, revision: head } = headRevision(c, prop.documentId); // the document's active branch
    if (input.action === 'reject') {
      run(c.db, "UPDATE proposals SET decision='rejected', resolved_at=? WHERE id=? AND workspace_id=?", clock.now(), proposalId, c.ws);
      run(
        c.db,
        'INSERT INTO decisions(id,workspace_id,proposal_id,document_id,action,revision_id,idempotency_key,user_id,note,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
        uid('dec'),
        c.ws,
        proposalId,
        prop.documentId,
        'reject',
        null,
        input.idempotencyKey,
        c.userId,
        input.note ?? null,
        clock.now(),
      );
      logEvent(c, prop.documentId, 'suggestion_rejected', {
        proposalId,
        issue: prop.issue,
        provider: prop.provider,
      });
      return { status: 'rejected' };
    }
    const replacement = input.action === 'edit' ? (input.finalText ?? '') : prop.replacement;
    if (input.action === 'edit' && !replacement.trim()) throw new HttpError(422, 'empty_edit', 'Edited text cannot be empty.');
    const locks = activeLocks(c, prop.documentId);
    const applied = applyProposal({ ...prop, replacement }, head.paragraphs, locks);
    const baseText = baseRev.paragraphs.find((p) => p.id === prop.paragraphId)?.text ?? null;
    // A change accepted since this suggestion was made that touched the same range is a conflict even if the original text
    // is still present (e.g. the first edit extended the sentence). Never silently stack two rewrites of one sentence.
    const clash =
      applied.ok &&
      all(
        c.db,
        "SELECT start, original, base_revision FROM proposals WHERE workspace_id=? AND document_id=? AND paragraph_id=? AND decision IN ('accepted','edited') AND id<>? AND resolved_at>=?",
        c.ws,
        prop.documentId,
        prop.paragraphId,
        proposalId,
        prop.createdAt,
      ).some((o) => o.base_revision === prop.baseRevision && prop.start < o.start + o.original.length && prop.start + prop.original.length > o.start);
    if (!applied.ok || clash) {
      const reason = applied.ok ? 'overlaps_accepted_change' : applied.reason;
      const detail = applied.ok ? 'Another suggestion for this same sentence was already accepted.' : applied.detail;
      run(c.db, "UPDATE proposals SET decision='conflict' WHERE id=? AND workspace_id=?", proposalId, c.ws);
      return {
        status: 'conflict',
        conflict: {
          reason,
          detail,
          baseText,
          headText: head.paragraphs.find((p) => p.id === prop.paragraphId)?.text ?? null,
          replacement,
        },
      };
    }
    if (!applied.ok) throw new HttpError(500, 'unreachable', 'unreachable');
    if (lockViolations(head.paragraphs, applied.paragraphs, locks).length) {
      return {
        status: 'conflict',
        conflict: {
          reason: 'locked',
          detail: 'Applying this would change locked text.',
          baseText,
          headText: head.paragraphs.find((p) => p.id === prop.paragraphId)?.text ?? null,
          replacement,
        },
      };
    }
    const meaning = compareMeaning(prop.original, replacement);
    const revId = commitRevision(
      c,
      prop.documentId,
      branch.id,
      head.id,
      applied.paragraphs,
      input.action === 'edit' ? 'accept_edited' : 'accept',
      `${input.action === 'edit' ? 'Edited and accepted' : 'Accepted'}: ${prop.issue.replace(/_/g, ' ')}`,
      {
        proposalId,
        provider: prop.provider,
        policyVersion: prop.policyVersion,
        materialFindings: meaning.material.length,
      },
    );
    run(
      c.db,
      'UPDATE proposals SET decision=?, resolved_at=? WHERE id=? AND workspace_id=?',
      input.action === 'edit' ? 'edited' : 'accepted',
      clock.now(),
      proposalId,
      c.ws,
    );
    run(
      c.db,
      'INSERT INTO decisions(id,workspace_id,proposal_id,document_id,action,revision_id,idempotency_key,user_id,note,final_text,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
      uid('dec'),
      c.ws,
      proposalId,
      prop.documentId,
      input.action,
      revId,
      input.idempotencyKey,
      c.userId,
      input.note ?? null,
      input.action === 'edit' ? replacement : null,
      clock.now(),
    );
    logEvent(c, prop.documentId, input.action === 'edit' ? 'suggestion_edited' : 'suggestion_accepted', {
      proposalId,
      issue: prop.issue,
      provider: prop.provider,
      requiresDecision: prop.requiresDecision,
    });
    return {
      status: input.action === 'edit' ? 'edited' : 'accepted',
      revisionId: revId,
    };
  });
}

// ---- audits ---------------------------------------------------------------------------------
export function replaceAudits(
  c: Ctx,
  docId: string,
  revisionId: string,
  runId: string | null,
  rows: {
    paragraphId: string;
    claimId: string;
    claim: string;
    start: number;
    end: number;
    verdict: string;
    passageId: string | null;
    quote: unknown;
    reasons: string[];
    stale: boolean;
    engine: string;
  }[],
) {
  tx(c.db, () => {
    run(c.db, 'DELETE FROM claim_audits WHERE workspace_id=? AND document_id=? AND revision_id=?', c.ws, docId, revisionId);
    for (const r of rows)
      run(
        c.db,
        'INSERT INTO claim_audits(id,workspace_id,document_id,revision_id,paragraph_id,claim_id,claim,start,end,verdict,passage_id,quote,reasons,stale,engine,run_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        uid('aud'),
        c.ws,
        docId,
        revisionId,
        r.paragraphId,
        r.claimId,
        r.claim,
        r.start,
        r.end,
        r.verdict,
        r.passageId,
        j(r.quote),
        j(r.reasons),
        r.stale ? 1 : 0,
        r.engine,
        runId,
        clock.now(),
      );
  });
}
export function listAudits(c: Ctx, docId: string, revisionId?: string) {
  const rev = revisionId ?? headRevision(c, docId).revision.id;
  return all(c.db, 'SELECT * FROM claim_audits WHERE workspace_id=? AND document_id=? AND revision_id=? ORDER BY rowid', c.ws, docId, rev).map((r) => ({
    id: r.id,
    paragraphId: r.paragraph_id,
    claimId: r.claim_id,
    claim: r.claim,
    start: r.start,
    end: r.end,
    verdict: r.verdict,
    passageId: r.passage_id,
    quote: unj(r.quote, null),
    reasons: unj(r.reasons, []),
    stale: !!r.stale,
    engine: r.engine,
    revisionId: r.revision_id,
  }));
}

// ---- data deletion --------------------------------------------------------------------------
export function deleteDerived(c: Ctx, what: 'passages' | 'voice' | 'feedback' | 'cache' | 'everything') {
  requireWrite(c);
  tx(c.db, () => {
    if (what === 'passages' || what === 'everything') {
      run(c.db, 'DELETE FROM passages WHERE workspace_id=?', c.ws);
      run(c.db, 'DELETE FROM claim_audits WHERE workspace_id=?', c.ws);
    }
    if (what === 'voice' || what === 'everything') {
      run(c.db, 'DELETE FROM voice_samples WHERE workspace_id=?', c.ws);
      run(c.db, 'UPDATE settings SET voice_profile=? WHERE workspace_id=?', j(NEUTRAL_PROFILE), c.ws);
    }
    if (what === 'feedback' || what === 'everything') run(c.db, 'DELETE FROM feedback_rules WHERE workspace_id=?', c.ws);
    if (what === 'cache' || what === 'everything') run(c.db, 'DELETE FROM stage_outputs WHERE workspace_id=?', c.ws);
    if (what === 'everything')
      for (const t of [
        'proposals',
        'decisions',
        'events',
        'locks',
        'lock_notes',
        'revisions',
        'branches',
        'documents',
        'brief_items',
        'brief_corrections',
        'brief_resolutions',
        'source_versions',
        'sources',
        'assignments',
        'courses',
        'runs',
        'run_stages',
        'spend',
        'exports',
      ])
        run(c.db, `DELETE FROM ${t} WHERE workspace_id=?`, c.ws);
  });
  if (what === 'everything') {
    const dir = path.join(DATA_DIR, 'files');
    if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir)) if (f.startsWith(c.ws + '_')) fs.rmSync(path.join(dir, f), { force: true });
  }
}
void validateProposal;
