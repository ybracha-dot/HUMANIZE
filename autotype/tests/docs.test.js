// Google Docs: reading the Doc's simple HTML view, and editing around the
// things in a Doc that can't be typed (page breaks, pictures, footnote marks).
// The HTML below copies the shapes Google Docs really serves at /mobilebasic.
import assert from 'node:assert/strict';
import '../docs-reader.js';
import { editorDiff, applyEdits, tokenize } from '../engine/diff.js';
import { buildEditPlan, simulate, DEFAULT_SETTINGS } from '../engine/plan.js';
import { makeRng } from '../engine/rng.js';
import { graphemes } from '../engine/text.js';

const toText = globalThis.autoTypeDocsText;
const NB = ' ';
const page = (content) => `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Essay</title><style>p{margin:0}</style>
<script nonce="x">var a = "<p>not the doc</p>";</script></head><body><script>var b=1;</script>
<div class="app-container"><div class="doc-container"><div class="doc"><div class="doc-content">${content}</div></div></div></div>
<script>var c = "</div>";</script></body></html>`;

// 1. Reading.
const real = page(
  '<div><p class="c3"><span class="c1">Paley 1</span></p></div>'
  + '<p class="c2"><span class="c1">The first line stays the same.</span></p>'
  + '<p><span>The second line has a tpyo &amp; a big error.</span></p>'
  + '<p><span></span></p>'
  + '<p><span>The last line is fine.</span></p>'
  + `<p><span>${NB.repeat(8)}Indented with a tab. ${NB}Two spaces before this “quoted” part.<br>After a soft break.</span></p>`
  + '<ul class="lst-kix_k7ry9bfa0llx-0 start"><li class="c4 li-bullet-0"><span>First bullet</span></li><li><span>Second bullet</span></li></ul>'
  + '<hr style="page-break-before:always;display:none;">'
  + '<p><span></span></p>'
  + '<p class="title" id="h.abc"><span>Works Cited</span></p>'
  + `<p><span>${NB.repeat(16)}Two tabs. ${NB} Three spaces, a note</span><sup><a href="#ftnt1" id="ftnt_ref1">[1]</a></sup><span> and a comment</span><span>.</span><sup><a href="#cmnt1" id="cmnt_ref1">[a]</a></sup></p>`
  + '<p><span>A picture </span><span style="overflow:hidden;display:inline-block"><img alt="" src="https://lh7-rt.googleusercontent.com/x" style="width:10px"></span><span> here.</span></p>'
  + '<hr class="c5"><div><p><a href="#ftnt_ref1" id="ftnt1">[1]</a><span>Footnote text.</span></p></div>'
  + '<div><p><a href="#cmnt_ref1" id="cmnt1">[a]</a><span>test comment</span></p></div>'
  + '<div><p><span>Footer text</span></p></div>',
);
const expected = 'The first line stays the same.\nThe second line has a tpyo & a big error.\n\nThe last line is fine.\n'
  + '\tIndented with a tab.  Two spaces before this “quoted” part.\nAfter a soft break.\n'
  + 'First bullet\nSecond bullet\n\f\nWorks Cited\n\t\tTwo tabs.   Three spaces, a note￼ and a comment.\nA picture ￼ here.';
assert.equal(toText(real), expected);
assert.equal(toText('<html><body><p>Sign in to continue</p></body></html>'), null, 'a page without the document gives null');
assert.equal(toText(page('')), '', 'an empty Doc reads as empty');
assert.equal(toText(page('<p><span>x &lt;y&gt; &#8217;z&#x2019; &quot;q&quot; &nbsp;</span></p>')), 'x <y> ’z’ "q"  ');
assert.equal(toText(page('<h1><span>Title</span></h1><table><tbody><tr><td><p><span>a</span></p><p><span>b</span></p></td></tr></tbody></table>')), 'Title\na\nb');
console.log('ok: the Google Docs reader matches the cursor (checked in a real Doc), with headers, footers, comments and footnotes left out');

// 2. Editing around page breaks, pictures and quote styles.
const r = makeRng(31);
const WORDS = ['quickly', 'the', 'significant', 'however', 'Boston', 'argues', '“quoted”', '"plain"', 'it’s', "it's", 'and', 'very'];
const HIDDEN = /[\f￼]/g;
function makeDoc() {
  const paras = [];
  const n = r.int(2, 7);
  for (let i = 0; i < n; i++) {
    const words = [];
    for (let k = r.int(0, 14); k > 0; k--) words.push(r.pick(WORDS));
    let p = (r.chance(0.2) ? '\t' : '') + words.join(' ') + (words.length ? '.' : '');
    if (r.chance(0.25)) p = '\f' + p; // page break at the start of a paragraph
    if (r.chance(0.2) && p.length > 3) {
      const at = r.int(1, p.length - 1);
      p = p.slice(0, at) + '￼' + p.slice(at); // picture or footnote mark
    }
    paras.push(p);
  }
  return paras.join('\n');
}
function mutate(text) {
  const toks = tokenize(text.replace(HIDDEN, ''));
  for (let k = r.int(1, 6); k > 0; k--) {
    const i = r.int(0, Math.max(0, toks.length - 1));
    const roll = r();
    if (roll < 0.3) toks[i] = r.pick(WORDS);
    else if (roll < 0.5) toks.splice(i, 0, r.pick(WORDS), ' ');
    else if (roll < 0.65) toks.splice(i, 2);
    else if (roll < 0.75) toks.splice(i, 0, '\nA new paragraph.');
    else if (roll < 0.85) toks.splice(i, 0, ' Another sentence.');
    else toks[i] = (toks[i] || '').replace(/[“”]/g, '"').replace(/’/g, "'");
  }
  return toks.join('');
}
const plainQ = (t) => t.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
let runs = 0;
let hiddenKept = 0;
for (let t = 0; t < 1500; t++) {
  const doc = makeDoc() + (r.chance(0.5) ? '\n' : '');
  const upd = mutate(doc);
  const loose = r.chance(0.5);
  const d = editorDiff(doc, upd, { looseQuotes: loose });
  const label = JSON.stringify({ doc, upd, loose });
  assert.equal(applyEdits(d.old, d.edits) + d.trailing, d.after, label);
  for (const h of d.edits) assert.ok(!/[\f￼]/.test(d.old.slice(h.s, h.e)), `an edit went through a page break or picture: ${label}`);
  const count = (s, c) => s.split(c).length - 1;
  assert.equal(count(d.after, '\f'), count(doc, '\f'), label);
  assert.equal(count(d.after, '￼'), count(doc, '￼'), label);
  hiddenKept += count(doc, '\f') + count(doc, '￼');
  const want = upd.replace(/\n+$/, '');
  const got = d.after.replace(HIDDEN, '').replace(/\n+$/, '');
  if (loose) assert.equal(plainQ(got), plainQ(want), label);
  else assert.equal(got, want, label);
  // The keystrokes land on that result from wherever the cursor starts.
  const plan = buildEditPlan(null, null, { ...DEFAULT_SETTINGS, typoRate: r.pick([0, 6]), editTimeMin: 0.2, editTimeMax: 0.5 }, { diff: d, runSeed: r.int(1, 1e9) });
  const gs = graphemes(d.before);
  const start = gs.slice(0, r.int(0, gs.length)).join('').length;
  assert.equal(simulate(plan.actions, d.before.slice(0, start), d.before.slice(start)), d.after, label);
  runs++;
}
console.log(`ok: ${runs} Doc edits stepped around ${hiddenKept} page breaks and pictures without touching one, quote styles tolerated`);
