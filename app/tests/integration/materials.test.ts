// Materials, brief and shell state: scope rules, mixed-batch truth, the persisted word-limit choice, resume location, export confirmation.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { makePdf } from '../../server/pdfgen.ts';
import { openDb } from '../../server/db.ts';
import { client, freshDb, newUser, waitRun } from './helpers.ts';

type U = Awaited<ReturnType<typeof newUser>>;
const SHEET = `# Assignment 1\n\nWrite a short argumentative essay on school start times. Length: 700-900 words. Use APA citations. Due Friday, Mar 7 at 11:59 pm ET.\n\nArgument (40 points)\nEvidence (30 points)\nClarity (30 points)\n\nYou may use AI tools if you disclose how.\n`;

async function blank(u: U, name = 'Course') {
  const course = (await u.api.post('courses', { name })).data;
  const asg = (await u.api.post(`courses/${course.id}/assignments`, { title: 'Paper one' })).data;
  return { course: course.id as string, asg: asg.id as string };
}
const paste = (u: U, asg: string, items: unknown[]) => u.api.post(`assignments/${asg}/materials`, { items });
function multipart(files: { name: string; bytes: Uint8Array | string; kind: string; scope?: string }[]) {
  const f = new FormData();
  for (const x of files) f.append('file', new File([typeof x.bytes === 'string' ? x.bytes : new Uint8Array(x.bytes)], x.name));
  f.append('plan', JSON.stringify(files.map((x) => ({ kind: x.kind, scope: x.scope }))));
  return f;
}

describe('a brand-new assignment: pasted instructions become a brief immediately', () => {
  const { db } = freshDb('mat1');
  it('overview starts empty and opens on Materials; pasting instructions yields the deliverable, length, citation, deadline with timezone and criteria', async () => {
    const u = await newUser(db);
    const { asg } = await blank(u);
    const o0 = (await u.api.get(`assignments/${asg}/overview`)).data;
    expect(o0.entry).toBe('materials');
    expect(o0.facts).toEqual({ hasInstructions: false, hasPlan: false, hasDraft: false, reviewDone: false, exportDone: false });
    expect(o0.materials.instructions).toEqual([]);

    const r = await paste(u, asg, [{ kind: 'assignment', title: 'Assignment instructions', text: SHEET }]);
    expect(r.data.results[0]).toMatchObject({ status: 'ready', scope: 'assignment', kind: 'assignment' });
    const o = (await u.api.get(`assignments/${asg}/overview`)).data;
    expect(o.facts.hasInstructions).toBe(true);
    const kinds = new Set(o.brief.items.map((i: any) => i.kind));
    for (const k of ['deliverable', 'word_range', 'citation_style', 'deadline', 'criterion', 'assistance']) expect(kinds.has(k), k).toBe(true);
    expect(o.brief.effective.deadline.data.timezone).toBe('ET');
    expect(o.brief.effective.word_range.data).toMatchObject({ min: 700, max: 900 });
    // criteria came from the assignment sheet itself: the Rubric row can say so without an uploaded rubric file
    expect(o.materials.foundInInstructions.map((c: any) => c.label)).toEqual(['Argument', 'Evidence', 'Clarity']);
    expect(o.materials.foundInInstructions[0].sourceTitle).toBe('Assignment instructions');
    expect(o.materials.rubricFiles).toEqual([]);
    // every requirement keeps its exact source passage
    for (const i of o.brief.items.slice(0, 5)) {
      const p = (await u.api.get(`passages/${i.passageId}`)).data;
      expect(p.text.slice(i.start, i.end)).toBe(i.quote);
    }
  });
  it('a plain mention of the word "rubric" is not criteria', async () => {
    const u = await newUser(db);
    const { asg } = await blank(u);
    await paste(u, asg, [
      { kind: 'assignment', text: 'Write an essay of 600-800 words on a topic of your choice. Your grade follows the rubric on the course page. Cite in MLA.' },
    ]);
    const o = (await u.api.get(`assignments/${asg}/overview`)).data;
    expect(o.materials.foundInInstructions).toEqual([]);
    expect(o.brief.missing.some((m: any) => m.kind === 'criterion')).toBe(true);
  });
});

describe('the preloaded attendance sample', () => {
  const { db } = freshDb('mat2');
  it('recognises the course syllabus, the assignment sheet and its criteria without any re-upload, and shows the real length conflict', async () => {
    const u = await newUser(db);
    const seed = (await u.api.post('demo/seed')).data;
    const o = (await u.api.get(`assignments/${seed.assignmentId}/overview`)).data;
    expect(o.materials.syllabi).toHaveLength(1);
    expect(o.materials.syllabi[0]).toMatchObject({ origin: 'From this course', status: 'ready', counted: true });
    expect(o.materials.instructions[0]).toMatchObject({ origin: 'This assignment', status: 'ready' });
    expect(o.materials.foundInInstructions.map((c: any) => c.label)).toEqual(['Argument', 'Use of evidence', 'Engagement with objections', 'Clarity']);
    expect(o.materials.readings).toHaveLength(1);
    const cf = o.brief.conflicts.find((x: any) => x.kind === 'word_range');
    expect(cf.decision).toBe('open');
    expect([cf.a.value, cf.b.value].sort()).toEqual(['800–1000 words', '800–1200 words']);
    expect(o.facts.hasInstructions).toBe(true);
  });
  it('choosing either range persists across a fresh API instance and drives the effective requirement; "decide later" keeps it visible', async () => {
    const u = await newUser(db);
    const seed = (await u.api.post('demo/seed')).data;
    const before = (await u.api.get(`courses/${seed.courseId}`)).data.sources.length;
    const o = (await u.api.get(`assignments/${seed.assignmentId}/overview`)).data;
    const cf = o.brief.conflicts.find((x: any) => x.kind === 'word_range');
    const sheet = [cf.a, cf.b].find((i: any) => i.sourceTitle === 'Assignment sheet');
    const syllabus = [cf.a, cf.b].find((i: any) => i.sourceTitle === 'Syllabus');
    await u.api.post(`assignments/${seed.assignmentId}/brief/resolve`, { kind: 'word_range', chosenSourceId: sheet.sourceId });
    const again = client(db, u.token); // a fresh client = reload
    const o2 = (await again.get(`assignments/${seed.assignmentId}/overview`)).data;
    expect(o2.brief.conflicts.find((x: any) => x.kind === 'word_range').decision).toBe('chosen');
    expect(o2.brief.effective.word_range.sourceTitle).toBe('Assignment sheet');
    expect(o2.brief.effective.word_range.data).toMatchObject({ min: 800, max: 1000 });
    await u.api.post(`assignments/${seed.assignmentId}/brief/resolve`, { kind: 'word_range', chosenSourceId: syllabus.sourceId });
    expect((await again.get(`assignments/${seed.assignmentId}/overview`)).data.brief.effective.word_range.data.max).toBe(1200);
    await u.api.post(`assignments/${seed.assignmentId}/brief/resolve`, { kind: 'word_range', chosenSourceId: null });
    const later = (await again.get(`assignments/${seed.assignmentId}/overview`)).data;
    expect(later.brief.conflicts.find((x: any) => x.kind === 'word_range').decision).toBe('later');
    // nothing was uploaded again
    expect((await u.api.get(`courses/${seed.courseId}`)).data.sources.length).toBe(before);
  });
  it('the review checks length against the range the student chose', async () => {
    const u = await newUser(db);
    const seed = (await u.api.post('demo/seed')).data;
    const o = (await u.api.get(`assignments/${seed.assignmentId}/overview`)).data;
    const cf = o.brief.conflicts.find((x: any) => x.kind === 'word_range');
    const syllabus = [cf.a, cf.b].find((i: any) => i.sourceTitle === 'Syllabus');
    await u.api.post(`assignments/${seed.assignmentId}/brief/resolve`, { kind: 'word_range', chosenSourceId: syllabus.sourceId });
    const d = (await u.api.post(`assignments/${seed.assignmentId}/document`, { text: 'Attendance matters.' })).data.documentId;
    const fin = await waitRun(u.api, db, (await u.api.post(`documents/${d}/runs`, { mode: 'quick' })).data.runId);
    expect(fin.summary.requirements.find((q: any) => q.kind === 'length').message).toContain('800–1200 words');
  });
});

describe("scope: a sibling assignment's material never leaks in", () => {
  const { db } = freshDb('mat3');
  it('an assignment-specific rubric stays with its assignment; a client cannot make a sheet or rubric course-wide', async () => {
    const u = await newUser(db);
    const { course, asg: a } = await blank(u);
    const b = (await u.api.post(`courses/${course}/assignments`, { title: 'Paper two' })).data.id as string;
    const rub = 'Thesis (50 points)\nEvidence (50 points)\n';
    const r = await paste(u, a, [{ kind: 'rubric', scope: 'course', title: 'Private rubric A', text: rub }]);
    expect(r.data.results[0].scope).toBe('assignment'); // forced by the server
    const oa = (await u.api.get(`assignments/${a}/overview`)).data;
    const ob = (await u.api.get(`assignments/${b}/overview`)).data;
    expect(oa.materials.foundInRubric.map((c: any) => c.label)).toEqual(['Thesis', 'Evidence']);
    expect(ob.materials.rubricFiles).toEqual([]);
    expect(ob.materials.foundInRubric).toEqual([]);
    expect(ob.brief.items.filter((i: any) => i.kind === 'criterion')).toEqual([]);
  });
  it('a legacy course-level sheet is not counted when the course has several assignments, and can be attached explicitly', async () => {
    const { db: d2 } = freshDb('mat3b');
    const u = await newUser(d2);
    const { course, asg: a } = await blank(u);
    const b = (await u.api.post(`courses/${course}/assignments`, { title: 'Paper two' })).data.id as string;
    // legacy path: the old course page uploads with no assignment id
    const f = new FormData();
    f.append('kind', 'rubric');
    f.append('file', new File(['Voice (60 points)\nStructure (40 points)\n'], 'old-rubric.md', { type: 'text/markdown' }));
    await u.api.upload(`courses/${course}/sources`, f);
    for (const id of [a, b]) {
      const o = (await u.api.get(`assignments/${id}/overview`)).data;
      expect(o.materials.rubricFiles).toEqual([]);
      expect(o.brief.items.filter((i: any) => i.kind === 'criterion')).toEqual([]);
      expect(o.materials.legacyAttachable.map((x: any) => x.title)).toEqual(['old-rubric.md']);
    }
    const legacyId = (await u.api.get(`assignments/${b}/overview`)).data.materials.legacyAttachable[0].id;
    await u.api.post(`assignments/${b}/materials/${legacyId}/attach`);
    const ob = (await u.api.get(`assignments/${b}/overview`)).data;
    expect(ob.materials.foundInRubric.map((c: any) => c.label)).toEqual(['Voice', 'Structure']);
    const oa = (await u.api.get(`assignments/${a}/overview`)).data;
    expect(oa.materials.legacyAttachable).toEqual([]);
    expect(oa.materials.foundInRubric).toEqual([]);
  });
  it('in a course with one assignment, an older course-level sheet still counts (backward compatible)', async () => {
    const u = await newUser(db);
    const { course, asg } = await blank(u);
    const f = new FormData();
    f.append('kind', 'assignment');
    f.append('file', new File([SHEET], 'sheet.md', { type: 'text/markdown' }));
    await u.api.upload(`courses/${course}/sources`, f);
    const o = (await u.api.get(`assignments/${asg}/overview`)).data;
    expect(o.materials.instructions[0]).toMatchObject({ scope: 'legacy', origin: 'Older course file', counted: true });
  });
  it('several syllabi: the student chooses, and the brief follows the choice', async () => {
    const u = await newUser(db);
    const { asg } = await blank(u);
    await paste(u, asg, [{ kind: 'syllabus', title: 'Syllabus fall', text: 'Papers are 500-700 words in MLA format.' }]);
    await paste(u, asg, [{ kind: 'syllabus', title: 'Syllabus spring', text: 'Papers are 900-1,100 words in MLA format.' }]);
    const o = (await u.api.get(`assignments/${asg}/overview`)).data;
    expect(o.materials.syllabi).toHaveLength(2);
    const fall = o.materials.syllabi.find((s: any) => s.title === 'Syllabus fall');
    await u.api.put(`assignments/${asg}/ui-state`, { syllabusSourceId: fall.id });
    const o2 = (await u.api.get(`assignments/${asg}/overview`)).data;
    expect(o2.materials.syllabusChosenId).toBe(fall.id);
    expect(o2.brief.effective.word_range.data).toMatchObject({ min: 500, max: 700 });
  });
});

describe('mixed and partial uploads tell the truth per file', () => {
  const { db } = freshDb('mat4');
  it('one valid reading and one unreadable input yield two states; retrying only the failure adds no duplicate; the rubric of another assignment stays out', async () => {
    const u = await newUser(db);
    const { course, asg } = await blank(u);
    const other = (await u.api.post(`courses/${course}/assignments`, { title: 'Paper two' })).data.id as string;
    await paste(u, other, [{ kind: 'rubric', text: 'Secret criterion (100 points)\n' }]);
    const good = await makePdf([{ lines: ['Frequent attendees averaged 84 on the final exam.'] }]);
    const bad = await makePdf([{ lines: [] }]); // no text layer
    const r1 = (
      await u.api.upload(
        `assignments/${asg}/materials`,
        multipart([
          { name: 'reading.pdf', bytes: good, kind: 'reading' },
          { name: 'scan.pdf', bytes: bad, kind: 'reading' },
        ]),
      )
    ).data.results;
    expect(r1.map((x: any) => x.status)).toEqual(['ready', 'needs_text']);
    expect(r1[1].error).toMatch(/OCR|by hand/);
    let o = (await u.api.get(`assignments/${asg}/overview`)).data;
    expect(o.materials.readings.map((x: any) => [x.filename, x.status]).sort()).toEqual([
      ['reading.pdf', 'ready'],
      ['scan.pdf', 'needs_text'],
    ]);
    // retry: only the failed item, now with a readable version of the same file name
    const fixed = await makePdf([{ lines: ['Less frequent attendees averaged 77 on the final exam.'] }]);
    const r2 = (await u.api.upload(`assignments/${asg}/materials`, multipart([{ name: 'scan.pdf', bytes: fixed, kind: 'reading' }]))).data.results;
    expect(r2[0].status).toBe('replaced');
    // resubmitting the already-good file is recognised, never duplicated
    const r3 = (await u.api.upload(`assignments/${asg}/materials`, multipart([{ name: 'reading.pdf', bytes: good, kind: 'reading' }]))).data.results;
    expect(r3[0].status).toBe('duplicate');
    o = (await u.api.get(`assignments/${asg}/overview`)).data;
    expect(o.materials.readings).toHaveLength(2);
    expect(o.materials.readings.every((x: any) => x.status === 'ready')).toBe(true);
    expect(JSON.stringify(o.brief)).not.toContain('Secret criterion');
  });
  it('a file whose type was left unchosen fails with a clear message, and pasting follows the same path as a file', async () => {
    const u = await newUser(db);
    const { asg } = await blank(u);
    const f = new FormData();
    f.append('file', new File(['x'], 'mystery.bin'));
    f.append('plan', JSON.stringify([{ kind: 'reading' }]));
    const r = (await u.api.upload(`assignments/${asg}/materials`, f)).data.results[0];
    expect(r.status).toBe('failed');
    expect(r.error).toMatch(/Unsupported/);
    const p = (await paste(u, asg, [{ kind: 'assignment', text: SHEET }])).data.results[0];
    const again = (await paste(u, asg, [{ kind: 'assignment', text: SHEET }])).data.results[0];
    expect([p.status, again.status]).toEqual(['ready', 'duplicate']);
  });
});

describe('draft-first, resume, export completion, and an existing database', () => {
  const { db } = freshDb('mat5');
  it('pasting a finished draft opens the editor with no model call, recorded as an import, and survives reload', async () => {
    const u = await newUser(db);
    const { asg } = await blank(u);
    const r = (await u.api.post(`assignments/${asg}/document`, { text: 'My finished first paragraph.\n\nMy second paragraph.' })).data;
    const o = (await client(db, u.token).get(`assignments/${asg}/overview`)).data;
    expect(o.document).toMatchObject({ id: r.documentId, words: 7, cause: 'import' });
    expect(o.entry).toBe('draft');
    expect(o.facts).toMatchObject({ hasDraft: true, hasInstructions: false, hasPlan: false });
    const spend = (await u.api.get(`assignments/${asg}/spend`)).data;
    expect(spend.calls).toBe(0);
    const rep = (await u.api.get(`documents/${r.documentId}/report`)).data.lines.join('\n');
    expect(rep).toMatch(/arrived whole/);
  });
  it('resume location is stored separately from completion; a bad stage is refused; visiting Export completes nothing; a download counts only once confirmed', async () => {
    const u = await newUser(db);
    const { asg } = await blank(u);
    const doc = (await u.api.post(`assignments/${asg}/document`, { text: 'A draft with several words in it.' })).data.documentId;
    expect((await u.api.put(`assignments/${asg}/ui-state`, { resumeStage: 'nonsense' })).status).toBe(422);
    await u.api.put(`assignments/${asg}/ui-state`, { resumeStage: 'export' });
    let o = (await u.api.get(`assignments/${asg}/overview`)).data;
    expect(o.ui.resume.stage).toBe('export');
    expect(o.entry).toBe('export');
    expect(o.facts.exportDone).toBe(false);
    const ex = await u.api.post(`documents/${doc}/export`, { format: 'txt' });
    const exportId = ex.headers.get('x-export-id')!;
    expect(exportId).toMatch(/^exp_/);
    o = (await u.api.get(`assignments/${asg}/overview`)).data;
    expect(o.facts.exportDone).toBe(false); // produced, not yet confirmed as downloaded
    await u.api.post(`documents/${doc}/export-confirm`, { exportId });
    expect((await u.api.get(`assignments/${asg}/overview`)).data.facts.exportDone).toBe(true);
    // reviewDone only when a run actually finished
    expect(o.facts.reviewDone).toBe(false);
    await waitRun(u.api, db, (await u.api.post(`documents/${doc}/runs`, { mode: 'quick' })).data.runId);
    expect((await u.api.get(`assignments/${asg}/overview`)).data.facts.reviewDone).toBe(true);
  });
  it('a GET of the overview never creates a revision, a run or spend', async () => {
    const u = await newUser(db);
    const { asg } = await blank(u);
    const doc = (await u.api.post(`assignments/${asg}/document`, { text: 'Some words here.' })).data.documentId;
    const h0 = (await u.api.get(`documents/${doc}/history`)).data.revisions.length;
    for (let i = 0; i < 5; i++) await u.api.get(`assignments/${asg}/overview`);
    expect((await u.api.get(`documents/${doc}/history`)).data.revisions.length).toBe(h0);
    expect((await u.api.get(`documents/${doc}/runs`)).data).toEqual([]);
    expect((await u.api.get(`assignments/${asg}/spend`)).data.calls).toBe(0);
  });
  it('an existing populated database gains the new column without losing rows', () => {
    const dir = path.resolve('.data-test', 'legacy-' + Math.random().toString(36).slice(2, 7));
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'old.db');
    const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
    const old = new DatabaseSync(file);
    old.exec(
      "CREATE TABLE exports (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, document_id TEXT NOT NULL, revision_id TEXT NOT NULL, format TEXT NOT NULL, text_hash TEXT NOT NULL, filename TEXT, created_at INTEGER NOT NULL); INSERT INTO exports VALUES ('exp_old','w','d','r','txt','h','f.txt',1);",
    );
    old.close();
    const db2 = openDb(file);
    const row = db2.prepare('SELECT id, confirmed FROM exports').get() as any;
    expect(row).toEqual({ id: 'exp_old', confirmed: 0 });
    expect(() => openDb(file)).not.toThrow(); // idempotent
  });
});
