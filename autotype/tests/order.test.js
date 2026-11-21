// Each paragraph is written, then edited, before the next paragraph starts,
// and the pause before editing stays inside its range.
import assert from 'node:assert/strict';
import { buildPlan, DEFAULT_SETTINGS } from '../engine/plan.js';
import { ALL } from './corpus.js';

for (const [name, text] of Object.entries(ALL)) {
  for (let seed = 1; seed <= 30; seed++) {
    const plan = buildPlan(text, { ...DEFAULT_SETTINGS, roughness: 80, reviewPauseMin: 3, reviewPauseMax: 3.5 }, { draftSeed: seed, runSeed: seed });
    let current = 0;
    let phase = 'typing';
    for (const a of plan.actions) {
      if (!a.s || a.p == null) continue;
      if (a.s.startsWith('Typing')) {
        assert.ok(a.p >= current, `${name}: went back to typing an earlier paragraph`);
        if (a.p > current) {
          current = a.p;
          phase = 'typing';
        }
        assert.equal(phase, 'typing', `${name}: typed more of paragraph ${a.p} after editing began`);
      } else if (a.s.startsWith('Rereading')) {
        assert.equal(a.p, current, `${name}: edited a paragraph other than the one just written`);
        assert.ok(a.d >= 3000 && a.d <= 3500, `${name}: pause before editing out of range (${a.d})`);
        phase = 'editing';
      } else if (a.s.startsWith('Revising')) {
        assert.equal(a.p, current, `${name}: revision for paragraph ${a.p} while on ${current}`);
        assert.equal(phase, 'editing');
      }
    }
  }
}
console.log('ok: every paragraph is written, paused on, then edited before the next one starts');
