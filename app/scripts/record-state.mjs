#!/usr/bin/env node
// Atomically update .studio-build/state.json (temp file + rename). Usage:
//   node scripts/record-state.mjs --status working --milestone M2 --next "..." --evidence "M1: ..." --verify '{"command":"...","outcome":"passed","scope":"..."}'
// Evidence strings are append-only and de-duplicated; the supervisor uses them to detect stalls.
import fs from 'node:fs';
import path from 'node:path';
const file = path.resolve(process.cwd(), '..', '.studio-build', 'state.json');
const args = process.argv.slice(2);
const get = (k) => { const out = []; args.forEach((a, i) => { if (a === `--${k}`) out.push(args[i + 1]); }); return out; };
let s = { status: 'working', milestone: 'M0', evidence: [], next: '', blockers: [], verification: [] };
try { s = { ...s, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch {}
if (get('status')[0]) s.status = get('status')[0];
if (get('milestone')[0]) s.milestone = get('milestone')[0];
if (get('next')[0] !== undefined) s.next = get('next')[0];
for (const e of get('evidence')) if (!s.evidence.includes(e)) s.evidence.push(e);
for (const v of get('verify')) s.verification.push(JSON.parse(v));
for (const b of get('blocker')) s.blockers.push(JSON.parse(b));
if (args.includes('--clear-blockers')) s.blockers = [];
fs.mkdirSync(path.dirname(file), { recursive: true });
const tmp = file + '.tmp';
fs.writeFileSync(tmp, JSON.stringify(s, null, 2) + '\n');
fs.renameSync(tmp, file);
console.log('state:', s.status, s.milestone, `${s.evidence.length} evidence`);
