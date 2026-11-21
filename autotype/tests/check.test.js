// Checks every 5 edits: the plan says what the page should hold at each check,
// and when the page holds something else, the fix goes back, repairs it, puts
// the cursor back, and the rest of the plan still lands exactly.
import assert from 'node:assert/strict';
import { buildPlan, buildEditPlan, addChecks, buildFixPlan, TextModel, DEFAULT_SETTINGS } from '../engine/plan.js';
import { editorDiff, tokenize } from '../engine/diff.js';
import { makeRng } from '../engine/rng.js';
import { graphemes, glen } from '../engine/text.js';
import { ALL } from './corpus.js';

const r = makeRng(77);
const texts = Object.values(ALL);
const WORDS = ['quickly', 'the', 'significant', 'however', 'Boston', 'argues', 'that', 'very', 'clear'];

function corrupt(text) {
  // A few wrong characters, like a dropped key or an autocorrect.
  const g = graphemes(text);
  for (let k = r.int(1, 3); k > 0; k--) {
    const i = r.int(0, g.length);
    if (/[\f￼]/.test(g[i] || '')) continue;
    const roll = r();
    if (roll < 0.35 && g.length) g.splice(Math.min(i, g.length - 1), 1);
    else if (roll < 0.7) g.splice(i, 0, r.pick(['x', 'e', ' ', 'the', '\n', ',']));
    else if (g.length) g[Math.min(i, g.length - 1)] = r.pick(['a', 'Q', '.', ' ']);
  }
  return g.join('');
}

let checks = 0;
let fixed = 0;
let runs = 0;
for (let t = 0; t < 700; t++) {
  const writer = t % 2 === 0;
  const settings = { ...DEFAULT_SETTINGS, typoRate: r.pick([0, 4, 15]), roughness: r.pick([0, 35, 80]), secondThoughts: r.pick([0, 20]), editTimeMin: 0.3, editTimeMax: 0.8 };
  let actions;
  let base = '';
  let p0 = 0;
  let finalText;
  let events;
  if (writer) {
    const text = r.pick(texts);
    actions = buildPlan(text, settings, { draftSeed: r.int(1, 1e9), runSeed: r.int(1, 1e9) }).actions;
    base = r.pick(['', 'Simon Paley\nProfessor Rivera\n', 'A title\n\nAnd a line after.']);
    p0 = r.pick([0, base.length, base.indexOf('\n') + 1]);
    finalText = base.slice(0, p0) + text + base.slice(p0);
    events = ['fix', 'typo', 'rethink'];
  } else {
    const a = r.pick(texts);
    const toks = tokenize(a);
    for (let k = r.int(1, 12); k > 0; k--) {
      const i = r.int(0, Math.max(0, toks.length - 1));
      if (r.chance(0.5)) toks[i] = r.pick(WORDS);
      else toks.splice(i, 0, r.pick(WORDS), ' ');
    }
    const d = editorDiff(a, toks.join(''));
    actions = buildEditPlan(null, null, settings, { diff: d, runSeed: r.int(1, 1e9) }).actions;
    base = d.before;
    finalText = d.after;
    events = ['fix'];
  }
  const withChecks = addChecks(actions, { every: 5, events, prefix: writer ? '' : base });
  assert.deepEqual(withChecks.filter((a) => !a.check), actions, 'checks are only added, nothing else changes');
  const list = withChecks.map((a) => a.check).filter(Boolean);
  assert.ok(list.length >= 1 && list[list.length - 1].final, 'there is always a final check');
  const nEdits = actions.filter((a) => events.includes(a.ev)).length;
  for (const c of list) assert.ok(c.final || c.to - c.from + 1 >= Math.min(5, nEdits), 'a check comes after at least 5 edits');

  // Play it on the real page: the typed part sits inside `base` for the Writer.
  const outside = writer ? [base.slice(0, p0), base.slice(p0)] : ['', ''];
  const page = writer ? new TextModel(outside[0], outside[1]) : new TextModel(base, '');
  const sabotage = r.int(0, list.length - 1); // which check finds a mistake
  let seen = 0;
  for (const a of withChecks) {
    if (a.check) {
      const want = outside[0] + a.check.text + outside[1];
      const cursor = glen(outside[0]) + a.check.cursor;
      assert.equal(page.text, want, 'the page matches the plan at every check');
      assert.equal(page.cur, cursor);
      checks++;
      if (seen++ === sabotage) {
        // Something went wrong on the page: wrong characters, cursor anywhere.
        const broken = corrupt(page.text);
        if (broken !== want) {
          const fix = buildFixPlan(broken, want, cursor, settings, { runSeed: r.int(1, 1e9) });
          assert.ok(fix.ok, `fix plan proves itself: ${JSON.stringify({ broken, want })}`);
          const m = new TextModel(broken, '');
          m.cur = r.int(0, m.doc.length); // the real cursor could be anywhere
          for (const x of fix.actions) m.apply(x);
          assert.equal(m.text, want, 'fixed');
          assert.equal(m.cur, cursor, 'cursor back where the plan left it');
          page.doc = m.doc;
          page.cur = m.cur;
          page.anchor = null;
          fixed++;
        }
      }
      continue;
    }
    page.apply(a);
  }
  assert.equal(page.text, finalText, 'the rest of the plan still lands exactly after a fix');
  runs++;
}
console.log(`ok: ${runs} runs (Writer and Editor), ${checks} checks matched the page, ${fixed} injected mistakes fixed and the run still ended exactly`);
