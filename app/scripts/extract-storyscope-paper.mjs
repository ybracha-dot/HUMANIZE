#!/usr/bin/env node
// Reads the vendored StoryScope PDF locally (poppler `pdftotext -layout`) and records, deterministically:
//  - the physical PDF page and printed page of Tables 14-17
//  - every printed row of Table 16 (label, encoding marker, human value, AI value, printed gap) exactly as printed
// Output: fixtures/upstream/storyscope-paper-tables.json. Needs `pdftotext`; the committed JSON lets everything else run without it.
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';

const pdf = new URL('../fixtures/upstream/StoryScope-v6.pdf', import.meta.url).pathname;
const oi = process.argv.indexOf('--out');
const out = oi > 0 ? process.argv[oi + 1] : new URL('../fixtures/upstream/storyscope-paper-tables.json', import.meta.url).pathname;
const sha = crypto.createHash('sha256').update(fs.readFileSync(pdf)).digest('hex');
const text = execFileSync('pdftotext', ['-layout', pdf, '-'], { encoding: 'utf8', maxBuffer: 64 << 20 });
const pages = text.split('\f');

const locators = {};
pages.forEach((p, i) => {
  for (const m of p.matchAll(/^\s*Table (1[4-7]):/gm)) {
    const footer = p.trim().split('\n').map((l) => l.trim()).filter((l) => /^\d{1,3}$/.test(l)).at(-1);
    locators[`table${m[1]}`] = { pdfPage: i + 1, printedPage: Number(footer) };
  }
});

const p16 = pages[locators.table16.pdfPage - 1];
const rows = [];
let theme = null;
for (const line of p16.split('\n')) {
  const t = line.trim();
  const th = /^(AI-elevated|Human-elevated): (.+)$/.exec(t);
  if (th) { theme = `${th[1]}: ${th[2]}`; continue; }
  const m = /^(.+?)\s+(?:([so])\s+)?(\d+(?:\.\d+)?%?)\s+(\d+(?:\.\d+)?%?)\s+([−+]\d+(?:\.\d+)?)$/.exec(t);
  if (!m || !theme) continue;
  const arrow = m[1].includes('→');
  rows.push({
    theme, label: m[1].trim(), marker: m[2] ?? null, humanPrinted: m[3], aiPrinted: m[4], gapPrinted: m[5],
    encoding: arrow ? 'prevalence_percent' : m[2] === 'o' ? 'ordinal_code_mean' : 'scale_mean',
    human: parseFloat(m[3]), model: parseFloat(m[4]), gap: parseFloat(m[5].replace('−', '-')),
  });
}
const result = { paperSHA256: sha, extractedWith: 'pdftotext -layout (poppler)', caption: /Table 16:[\s\S]*?AI column averages\s+across all five models\./.exec(p16)?.[0].replace(/\s+/g, ' ') ?? null, locators, table16: rows };
fs.writeFileSync(out, JSON.stringify(result, null, 1) + '\n');
console.log(`table 16 rows: ${rows.length}; locators: ${Object.entries(locators).map(([k, v]) => `${k}=pdf${v.pdfPage}/printed${v.printedPage}`).join(' ')}`);
