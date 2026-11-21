// Browser smoke test: drives the real UI in Chromium against a freshly started server (fixture mode, no keys).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import mammoth from 'mammoth';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const PORT = 8790;
const base = `http://127.0.0.1:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-smoke-'));
const shots = path.join(root, 'test-results'); fs.mkdirSync(shots, { recursive: true });
const t0 = Date.now();
const log = (m) => console.log(`[smoke +${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);

function chromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  for (const dir of ['/opt/pw-browsers']) if (fs.existsSync(dir)) for (const d of fs.readdirSync(dir).filter((x) => /^chromium-\d+$/.test(x))) { const p = path.join(dir, d, 'chrome-linux64', 'chrome'); if (fs.existsSync(p)) return p; }
  return undefined;
}

const server = spawn(process.execPath, ['scripts/start.mjs'], { cwd: root, env: { ...process.env, PORT: String(PORT), STUDIO_DATA_DIR: dataDir, STUDIO_LOCAL_MODE: '1', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '' }, stdio: 'ignore' });
let browser;
const cleanup = () => { try { server.kill('SIGTERM'); } catch {} };
process.on('exit', cleanup);

try {
  for (let i = 0; i < 80; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch {} await new Promise((r) => setTimeout(r, 250)); }
  browser = await chromium.launch({ executablePath: chromiumPath(), args: ['--no-sandbox'] });
  let ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, acceptDownloads: true });
  const errors = [];
  const watch = (page) => { page.on('pageerror', (e) => errors.push('pageerror: ' + e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); }); };
  let page = await ctx.newPage(); watch(page);

  // 1. sample course
  await page.goto(base + '/');
  await page.getByTestId('load-sample').click();
  await page.waitForURL(/\/assignments\//);
  assert.match(await page.getByTestId('mode-badge').innerText(), /Demo mode/);
  const asgUrl = page.url();
  log('sample loaded, demo mode badge present');

  // 2. brief: exact quote + jump
  await page.getByTestId('tab-brief').click();
  await page.getByTestId('brief-item').first().waitFor();
  assert.ok((await page.getByTestId('brief-item').count()) >= 6, 'brief items');
  assert.ok((await page.getByTestId('brief-conflict').count()) >= 1, 'conflict shown');
  await page.getByTestId('brief-jump').first().click();
  await page.getByTestId('source-reader').waitFor();
  assert.ok((await page.getByTestId('evidence-highlight').innerText()).length > 5);
  await page.getByTestId('back-to-draft').click();
  log('brief items with quotes, conflict, jump to the source highlight');

  // 3. idea -> thesis -> outline -> draft
  await page.getByTestId('tab-idea').click();
  await page.getByTestId('idea-note').fill('I think attendance helps, but motivated students might also show up more.');
  await page.getByTestId('find-directions').click();
  await page.getByTestId('thesis-option').nth(1).waitFor();
  assert.equal(await page.getByTestId('thesis-option').count(), 2);
  await page.getByTestId('choose-opt_association').click();
  await page.getByTestId('build-outline').click();
  await page.getByTestId('outline-item').first().waitFor();
  await page.getByTestId('draft-from-outline').click();
  await page.locator('.ProseMirror p').first().waitFor();
  assert.ok((await page.locator('.ProseMirror p').count()) >= 3);
  log('idea -> 2 thesis options -> outline -> reviewable draft');
  await page.screenshot({ path: path.join(shots, '1-draft.png') });

  // 4. write the evidence paragraph, lock thesis, save
  const paras = page.locator('.ProseMirror p');
  const thesisBefore = await paras.first().innerText();
  await paras.nth(1).click({ clickCount: 3 });
  await page.keyboard.type('Attendance is associated with higher exam scores.');
  await page.getByTestId('save-state').filter({ hasText: /Unsaved/ }).waitFor();
  await paras.first().click();
  await page.getByTestId('lock-thesis').click();
  await page.getByTestId('lock-list').waitFor();
  await page.getByTestId('save-state').filter({ hasText: /^Saved$/ }).waitFor();
  log('typed into the editor, thesis locked, saved');

  // 5. review through the durable queue
  await page.getByTestId('tab-review').click();
  await page.getByTestId('estimate').getByText(/free \(deterministic fixture engine/).first().waitFor();
  await page.getByTestId('start-review').click();
  await page.getByTestId('proposal-card').first().waitFor({ timeout: 30000 }); // the UI moves to Suggestions when the run finishes
  const cards = page.getByTestId('proposal-card');
  assert.ok((await cards.count()) >= 2);
  const sharpen = page.locator('[data-testid="proposal-card"][data-issue="weak_argument"]');
  const limit = page.locator('[data-testid="proposal-card"][data-issue="missing_requirement"]');
  assert.match(await sharpen.getByTestId('meaning-warnings').innerText(), /asserts causation/);
  assert.match(await limit.innerText(), /Because students chose whether to attend/);
  assert.match(await limit.innerText(), /fixture \(rules, not a model\)/);
  log('review done: causal rewrite warned, limitation offered, provider labelled as fixture');
  await page.screenshot({ path: path.join(shots, '2-suggestions.png') });

  // 6. one-click evidence jump to page 2, with printed label, highlight, return to the sentence
  await limit.getByTestId('open-evidence').first().click();
  await page.getByTestId('source-reader').waitFor();
  const heading = await page.locator('[data-testid="page-heading"]', { hasText: 'Viewer page 2' }).innerText();
  assert.match(heading, /viewer page 2 · printed page 14/i);
  const hl = (await page.getByTestId('evidence-highlight').innerText()).trim();
  assert.equal(hl, 'Students chose whether to attend.'); // the exact sentence, not the whole passage
  await page.screenshot({ path: path.join(shots, '3-evidence-page2.png') });
  await page.getByTestId('back-to-draft').click();
  await page.waitForFunction(() => document.activeElement?.closest('.ProseMirror') !== null);
  log('evidence jump: viewer page 2 / printed page 14, highlighted, focus returned to the draft');

  // 7. keyboard reject of the causal rewrite, then accept the limitation
  await sharpen.focus();
  await page.keyboard.press('r');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="proposal-card"][data-issue="weak_argument"]').length === 0);
  await page.locator('[data-testid="proposal-card"][data-issue="missing_requirement"]').getByTestId('accept').click();
  await page.getByTestId('undo').waitFor();
  const finalP2 = (await page.locator('.ProseMirror p').nth(1).innerText()).replace(/\s+/g, ' ');
  assert.equal(finalP2, 'Attendance is associated with higher exam scores. Because students chose whether to attend, this shows an association rather than an effect: motivated students might also show up more.');
  assert.equal(await page.locator('.ProseMirror p').first().innerText(), thesisBefore); // locked
  log('causal rewrite rejected by keyboard; limitation accepted; thesis lock held');
  await page.screenshot({ path: path.join(shots, '4-approved.png') });

  // 8. close the browser entirely; a fresh profile returns to the same work
  const approved = (await page.locator('.ProseMirror p').allInnerTexts()).join('\n\n');
  await ctx.close();
  ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, acceptDownloads: true });
  page = await ctx.newPage(); watch(page);
  await page.goto(asgUrl);
  await page.locator('.ProseMirror p').first().waitFor();
  assert.equal((await page.locator('.ProseMirror p').allInnerTexts()).join('\n\n'), approved);
  log('closed the browser; a brand-new profile reopened the identical approved draft');

  // 9. export: preview, escape closes the dialog, exact DOCX/TXT/PDF report
  await page.getByTestId('open-export').click();
  await page.getByTestId('export-preview').waitFor();
  assert.equal((await page.getByTestId('export-text').innerText()).replace(/\s+/g, ' '), approved.replace(/\s+/g, ' '));
  await page.keyboard.press('Escape');
  await page.getByTestId('export-preview').waitFor({ state: 'detached' });
  await page.getByTestId('open-export').click();
  await page.getByTestId('export-preview').waitFor();
  const dl = async (id) => { const [d] = await Promise.all([page.waitForEvent('download'), page.getByTestId(id).click()]); const p = path.join(dataDir, d.suggestedFilename()); await d.saveAs(p); return p; };
  const docxPath = await dl('export-docx');
  const txtPath = await dl('export-txt');
  const pdfPath = await dl('export-report-pdf');
  assert.equal((await mammoth.extractRawText({ path: docxPath })).value.replace(/\n\n$/, ''), approved);
  assert.equal(fs.readFileSync(txtPath, 'utf8'), approved);
  assert.equal(fs.readFileSync(pdfPath).subarray(0, 5).toString(), '%PDF-');
  log('exported DOCX + TXT identical to the approved text; process report PDF produced');
  await page.keyboard.press('Escape');

  // 10. history: versions, import boundary, restore without erasing
  await page.getByTestId('history-link').click();
  await page.getByTestId('revision-row').first().waitFor();
  const before = await page.getByTestId('revision-row').count();
  assert.match(await page.getByTestId('import-boundary').innerText(), /Edits made before an import were not observed/);
  assert.ok((await page.locator('[data-testid="revision-row"][data-cause="accept"]').count()) >= 1);
  await page.getByTestId('restore').last().click();
  await page.waitForFunction((n) => document.querySelectorAll('[data-testid="revision-row"]').length === n + 1, before);
  assert.ok((await page.locator('[data-testid="revision-row"][data-cause="restore"]').count()) === 1);
  assert.ok((await page.locator('[data-testid="revision-row"][data-cause="accept"]').count()) >= 1);
  log('history: restore added a version; the accepted version is still there');

  // 11. mobile: one panel at a time, focus returns to the sentence
  const m = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mp = await m.newPage(); watch(mp);
  await mp.goto(asgUrl);
  await mp.locator('.ProseMirror p').first().waitFor();
  assert.equal(await mp.getByRole('tab', { name: /Suggestions/ }).isVisible(), false);
  await mp.getByRole('button', { name: 'Panels' }).click();
  assert.equal(await mp.locator('.ProseMirror').isVisible(), false);
  await mp.getByTestId('tab-brief').click();
  await mp.getByTestId('brief-jump').first().click();
  await mp.getByTestId('source-reader').waitFor();
  await mp.getByTestId('back-to-draft').click();
  await mp.locator('.ProseMirror').waitFor({ state: 'visible' });
  const overflow = await mp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  assert.equal(overflow, false, 'no horizontal page scroll at phone width');
  await mp.screenshot({ path: path.join(shots, '5-mobile.png') });
  log('mobile 390px: single panel at a time, back-to-draft restores the editor, no horizontal scroll');

  const real = errors.filter((e) => !/favicon/i.test(e));
  assert.deepEqual(real, [], 'browser console/page errors: ' + real.join(' | '));
  log(`PASS in ${((Date.now() - t0) / 1000).toFixed(1)}s (Chromium, Linux, fixture mode)`);
} catch (e) {
  console.error('[smoke] FAIL', e);
  process.exitCode = 1;
} finally {
  await browser?.close();
  cleanup();
  fs.rmSync(dataDir, { recursive: true, force: true });
}
