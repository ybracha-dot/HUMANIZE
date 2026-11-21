// Journey 4: the truthfulness and access checks from the redesign brief: locked stages, draft-first, mixed upload, theme, keyboard, small screens.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DESKTOP, PHONE, log, root, shot, startStudio } from './lib.mjs';

const studio = await startStudio();
let failed = false;
const allErrors = [];
const mkAsg = async (title) => {
  const course = (await studio.api('GET', '/courses')).find?.((c) => c.name === 'Checks') ?? (await studio.api('POST', '/courses', { name: 'Checks' }));
  return (await studio.api('POST', `/courses/${course.id}/assignments`, { title })).id;
};
const stageOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
try {
  // ---- A · stages that cannot be used yet say why and offer the next step; deep links work
  {
    const id = await mkAsg('Locked');
    const { page, errors } = await studio.newPage(DESKTOP);
    allErrors.push(errors);
    await page.goto(`${studio.base}/assignments/${id}/review`);
    await page.getByTestId('locked-review').waitFor();
    assert.match(await page.getByTestId('locked-review').innerText(), /draft/i);
    assert.equal(await page.getByTestId('step-export').getAttribute('data-state'), 'unavailable');
    assert.equal(await page.getByTestId('step-draft').getAttribute('data-state'), 'available');
    await page.getByTestId('unlock-action').click();
    await page.waitForURL(/\/draft$/);
    await page.getByTestId('blank-page').waitFor();
    log('locked Review explains itself and its action leads to Draft; deep links work');
  }

  // ---- B · draft-first: paste a draft, land in the editor, nothing generated, nothing spent
  {
    const id = await mkAsg('Draft first');
    const { page, errors } = await studio.newPage(DESKTOP);
    allErrors.push(errors);
    await page.goto(`${studio.base}/assignments/${id}/materials`);
    await page.getByTestId('have-draft').click();
    await page.getByTestId('draft-paste').fill('Schools should start later. Sleep matters.\n\nTeenagers need more sleep than adults do.');
    await page.getByTestId('draft-open').click();
    await page.waitForURL(/\/draft$/);
    await page.locator('.ProseMirror p').first().waitFor();
    assert.equal(await page.locator('.ProseMirror p').count(), 2);
    assert.match(await page.getByTestId('word-count').innerText(), /^13 words$/);
    assert.equal((await studio.api('GET', `/assignments/${id}/spend`)).calls, 0, 'no model call for a pasted draft');
    assert.equal((await studio.api('GET', `/assignments/${id}/overview`)).facts.hasDraft, true);
    await page.getByTestId('to-review').click();
    await page.getByTestId('start-quick').waitFor();
    log('draft-first: pasted draft opened in the editor untouched, 13 words, zero model calls, Review reachable');
  }

  // ---- C · mixed upload tells the truth about each file and retries only what failed
  {
    const id = await mkAsg('Mixed upload');
    const dir = fs.mkdtempSync(path.join(studio.dataDir, 'up-'));
    const bad = path.join(dir, 'broken-reading.pdf');
    fs.writeFileSync(bad, 'this is not a pdf');
    const good = path.join(root, 'fixtures', 'fresh', 'reading-canopy.pdf');
    const { page, errors } = await studio.newPage(DESKTOP);
    allErrors.push(errors);
    await page.goto(`${studio.base}/assignments/${id}/materials`);
    await page.getByTestId('skip-syllabus').click();
    await page.getByTestId('row-readings').getByRole('button').first().click();
    await page.getByTestId('row-readings').getByTestId('intake-file-input').setInputFiles([good, bad]);
    await page.getByTestId('intake-entry').nth(1).waitFor();
    for (const sel of await page.getByTestId('intake-type').all()) if ((await sel.inputValue()) === '') await sel.selectOption('reading');
    await page.getByTestId('intake-import').click();
    await page.getByTestId('intake-result').nth(1).waitFor();
    const results = await page.getByTestId('intake-entry').evaluateAll((els) => els.map((e) => [e.querySelector('span.font-medium')?.textContent, e.getAttribute('data-status')]));
    assert.deepEqual(results.map((r) => r[1]), ['ready', 'failed'], JSON.stringify(results));
    assert.match(await page.getByTestId('intake-entry').nth(1).getByTestId('intake-result').innerText(), /Could not/);
    const summary = await page.getByTestId('row-readings').getByTestId('row-summary').innerText();
    assert.doesNotMatch(summary, /2 readings/i, 'the unreadable file is not counted as ready: ' + summary);
    await shot(page, 'mixed-upload-desktop');
    // replace the failed file without starting over; the good one is not imported twice
    await page.getByTestId('intake-entry').nth(1).getByTestId('intake-replace-input').setInputFiles(path.join(root, 'fixtures', 'sample', 'reading-attendance.pdf'));
    await page.getByTestId('intake-import').click();
    await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="intake-entry"]')].every((e) => e.getAttribute('data-status') === 'ready'));
    const sources = (await studio.api('GET', `/assignments/${id}/overview`)).materials.readings;
    assert.equal(sources.filter((s) => s.status === 'ready').length, 2);
    assert.equal(new Set(sources.map((s) => s.title)).size, sources.length, 'no duplicates');
    log('mixed upload: ready + could-not-read shown per file, failed one replaced in place, no duplicate of the good file');
  }

  // ---- D · theme: light by default on a dark OS, explicit choice persists
  {
    const id = await mkAsg('Theme');
    const { chromium } = await import('playwright-core');
    const { chromiumPath } = await import('./lib.mjs');
    const b = await chromium.launch({ executablePath: chromiumPath(), args: ['--no-sandbox'] });
    const c = await b.newContext({ viewport: DESKTOP, colorScheme: 'dark' });
    await c.addInitScript((t) => localStorage.setItem('studio.token', t), studio.token);
    const page = await c.newPage();
    await page.goto(`${studio.base}/assignments/${id}/materials`);
    await page.getByTestId('stage-materials').waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'light', 'first visit is light even on a dark OS');
    await page.getByTestId('theme-dark').click();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
    await page.reload();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark', 'explicit choice persists');
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    assert.notEqual(bg, 'rgb(255, 255, 255)');
    await shot(page, 'materials-dark-desktop');
    await page.getByTestId('theme-system').click();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark', 'System follows the dark OS');
    await b.close();
    log('theme: light first on a dark OS; Dark persists; System follows the OS');
  }

  // ---- E · keyboard only: skip link, visible focus, stepper reachable and operable
  {
    const id = await mkAsg('Keyboard');
    const { page, errors } = await studio.newPage(DESKTOP);
    allErrors.push(errors);
    await page.goto(`${studio.base}/assignments/${id}/materials`);
    await page.getByTestId('stage-materials').waitFor();
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Skip to your paper');
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => document.activeElement?.id || document.activeElement?.closest('#stage')?.id), 'stage');
    const seen = new Set();
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab');
      const info = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body || el.getAttribute('tabindex') === '-1') return null; // programmatic focus targets (headings, main) show no ring by design
        const cs = getComputedStyle(el);
        return { label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40), ring: cs.outlineStyle !== 'none' || cs.boxShadow !== 'none' };
      });
      if (info) { seen.add(info.label); assert.ok(info.ring, `visible focus on "${info.label}"`); }
    }
    assert.ok([...seen].some((l) => /Add syllabus|Choose|Skip|syllabus/i.test(l)), 'the first task is reachable by keyboard');
    log('keyboard: skip link works, ' + seen.size + ' tab stops each show a focus ring');
  }

  // ---- F · small screens: 320px and a 200%-zoom equivalent (640px wide) never scroll sideways
  {
    const id = await mkAsg('Small');
    await studio.api('POST', `/assignments/${id}/materials`, { items: [{ kind: 'assignment', title: 'Sheet', text: 'Write an essay of 500-700 words about a very-long-unbroken-word-' + 'x'.repeat(80) + '. Use APA.' }] });
    for (const vp of [{ width: 320, height: 640 }, { width: 640, height: 450 }]) {
      const { page, errors } = await studio.newPage(vp);
      allErrors.push(errors);
      for (const st of ['materials', 'plan', 'draft']) {
        await page.goto(`${studio.base}/assignments/${id}/${st}`);
        await page.getByTestId('stage').waitFor();
        await page.waitForTimeout(400);
        assert.ok((await stageOverflow(page)) <= 1, `${st} at ${vp.width}px scrolls sideways by ${await stageOverflow(page)}px`);
      }
      await shot(page, `materials-${vp.width}`);
    }
    log('320px and 640px (200% zoom equivalent): Materials, Plan, Draft never scroll sideways, even with a very long word');
  }

  const real = allErrors.flat().filter((e) => !/favicon/i.test(e) && !/status of (409|422)/.test(e));
  assert.deepEqual(real, [], 'browser console/page errors: ' + real.join(' | '));
  void PHONE;
  log('PASS checks journey');
} catch (e) {
  console.error('[journey] FAIL', e);
  failed = true;
} finally {
  await studio.stop();
  process.exitCode = failed ? 1 : 0;
}
