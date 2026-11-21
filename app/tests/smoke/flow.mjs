// Journey 3: the whole paper on the attendance sample: choose the limit, plan, generate a reviewable draft, protect the thesis, write, review, decide
// with the evidence sheet and the keyboard, reopen in a new browser profile, export, history, and the same stages on a phone.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import mammoth from 'mammoth';
import { DESKTOP, PHONE, log, shot, startStudio } from './lib.mjs';

const studio = await startStudio();
let failed = false;
const allErrors = [];
try {
  const seed = await studio.api('POST', '/demo/seed');
  const asgUrl = `${studio.base}/assignments/${seed.assignmentId}`;
  let { page, ctx, errors } = await studio.newPage(DESKTOP);
  allErrors.push(errors);

  // 1 · materials -> choose the limit -> plan
  await page.goto(asgUrl);
  await page.waitForURL(/\/materials$/);
  assert.match(await page.getByTestId('mode-badge').innerText(), /Sample feedback/);
  await page.getByTestId('primary-action').click();
  await page.getByTestId('conflict-option').filter({ hasText: 'Assignment sheet' }).getByTestId('conflict-choose').click();
  await page.getByTestId('primary-action').filter({ hasText: 'Start my plan' }).click();
  await page.waitForURL(/\/plan$/);
  log('materials: limit chosen, next action took us to Plan');

  // 2 · plan: idea -> two directions -> thesis -> outline -> explicit, acknowledged draft generation
  assert.equal(await page.getByTestId('idea-note').inputValue(), '');
  await page.getByTestId('sample-idea').click();
  await page.getByTestId('explore-directions').click();
  await page.getByTestId('direction').nth(1).waitFor();
  assert.equal(await page.getByTestId('direction').count(), 2);
  assert.ok((await page.getByTestId('passage-chip').first().innerText()).length > 8, 'readings are named, not shown as ids');
  await shot(page, 'plan-directions-desktop');
  await page.getByTestId('choose-opt_association').click();
  await page.getByTestId('thesis-text').waitFor();
  await page.getByTestId('build-outline').click();
  await page.getByTestId('outline-item').first().waitFor();
  assert.ok((await page.getByTestId('outline-item').count()) >= 3);
  await shot(page, 'plan-outline-desktop');
  await page.getByTestId('draft-from-outline-open').click();
  assert.equal(await page.getByTestId('draft-from-outline').isDisabled(), true, 'generation needs the student to acknowledge the policy first');
  assert.match(await page.getByTestId('draft-confirm').innerText(), /You may use AI tools for brainstorming/);
  await page.getByTestId('draft-allowed').check();
  await page.getByTestId('draft-from-outline').click();
  await page.waitForURL(/\/draft$/);
  await page.locator('.ProseMirror p').first().waitFor();
  assert.ok((await page.locator('.ProseMirror p').count()) >= 3);
  log('plan: idea -> 2 directions -> thesis -> outline -> acknowledged generation -> Draft');

  // 3 · draft: write, protect the thesis, autosave, word count and target
  const paras = page.locator('.ProseMirror p');
  const thesisBefore = await paras.first().innerText();
  await paras.nth(1).click({ clickCount: 3 });
  await page.keyboard.type('Attendance is associated with higher exam scores.');
  await page.getByTestId('save-state').filter({ hasText: /Unsaved/ }).waitFor();
  await paras.first().click();
  await page.getByTestId('open-drawer').click();
  await page.getByTestId('protect-thesis').click();
  await page.getByTestId('lock-list').waitFor();
  assert.match(await page.getByTestId('lock-list').innerText(), /Thesis/);
  await page.getByTestId('save-state').filter({ hasText: /^Saved$/ }).waitFor();
  assert.match(await page.getByTestId('word-target').innerText(), /target 800–1,000/);
  assert.match(await page.getByTestId('word-count').innerText(), /^\d+ words?$/);
  await shot(page, 'draft-drawer-desktop');
  await page.keyboard.press('Escape');
  await page.getByTestId('drawer').waitFor({ state: 'detached' });
  await shot(page, 'draft-desktop');
  // the word target opens its source; Escape returns to the sentence being edited
  await paras.nth(2).click();
  await page.getByTestId('word-target').click();
  await page.getByTestId('source-sheet').waitFor();
  await page.keyboard.press('Escape');
  await page.getByTestId('source-sheet').waitFor({ state: 'detached' });
  await page.waitForFunction(() => document.activeElement?.closest('.ProseMirror') !== null);
  log('draft: typed, thesis protected, autosaved, word target opens its source and returns to the editor');

  // 3b · mid-edit navigation never loses text: type, leave at once, come back
  await paras.nth(2).click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Mid-edit marker.');
  await page.getByTestId('step-review').click();
  await page.waitForURL(/\/review$/);
  await page.getByTestId('step-draft').click();
  await page.waitForURL(/\/draft$/);
  await page.locator('.ProseMirror p').first().waitFor();
  assert.ok((await page.locator('.ProseMirror').innerText()).includes('Mid-edit marker.'), 'text typed just before leaving is still there');
  log('draft: text typed just before leaving was saved and is still there on return');

  // 3c · a second tab saves; this tab is told, keeps its text, and can save it on top
  const docId = (await studio.api('GET', `/assignments/${seed.assignmentId}/overview`)).document.id;
  const dv = await studio.api('GET', `/documents/${docId}`);
  const other = dv.revision.paragraphs.map((p, i) => (i === dv.revision.paragraphs.length - 1 ? { ...p, text: p.text + ' (edited elsewhere)' } : p));
  await studio.api('POST', `/documents/${docId}/revisions`, { baseRevisionId: dv.revision.id, paragraphs: other, label: 'Other tab' });
  const lastPara = page.locator('.ProseMirror p').last();
  await lastPara.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Mine.');
  await page.getByTestId('stale-banner').waitFor({ timeout: 15000 });
  assert.ok((await page.locator('.ProseMirror').innerText()).includes(' Mine.'), 'my text is still on the page');
  assert.equal((await page.getByTestId('save-state').innerText()).includes('Saved'), false);
  await page.getByTestId('stale-mine').click();
  await page.getByTestId('stale-banner').waitFor({ state: 'detached' });
  await page.getByTestId('save-state').filter({ hasText: /^Saved$/ }).waitFor();
  assert.ok((await page.locator('.ProseMirror').innerText()).includes(' Mine.'));
  log('draft: second-tab save detected, my text kept on screen, saved on top without loss');
  // put the draft back to the clean test text for the review decisions below
  const dv2 = await studio.api('GET', `/documents/${docId}`);
  const cleaned = dv2.revision.paragraphs.map((p) => ({ ...p, text: p.text.replace(' Mid-edit marker.', '').replace(' (edited elsewhere)', '').replace(' Mine.', '') }));
  await studio.api('POST', `/documents/${docId}/revisions`, { baseRevisionId: dv2.revision.id, paragraphs: cleaned, label: 'Test reset' });
  await page.reload();
  await page.locator('.ProseMirror p').first().waitFor();

  // 4 · review: real stages, one recommendation at a time
  await page.getByTestId('to-review').click();
  await page.waitForURL(/\/review$/);
  await page.getByTestId('start-quick').waitFor();
  assert.match(await page.getByTestId('review-estimate').innerText(), /Free in this setup/);
  await shot(page, 'review-start-desktop');
  await page.getByTestId('start-quick').click();
  await page.getByTestId('recommendation').waitFor({ timeout: 30000 });
  const total = Number((await page.locator('#rec-h').innerText()).match(/of (\d+)/)[1]);
  assert.ok(total >= 2, 'at least two recommendations');
  const pick = async (label) => {
    if (!(await page.getByTestId('all-list').count())) await page.getByTestId('view-all').click();
    await page.getByTestId('all-list').getByRole('button', { name: new RegExp(`^\\d+\\. ${label}`) }).click();
  };
  await pick('Argument');
  const rec = page.getByTestId('recommendation');
  assert.match(await rec.getByTestId('meaning-warnings').innerText(), /asserts causation/);
  assert.equal((await rec.locator('.btn-primary').first().innerText()).replace(/\s+a?r?$/, '').trim().startsWith('Keep my wording'), true, 'risky change: keeping wording is the primary action');
  await shot(page, 'review-recommendation-desktop');
  {
    const rp = await studio.newPage(PHONE);
    allErrors.push(rp.errors);
    await rp.page.goto(`${asgUrl}/review`);
    await rp.page.getByTestId('recommendation').waitFor();
    await shot(rp.page, 'review-recommendation-phone');
    await rp.ctx.close();
  }
  await pick('Missing requirement');
  assert.match(await rec.innerText(), /Because students chose whether to attend/);
  // evidence opens at the exact sentence, with PDF page and printed page, and Escape returns focus to the opener
  await rec.getByTestId('open-evidence').click();
  await page.getByTestId('source-sheet').waitFor();
  assert.match(await page.getByTestId('page-heading').filter({ hasText: /page 2/i }).first().innerText(), /PDF viewer page 2 · printed page 14/i);
  assert.equal((await page.getByTestId('evidence-highlight').innerText()).trim(), 'Students chose whether to attend.');
  await shot(page, 'review-evidence-desktop');
  await page.keyboard.press('Escape');
  await page.getByTestId('source-sheet').waitFor({ state: 'detached' });
  await page.waitForFunction(() => /Open the evidence/.test(document.activeElement?.textContent ?? ''));
  // keyboard: keep wording on the causal rewrite, use the limitation
  await pick('Argument');
  await page.locator('body').click({ position: { x: 5, y: 300 } });
  await page.keyboard.press('r');
  await page.waitForFunction(() => !document.querySelector('[data-testid="recommendation"][data-issue="weak_argument"]'));
  assert.match(await page.getByTestId('last-action').innerText(), /Kept your wording/);
  let guard = 0;
  while ((await page.getByTestId('recommendation').count()) && guard++ < 6) {
    const issue = await page.getByTestId('recommendation').getAttribute('data-issue');
    await page.locator('body').click({ position: { x: 5, y: 300 } });
    await page.keyboard.press(issue === 'weak_argument' ? 'r' : 'a');
    await page.waitForTimeout(400);
  }
  await page.getByTestId('review-outcome').waitFor();
  assert.match(await page.getByTestId('outcome-line').innerText(), /\d+ changes? applied · \d+ kept as written/);
  await shot(page, 'review-outcome-desktop');
  log('review: real stages, one recommendation at a time, evidence at PDF p2 / printed p14, keyboard decisions, outcome: ' + (await page.getByTestId('outcome-line').innerText()));

  // 5 · a brand-new browser profile reopens the same work in the right place
  await page.goto(asgUrl + '/draft');
  await page.locator('.ProseMirror p').first().waitFor();
  const approved = (await page.locator('.ProseMirror p').allInnerTexts()).join('\n\n');
  assert.ok(approved.includes('Attendance is associated with higher exam scores.'));
  assert.equal(await page.locator('.ProseMirror p').first().innerText(), thesisBefore, 'locked thesis unchanged');
  await ctx.close();
  ({ page, ctx, errors } = await studio.newPage(DESKTOP));
  allErrors.push(errors);
  await page.goto(asgUrl);
  await page.waitForURL(/\/(draft|review|export)$/);
  log('fresh profile: opening the assignment resumed at ' + new URL(page.url()).pathname.split('/').pop());
  await page.goto(asgUrl + '/draft');
  await page.locator('.ProseMirror p').first().waitFor();
  assert.equal((await page.locator('.ProseMirror p').allInnerTexts()).join('\n\n'), approved);

  // 6 · export: preview equals the file; download counts only after success
  await page.getByTestId('step-export').click();
  await page.waitForURL(/\/export$/);
  assert.equal((await studio.api('GET', `/assignments/${seed.assignmentId}/overview`)).facts.exportDone, false, 'visiting Export does not complete it');
  await page.getByTestId('export-text').waitFor();
  assert.equal((await page.getByTestId('export-text').innerText()).replace(/\s+/g, ' ').trim(), approved.replace(/\s+/g, ' ').trim());
  assert.equal(await page.getByTestId('export-hash').isVisible(), false, 'hash is behind details');
  await shot(page, 'export-desktop');
  const dl = async (id) => {
    const [d] = await Promise.all([page.waitForEvent('download'), page.getByTestId(id).click()]);
    const p = path.join(studio.dataDir, d.suggestedFilename());
    await d.saveAs(p);
    return p;
  };
  const docxPath = await dl('export-docx');
  await page.getByTestId('export-done').waitFor();
  assert.equal((await studio.api('GET', `/assignments/${seed.assignmentId}/overview`)).facts.exportDone, true, 'a successful download completes Export');
  const txtPath = await dl('export-txt');
  const pdfPath = await dl('export-report-pdf');
  assert.equal((await mammoth.extractRawText({ path: docxPath })).value.replace(/\n\n$/, ''), approved);
  assert.equal(fs.readFileSync(txtPath, 'utf8'), approved);
  assert.equal(fs.readFileSync(pdfPath).subarray(0, 5).toString(), '%PDF-');
  // statement: shown exactly as it will be exported
  await page.getByTestId('include-statement').check();
  await page.getByTestId('statement').fill('I used a sample reviewer for edits and checked each one.');
  assert.match(await page.getByTestId('export-statement-preview').innerText(), /sample reviewer/);
  const txt2 = await dl('export-txt');
  assert.equal(fs.readFileSync(txt2, 'utf8'), approved + '\n\nI used a sample reviewer for edits and checked each one.');
  log('export: preview == DOCX == TXT; PDF report produced; Export completes only after a successful download; statement previewed exactly');

  // 7 · history is reachable from Draft and returns to Draft
  await page.getByTestId('step-draft').click();
  await page.waitForURL(/\/draft$/);
  assert.equal(await page.getByTestId('step-export').getAttribute('data-state'), 'complete', 'Export shows complete once left');
  await page.getByTestId('open-drawer').click();
  await page.getByTestId('drawer-tab-history').click();
  await page.getByTestId('history-link').click();
  await page.getByTestId('revision-row').first().waitFor();
  assert.match(await page.getByTestId('import-boundary').innerText(), /Edits made before an import were not observed/);
  await page.getByTestId('back-to-draft').click();
  await page.waitForURL(/\/draft$/);
  log('history reachable from the Draft drawer');
  for (const st of ['export', 'draft', 'review']) {
    await page.goto(`${asgUrl}/${st}`);
    await page.getByTestId('theme-dark').click();
    await page.waitForTimeout(600);
    await shot(page, `${st}-dark-desktop`);
  }
  await page.getByTestId('theme-light').click();
  await ctx.close();

  // 8 · phone: every stage fits, no horizontal scroll
  const ph = await studio.newPage(PHONE);
  allErrors.push(ph.errors);
  for (const st of ['materials', 'plan', 'draft', 'review', 'export']) {
    await ph.page.goto(`${asgUrl}/${st}`);
    await ph.page.getByTestId(`stage-${st}`).or(ph.page.getByTestId('stage')).first().waitFor();
    await ph.page.waitForTimeout(500);
    const overflow = await ph.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 1, `${st}: no horizontal scroll at 390px (over by ${overflow})`);
    assert.match(await ph.page.getByTestId('step-summary').innerText(), /Step \d of 5/);
    await shot(ph.page, `${st}-phone`);
  }
  await ph.page.goto(`${asgUrl}/draft`);
  await ph.page.locator('.ProseMirror p').first().waitFor();
  await ph.page.getByTestId('open-drawer').click();
  await ph.page.getByTestId('drawer').waitFor();
  const box = await ph.page.getByTestId('drawer').boundingBox();
  assert.ok(box.y > 100 && box.width <= 391, 'drawer is a bottom sheet on a phone');
  await shot(ph.page, 'draft-drawer-phone');
  log('phone 390px: all five stages fit without horizontal scroll; drawer is a bottom sheet');

  const real = allErrors.flat().filter((e) => !/favicon/i.test(e) && !/status of 409 \(Conflict\)/.test(e)); // the one deliberate stale save in 3c
  assert.deepEqual(real, [], 'browser console/page errors: ' + real.join(' | '));
  log('PASS full-paper journey');
} catch (e) {
  console.error('[journey] FAIL', e);
  failed = true;
} finally {
  await studio.stop();
  process.exitCode = failed ? 1 : 0;
}
