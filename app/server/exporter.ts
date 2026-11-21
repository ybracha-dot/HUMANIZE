// Export: DOCX and plain text reproduce the approved revision EXACTLY (round-trip verified), plus an optional process
// report that states what was observed, where the import boundary is, and what is not known.
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx';
import mammoth from 'mammoth';
import { all, clock, j, one, run, sha256, uid, unj, type Row } from './db.ts';
import {
  activeLocks,
  getBrief,
  getAssignmentState,
  getDocumentRow,
  headRevision,
  history,
  joinText,
  listAudits,
  logEvent,
  revisionRow,
  textHash,
  requireWrite,
  type Ctx,
} from './store.ts';
import { extractCitations } from '../shared/meaning.ts';
import { countWords } from '../shared/text.ts';
import { paginate, makePdf, wrap } from './pdfgen.ts';
import type { Para } from '../shared/proposals.ts';

const RTL = /[֐-׿؀-ۿ]/;

export async function docxBuffer(paras: Para[], opts: { title?: string; statement?: string | null } = {}): Promise<Buffer> {
  const children: Paragraph[] = paras.map(
    (p) =>
      new Paragraph({
        bidirectional: RTL.test(p.text) && !/[A-Za-z]/.test(p.text),
        heading: p.kind === 'h' ? HeadingLevel.HEADING_2 : undefined,
        children: p.text.split('\n').flatMap((line, i) => [new TextRun({ text: line, break: i ? 1 : 0 })]),
      }),
  );
  if (opts.statement)
    children.push(
      new Paragraph({
        children: [new TextRun({ text: opts.statement, italics: true })],
      }),
    );
  const doc = new Document({
    title: opts.title,
    creator: 'Writing Studio',
    sections: [{ children }],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}

export async function readDocxText(buf: Buffer): Promise<string> {
  return (await mammoth.extractRawText({ buffer: buf })).value.replace(/\n\n$/, ''); // mammoth terminates every paragraph with a blank line
}

/** Re-read an exported DOCX and compare with the approved text. Returns exact equality on the essay part. */
export async function verifyDocxRoundTrip(paras: Para[], buf: Buffer, statement?: string | null) {
  const got = await readDocxText(buf);
  const expected = joinText(paras) + (statement ? '\n\n' + statement : '');
  return {
    exact: got === expected,
    expectedHash: sha256(expected),
    gotHash: sha256(got),
  };
}

export function exportPreview(c: Ctx, docId: string, revisionId?: string) {
  const doc = getDocumentRow(c, docId);
  const rev = revisionId ? revisionRow(c, revisionId) : headRevision(c, docId).revision;
  const text = joinText(rev.paragraphs);
  const brief = getBrief(c, doc.assignment_id);
  const state = getAssignmentState(c, doc.assignment_id);
  const assistance = brief.items.filter((i) => i.kind === 'assistance').map((i) => i.value);
  const audits = listAudits(c, docId, rev.id);
  return {
    revisionId: rev.id,
    hash: textHash(rev.paragraphs),
    words: countWords(text),
    paragraphs: rev.paragraphs.length,
    text,
    citations: [...new Set(extractCitations(text).map((x) => x.text))],
    citationStyle: brief.items.find((i) => i.kind === 'citation_style')?.value ?? null,
    assistanceRequirement: assistance,
    assistanceStatement: (state.assistanceStatement as string | undefined) ?? '',
    unresolvedEvidence: audits.filter((a) => a.verdict !== 'supported').length,
    staleEvidence: audits.filter((a) => a.stale).length,
    locks: activeLocks(c, docId).length,
  };
}

export async function exportDocument(
  c: Ctx,
  docId: string,
  input: {
    format: 'docx' | 'txt' | 'report' | 'report-pdf';
    revisionId?: string;
    includeStatement?: boolean;
    includeText?: boolean;
  },
) {
  requireWrite(c); // exporting records an event; read-only roles download via preview
  const doc = getDocumentRow(c, docId);
  const rev = input.revisionId ? revisionRow(c, input.revisionId) : headRevision(c, docId).revision;
  const state = getAssignmentState(c, doc.assignment_id);
  const statement = input.includeStatement && state.assistanceStatement ? String(state.assistanceStatement) : null;
  const hash = textHash(rev.paragraphs);
  const base =
    String(doc.title)
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-|-$/g, '') || 'essay';
  let body: Buffer;
  let filename: string;
  let mime: string;
  if (input.format === 'txt') {
    body = Buffer.from(joinText(rev.paragraphs) + (statement ? '\n\n' + statement : ''), 'utf8');
    filename = `${base}.txt`;
    mime = 'text/plain; charset=utf-8';
  } else if (input.format === 'docx') {
    body = await docxBuffer(rev.paragraphs, {
      title: String(doc.title),
      statement,
    });
    filename = `${base}.docx`;
    mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  } else {
    const report = buildReport(c, docId, rev.id, input.includeText !== false);
    if (input.format === 'report') {
      body = Buffer.from(report.html, 'utf8');
      filename = `${base}-process-report.html`;
      mime = 'text/html; charset=utf-8';
    } else {
      body = Buffer.from(
        await makePdf(
          paginate(
            report.lines.flatMap((l) => wrap(l)),
            44,
            'Process report',
          ),
          { title: `${doc.title} - process report` },
        ),
      );
      filename = `${base}-process-report.pdf`;
      mime = 'application/pdf';
    }
  }
  run(
    c.db,
    'INSERT INTO exports(id,workspace_id,document_id,revision_id,format,text_hash,filename,created_at) VALUES(?,?,?,?,?,?,?,?)',
    uid('exp'),
    c.ws,
    docId,
    rev.id,
    input.format,
    hash,
    filename,
    clock.now(),
  );
  logEvent(c, docId, 'export', {
    format: input.format,
    revisionId: rev.id,
    hash,
  });
  return { body, filename, mime, hash, revisionId: rev.id };
}

// ---- process report -----------------------------------------------------------------------------
const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);
const fmt = (t: number) => new Date(t).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

export function buildReport(c: Ctx, docId: string, revisionId: string, includeText: boolean) {
  const doc = getDocumentRow(c, docId);
  const events = all(c.db, 'SELECT kind, data, created_at FROM events WHERE workspace_id=? AND document_id=? ORDER BY created_at, rowid', c.ws, docId).map(
    (e): Row => ({ ...e, data: unj<any>(e.data, {}) }),
  );
  const h = history(c, docId);
  const runs = all(c.db, 'SELECT id, mode, status, created_at, summary FROM runs WHERE workspace_id=? AND document_id=? ORDER BY created_at', c.ws, docId).map(
    (r): Row => ({ ...r, summary: unj<any>(r.summary, null) }),
  );
  const props = all(
    c.db,
    'SELECT id, issue, provider, decision, original, replacement, policy_version, resolved_at FROM proposals WHERE workspace_id=? AND document_id=? ORDER BY created_at',
    c.ws,
    docId,
  );
  const audits = listAudits(c, docId, revisionId);
  const imports = events.filter((e) => e.kind === 'import' || e.kind === 'draft_generated');
  const typing = events.filter((e) => e.kind === 'typing_batch');
  const pastes = events.filter((e) => e.kind === 'paste');
  const automated = events.filter((e) => e.kind === 'automated_input');
  const inserted = typing.reduce((a, e) => a + (e.data.inserted ?? 0), 0);
  const deleted = typing.reduce((a, e) => a + (e.data.deleted ?? 0), 0);
  const activeMs = typing.reduce((a, e) => a + (e.data.activeMs ?? 0), 0);
  const decided = props.filter((p) => ['accepted', 'rejected', 'edited'].includes(p.decision));
  const count = (d: string) => decided.filter((p) => p.decision === d).length;
  const providers = [...new Set(props.map((p) => p.provider))];
  const snip = (s: string) => (includeText ? `"${s.slice(0, 90)}${s.length > 90 ? '...' : ''}"` : '(text omitted)');

  const lines: string[] = [];
  const L = (s = '') => lines.push(s);
  L(`Process report: ${doc.title}`);
  L(`Generated ${fmt(clock.now())} for revision ${revisionId}.`);
  L();
  L('WHAT THIS REPORT IS');
  L(
    'It lists what Writing Studio observed inside this editor and the decisions recorded here. It cannot see work done in other tools, and it is not proof of authorship or of the absence of assistance. Observed events are recorded by this application; they are not independently verified.',
  );
  L();
  L('IMPORT BOUNDARY');
  if (!imports.length) L('No import event recorded.');
  for (const e of imports)
    L(
      `- ${fmt(e.created_at)}: ${e.kind === 'draft_generated' ? 'a generated starting draft' : 'text imported'} (${e.data.words ?? '?'} words). The text arrived whole; any editing before this point was not observed and cannot be recovered.`,
    );
  L();
  L('OBSERVED WRITING IN THIS EDITOR');
  L(
    `- Typing batches recorded: ${typing.length}; characters inserted ${inserted}, deleted ${deleted}; active editing time about ${Math.round(activeMs / 60000)} min (idle and background processing excluded).`,
  );
  L(`- Paste events: ${pastes.length}${pastes.length ? ` (${pastes.reduce((a, e) => a + (e.data.chars ?? 0), 0)} characters pasted in total)` : ''}.`);
  L();
  L('AUTOMATED INPUT');
  if (!automated.length) L('No automated input (replayed or simulated typing) was recorded.');
  for (const e of automated)
    L(
      `- ${fmt(e.created_at)}: ${e.data.tool ?? 'automated tool'} supplied ${e.data.chars ?? '?'} characters. Automated playback is NOT an authorship event and is excluded from the observed writing above.`,
    );
  L();
  L('MODEL-ASSISTED STAGES');
  if (!runs.length && !props.length) L('No model-assisted review ran.');
  for (const r of runs)
    L(
      `- ${fmt(r.created_at)}: ${r.mode} review (${r.status}); editor ${r.summary?.providers?.editor ?? 'n/a'}${r.summary?.providers?.critic ? `, reviewer ${r.summary.providers.critic}` : ''}${r.summary?.providers?.independent === false ? ' (not independent)' : ''}.`,
    );
  if (providers.length) L(`Providers behind suggestions: ${providers.join(', ')}.`);
  const policies = [...new Set(props.map((p) => p.policy_version).filter(Boolean))];
  if (policies.length) L(`Clarity and hygiene policy: ${policies.join('; ')}.`);
  L();
  L('DECISIONS');
  L(
    `${props.length} suggestions shown: ${count('accepted')} accepted, ${count('edited')} edited then accepted, ${count('rejected')} rejected, ${props.length - decided.length} unresolved.`,
  );
  for (const p of decided) L(`- ${p.decision.toUpperCase()} ${String(p.issue).replace(/_/g, ' ')} from ${p.provider}: ${snip(p.original)}`);
  const restores = h.revisions.filter((r) => r.cause === 'restore').length;
  L(`Versions saved: ${h.revisions.length}; restores: ${restores}; branches: ${h.branches.length}.`);
  L();
  L('EVIDENCE STATUS AT THIS REVISION');
  if (!audits.length) L('No evidence audit has been run for this revision.');
  else
    L(
      `${audits.length} claims checked against the assignment readings: ${audits.filter((a) => a.verdict === 'supported').length} supported, ${audits.filter((a) => a.verdict === 'partial').length} partly supported, ${audits.filter((a) => a.verdict === 'contradicted').length} contradicted, ${audits.filter((a) => a.verdict === 'insufficient' || a.verdict === 'unreadable').length} not established. ${audits.filter((a) => a.stale).length} rely on a source that has since been replaced.`,
    );
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Process report: ${esc(String(doc.title))}</title><style>body{font:14px/1.5 Georgia,serif;max-width:46rem;margin:2rem auto;padding:0 1rem;color:#1c1917}h1{font-size:1.4rem}h2{font-size:.85rem;letter-spacing:.08em;margin-top:1.6rem;border-bottom:1px solid #d6d3d1}li{margin:.2rem 0}@media print{body{margin:0}}</style><body>${lines.map((l, i) => (i === 0 ? `<h1>${esc(l)}</h1>` : /^[A-Z][A-Z \-]+$/.test(l) ? `<h2>${esc(l)}</h2>` : l.startsWith('- ') ? `<li>${esc(l.slice(2))}</li>` : l ? `<p>${esc(l)}</p>` : '')).join('\n')}</body></html>`;
  void one;
  void j;
  return { lines, html };
}
