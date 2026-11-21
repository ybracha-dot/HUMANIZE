// The editor's diff must always rebuild the updated version exactly, keep
// changes small, and never touch unchanged paragraphs.
import assert from 'node:assert/strict';
import { diffTexts, applyEdits, tokenize } from '../engine/diff.js';
import { makeRng } from '../engine/rng.js';
import { ALL } from './corpus.js';

const r = makeRng(99);
const WORDS = ['quickly', 'the', 'significant', 'however', 'Boston', 'novel', 'argues', 'that', 'very', 'clear', 'and', 'a', 'it', 'example'];

// Make a realistic edited version: word swaps, small fixes, inserts, deletes,
// a sentence added, a paragraph removed.
function mutate(text, strength) {
  let toks = tokenize(text);
  const n = Math.max(1, Math.round(toks.length * strength));
  for (let k = 0; k < n; k++) {
    const i = r.int(0, Math.max(0, toks.length - 1));
    const t = toks[i] || '';
    const roll = r();
    if (roll < 0.3 && /\p{L}/u.test(t)) toks[i] = r.pick(WORDS);
    else if (roll < 0.45 && /\p{L}{3,}/u.test(t)) toks[i] = t.slice(0, -1) + (t.endsWith('s') ? '' : 's');
    else if (roll < 0.6) toks.splice(i, 0, r.pick(WORDS), ' ');
    else if (roll < 0.72 && /\p{L}/u.test(t)) toks.splice(i, 2);
    else if (roll < 0.8) toks.splice(i, 0, ',');
    else if (roll < 0.88 && /\p{L}/u.test(t)) toks[i] = t[0] === t[0].toUpperCase() ? t.toLowerCase() : t[0].toUpperCase() + t.slice(1);
    else if (roll < 0.94) toks.splice(i, 0, ' This sentence was added for testing.');
    else toks.splice(i, 0, '\n\nA brand new paragraph appears here, with a comma.');
  }
  return toks.join('');
}

let runs = 0;
let edits = 0;
for (const [name, text] of Object.entries(ALL)) {
  for (let k = 0; k < 120; k++) {
    const strength = r.pick([0.005, 0.02, 0.05, 0.15, 0.4]);
    const neu = mutate(text, strength);
    const d = diffTexts(text, neu);
    assert.equal(applyEdits(d.old, d.edits), d.new, `${name}: edits don't rebuild the new version`);
    let last = -1;
    for (const h of d.edits) {
      assert.ok(h.s >= last && h.e >= h.s, `${name}: edits out of order`);
      last = h.e;
    }
    runs++;
    edits += d.edits.length;
  }
}
// Identical texts: nothing to do. Totally different: still exact.
assert.equal(diffTexts(ALL.ESSAY, ALL.ESSAY).edits.length, 0);
const swap = diffTexts(ALL.ESSAY, ALL.NARRATIVE);
assert.equal(applyEdits(swap.old, swap.edits), swap.new);

// Small changes stay small.
const show = (o, n) => diffTexts(o, n).edits.map((h) => `${JSON.stringify(o.slice(h.s, h.e))}->${JSON.stringify(h.text)}`).join('  ');
const checks = [
  ['The cat sat on the mat.', 'The cat sat on the mats.', '"" -> "s"'],
  ['I like the colour red.', 'I like the color red.', 'one letter cut'],
  ['They walk to school.', 'They walked to school.', 'add "ed"'],
  ['the big red dog barked', 'the large brown dog barked', 'phrase swap'],
  ['We went to london last year.', 'We went to London last year.', 'one capital'],
  ['Para one stays.\nPara two has a typo teh end.\nPara three stays.', 'Para one stays.\nPara two has a typo the end.\nPara three stays.', 'only the typo'],
];
for (const [o, n, why] of checks) console.log(`  ${why.padEnd(14)} ${show(o, n)}`);
assert.equal(diffTexts('The cat sat on the mat.', 'The cat sat on the mats.').edits.length, 1);
assert.equal(diffTexts('I like the colour red.', 'I like the color red.').edits[0].text, '');
console.log(`ok: ${runs} random edit pairs rebuilt exactly with ${edits} edits`);
