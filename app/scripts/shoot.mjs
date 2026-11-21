#!/usr/bin/env node
// Screenshot tool for the redesign evidence. Starts an isolated fixture server (temp data dir, no keys), creates a blank assignment and the
// seeded attendance sample through the API, then photographs `/assignments/:id[/stage]` at desktop and phone widths in light and dark.
//   node scripts/shoot.mjs --out ../docs/redesign/before [--stages ""|materials,plan,...] [--schemes light,dark]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : d;
};
const out = path.resolve(arg('--out', '../docs/redesign/shots'));
const stages = arg('--stages', '').split(',');
const schemes = arg('--schemes', 'light,dark').split(',');
fs.mkdirSync(out, { recursive: true });
const PORT = 8900 + Math.floor(Math.random() * 90);
const base = `http://127.0.0.1:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-shoot-'));
const server = spawn(process.execPath, ['scripts/start.mjs'], {
  cwd: root,
  env: { ...process.env, PORT: String(PORT), STUDIO_DATA_DIR: dataDir, STUDIO_LOCAL_MODE: '1', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '' },
  stdio: 'ignore',
});
const chromiumPath = () => {
  for (const d of fs.existsSync('/opt/pw-browsers') ? fs.readdirSync('/opt/pw-browsers').filter((x) => /^chromium-\d+$/.test(x)) : []) {
    const p = path.join('/opt/pw-browsers', d, 'chrome-linux64', 'chrome');
    if (fs.existsSync(p)) return p;
  }
};
try {
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(base + '/api/health')).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  const s = await (
    await fetch(base + '/api/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ local: true }) })
  ).json();
  const api = async (m, u, b) =>
    (
      await fetch(base + '/api' + u, {
        method: m,
        headers: { authorization: `Bearer ${s.token}`, 'content-type': 'application/json' },
        body: b ? JSON.stringify(b) : undefined,
      })
    ).json();
  const course = await api('POST', '/courses', { name: 'Blank course' });
  const blank = await api('POST', `/courses/${course.id}/assignments`, { title: 'Untitled paper' });
  const sample = await api('POST', '/demo/seed');
  const targets = { blank: blank.id, sample: sample.assignmentId };
  const browser = await chromium.launch({ executablePath: chromiumPath(), args: ['--no-sandbox'] });
  for (const scheme of schemes)
    for (const [vw, size] of [
      ['desktop', { width: 1440, height: 900 }],
      ['phone', { width: 390, height: 844 }],
    ]) {
      const ctx = await browser.newContext({ viewport: size, colorScheme: scheme, deviceScaleFactor: 1 });
      await ctx.addInitScript(
        ([t, th]) => {
          try {
            localStorage.setItem('studio.token', t);
            localStorage.setItem('studio.theme', th);
          } catch {}
        },
        [s.token, scheme],
      );
      const page = await ctx.newPage();
      for (const [name, id] of Object.entries(targets))
        for (const st of stages) {
          await page.goto(`${base}/assignments/${id}${st ? '/' + st : ''}`);
          await page.waitForTimeout(1200);
          const file = path.join(out, `${name}${st ? '-' + st : ''}-${vw}-${scheme}.png`);
          await page.screenshot({ path: file, fullPage: false });
          console.log('shot', path.relative(root, file));
        }
      await ctx.close();
    }
  await browser.close();
} finally {
  server.kill('SIGTERM');
  fs.rmSync(dataDir, { recursive: true, force: true });
}
