// Editor plans: replaying the keystrokes on the current document must give
// the updated version exactly, starting from any cursor position.
import assert from 'node:assert/strict';
import { buildEditPlan, simulate, DEFAULT_SETTINGS } from '../engine/plan.js';
import { tokenize, editorDiff } from '../engine/diff.js';
import { makeRng } from '../engine/rng.js';
import { graphemes } from '../engine/text.js';
import { ALL } from './corpus.js';

const r = makeRng(7);
const WORDS = ['quickly', 'the', 'significant', 'however', 'Boston', 'argues', 'that', 'very', 'clear', 'and'];
function mutate(text, strength) {
  const toks = tokenize(text);
  const n = Math.max(1, Math.round(toks.length * strength));
  for (let k = 0; k < n; k++) {
    const i = r.int(0, Math.max(0, toks.length - 1));
    const t = toks[i] || '';
    const roll = r();
    if (roll < 0.35 && /\p{L}/u.test(t)) toks[i] = r.pick(WORDS);
    else if (roll < 0.55) toks.splice(i, 0, r.pick(WORDS), ' ');
    else if (roll < 0.7 && /\p{L}/u.test(t)) toks.splice(i, 2);
    else if (roll < 0.8) toks.splice(i, 0, ',');
    else if (roll < 0.9) toks.splice(i, 0, ' Another sentence, typed fresh. And one more.');
    else toks.splice(i, 0, '\n\nA whole new paragraph, written out.');
  }
  return toks.join('');
}

let runs = 0;
let up = 0;
for (const [name, text] of Object.entries(ALL)) {
  for (let k = 0; k < 40; k++) {
    const neu = mutate(text, r.pick([0.01, 0.04, 0.12]));
    const settings = { ...DEFAULT_SETTINGS, typoRate: r.pick([0, 5, 20]), secondThoughts: r.pick([0, 30]), editTimeMin: 0.2, editTimeMax: r() * 3 + 0.2 };
    const trail = '\n'.repeat(r.pick([0, 0, 1, 2]));
    const diff = editorDiff(text + trail, neu + (r.chance(0.5) ? '\n' : ''));
    const plan = buildEditPlan(null, null, settings, { diff, runSeed: r.int(1, 1e9) });
    // A real cursor always sits between characters (never inside an emoji).
    const gs = graphemes(diff.before);
    const start = gs.slice(0, r.int(0, gs.length)).join('').length;
    const result = simulate(plan.actions, diff.before.slice(0, start), diff.before.slice(start));
    assert.equal(result, diff.after, `${name}: editor plan did not produce the updated version`);
    if (plan.order === 'up') up++;
    runs++;
  }
}
console.log(`ok: ${runs} editor plans land exactly on the updated version, from any starting cursor`);
