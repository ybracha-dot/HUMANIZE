// Shared harness for the browser journeys: an isolated fixture server (temp data, no keys) and a Chromium launcher.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';

export const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
export const shotsDir = path.join(root, '..', 'docs', 'redesign', 'after');
fs.mkdirSync(shotsDir, { recursive: true });

export function chromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  if (fs.existsSync('/opt/pw-browsers')) for (const d of fs.readdirSync('/opt/pw-browsers').filter((x) => /^chromium-\d+$/.test(x))) {
    const p = path.join('/opt/pw-browsers', d, 'chrome-linux64', 'chrome');
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

export async function startStudio() {
  const port = 9000 + Math.floor(Math.random() * 900);
  const base = `http://127.0.0.1:${port}`;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-j-'));
  const server = spawn(process.execPath, ['scripts/start.mjs'], { cwd: root, env: { ...process.env, PORT: String(port), STUDIO_DATA_DIR: dataDir, STUDIO_LOCAL_MODE: '1', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '' }, stdio: 'ignore' });
  for (let i = 0; i < 100; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch {} await new Promise((r) => setTimeout(r, 250)); }
  const s = await (await fetch(base + '/api/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ local: true }) })).json();
  const api = async (method, url, body) => {
    const r = await fetch(base + '/api' + url, { method, headers: { authorization: `Bearer ${s.token}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return r.headers.get('content-type')?.includes('json') ? r.json() : r.text();
  };
  const browser = await chromium.launch({ executablePath: chromiumPath(), args: ['--no-sandbox'] });
  const newPage = async (viewport = { width: 1440, height: 900 }, scheme = 'light') => {
    const ctx = await browser.newContext({ viewport, colorScheme: 'light', acceptDownloads: true });
    await ctx.addInitScript(([t, th]) => { try { localStorage.setItem('studio.token', t); if (th !== 'default') localStorage.setItem('studio.theme', th); } catch {} }, [s.token, scheme]);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/favicon/i.test(m.text())) errors.push('console: ' + m.text()); });
    return { page, ctx, errors };
  };
  const stop = async () => { await browser.close(); server.kill('SIGTERM'); fs.rmSync(dataDir, { recursive: true, force: true }); };
  return { base, api, token: s.token, newPage, stop, dataDir };
}

export const DESKTOP = { width: 1440, height: 900 };
export const PHONE = { width: 390, height: 844 };
export const t0 = Date.now();
export const log = (m) => console.log(`[journey +${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);
export const shot = (page, name) => page.screenshot({ path: path.join(shotsDir, name + '.png') });
