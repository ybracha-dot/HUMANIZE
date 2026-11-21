#!/usr/bin/env node
// Runs ONE fresh synthetic assignment (trees and city heat; not the attendance demo) through the same UI a student uses:
//   course -> upload sheet + reading -> brief -> idea -> thesis -> outline -> draft -> write -> Deep review (critique) ->
//   open exact source passage -> decide -> Evidence review (source verification) -> export -> receipts.
//
//   --mode fixture            default. Deterministic rules, no key. Receipts say "fixture".
//   --mode live               real provider. Needs ALL of: ANTHROPIC_API_KEY (or OPENAI_API_KEY + STUDIO_OPENAI_MODEL),
//                             STUDIO_PRICES_JSON, STUDIO_LIVE_BUDGET_USD (your spending authorization). Starts with one small probe request.
//   --mode mock-live          the live code path against a local HTTP mock. Receipts are labelled MOCK and are not provider evidence.
//   --dry-run                 (live) print what would be sent and the upper-bound cost, spend nothing.
// A key is never printed or written. Receipts go to ../.studio-build/receipts/.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { startMockAnthropic } from '../tests/support/mockAnthropic.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const argv = process.argv.slice(2);
const mode = argv.includes('--mode') ? argv[argv.indexOf('--mode') + 1] : 'fixture';
const dry = argv.includes('--dry-run');
if (!['fixture', 'live', 'mock-live'].includes(mode)) { console.error('--mode must be fixture, live or mock-live'); process.exit(2); }

const SETUP = `To run live, set these in the shell that launches this script (names only; values are yours):
  export ANTHROPIC_API_KEY=...                         # or: OPENAI_API_KEY=... and STUDIO_OPENAI_MODEL=...
  export STUDIO_ANTHROPIC_MODEL=<model id>             # optional; default claude-sonnet-5-5
  export STUDIO_PRICES_JSON='{"anthropic:<model id>":{"inputPerMTok":<USD>,"outputPerMTok":<USD>}}'   # copy from the provider's current price page
  export STUDIO_LIVE_BUDGET_USD=1                      # your authorization for this run
  cd app && npm ci && node scripts/run-assignment.mjs --mode live`;

let mock = null;
const env = { ...process.env };
if (mode === 'live') {
  const missing = [];
  if (!env.ANTHROPIC_API_KEY && !(env.OPENAI_API_KEY && env.STUDIO_OPENAI_MODEL)) missing.push('ANTHROPIC_API_KEY (or OPENAI_API_KEY + STUDIO_OPENAI_MODEL)');
  if (!env.STUDIO_PRICES_JSON) missing.push('STUDIO_PRICES_JSON');
  if (!(Number(env.STUDIO_LIVE_BUDGET_USD) > 0)) missing.push('STUDIO_LIVE_BUDGET_USD');
  if (missing.length) { console.error(`NOT RUN (live). Missing: ${missing.join(', ')}.\n\n${SETUP}`); process.exit(3); }
  // Never route a real key to a custom endpoint by accident: a base URL override is only honoured in mock-live.
  delete env.ANTHROPIC_BASE_URL; delete env.OPENAI_BASE_URL;
}
if (mode === 'mock-live') {
  mock = await startMockAnthropic();
  Object.assign(env, { ANTHROPIC_API_KEY: 'mock-key-not-real', ANTHROPIC_BASE_URL: mock.url, STUDIO_ANTHROPIC_MODEL: 'mock-model', STUDIO_PRICES_JSON: JSON.stringify({ 'anthropic:mock-model': { inputPerMTok: 3, outputPerMTok: 15, rev: 'mock' } }), STUDIO_LIVE_BUDGET_USD: '1' });
  delete env.OPENAI_API_KEY;
}
const live = mode !== 'fixture';
if (dry) { console.log(`DRY RUN (${mode}): would drive the UI through ~6 setup calls, a Deep review (~5 calls) and an Evidence review (1 call); budget ${env.STUDIO_LIVE_BUDGET_USD ?? 'n/a'} USD. Nothing sent.`); process.exit(0); }

const PORT = 8800 + Math.floor(Math.random() * 90);
const base = `http://127.0.0.1:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-run-'));
const t0 = Date.now();
const log = (m) => console.log(`[run +${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);
const chromiumPath = () => { if (env.CHROMIUM_PATH) return env.CHROMIUM_PATH; for (const d of fs.existsSync('/opt/pw-browsers') ? fs.readdirSync('/opt/pw-browsers').filter((x) => /^chromium-\d+$/.test(x)) : []) { const p = path.join('/opt/pw-browsers', d, 'chrome-linux64', 'chrome'); if (fs.existsSync(p)) return p; } return undefined; };

const server = spawn(process.execPath, ['scripts/start.mjs'], { cwd: root, env: { ...env, PORT: String(PORT), STUDIO_DATA_DIR: dataDir, STUDIO_LOCAL_MODE: '1', ...(live ? {} : { ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '' }) }, stdio: 'ignore' });
let browser; let receipts = null;
const stop = () => { try { server.kill('SIGTERM'); } catch {} mock?.close(); };
process.on('exit', stop);

try {
  for (let i = 0; i < 80; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch {} await new Promise((r) => setTimeout(r, 250)); }
  browser = await chromium.launch({ executablePath: chromiumPath(), args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const api = (method, url, body) => page.evaluate(async ([m, u, b]) => { const t = localStorage.getItem('studio.token'); const r = await fetch('/api' + u, { method: m, headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return r.json(); }, [method, url, body]);

  // ---- Settings first (so the assignment inherits the budget) ------------------------------------
  await page.goto(base + '/');
  if (live) {
    await page.goto(base + '/settings');
    await page.getByTestId('mode-live').click();
    await page.getByTestId('budget-input').fill(String(env.STUDIO_LIVE_BUDGET_USD));
    await page.getByTestId('budget-input').blur();
    await page.waitForTimeout(400);
    log(`Settings: Live mode, per-assignment budget $${env.STUDIO_LIVE_BUDGET_USD}`);
    await page.goto(base + '/');
  }

  // ---- course, assignment (the student's path) ---------------------------------------------------
  await page.getByTestId('start-title').fill('Assignment 3: Trees and city heat');
  await page.getByTestId('start-course-name').fill('ENV 210: Urban Environments (synthetic)');
  await page.getByTestId('start-go').click();
  await page.waitForURL(/\/assignments\/[^/]+\/materials$/);
  const asgId = page.url().split('/')[4];

  // ---- Materials: the assignment sheet and a 3-page PDF reading, then the brief -------------------
  await page.getByTestId('skip-syllabus').click();
  await page.getByTestId('row-assignment').getByTestId('intake-file-input').setInputFiles(path.join(root, 'fixtures/fresh', 'assignment.md'));
  await page.getByTestId('intake-import').click();
  await page.getByTestId('brief-view').waitFor();
  const briefText = (await page.getByTestId('brief-view').innerText()).replace(/\s+/g, ' ');
  assert.ok(/Claim/.test(briefText), 'rubric criteria read from the sheet');
  await page.getByTestId('row-readings').getByRole('button').first().click();
  await page.getByTestId('row-readings').getByTestId('intake-file-input').setInputFiles(path.join(root, 'fixtures/fresh', 'reading-canopy.pdf'));
  await page.getByTestId('row-readings').getByTestId('intake-import').click();
  await page.getByTestId('row-readings').getByTestId('intake-result').first().waitFor();
  log(`materials: sheet + 3-page PDF imported; brief shows ${(briefText.match(/points|Claim|Evidence/g) ?? []).length} graded signals with source links`);

  // ---- probe (live) ------------------------------------------------------------------------------
  let probe = null;
  if (live) {
    probe = await api('POST', `/assignments/${asgId}/probe`);
    if (probe.error) throw new Error(`probe failed: ${probe.error.message}`);
    log(`probe: ${probe.provider} ${probe.latencyMs}ms ${probe.inputTokens}in/${probe.outputTokens}out $${Number(probe.costUsd).toFixed(6)}`);
  }

  // ---- Plan: idea -> thesis -> outline -> draft ---------------------------------------------------
  await page.getByTestId('primary-action').click();
  await page.waitForURL(/\/plan$/);
  await page.getByTestId('idea-note').fill(fs.readFileSync(path.join(root, 'fixtures/fresh/student-note.txt'), 'utf8').trim());
  await page.getByTestId('explore-directions').click();
  await page.getByTestId('direction').nth(1).waitFor({ timeout: 120000 });
  const optionTexts = await page.getByTestId('direction').allInnerTexts();
  await page.locator('[data-testid^="choose-"]').first().click();
  await page.getByTestId('build-outline').click();
  await page.getByTestId('outline-item').first().waitFor({ timeout: 120000 });
  await page.getByTestId('draft-from-outline-open').click();
  await page.getByTestId('draft-allowed').check();
  await page.getByTestId('draft-from-outline').click();
  await page.waitForURL(/\/draft$/, { timeout: 180000 });
  await page.locator('.ProseMirror p').first().waitFor({ timeout: 180000 });
  log(`idea -> ${optionTexts.length} thesis options -> outline -> draft (${await page.locator('.ProseMirror p').count()} paragraphs)`);

  // ---- the student writes the claim under test ---------------------------------------------------
  const CLAIM = 'Tree canopy reduced afternoon surface temperatures.';
  await page.locator('.ProseMirror p').nth(1).click({ clickCount: 3 });
  await page.keyboard.type(CLAIM);
  await page.getByTestId('save-state').filter({ hasText: /^Saved$/ }).waitFor({ timeout: 15000 });

  // ---- Deep review: draft + independent critique + repair + re-check -----------------------------
  await page.getByTestId('to-review').click();
  await page.waitForURL(/\/review$/);
  await page.getByTestId('review-options').click();
  await page.getByTestId('mode-deep').check({ force: true });
  const estimate = await page.getByTestId('estimate').innerText();
  await page.getByTestId('start-review').click();
  await page.getByTestId('recommendation').waitFor({ timeout: 300000 });
  await page.getByTestId('view-all').click();
  await page.getByTestId('all-list').getByRole('button', { name: /canopy/i }).first().click();
  const card = page.getByTestId('recommendation');
  const cardText = (await card.innerText()).replace(/\s+/g, ' ');
  const providerBadge = (await page.getByTestId('mode-badge').innerText()).replace(/\s+/g, ' ');
  const replacement = (await card.locator('[data-testid="diff"] p').nth(1).innerText()).replace(/^Suggested\s*/i, '').replace(/\s+/g, ' ').trim();
  log(`critique ready: "${replacement.slice(0, 90)}..." [${providerBadge}]`);

  // ---- exact source passage ----------------------------------------------------------------------
  let evidence = null;
  const ev = card.getByTestId('open-evidence').first();
  if (await ev.count()) {
    await ev.click();
    await page.getByTestId('source-sheet').waitFor();
    evidence = {
      heading: (await page.locator('[data-testid="page-heading"]').filter({ hasText: /./ }).evaluateAll((els) => els.find((e) => e.nextElementSibling?.querySelector('mark.src-hit,.src-hit'))?.textContent ?? '')) || null,
      highlighted: (await page.getByTestId('evidence-highlight').first().innerText().catch(() => null)) ?? null,
    };
    await page.keyboard.press('Escape');
    await page.getByTestId('source-sheet').waitFor({ state: 'detached' });
  }
  // ---- decision ----------------------------------------------------------------------------------
  await card.getByTestId('accept').click();
  await page.getByTestId('last-action').waitFor();
  const docId = (await api('GET', `/assignments/${asgId}/overview`)).document.id;
  const headText = async () => (await api('GET', `/documents/${docId}`)).revision.paragraphs.map((p) => p.text);
  const accepted = (await headText())[1].replace(/\s+/g, ' ');
  log(`accepted: "${accepted.slice(0, 120)}"`);

  // ---- source verification of the approved text (Evidence review) --------------------------------
  if (!(await page.getByTestId('mode-evidence').count())) await page.getByTestId('review-options').click();
  await page.getByTestId('mode-evidence').check({ force: true });
  await page.getByTestId('start-review').click();
  await page.waitForTimeout(500);
  let audits = [];
  for (let i = 0; i < 120 && !audits.length; i++) {
    const doc = await api('GET', `/documents/${docId}`);
    const mine = (doc.audits ?? []).filter((a) => /canopy|temperature/i.test(a.claim));
    if (mine.length && (doc.audits ?? []).some((a) => /evidence|deterministic/.test(a.engine ?? '')) && (await api('GET', `/documents/${docId}/runs`)).every((r) => ['done', 'failed', 'canceled', 'blocked'].includes(r.status))) audits = mine;
    else await page.waitForTimeout(500);
  }

  // ---- export ------------------------------------------------------------------------------------
  await page.getByTestId('step-export').click();
  await page.waitForURL(/\/export$/);
  await page.getByTestId('export-text').waitFor();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-txt').click()]);
  const out = path.join(dataDir, dl.suggestedFilename());
  await dl.saveAs(out);
  const exported = fs.readFileSync(out, 'utf8');
  const exportedSha = crypto.createHash('sha256').update(exported).digest('hex');
  await page.getByTestId('export-more').click();
  const shownHash = await page.getByTestId('export-hash').innerText();
  const editorText = (await headText()).join('\n\n');
  assert.equal(exported, editorText, 'exported text equals the approved text');
  log(`exported ${exported.split(/\s+/).length} words; sha256 ${exportedSha.slice(0, 16)}...`);

  // ---- receipts ----------------------------------------------------------------------------------
  const spend = await api('GET', `/assignments/${asgId}/spend`);
  const runs = await api('GET', `/documents/${docId}/runs`);
  const settings = await api('GET', '/settings');
  const providerIds = [...new Set(spend.rows.map((r) => r.provider))];
  const labelOf = (p) => (p.startsWith('fixture') ? 'fixture (deterministic rules, not a model)' : mode === 'mock-live' ? 'MOCK of the live code path (local HTTP stand-in, NOT a provider)' : 'LIVE provider');
  const liveRows = spend.rows.filter((r) => r.paid);
  if (mode === 'live') { assert.ok(liveRows.length > 0, 'live mode produced paid calls'); assert.ok(!providerIds.some((p) => p.startsWith('fixture')), 'no fixture result in a live run'); assert.ok(!/Sample feedback/.test(await page.getByTestId('mode-badge').innerText()), 'UI must say Live'); }
  if (mode === 'fixture') assert.ok(spend.paidCalls === 0, 'fixture run made no paid call');
  const finalAudit = audits.find((a) => /canopy|temperature/i.test(a.claim));
  receipts = {
    generatedAt: new Date().toISOString(),
    mode, modeLabel: labelOf(providerIds[0] ?? 'fixture'), uiBadge: (await page.getByTestId('mode-badge').innerText()),
    assignment: 'Assignment 3: Trees and city heat (synthetic; reading: 3-page PDF, printed labels v-vii)',
    providers: { ids: providerIds, independentReviewer: runs.map((r) => r.summary?.providers?.independent).find((v) => v !== undefined), independence: settings.providers?.independence },
    models: [...new Set(spend.rows.map((r) => r.model))],
    probe,
    calls: spend.rows.map((r) => ({ provider: r.provider, model: r.model, state: r.state, paid: !!r.paid, latencyMs: r.latency_ms, inputTokens: r.input_tokens, outputTokens: r.output_tokens, costUsd: r.actual_usd, stage: String(r.stage_id).startsWith('direct_') ? String(r.stage_id).split('_')[1] : 'queued stage' })),
    totals: { calls: spend.calls, paidCalls: spend.paidCalls, settledUsd: spend.settledUsd, uncertainUsd: spend.uncertainUsd, wallClockSeconds: Math.round((Date.now() - t0) / 1000) },
    runs: runs.map((r) => ({ mode: r.mode, status: r.status, degraded: r.summary?.degraded ?? [], critic: r.summary?.providers?.critic ?? null, error: r.error })),
    estimateShownBeforeRun: estimate.replace(/\s+/g, ' ').slice(0, 300),
    revision: { studentSentence: CLAIM, suggestion: replacement, acceptedParagraph: accepted, badges: providerBadge, cardExcerpt: cardText.slice(0, 400) },
    sourcePassage: evidence,
    suggestionSupportedBySource: finalAudit ? { verdict: finalAudit.verdict, engine: finalAudit.engine, reasons: finalAudit.reasons, passageId: finalAudit.passageId, quote: finalAudit.quote?.text ?? null } : 'no audit row found',
    export: { words: exported.split(/\s+/).length, sha256: exportedSha, hashShownInApp: shownHash, identicalToApproved: exported === editorText },
    browserErrors: errors,
  };
  const outDir = path.resolve(root, '..', '.studio-build', 'receipts');
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${mode}.json`);
  fs.writeFileSync(file, JSON.stringify(receipts, null, 2));
  console.log('\n' + JSON.stringify({ file: path.relative(root, file), modeLabel: receipts.modeLabel, models: receipts.models, totals: receipts.totals, supported: receipts.suggestionSupportedBySource, exportSha256: exportedSha }, null, 2));
  assert.deepEqual(errors.filter((e) => !/favicon/i.test(e)), [], 'browser errors');
} catch (e) {
  console.error('[run] FAILED:', e?.message ?? e);
  process.exitCode = 1;
} finally {
  await browser?.close();
  stop();
  fs.rmSync(dataDir, { recursive: true, force: true });
}
