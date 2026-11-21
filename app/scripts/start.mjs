#!/usr/bin/env node
// One command: API server + durable-queue worker (separate processes) + the built UI (or Vite in --dev).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const dev = process.argv.includes('--dev');
const tsx = path.join(root, 'node_modules', '.bin', 'tsx');
const kids = [];
const run = (name, cmd, args, env = {}) => {
  const p = spawn(cmd, args, { stdio: 'inherit', env: { ...process.env, ...env } });
  p.on('exit', (code) => { if (!shuttingDown) { console.log(`[${name}] exited (${code}); stopping`); shutdown(code ?? 1); } });
  kids.push(p);
};
let shuttingDown = false;
function shutdown(code = 0) { shuttingDown = true; for (const k of kids) k.kill('SIGTERM'); setTimeout(() => process.exit(code), 300); }
process.on('SIGINT', () => shutdown(0)); process.on('SIGTERM', () => shutdown(0));

if (!dev && !fs.existsSync(path.join(root, 'dist', 'index.html'))) {
  console.log('[start] building the UI once (npm run build)...');
  await new Promise((res, rej) => spawn('npx', ['vite', 'build'], { stdio: 'inherit' }).on('exit', (c) => (c === 0 ? res() : rej(new Error('build failed')))));
}
run('server', tsx, ['server/index.ts']);
run('worker', tsx, ['server/worker.ts']);
if (dev) run('vite', 'npx', ['vite']);
const mode = process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY ? 'keys detected: switch to Live in Settings' : 'no keys: demo mode (deterministic fixture engine)';
console.log(`\n  Writing Studio -> http://127.0.0.1:${dev ? 5173 : process.env.PORT ?? 8787}   (${mode})\n`);
