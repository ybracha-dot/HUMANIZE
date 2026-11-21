#!/usr/bin/env node
// WCAG contrast of every text/background and boundary pairing the design uses, read straight from src/index.css tokens. Exits 1 on any miss.
//   text pairs need 4.5:1; interactive boundaries (edge on surface/page) and focus rings need 3:1.
import fs from 'node:fs';
import path from 'node:path';

const css = fs.readFileSync(path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'src', 'index.css'), 'utf8');
const block = (re) => {
  const m = css.match(re);
  const out = {};
  for (const [, k, v] of m[1].matchAll(/--([\w-]+):\s*(\d+) (\d+) (\d+)/g).length ? [] : []) void k, void v;
  for (const t of m[1].matchAll(/--([\w-]+):\s*(\d+)\s+(\d+)\s+(\d+)/g)) out[t[1]] = [+t[2], +t[3], +t[4]];
  return out;
};
const themes = {
  light: block(/:root,\s*:root\[data-theme='light'\]\s*\{([\s\S]*?)\n\}/),
  dark: block(/:root\[data-theme='dark'\]\s*\{([\s\S]*?)\n\}/),
};
const lum = ([r, g, b]) => {
  const f = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
// [foreground, background, minimum, what it is used for]
const PAIRS = [
  ['ink', 'page', 4.5, 'body text'],
  ['ink', 'surface', 4.5, 'text on cards and the writing page'],
  ['ink', 'tint', 4.5, 'active stage, selected control'],
  ['ink2', 'page', 4.5, 'secondary text'],
  ['ink2', 'surface', 4.5, 'secondary text on cards'],
  ['ink2', 'tint', 4.5, 'secondary text on a selected row'],
  ['accent', 'page', 4.5, 'links'],
  ['accent', 'surface', 4.5, 'links on cards'],
  ['accent', 'tint', 4.5, 'links on a selected row'],
  ['accent-ink', 'accent', 4.5, 'text on a filled primary button'],
  ['ok', 'page', 4.5, 'success text'],
  ['ok', 'ok-bg', 4.5, 'success text on its tint'],
  ['warn', 'page', 4.5, 'caution text'],
  ['warn', 'warn-bg', 4.5, 'caution text on its tint'],
  ['err', 'page', 4.5, 'error text'],
  ['err', 'err-bg', 4.5, 'error text on its tint'],
  ['edge', 'page', 3, 'control boundary on the page'],
  ['edge', 'surface', 3, 'control boundary on a card'],
  ['accent', 'page', 3, 'focus ring'],
];
let bad = 0;
for (const [name, t] of Object.entries(themes)) {
  for (const [fg, bg, min, use] of PAIRS) {
    if (!t[fg] || !t[bg]) {
      console.log(`${name.padEnd(5)} MISSING token for ${fg}/${bg}`);
      bad++;
      continue;
    }
    const r = ratio(t[fg], t[bg]);
    const ok = r >= min;
    if (!ok) bad++;
    console.log(`${name.padEnd(5)} ${ok ? 'pass' : 'FAIL'} ${r.toFixed(2).padStart(5)}:1 (need ${min}) ${fg} on ${bg}: ${use}`);
  }
}
console.log(bad ? `\n${bad} pairing(s) fail` : `\nAll ${PAIRS.length * 2} pairings pass`);
process.exitCode = bad ? 1 : 0;
