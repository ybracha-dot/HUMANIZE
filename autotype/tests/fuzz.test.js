// Proves the core promise: whatever the settings, replaying the keystroke plan
// on a model of the page ends with the exact original text, and text around the
// cursor in the page is never touched.

import assert from 'node:assert/strict';
import { buildPlan, simulate, DEFAULT_SETTINGS } from '../engine/plan.js';
import { makeDraft } from '../engine/degrade.js';
import { findProtected } from '../engine/text.js';
import { makeRng } from '../engine/rng.js';
import { ALL } from './corpus.js';

const texts = Object.entries(ALL);
// Mash-ups: paragraphs from different samples, different separators.
const r = makeRng(12345);
for (let i = 0; i < 25; i++) {
  const parts = [];
  const n = r.int(1, 5);
  for (let j = 0; j < n; j++) {
    const src = r.pick(texts)[1];
    const paras = src.split(/\n+/);
    parts.push(r.pick(paras));
  }
  const seps = ['\n', '\n\n', '\n\n\n'];
  texts.push([`MIX${i}`, parts.map((p, k) => (k ? r.pick(seps) : '') + p).join('') + (r.chance(0.3) ? '\n' : '')]);
}
texts.push(['EMPTY_LINES', '\n\nStarts with blank lines. It has two sentences.\n']);
texts.push(['CRLF', 'Windows line endings here.\r\nSecond line, which has a comma.\r\n\r\nThird paragraph is significant.']);

let runs = 0;
let quotesKept = 0;
let draftEdits = 0;
const typeCounts = {};
const prefix = 'EXISTING TEXT BEFORE ';
const suffix = ' EXISTING TEXT AFTER';

for (const [name, text] of texts) {
  const expected = text.replace(/\r\n?/g, '\n');
  for (let k = 0; k < 40; k++) {
    const range = (max) => { const a = r() * max; const b = r() * max; return [Math.min(a, b), Math.max(a, b)]; };
    const [sMin, sMax] = range(6);
    const [pMin, pMax] = range(20);
    const [cMin, cMax] = range(2);
    const [qMin, qMax] = range(4);
    const [eMin, eMax] = range(8);
    const settings = {
      ...DEFAULT_SETTINGS,
      wpm: r.int(15, 160),
      sentencePauseMin: sMin, sentencePauseMax: sMax,
      paragraphPauseMin: pMin, paragraphPauseMax: pMax,
      commaPauseMin: cMin, commaPauseMax: cMax,
      citationPauseMin: qMin, citationPauseMax: qMax,
      editTimeMin: 0.2 + eMin, editTimeMax: 0.2 + eMax,
      typoRate: r.pick([0, 2, 5, 10, 25]),
      roughness: r.pick([0, 10, 35, 60, 100]),
      variation: r.int(0, 80),
      secondThoughts: r.pick([0, 10, 50]),
    };
    const draftSeed = r.int(1, 1e9);
    const runSeed = r.int(1, 1e9);
    const plan = buildPlan(text, settings, { draftSeed, runSeed });

    // Each paragraph's draft must turn back into the original via its edits.
    for (const p of plan.draft.paragraphs) {
      let rebuilt = '';
      let last = 0;
      for (const e of p.edits) {
        assert.equal(p.draft.slice(e.ds, e.de), e.draft, `${name}: draft span mismatch`);
        rebuilt += p.draft.slice(last, e.ds) + e.orig;
        last = e.de;
        typeCounts[e.type] = (typeCounts[e.type] || 0) + 1;
      }
      rebuilt += p.draft.slice(last);
      assert.equal(rebuilt, p.original, `${name}: edits do not restore the paragraph`);
      draftEdits += p.edits.length;
      // Quotes and citations are copied into the draft untouched, at the mapped spots.
      const prot = findProtected(p.original);
      prot.quotes.forEach(([s, e], k) => {
        const [ds, de] = p.quotesD[k];
        assert.equal(p.draft.slice(ds, de), p.original.slice(s, e), `${name}: a quote changed in the draft`);
        quotesKept++;
      });
      prot.cites.forEach((c, k) => {
        const d = p.citesD[k];
        assert.equal(p.draft.slice(d.pauseAt, d.e), p.original.slice(c.pauseAt, c.e), `${name}: a citation changed in the draft`);
      });
    }

    const out = simulate(plan.actions, prefix, suffix);
    if (out !== prefix + expected + suffix) {
      console.error('MISMATCH in', name, JSON.stringify(settings), { draftSeed, runSeed });
      console.error('expected:', JSON.stringify(prefix + expected + suffix).slice(0, 400));
      console.error('got:     ', JSON.stringify(out).slice(0, 400));
      process.exit(1);
    }
    for (const a of plan.actions) {
      assert.ok(Number.isFinite(a.d) && a.d >= 0, 'bad delay');
      if (a.k === 'type') assert.ok(typeof a.g === 'string' && a.g.length > 0 && a.g !== '\n');
    }
    runs++;
  }
}

// Same seeds, same plan (the preview is exactly what gets typed).
const a = buildPlan(ALL.ESSAY, DEFAULT_SETTINGS, { draftSeed: 9, runSeed: 4 });
const b = buildPlan(ALL.ESSAY, DEFAULT_SETTINGS, { draftSeed: 9, runSeed: 4 });
assert.deepEqual(a.actions, b.actions);
const d1 = makeDraft(ALL.ESSAY, 40, 77);
const d2 = makeDraft(ALL.ESSAY, 40, 77);
assert.deepEqual(d1.paragraphs.map((p) => p.draft), d2.paragraphs.map((p) => p.draft));

// Old single-value settings still work.
const legacy = buildPlan(ALL.ESSAY, { sentencePause: 2, paragraphPause: 5, editTime: 1 }, { draftSeed: 3, runSeed: 3 });
assert.equal(simulate(legacy.actions), ALL.ESSAY);

// Pauses land inside their ranges.
const fixed = buildPlan(ALL.MLA, { ...DEFAULT_SETTINGS, citationPauseMin: 2, citationPauseMax: 2.5, roughness: 0, typoRate: 0, secondThoughts: 0 }, { draftSeed: 1, runSeed: 1 });
const citePauses = fixed.actions.filter((x) => x.s === 'Checking the source…').map((x) => x.d);
assert.equal(citePauses.length, 4, 'one pause before each of the 4 citations');
assert.ok(citePauses.every((d) => d >= 2000 && d <= 2500), `citation pauses out of range: ${citePauses}`);

console.log(`ok: ${runs} randomized runs over ${texts.length} texts, ${draftEdits} rough-draft edits restored exactly, ${quotesKept} quotes left untouched`);
console.log('edit types seen:', typeCounts);
