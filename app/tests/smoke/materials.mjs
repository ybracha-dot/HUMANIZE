// Journey 1 and 2: a brand-new assignment (paste instructions, get a brief) and the preloaded attendance sample (resolve the length conflict).
import assert from 'node:assert/strict';
import { DESKTOP, PHONE, log, shot, startStudio } from './lib.mjs';

const SHEET = `Write a short argumentative essay on whether school should start later. Length: 700-900 words. Use APA citations. Due Friday, Mar 7 at 11:59 pm ET.\n\nArgument (40 points)\nEvidence (30 points)\nClarity (30 points)\n\nYou may use AI tools if you disclose how.`;
const studio = await startStudio();
let failed = false;
try {
  // ---------------------------------------------------------------- 1. cold start
  const course = await studio.api('POST', '/courses', { name: 'Sociology 101' });
  const asg = await studio.api('POST', `/courses/${course.id}/assignments`, { title: 'Paper one' });
  for (const [vp, name] of [[DESKTOP, 'desktop'], [PHONE, 'phone']]) {
    const { page, errors } = await studio.newPage(vp);
    const a = vp === DESKTOP ? asg : await studio.api('POST', `/courses/${course.id}/assignments`, { title: `Paper phone ${name}` });
    await page.goto(`${studio.base}/assignments/${a.id}`);
    await page.waitForURL(/\/assignments\/[^/]+\/materials$/);
    assert.equal(await page.getByRole('heading', { level: 1 }).innerText(), 'Set up your paper');
    // stage, first ask and a useful action are visible without scrolling
    const first = page.getByTestId('intake-choose').first();
    await first.waitFor();
    const box = await first.boundingBox();
    assert.ok(box && box.y + box.height < vp.height, `primary control visible at ${vp.width}x${vp.height}`);
    assert.equal(await page.getByTestId('stepper').count(), 1);
    if (name === 'desktop') assert.equal(await page.getByTestId('step-materials').getAttribute('aria-current'), 'step');
    else assert.match(await page.getByTestId('step-summary').innerText(), /Step 1 of 5\s*·\s*Materials/);
    await shot(page, `new-materials-${name}`);
    // skip the syllabus and paste instructions without leaving this page
    await page.getByTestId('skip-syllabus').click();
    await page.getByTestId('intake-paste-toggle').nth(0).waitFor();
    await page.locator('[data-testid="intake-paste-toggle"]:visible').first().click();
    await page.getByTestId('intake-paste').fill(SHEET);
    await page.getByTestId('intake-paste-submit').click();
    await page.getByTestId('brief-view').waitFor();
    assert.match(await page.getByTestId('brief-deliverable').innerText(), /argumentative essay on whether school should start later/);
    assert.match(await page.getByTestId('brief-word_range').innerText(), /700.900 words/);
    assert.match(await page.getByTestId('brief-deadline').innerText(), /ET/);
    assert.match(await page.getByTestId('brief-citation_style').innerText(), /APA/);
    assert.deepEqual(await page.locator('[data-testid="brief-criteria"] li').evaluateAll((els) => els.map((e) => e.innerText.replace(/See where/, '').replace(/\s+/g, ' ').trim())), ['Argument 40 points', 'Evidence 30 points', 'Clarity 30 points']);
    assert.equal(page.url().includes('/materials'), true, 'still in Materials: no other page was needed');
    assert.equal(await page.getByTestId('primary-action').innerText(), 'Start my plan');
    await shot(page, `new-brief-${name}`);
    assert.deepEqual(errors, [], 'no browser errors');
    log(`${name}: cold start -> skip syllabus -> pasted instructions -> brief with length, due date, citation, 3 criteria`);
  }

  // ---------------------------------------------------------------- 2. attendance sample
  const seed = await studio.api('POST', '/demo/seed');
  const before = (await studio.api('GET', `/courses/${seed.courseId}`)).sources.length;
  for (const [vp, name] of [[PHONE, 'phone'], [DESKTOP, 'desktop']]) { // phone first: it only looks; desktop then resolves the conflict on the same real sample
    const sampleAsg = seed.assignmentId;
    const { page, errors } = await studio.newPage(vp);
    await page.goto(`${studio.base}/assignments/${sampleAsg}`);
    await page.getByTestId('brief-view').waitFor();
    assert.equal(await page.getByRole('heading', { name: 'Your assignment at a glance' }).count(), 1);
    if (name === 'desktop') {
      assert.match(await page.getByTestId('brief-deliverable').innerText(), /attendance improves exam performance/);
      const len = await page.getByTestId('brief-length-conflict').innerText();
      assert.match(len, /800.1000 words/); assert.match(len, /800.1200 words/);
      assert.equal(await page.getByTestId('primary-action').innerText(), 'Choose word limit');
      assert.equal(await page.locator('[data-testid="intake"]:visible').count(), 0, 'no request to upload anything again');
      await shot(page, `sample-brief-${name}`);
      // choose the limit: both original quotes are shown
      await page.getByTestId('primary-action').click();
      await page.getByTestId('conflict-chooser').waitFor();
      const opts = await page.getByTestId('conflict-option').allInnerTexts();
      assert.equal(opts.length, 2);
      assert.ok(opts.some((t) => /Syllabus/.test(t) && /Aug 28/.test(t)) && opts.some((t) => /Assignment sheet/.test(t) && /Oct 3/.test(t)));
      await shot(page, `sample-conflict-${name}`);
      // open an original in the sheet; Escape closes it and focus returns
      const openBtn = page.getByRole('button', { name: 'Open the original' }).first();
      await openBtn.click();
      await page.getByTestId('source-sheet').waitFor();
      assert.match(await page.getByTestId('evidence-highlight').first().innerText(), /800.*words/i);
      await page.keyboard.press('Escape');
      await page.getByTestId('source-sheet').waitFor({ state: 'detached' });
      assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Open the original');
      // one click records the choice
      await page.getByTestId('conflict-option').filter({ hasText: 'Assignment sheet' }).getByTestId('conflict-choose').click();
      await page.getByTestId('conflict-chooser').waitFor({ state: 'detached' });
      assert.match(await page.getByTestId('brief-word_range').innerText(), /800.1000 words/);
      assert.equal(await page.getByTestId('primary-action').innerText(), 'Start my plan');
      // reload: the choice persists and nothing was uploaded
      await page.reload();
      await page.getByTestId('brief-view').waitFor();
      assert.match(await page.getByTestId('brief-word_range').innerText(), /800.1000 words/);
      assert.equal(await page.getByTestId('primary-action').innerText(), 'Start my plan');
      assert.equal((await studio.api('GET', `/courses/${seed.courseId}`)).sources.length >= before, true);
      await shot(page, `sample-resolved-${name}`);
      log('sample desktop: conflict shown with both limits -> original opened and closed by Escape -> choice recorded -> survives reload -> next action is "Start my plan"');
    } else {
      await shot(page, `sample-brief-${name}`);
      log('sample phone: brief visible at 390x844');
    }
    assert.deepEqual(errors, [], 'no browser errors');
  }
  log('PASS materials journeys');
} catch (e) {
  console.error('[journey] FAIL', e);
  failed = true;
} finally {
  await studio.stop();
  process.exitCode = failed ? 1 : 0;
}
