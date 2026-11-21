import { describe, expect, it, beforeAll } from 'vitest';
import fs from 'node:fs';
import { freshDb, newUser, waitRun } from './helpers.ts';
import { readDocxText, verifyDocxRoundTrip } from '../../server/exporter.ts';
import { sha256 } from '../../server/db.ts';
import { makePdf } from '../../server/pdfgen.ts';

describe('personal workflow: import -> idea -> thesis -> draft -> review -> decide -> reopen -> export', () => {
  const { db } = freshDb('wf');
  let u: Awaited<ReturnType<typeof newUser>>;
  let asgId = ''; let courseId = ''; let docId = '';
  const state: Record<string, any> = {};

  beforeAll(async () => { u = await newUser(db); });

  it('M1: seeds the sample course; brief items carry exact quotes, conflicts and what is missing', async () => {
    const seed = await u.api.post('demo/seed');
    expect(seed.status).toBe(200);
    asgId = seed.data.assignmentId; courseId = seed.data.courseId;
    const a = await u.api.get(`assignments/${asgId}`);
    const brief = a.data.brief;
    const kinds = new Set(brief.items.map((i: any) => i.kind));
    for (const k of ['deliverable', 'word_range', 'citation_style', 'deadline', 'criterion', 'assistance']) expect(kinds.has(k)).toBe(true);
    expect(brief.items.find((i: any) => i.kind === 'deadline').data.timezone).toBe('ET');
    expect(brief.conflicts.some((c: any) => c.kind === 'word_range' && /Aug 28/.test(c.note) && /Oct 3/.test(c.note))).toBe(true);
    for (const i of brief.items.slice(0, 5)) {
      const p = await u.api.get(`passages/${i.passageId}`);
      expect(p.data.text.slice(i.start, i.end)).toBe(i.quote);
    }
    expect(a.data.evidence.length).toBeGreaterThan(0);
  });

  it('M1: a source jump resolves to the labelled page (printed label differs from viewer page index)', async () => {
    const hit = await u.api.get(`assignments/${asgId}/search?q=${encodeURIComponent('students chose whether to attend')}`);
    expect(hit.data[0].pageIndex).toBe(2);
    expect(hit.data[0].pageLabel).toBe('14');
    const p = await u.api.get(`passages/${hit.data[0].id}`);
    expect(p.data.text).toContain('Students chose whether to attend.');
    expect(p.data.stale).toBe(false);
    state.evidencePassage = hit.data[0].id;
  });

  it('M1: unreadable and scanned files fail per file with a remedy; good files still import', async () => {
    const scanned = await makePdf([{ lines: [] }]);
    const form = new FormData();
    form.append('kind', 'reading');
    form.append('file', new File([Buffer.from([0, 1, 2, 3, 250, 251, 0, 0, 9, 9])], 'broken.bin', { type: 'application/octet-stream' }));
    form.append('file', new File([new Uint8Array(scanned)], 'scan.pdf', { type: 'application/pdf' }));
    form.append('file', new File(['A short reading about policy.\n\nIt has two paragraphs.'], 'ok.txt', { type: 'text/plain' }));
    const r = await u.api.upload(`courses/${courseId}/sources`, form);
    const by = Object.fromEntries(r.data.results.map((x: any) => [x.file, x]));
    expect(by['broken.bin'].status).toBe('unreadable');
    expect(by['broken.bin'].error).toMatch(/Unsupported/);
    expect(by['scan.pdf'].status).toBe('needs_ocr');
    expect(by['scan.pdf'].error).toMatch(/OCR|by hand/);
    expect(by['ok.txt'].status).toBe('ok');
    // manual passage entry rescues the scanned file
    const add = await u.api.post(`sources/${by['scan.pdf'].sourceId}/passages`, { text: 'Typed from the scan: tutoring raised pass rates.', pageIndex: 1, pageLabel: 'iv' });
    expect(add.status).toBe(200);
    const d = await u.api.get(`sources/${by['scan.pdf'].sourceId}`);
    expect(d.data.version.status).toBe('ok');
    expect(d.data.passages[0].page_label).toBe('iv');
  });

  it('M2: note -> at most two questions, two thesis options with readings and a weakening fact; original note kept', async () => {
    const r = await u.api.post(`assignments/${asgId}/idea`, { note: 'I think attendance helps, but motivated students might also show up more.' });
    expect(r.status).toBe(200);
    expect(r.data.originalNote).toContain('motivated students');
    expect(r.data.extraction.objection).toMatch(/motivated students/);
    expect(r.data.questions.length).toBeLessThanOrEqual(2);
    expect(r.data.options).toHaveLength(2);
    for (const o of r.data.options) { expect(o.weakeningFact.length).toBeGreaterThan(10); expect(o.supportingPassageIds).toContain(state.evidencePassage); }
    expect(r.data.provider).toBe('fixture:rules/1');
    const ch = await u.api.post(`assignments/${asgId}/idea/choose`, { optionId: 'opt_association' });
    expect(ch.data.thesis).toMatch(/association/);
  });

  it('M2: outline -> reviewable draft with unsupported statements flagged; a protected span survives reload', async () => {
    const o = await u.api.post(`assignments/${asgId}/outline`);
    expect(o.data.items.length).toBeGreaterThanOrEqual(3);
    const d = await u.api.post(`assignments/${asgId}/draft`);
    expect(d.status).toBe(200);
    docId = d.data.documentId;
    const doc = await u.api.get(`documents/${docId}`);
    expect(doc.data.revision.paragraphs.length).toBeGreaterThanOrEqual(3);
    expect(doc.data.revision.cause).toBe('draft');
    // lock the thesis paragraph and an exact span, then reload
    const first = doc.data.revision.paragraphs[0];
    const lk = await u.api.post(`documents/${docId}/locks`, { paragraphId: first.id, kind: 'paragraph', thesis: true });
    expect(lk.status).toBe(200);
    const re = await u.api.get(`documents/${docId}`);
    expect(re.data.locks).toHaveLength(1);
    expect(re.data.locks[0].thesis).toBe(true);
    state.thesisId = first.id; state.thesisText = first.text;
    // revising a locked paragraph is refused
    const rv = await u.api.post(`documents/${docId}/paragraphs/${first.id}/revise`);
    expect(rv.status).toBe(409);
  });

  it('M3: the student writes the evidence paragraph; Quick review runs through the durable queue', async () => {
    const doc = await u.api.get(`documents/${docId}`);
    const paras = doc.data.revision.paragraphs.map((p: any, i: number) => (i === 1 ? { id: p.id, text: 'Attendance is associated with higher exam scores.' } : { id: p.id, text: p.text }));
    state.evParaId = paras[1].id;
    const s = await u.api.post(`documents/${docId}/revisions`, { baseRevisionId: doc.data.revision.id, paragraphs: paras, label: 'My evidence paragraph' });
    expect(s.status).toBe(200);
    const est = await u.api.post(`documents/${docId}/runs/estimate`, { mode: 'quick' });
    expect(est.data.paid).toBe(false);
    expect(est.data.label).toMatch(/free/);
    const run = await u.api.post(`documents/${docId}/runs`, { mode: 'quick', idempotencyKey: 'quick-run-1' });
    expect(run.status).toBe(202);
    const dup = await u.api.post(`documents/${docId}/runs`, { mode: 'quick', idempotencyKey: 'quick-run-1' });
    expect(dup.data.runId).toBe(run.data.runId);
    const fin = await waitRun(u.api, db, run.data.runId);
    expect(fin.status).toBe('done');
    expect(fin.summary.providers.editor).toBe('fixture:rules/1');
    expect(fin.summary.providers.independent).toBe(false);
    expect(fin.spend.paidCalls).toBe(0);
    const props = (await u.api.get(`documents/${docId}/proposals?decision=pending`)).data;
    expect(props.length).toBeLessThanOrEqual(3);
    const limit = props.find((p: any) => p.issue === 'missing_requirement');
    const sharpen = props.find((p: any) => p.issue === 'weak_argument');
    expect(limit.replacement).toContain('Because students chose whether to attend');
    expect(limit.replacement).toContain('motivated students might also show up more');
    expect(limit.evidence[0].passageId).toBe(state.evidencePassage);
    expect(sharpen.replacement).toMatch(/raises exam scores/);
    expect(sharpen.findings.some((f: any) => f.category === 'causal_introduced')).toBe(true);
    expect(sharpen.requiresDecision).toBe(true);
    expect(sharpen.meaningChange).toMatch(/causation/);
    expect(props.indexOf(limit)).toBeLessThan(props.indexOf(sharpen)); // missing requirement outranks argument polish
    state.limit = limit.id; state.sharpen = sharpen.id; state.limitText = limit.replacement;
    // locked thesis paragraph untouched by any proposal
    expect(props.every((p: any) => p.paragraphId !== state.thesisId)).toBe(true);
  });

  it('M3: reject the causal rewrite; accept the limitation. One decision, one revision each', async () => {
    const rej = await u.api.post(`proposals/${state.sharpen}/decision`, { action: 'reject', idempotencyKey: 'reject-1' });
    expect(rej.data.status).toBe('rejected');
    const before = (await u.api.get(`documents/${docId}/history`)).data.revisions.length;
    const acc = await u.api.post(`proposals/${state.limit}/decision`, { action: 'accept', idempotencyKey: 'accept-1' });
    expect(acc.data.status).toBe('accepted');
    const replay = await u.api.post(`proposals/${state.limit}/decision`, { action: 'accept', idempotencyKey: 'accept-1' });
    expect(replay.data.replayed).toBe(true);
    const other = await u.api.post(`proposals/${state.limit}/decision`, { action: 'accept', idempotencyKey: 'accept-2' });
    expect(other.data.replayed).toBe(true);
    const after = (await u.api.get(`documents/${docId}/history`)).data.revisions.length;
    expect(after).toBe(before + 1);
    const doc = await u.api.get(`documents/${docId}`);
    const ev = doc.data.revision.paragraphs.find((p: any) => p.id === state.evParaId).text;
    expect(ev).toBe('Attendance is associated with higher exam scores. Because students chose whether to attend, this shows an association rather than an effect: motivated students might also show up more.');
    expect(doc.data.revision.paragraphs[0].text).toBe(state.thesisText); // lock held
  });

  it('M5: close and return: a fresh API instance on the same database shows the same head, history and decisions', async () => {
    const api2 = (await import('./helpers.ts')).client(db, u.token);
    const home = await api2.get('home');
    expect(home.data.assignments[0].document_id).toBe(docId);
    const doc = await api2.get(`documents/${docId}`);
    expect(doc.data.resolved.map((p: any) => p.decision).sort()).toEqual(['accepted', 'rejected']);
    const h = await api2.get(`documents/${docId}/history`);
    expect(h.data.decisions.map((d: any) => d.action)).toEqual(expect.arrayContaining(['accept', 'reject']));
    expect(h.data.revisions.some((r: any) => r.cause === 'accept')).toBe(true);
  });

  it('M5: exact export (DOCX, TXT), re-import, hash match; restore keeps later history', async () => {
    const doc = await u.api.get(`documents/${docId}`);
    const approved = doc.data.revision.paragraphs.map((p: any) => p.text).join('\n\n');
    const prev = await u.api.get(`documents/${docId}/export-preview`);
    expect(prev.data.text).toBe(approved);
    expect(prev.data.hash).toBe(doc.data.revision.hash);
    const txt = await u.api.post(`documents/${docId}/export`, { format: 'txt' });
    expect(Buffer.from(txt.data).toString('utf8')).toBe(approved);
    const dx = await u.api.post(`documents/${docId}/export`, { format: 'docx' });
    const reread = await readDocxText(dx.data);
    expect(reread).toBe(approved);
    expect(sha256(reread)).toBe(sha256(approved));
    expect((await verifyDocxRoundTrip(doc.data.revision.paragraphs, dx.data)).exact).toBe(true);
    // restore the revision before the accepted edit; the accepted one stays in history
    const h = (await u.api.get(`documents/${docId}/history`)).data;
    const target = h.revisions.find((r: any) => r.label === 'My evidence paragraph');
    const rs = await u.api.post(`documents/${docId}/restore`, { revisionId: target.id });
    expect(rs.status).toBe(200);
    const h2 = (await u.api.get(`documents/${docId}/history`)).data;
    expect(h2.revisions.length).toBe(h.revisions.length + 1);
    expect(h2.revisions.find((r: any) => r.cause === 'accept')).toBeTruthy();
    const restored = h2.revisions.at(-1);
    expect(restored.cause).toBe('restore');
    expect(restored.parent_id).toBe(h.revisions.at(-1).id);
    // the process report is honest about the import boundary
    const rep = await u.api.get(`documents/${docId}/report`);
    const text = rep.data.lines.join('\n');
    expect(text).toMatch(/arrived whole/);
    expect(text).toMatch(/not proof of authorship/);
    expect(text).toMatch(/1 accepted/);
    expect(text).toMatch(/fixture:rules\/1/);
  });

  it('replayed/simulated input can never become an authorship event', async () => {
    const r = await u.api.post(`documents/${docId}/events`, { kind: 'typing_batch', inserted: 500, simulated: true, tool: 'practice playback', chars: 500 });
    expect(r.data.recordedAs).toBe('automated_input');
    const rep = (await u.api.get(`documents/${docId}/report`)).data.lines.join('\n');
    expect(rep).toMatch(/NOT an authorship event/);
    expect(rep).toMatch(/Typing batches recorded: 0/);
  });
});
