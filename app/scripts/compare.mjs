#!/usr/bin/env node
// Builds docs/redesign/comparison-desktop.png and comparison-phone.png: before/after pairs for empty Materials, populated brief, Draft and Review.
//   node scripts/compare.mjs   (reads docs/redesign/before and docs/redesign/after; run the journeys first)
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const dir = path.join(root, 'docs', 'redesign');
const pairs = {
  desktop: [
    ['Empty Materials (new assignment)', 'blank-desktop-light', 'new-materials-desktop'],
    ['Populated brief', 'brief-desktop-light', 'sample-brief-desktop'],
    ['Draft', 'draft-desktop-light', 'draft-desktop'],
    ['Review', 'review-desktop-light', 'review-recommendation-desktop'],
  ],
  phone: [
    ['Empty Materials (new assignment)', 'blank-phone-light', 'new-materials-phone'],
    ['Populated brief', 'brief-phone-light', 'sample-brief-phone'],
    ['Draft', 'draft-phone-light', 'draft-phone'],
    ['Review', 'review-phone-light', 'review-recommendation-phone'],
  ],
};
const b64 = (f) => 'data:image/png;base64,' + fs.readFileSync(f).toString('base64');
const cp = () => {
  for (const d of fs.existsSync('/opt/pw-browsers') ? fs.readdirSync('/opt/pw-browsers').filter((x) => /^chromium-\d+$/.test(x)) : []) {
    const p = path.join('/opt/pw-browsers', d, 'chrome-linux64', 'chrome');
    if (fs.existsSync(p)) return p;
  }
};
const browser = await chromium.launch({ executablePath: cp(), args: ['--no-sandbox'] });
for (const [kind, rows] of Object.entries(pairs)) {
  const cell = (label, f) => {
    const file = path.join(dir, f.startsWith('blank') || f.includes('-light') ? 'before' : 'after', f + '.png');
    return `<figure><figcaption>${label}</figcaption><img src="${b64(file)}"></figure>`;
  };
  const html = `<!doctype html><meta charset="utf-8"><style>
  body{font:14px/1.3 system-ui,sans-serif;margin:0;padding:24px;background:#fff;color:#111}
  h2{font-size:18px;margin:28px 0 8px}
  .row{display:grid;grid-template-columns:1fr 1fr;gap:16px}
  figure{margin:0}figcaption{font-weight:600;margin-bottom:6px}
  img{width:100%;border:1px solid #ccc;display:block}
  ${kind === 'phone' ? '.row{grid-template-columns:repeat(2,390px);justify-content:start}' : ''}
  </style><h1 style="margin:0 0 4px">Before and after: ${kind}</h1><p style="margin:0 0 12px">Left: the app before the redesign. Right: after.</p>
  ${rows.map(([title, before, after]) => `<h2>${title}</h2><div class="row">${cell('Before', before)}${cell('After', after)}</div>`).join('')}`;
  const page = await browser.newPage({ viewport: { width: kind === 'phone' ? 860 : 1800, height: 900 } });
  await page.setContent(html);
  await page.waitForTimeout(500);
  const out = path.join(dir, `comparison-${kind}.png`);
  await page.screenshot({ path: out, fullPage: true });
  console.log('wrote', path.relative(root, out));
  await page.close();
}
await browser.close();
