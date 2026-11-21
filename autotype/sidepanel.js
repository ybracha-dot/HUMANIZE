// The side panel is a remote control: typing runs in the background worker,
// so this panel can be hidden, closed or reopened without stopping anything.
import { makeDraft } from './engine/degrade.js';
import { buildPlan, buildEditPlan, formatDuration, normalizeSettings, DEFAULT_SETTINGS } from './engine/plan.js';
import { editorDiff } from './engine/diff.js';
import { randomSeed } from './engine/rng.js';
import { draftKey } from './engine/text.js';

const $ = (id) => document.getElementById(id);

// ---- presets and sliders ---------------------------------------------------

const PRESETS = {
  demo: {
    wpm: 120, sentencePauseMin: 0.3, sentencePauseMax: 1, paragraphPauseMin: 1, paragraphPauseMax: 2.5,
    commaPauseMin: 0.1, commaPauseMax: 0.4, citationPauseMin: 0.5, citationPauseMax: 1.2,
    reviewPauseMin: 0.5, reviewPauseMax: 1.5, editTimeMin: 0.4, editTimeMax: 1, typoRate: 6, roughness: 45, variation: 30, secondThoughts: 15,
  },
  natural: {
    wpm: 60, sentencePauseMin: 1, sentencePauseMax: 4, paragraphPauseMin: 4, paragraphPauseMax: 12,
    commaPauseMin: 0.2, commaPauseMax: 0.9, citationPauseMin: 1, citationPauseMax: 3,
    reviewPauseMin: 2, reviewPauseMax: 6, editTimeMin: 1.5, editTimeMax: 4.5, typoRate: 4, roughness: 35, variation: 35, secondThoughts: 8,
  },
  slow: {
    wpm: 38, sentencePauseMin: 3, sentencePauseMax: 10, paragraphPauseMin: 12, paragraphPauseMax: 40,
    commaPauseMin: 0.5, commaPauseMax: 2, citationPauseMin: 2, citationPauseMax: 6,
    reviewPauseMin: 5, reviewPauseMax: 15, editTimeMin: 4, editTimeMax: 10, typoRate: 3, roughness: 30, variation: 40, secondThoughts: 6,
  },
};

function roughLabel(v) {
  if (v === 0) return 'Off';
  if (v <= 20) return 'Light';
  if (v <= 45) return 'Medium';
  if (v <= 70) return 'Rough';
  return 'Very rough';
}

// range: true gives a min and a max (two thumbs, two number boxes).
// curve: the slider moves in finer steps near the low end.
const MAIN_SLIDERS = [
  { key: 'wpm', label: 'Typing speed', unit: 'wpm', min: 15, max: 160, step: 1 },
  { key: 'sentencePause', range: true, label: 'Pause between sentences', unit: 's', min: 0, max: 30, curve: 2.2 },
  { key: 'paragraphPause', range: true, label: 'Pause between paragraphs', unit: 's', min: 0, max: 120, curve: 2.4 },
  { key: 'commaPause', range: true, label: 'Pause after commas', unit: 's', min: 0, max: 5, curve: 2,
    hint: () => 'Also after semicolons and colons.' },
  { key: 'citationPause', range: true, label: 'Pause before citations', unit: 's', min: 0, max: 10, curve: 2,
    hint: () => 'After a quote, before typing where it is from, like (Miller 10).' },
  { key: 'typoRate', label: 'Spelling mistakes', unit: '% of words', min: 0, max: 25, step: 1,
    hint: () => 'Caught within a few letters, backspaced and retyped. Quotes get them too.' },
  { key: 'roughness', label: 'How rough the first draft is', unit: roughLabel, min: 0, max: 100, step: 1, fixing: true,
    hint: (v) => (v
      ? 'Weaker word choices, grammar slips, lowercase names and run-ons, fixed after each paragraph. Quotes and citations are never changed.'
      : 'Off: types your text straight through, typos only.') },
  { key: 'reviewPause', range: true, label: 'Pause before editing', unit: 's', min: 0, max: 60, curve: 2.2, fixing: true,
    hint: () => 'After a paragraph is written, before it goes back to fix it.' },
  { key: 'editTime', range: true, label: 'Editing time per fix', unit: 's', min: 0.2, max: 20, curve: 2.2, fixing: true,
    hint: () => 'Thinking time before each fix. Then it moves the cursor back and retypes.' },
];

const MORE_SLIDERS = [
  { key: 'variation', label: 'Rhythm variation', unit: '%', min: 0, max: 80, step: 1,
    hint: (v) => (v < 15 ? 'Steady, almost machine-like.' : v < 45 ? 'Natural ups and downs.' : 'Uneven, with bursts and stalls.') },
  { key: 'secondThoughts', label: 'Words swapped while typing', unit: '% of sentences', min: 0, max: 50, step: 1,
    hint: () => 'Types a word, deletes it, picks a better one. Never inside quotes.' },
  { key: 'countdown', label: 'Countdown before typing', unit: 's', min: 0, max: 10, step: 1,
    hint: () => 'Skipped when you start with the keyboard shortcut.' },
];

const ALL_SLIDERS = [...MAIN_SLIDERS, ...MORE_SLIDERS];

// Slider limits: the lowest and highest value each slider can reach. Users can
// change them on the Slider limits page, within these outer bounds.
const DEFAULT_LIMITS = Object.fromEntries(ALL_SLIDERS.map((c) => [c.key, [c.min, c.max]]));
const HARD_LIMITS = {
  wpm: [5, 400], sentencePause: [0, 3600], paragraphPause: [0, 3600], commaPause: [0, 600],
  citationPause: [0, 600], typoRate: [0, 100], roughness: [0, 100], reviewPause: [0, 3600],
  editTime: [0, 3600], variation: [0, 100], secondThoughts: [0, 100], countdown: [0, 60],
};
const LIMIT_UNITS = { wpm: 'wpm', typoRate: '%', variation: '%', secondThoughts: '%', roughness: 'of 100' };

const state = {
  text: '',
  settings: normalizeSettings({ ...DEFAULT_SETTINGS, ...PRESETS.natural }),
  preset: 'natural',
  draftSeed: randomSeed(),
  draft: null,
  estimate: null,
  mode: 'idle',
  windowId: null,
  // The tab this panel belongs to (it only opens in the tab you click the icon on).
  ownTabId: Number(new URLSearchParams(location.search).get('tab')) || null,
  tab: null,
  platform: 'win',
  run: null,
  pinnedTabId: null,
  currentFrom: null, // 'docs' or 'box' when Current document was read from the page
  currentTyped: 0, // bumps whenever the person types or pastes into Current document
  shortcuts: null,
  recording: null,
  limits: {},
  view: 'write', // write | edit
  current: '',
  updated: '',
  diff: null,
  scanning: false,
};

// Sliders that only matter to the Writer.
const WRITER_ONLY = ['roughness', 'reviewPause', 'citationPause'];

// ---- helpers ---------------------------------------------------------------

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function countWords(text) {
  return (text.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) || []).length;
}

function roughMinutes(ms) {
  const min = ms / 60000;
  if (min < 1) return 'Under a minute';
  if (min < 60) return `About ${Math.round(min)} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m ? `About ${h} h ${m} min` : `About ${h} h`;
}

function blockedReason(url) {
  if (!url) return 'Open your document in this tab first.';
  if (url.startsWith(chrome.runtime.getURL(''))) return null;
  if (/^(chrome|edge|brave|devtools|view-source|chrome-extension|chrome-search):/i.test(url)) {
    return "Chrome doesn't let extensions type into this page. Open AutoType in your document's tab.";
  }
  if (/^https:\/\/(chrome\.google\.com\/webstore|chromewebstore\.google\.com)/.test(url)) {
    return "Chrome doesn't let extensions type into the Web Store.";
  }
  return null;
}

let unsaved = false;
function saveNow() {
  if (!state.ready || !unsaved) return; // never overwrite saved settings before they've loaded
  unsaved = false;
  chrome.storage.local.set({
    autoType: {
      v: 2, text: state.text, settings: state.settings, preset: state.preset, draftSeed: state.draftSeed,
      tab: state.view, current: state.current, currentFrom: state.currentFrom, updated: state.updated,
    },
  });
}
const saveSoon = debounce(saveNow, 300);
function save() {
  unsaved = true;
  saveSoon();
}
// Closing or hiding the panel saves right away, so the last change is never lost.
window.addEventListener('pagehide', saveNow);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') saveNow();
});

// ---- sliders and number boxes ----------------------------------------------

const isDecimal = (cfg) => !(cfg.step >= 1);

function clampRound(cfg, v) {
  const x = Math.min(cfg.max, Math.max(cfg.min, v));
  return isDecimal(cfg) ? Math.round(x * 10) / 10 : Math.round(x);
}

function fmtNum(cfg, v) {
  return isDecimal(cfg) ? String(Math.round(v * 10) / 10) : String(Math.round(v));
}

function toPosition(cfg, v) {
  if (!cfg.curve) return v;
  const t = Math.max(0, Math.min(1, (v - cfg.min) / (cfg.max - cfg.min)));
  return Math.round(Math.pow(t, 1 / cfg.curve) * 1000);
}

function fromPosition(cfg, pos) {
  if (!cfg.curve) return Number(pos);
  return cfg.min + (cfg.max - cfg.min) * Math.pow(Number(pos) / 1000, cfg.curve);
}

function fraction(cfg, v) {
  const pos = toPosition(cfg, v);
  return cfg.curve ? pos / 1000 : (pos - cfg.min) / (cfg.max - cfg.min);
}

function settingKey(cfg, which) {
  return cfg.range ? `${cfg.key}${which}` : cfg.key;
}

function numberBox(cfg, which, label) {
  const input = el('input', 'num');
  input.type = 'number';
  input.inputMode = isDecimal(cfg) ? 'decimal' : 'numeric';
  input.min = cfg.min;
  input.max = cfg.max;
  input.step = isDecimal(cfg) ? 0.1 : cfg.step;
  input.id = `n-${settingKey(cfg, which)}`;
  input.setAttribute('aria-label', label);
  input.addEventListener('input', () => {
    const v = parseFloat(input.value);
    if (Number.isFinite(v) && v >= cfg.min && v <= cfg.max) setValue(cfg, which, v, input);
  });
  input.addEventListener('change', () => {
    const v = parseFloat(input.value);
    if (Number.isFinite(v)) setValue(cfg, which, v);
    else paintSlider(cfg);
  });
  return input;
}

function rangeInput(cfg, which, label) {
  const input = el('input', which === 'Min' ? 'lo' : which === 'Max' ? 'hi' : (cfg.fixing ? 'fixing' : null));
  input.type = 'range';
  input.id = `s-${settingKey(cfg, which)}`;
  if (cfg.curve) {
    input.min = 0;
    input.max = 1000;
    input.step = 5;
  } else {
    input.min = cfg.min;
    input.max = cfg.max;
    input.step = cfg.step;
  }
  input.setAttribute('aria-label', label);
  input.addEventListener('input', () => setValue(cfg, which, fromPosition(cfg, input.value)));
  return input;
}

function buildSlider(cfg) {
  const wrap = el('div', 'slider');
  wrap.dataset.key = cfg.key;
  const head = el('div', 'row');
  const vals = el('span', 'vals');
  if (cfg.range) {
    const name = el('span', 'label', cfg.label);
    vals.append(
      numberBox(cfg, 'Min', `${cfg.label}, shortest, in seconds`),
      'to',
      numberBox(cfg, 'Max', `${cfg.label}, longest, in seconds`),
      el('span', 'unit', cfg.unit),
    );
    head.append(name, vals);
    const dual = el('div', `dual${cfg.fixing ? ' fixing' : ''}`);
    dual.id = `d-${cfg.key}`;
    dual.append(
      rangeInput(cfg, 'Min', `${cfg.label}, shortest`),
      rangeInput(cfg, 'Max', `${cfg.label}, longest`),
    );
    wrap.append(head, dual);
  } else {
    const name = el('label', null, cfg.label);
    name.htmlFor = `n-${cfg.key}`;
    const unit = el('span', 'unit');
    unit.id = `u-${cfg.key}`;
    vals.append(numberBox(cfg, null, cfg.label), unit);
    head.append(name, vals);
    wrap.append(head, rangeInput(cfg, null, cfg.label));
  }
  if (cfg.hint) {
    const hint = el('p', 'hint');
    hint.id = `h-${cfg.key}`;
    wrap.append(hint);
  }
  return wrap;
}

function setValue(cfg, which, raw, typingIn = null) {
  const k = settingKey(cfg, which);
  state.settings[k] = clampRound(cfg, raw);
  if (cfg.range) {
    const lo = `${cfg.key}Min`;
    const hi = `${cfg.key}Max`;
    if (which === 'Min' && state.settings[lo] > state.settings[hi]) state.settings[hi] = state.settings[lo];
    if (which === 'Max' && state.settings[hi] < state.settings[lo]) state.settings[lo] = state.settings[hi];
  }
  if (cfg.key !== 'countdown') setPreset(null);
  paintSlider(cfg, typingIn);
  save();
  if (cfg.key === 'roughness') refreshDraftSoon();
  else refreshEstimateSoon();
}

// Updates thumbs, number boxes and hints. Leaves alone the box being typed in.
function paintSlider(cfg, typingIn = null) {
  const s = state.settings;
  const setBox = (which, v) => {
    const box = $(`n-${settingKey(cfg, which)}`);
    if (box !== typingIn) box.value = fmtNum(cfg, v);
  };
  if (cfg.range) {
    const lo = s[`${cfg.key}Min`];
    const hi = s[`${cfg.key}Max`];
    const loInput = $(`s-${cfg.key}Min`);
    const hiInput = $(`s-${cfg.key}Max`);
    loInput.value = toPosition(cfg, lo);
    hiInput.value = toPosition(cfg, hi);
    loInput.setAttribute('aria-valuetext', `${fmtNum(cfg, lo)} seconds`);
    hiInput.setAttribute('aria-valuetext', `${fmtNum(cfg, hi)} seconds`);
    const a = fraction(cfg, lo);
    const b = fraction(cfg, hi);
    const dual = $(`d-${cfg.key}`);
    dual.style.setProperty('--a', a);
    dual.style.setProperty('--b', b);
    loInput.classList.toggle('top', a > 0.9);
    setBox('Min', lo);
    setBox('Max', hi);
  } else {
    const v = s[cfg.key];
    const input = $(`s-${cfg.key}`);
    input.value = toPosition(cfg, v);
    input.style.setProperty('--fill', `${fraction(cfg, v) * 100}%`);
    const unit = typeof cfg.unit === 'function' ? cfg.unit(v) : cfg.unit;
    input.setAttribute('aria-valuetext', `${fmtNum(cfg, v)} ${unit}`);
    $(`u-${cfg.key}`).textContent = unit;
    setBox(null, v);
  }
  if (cfg.hint) {
    $(`h-${cfg.key}`).textContent = cfg.hint(cfg.range ? s[`${cfg.key}Max`] : s[cfg.key]);
  }
}

function paintAllSliders() {
  ALL_SLIDERS.forEach((cfg) => paintSlider(cfg));
}

function clampToLimits() {
  for (const cfg of ALL_SLIDERS) {
    if (cfg.range) {
      const lo = `${cfg.key}Min`;
      const hi = `${cfg.key}Max`;
      state.settings[lo] = clampRound(cfg, state.settings[lo]);
      state.settings[hi] = Math.max(state.settings[lo], clampRound(cfg, state.settings[hi]));
    } else {
      state.settings[cfg.key] = clampRound(cfg, state.settings[cfg.key]);
    }
  }
}

function applyLimits() {
  for (const cfg of ALL_SLIDERS) {
    [cfg.min, cfg.max] = state.limits[cfg.key] || DEFAULT_LIMITS[cfg.key];
    const ids = cfg.range ? [`${cfg.key}Min`, `${cfg.key}Max`] : [cfg.key];
    for (const id of ids) {
      const box = $(`n-${id}`);
      box.min = cfg.min;
      box.max = cfg.max;
      if (!cfg.curve) {
        const slider = $(`s-${id}`);
        slider.min = cfg.min;
        slider.max = cfg.max;
      }
    }
  }
  clampToLimits();
  paintAllSliders();
}

function setPreset(name) {
  state.preset = name;
  document.querySelectorAll('.presets button').forEach((b) => {
    b.setAttribute('aria-checked', String(b.dataset.preset === name));
  });
  $('custom-flag').hidden = !!name;
}

function applyPreset(name) {
  Object.assign(state.settings, PRESETS[name]);
  clampToLimits();
  setPreset(name);
  paintAllSliders();
  save();
  refreshDraftSoon();
}

// ---- draft preview ---------------------------------------------------------

function refreshDraft() {
  state.draft = state.text.trim() ? makeDraft(state.text, state.settings.roughness, state.draftSeed) : null;
  renderPad();
  if (state.run) markPad(state.run);
  refreshEstimate();
}
const refreshDraftSoon = debounce(refreshDraft, 160);

const CATEGORY_WORDS = { wording: 'word choice', grammar: 'grammar', clause: 'sentence structure', caps: 'capitalization' };

function renderPad() {
  const pad = $('pad');
  pad.replaceChildren();
  const d = state.draft;
  if (!d) {
    pad.append(el('p', 'empty', 'Paste your text above to see the rough draft it will type first.'));
    $('draft-meta').textContent = '';
    $('reshuffle').hidden = true;
    return;
  }
  let p = 0;
  let index = 0;
  for (const para of d.paragraphs) {
    if (!para.original.trim()) continue;
    p++;
    const node = el('p');
    node.dataset.p = p;
    let last = 0;
    for (const ed of para.edits) {
      node.append(document.createTextNode(para.draft.slice(last, ed.ds)));
      const span = el('span', 'edit');
      span.dataset.i = index++;
      span.title = ed.label;
      if (ed.draft) span.append(el('del', null, ed.draft));
      if (ed.orig) span.append(el('ins', null, ed.orig));
      if (!ed.draft) span.classList.add('insert');
      node.append(span);
      last = ed.de;
    }
    node.append(document.createTextNode(para.draft.slice(last)));
    pad.append(node);
  }
  $('reshuffle').hidden = d.total === 0;
  const kept = d.quotes || d.cites ? ' Quotes and citations stay exactly as written.' : '';
  if (!d.total) {
    $('draft-meta').textContent = (state.settings.roughness
      ? 'Too short for changes. It will type this as-is, with typos fixed along the way.'
      : 'Rough draft is off. It types your text as-is, with typos fixed along the way.') + kept;
    return;
  }
  const parts = Object.entries(d.counts).filter(([, n]) => n).map(([cat, n]) => `${n} ${CATEGORY_WORDS[cat]}`);
  $('draft-meta').textContent = `${d.total} ${d.total === 1 ? 'fix' : 'fixes'} planned: ${parts.join(', ')}.${kept}`;
}

function refreshEstimate() {
  const box = $('estimate');
  const editing = state.view === 'edit';
  if (editing ? !state.diff?.edits.length : !state.draft) {
    box.hidden = true;
    state.estimate = null;
    updateStartButton();
    return;
  }
  const plan = editing
    ? buildEditPlan(state.current, state.updated, state.settings, { diff: state.diff, runSeed: 1 })
    : buildPlan(state.text, state.settings, { draft: state.draft, runSeed: 1 });
  const st = plan.stats;
  state.estimate = st;
  box.hidden = false;
  $('estimate-total').textContent = roughMinutes(st.totalMs);
  const segs = $('split').children;
  segs[0].style.flex = String(st.typingMs);
  segs[1].style.flex = String(st.thinkingMs);
  segs[2].style.flex = String(st.editingMs);
  $('legend-typing').textContent = `Typing ${formatDuration(st.typingMs)}`;
  $('legend-thinking').textContent = `Pauses ${formatDuration(st.thinkingMs)}`;
  $('legend-editing').textContent = `Editing ${formatDuration(st.editingMs)}`;
  updateStartButton();
}
const refreshEstimateSoon = debounce(refreshEstimate, 160);

function updateSourceMeta() {
  const text = state.text;
  $('clear').hidden = !text;
  if (!text.trim()) {
    $('source-meta').textContent = 'Nothing pasted yet.';
    return;
  }
  const words = countWords(text);
  const paras = text.replace(/\r\n?/g, '\n').split(/\n+/).filter((p) => p.trim()).length;
  $('source-meta').textContent = `${words.toLocaleString()} ${words === 1 ? 'word' : 'words'} in ${paras} ${paras === 1 ? 'paragraph' : 'paragraphs'}.`;
}

// ---- editor ------------------------------------------------------------------

const shorten = (t, n = 48) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

function wordsIn(text) {
  return (text.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) || []).length;
}

function refreshEdit() {
  const { current, updated } = state;
  state.diff = null;
  state.diffError = '';
  if (current.trim() && updated.trim()) {
    try {
      state.diff = editorDiff(current, updated, { looseQuotes: state.currentFrom === 'docs' });
    } catch (err) {
      state.diffError = err?.message || String(err);
    }
  }
  $('clear-current').hidden = !current;
  $('clear-updated').hidden = !updated;
  if (!state.scanInfo) {
    $('current-meta').textContent = current.trim() ? `${wordsIn(current).toLocaleString()} words.` : '';
  }
  $('updated-meta').textContent = updated.trim() ? `${wordsIn(updated).toLocaleString()} words.` : '';
  renderEditPad();
  refreshEstimate();
}
const refreshEditSoon = debounce(refreshEdit, 200);

function renderEditPad() {
  const pad = $('edit-pad');
  pad.replaceChildren();
  const d = state.diff;
  const meta = $('edit-meta');
  if (!d) {
    pad.append(el('p', 'empty', state.diffError || 'Scan or paste your document, then paste the updated version. The changes show up here.'));
    meta.textContent = '';
    return;
  }
  if (!d.edits.length) {
    pad.append(el('p', 'empty', 'The two versions are the same. Nothing to change.'));
    meta.textContent = '';
    return;
  }
  // Show the document paragraph by paragraph with each edit marked in place.
  const a = d.old;
  let node = el('p');
  let index = 0;
  const addText = (t) => {
    const parts = t.split('\n');
    parts.forEach((part, i) => {
      if (i > 0) {
        pad.append(node);
        node = el('p');
      }
      // Page breaks and pictures from a Google Doc show as small labels; AutoType steps over them.
      part.split(/([\f\ufffc])/).forEach((bit) => {
        if (bit === '\f') node.append(el('span', 'object', 'page break'));
        else if (bit === '\ufffc') node.append(el('span', 'object', 'picture or note'));
        else if (bit) node.append(document.createTextNode(bit));
      });
    });
  };
  let last = 0;
  for (const h of d.edits) {
    addText(a.slice(last, h.s));
    const span = el('span', 'edit');
    span.dataset.i = index++;
    const from = a.slice(h.s, h.e);
    if (from) span.append(el('del', null, from.replace(/\n/g, ' ¶ ')));
    if (h.text) span.append(el('ins', null, h.text.replace(/\n/g, ' ¶ ')));
    if (!from) span.classList.add('insert');
    node.append(span);
    last = h.e;
  }
  addText(a.slice(last));
  pad.append(node);
  const adds = d.edits.filter((h) => h.s === h.e).length;
  const cuts = d.edits.filter((h) => !h.text).length;
  const swaps = d.edits.length - adds - cuts;
  const parts = [];
  if (swaps) parts.push(`${swaps} ${swaps === 1 ? 'change' : 'changes'}`);
  if (adds) parts.push(`${adds} ${adds === 1 ? 'addition' : 'additions'}`);
  if (cuts) parts.push(`${cuts} ${cuts === 1 ? 'cut' : 'cuts'}`);
  meta.textContent = `${d.edits.length} ${d.edits.length === 1 ? 'edit' : 'edits'}: ${parts.join(', ')}. Everything else stays as it is.`;
}

function setView(view) {
  state.view = view;
  document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.view === view)));
  document.querySelectorAll('section[data-view]').forEach((sec) => {
    sec.hidden = sec.dataset.view !== view;
  });
  document.querySelectorAll('.slider[data-key]').forEach((w) => {
    w.hidden = view === 'edit' && WRITER_ONLY.includes(w.dataset.key);
  });
  $('tagline').textContent = view === 'edit'
    ? 'Makes the changes between two versions of your document right in the document, one small edit at a time.'
    : 'Types your text like a person: a rough first draft, then revisions until it matches exactly.';
  $('start').textContent = view === 'edit' ? 'Start editing' : 'Start typing';
  const mac = state.platform === 'mac';
  $('current-help').textContent = 'Click Scan document to read it straight from this tab, or paste it here.';
  const tip = $('edit-tip');
  tip.hidden = view !== 'edit';
  tip.textContent = `It reads your document again right before it starts, jumps to the top with ${mac ? '⌘↑' : 'Ctrl+Home'}, and makes each change in place, top to bottom. Tables, pictures and footnotes can throw off the changes below them.`;
  save();
  refreshEstimate();
  autoScan();
}

// The Editor reads the page whenever it's shown, so Current document is
// always the document in this tab (not one left over from another tab).
function autoScan() {
  const busy = state.mode !== 'idle' || ['countdown', 'running'].includes(state.run?.mode);
  if (state.view === 'edit' && state.ready && state.tab && !busy && !blockedReason(state.tab.url)) scan(true);
}

// Read the document straight from this panel's tab (Google Docs or a text box).
async function scan(quiet = false) {
  if (state.scanning || !state.tab) return null;
  state.scanning = true;
  $('scan').disabled = true;
  $('scan').textContent = 'Scanning…';
  const typed = state.currentTyped;
  const res = await chrome.runtime.sendMessage({ type: 'autotype-scan', tabId: state.tab.id }).catch((err) => ({ error: String(err?.message || err) }));
  state.scanning = false;
  $('scan').disabled = state.mode !== 'idle';
  $('scan').textContent = 'Scan document';
  if (quiet && typed !== state.currentTyped) return null;
  if (res?.text != null) {
    setCurrent(res.text, res.source);
    return res.text;
  }
  if (!quiet) $('current-meta').textContent = res?.error || "Couldn't read this page. Paste the text instead.";
  return null;
}

function setCurrent(text, source) {
  state.current = text;
  state.currentFrom = source || null;
  $('current').value = text;
  const when = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const from = source === 'docs' ? 'Google Docs' : 'this page';
  state.scanInfo = !source ? null
    : text.trim() ? `Read from ${from} at ${when}. ${wordsIn(text).toLocaleString()} ${wordsIn(text) === 1 ? 'word' : 'words'}.`
    : `${source === 'docs' ? 'This Doc' : 'The text box on this page'} is empty, so there's nothing to edit yet. Use Writer to type something new.`;
  if (state.scanInfo) $('current-meta').textContent = state.scanInfo;
  save();
  refreshEdit();
}

// ---- keyboard shortcuts ----------------------------------------------------

const ACTION_NAMES = { startStop: 'Start or stop', pause: 'Pause or resume' };

function defaultShortcuts() {
  const mac = state.platform === 'mac';
  return {
    startStop: { code: 'KeyB', shift: true, meta: mac, ctrl: !mac, alt: false },
    pause: { code: 'KeyP', shift: true, meta: mac, ctrl: !mac, alt: false },
  };
}

const KEY_NAMES = {
  Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']',
  Backslash: '\\', Minus: '-', Equal: '=', Backquote: '`', Space: 'Space', Enter: 'Return', Tab: 'Tab',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Escape: 'Esc', Backspace: 'Delete',
};

function keyName(code) {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad\d$/.test(code)) return `Num ${code.slice(6)}`;
  return KEY_NAMES[code] || code;
}

function describeShortcut(s) {
  if (!s) return 'Not set';
  if (state.platform === 'mac') {
    return `${s.ctrl ? '⌃' : ''}${s.alt ? '⌥' : ''}${s.shift ? '⇧' : ''}${s.meta ? '⌘' : ''}${keyName(s.code)}`;
  }
  return [s.ctrl && 'Ctrl', s.alt && 'Alt', s.shift && 'Shift', s.meta && 'Win', keyName(s.code)].filter(Boolean).join('+');
}

function spokenShortcut(s) {
  const mac = state.platform === 'mac';
  return [s.ctrl && 'Control', s.alt && (mac ? 'Option' : 'Alt'), s.shift && 'Shift', s.meta && (mac ? 'Command' : 'Windows'), keyName(s.code)]
    .filter(Boolean).join(' ');
}

function sameShortcut(a, b) {
  return !!a && !!b && a.code === b.code && !!a.shift === !!b.shift && !!a.meta === !!b.meta && !!a.ctrl === !!b.ctrl && !!a.alt === !!b.alt;
}

function matchesEvent(e, s) {
  return !!s && e.code === s.code && e.shiftKey === !!s.shift && e.metaKey === !!s.meta && e.ctrlKey === !!s.ctrl && e.altKey === !!s.alt;
}

const KEYS_NOTE = 'Click a shortcut, then press the new keys. They work in any tab, even with this panel closed.';
let noteTimer = 0;
function keysNote(text, bad = false) {
  clearTimeout(noteTimer);
  const note = $('keys-note');
  note.textContent = text;
  note.classList.toggle('bad', bad);
  if (text !== KEYS_NOTE && !state.recording) {
    noteTimer = setTimeout(() => keysNote(KEYS_NOTE), 5000);
  }
}

function renderShortcuts() {
  for (const action of Object.keys(ACTION_NAMES)) {
    const btn = $(`key-${action}`);
    const s = state.shortcuts?.[action];
    btn.classList.toggle('recording', state.recording === action);
    btn.textContent = state.recording === action ? 'Press keys' : describeShortcut(s);
    btn.setAttribute('aria-label', `${ACTION_NAMES[action]}: ${s ? spokenShortcut(s) : 'not set'}. Click to change.`);
  }
}

function validateShortcut(combo, action) {
  const mac = state.platform === 'mac';
  if (!combo.meta && !combo.ctrl && !combo.alt) {
    return `Include ${mac ? 'Command, Control or Option' : 'Ctrl or Alt'} so normal typing never sets it off.`;
  }
  const letter = combo.code.replace(/^Key/, '');
  if ((combo.meta || combo.ctrl) && ['C', 'V', 'X', 'Z', 'A', 'Y'].includes(letter)) {
    return 'That one is used for copy, paste or undo. Pick another key.';
  }
  const reserved = mac
    ? combo.meta && (['Q', 'W', 'T', 'N', 'H', 'M'].includes(letter) || ['Tab', 'Backquote', 'Space'].includes(combo.code))
    : (combo.ctrl && (['W', 'T', 'N'].includes(letter) || combo.code === 'Tab')) || (combo.alt && combo.code === 'F4');
  if (reserved) return 'Chrome keeps that shortcut for itself. Pick another.';
  for (const [other, s] of Object.entries(state.shortcuts || {})) {
    if (other !== action && sameShortcut(s, combo)) return `That's already the shortcut for ${ACTION_NAMES[other].toLowerCase()}.`;
  }
  return null;
}

function startRecording(action) {
  state.recording = action;
  renderShortcuts();
  keysNote(`Press the new shortcut for ${ACTION_NAMES[action].toLowerCase()}. Esc cancels.`);
}

function stopRecording() {
  state.recording = null;
  renderShortcuts();
}

function handleRecordingKey(e) {
  e.preventDefault();
  e.stopPropagation();
  if (e.key === 'Escape') {
    stopRecording();
    keysNote(KEYS_NOTE);
    return;
  }
  if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Fn'].includes(e.key)) return;
  const action = state.recording;
  const combo = { code: e.code, shift: e.shiftKey, meta: e.metaKey, ctrl: e.ctrlKey, alt: e.altKey };
  const problem = validateShortcut(combo, action);
  if (problem) {
    keysNote(problem, true);
    return;
  }
  state.shortcuts = { ...state.shortcuts, [action]: combo };
  chrome.storage.local.set({ autoTypeShortcuts: state.shortcuts });
  stopRecording();
  keysNote(`Saved. ${describeShortcut(combo)} now ${action === 'startStop' ? 'starts and stops' : 'pauses and resumes'} typing.`);
}

function onShortcut(action) {
  if (state.recording) return;
  const mode = state.run?.mode || 'idle';
  if (action === 'startStop' && (mode === 'idle' || mode === 'done')) {
    start();
    return;
  }
  chrome.runtime.sendMessage({ type: 'autotype-shortcut', action, tabId: state.ownTabId }).catch(() => {});
}

// ---- target tab ------------------------------------------------------------

async function refreshTarget() {
  if (state.windowId == null) return;
  const fixedTab = state.pinnedTabId ?? state.ownTabId;
  const [tab] = fixedTab != null
    ? [await chrome.tabs.get(fixedTab).catch(() => null)]
    : await chrome.tabs.query({ active: true, windowId: state.windowId });
  state.tab = tab || null;
  const target = $('target');
  const reason = blockedReason(tab?.url);
  target.classList.toggle('blocked', !!reason);
  target.replaceChildren();
  if (reason) {
    target.textContent = reason;
  } else {
    target.append('Types into ', el('b', null, tab.title || tab.url), ' wherever you click, and rereads the page every 5 edits to fix anything that came out wrong.');
    target.title = tab.title || '';
  }
  const tip = $('tip');
  if (!reason && /^https:\/\/docs\.google\.com\/document\//.test(tab?.url || '')) {
    tip.hidden = false;
    tip.textContent = 'Typing into Google Docs? In Tools > Preferences, uncheck the automatic options (capitalize words, detect lists, correct spelling, Smart Compose) and turn off automatic substitution. Otherwise Docs changes the text as it types, and a check will stop the run if Docs keeps undoing a fix. Smart quotes can stay on.';
  } else {
    tip.hidden = true;
  }
  updateStartButton();
}

function updateStartButton() {
  const content = state.view === 'edit' ? !!state.diff?.edits.length : !!state.draft;
  const ready = state.mode === 'idle' && content && !!state.tab && !blockedReason(state.tab.url);
  $('start').disabled = !ready;
}

// ---- run (shown here, carried out by the background worker) ----------------

function setMode(mode) {
  state.mode = mode;
  if (mode === 'running' || mode === 'countdown') hideRecovery();
  else if (state.tab) refreshRecovery();
  $('idle-view').hidden = mode !== 'idle';
  $('run-view').hidden = mode !== 'running';
  $('result-view').hidden = mode !== 'done';
  const locked = mode !== 'idle';
  ['source', 'current', 'updated', 'scan', 'clear-current', 'clear-updated', 'tab-write', 'tab-edit'].forEach((id) => {
    $(id).disabled = locked;
  });
  document.querySelectorAll('#main input, .presets button, #reshuffle, #clear, .keycap, #open-limits').forEach((n) => {
    n.disabled = locked;
  });
  updateStartButton();
}

function showError(msg) {
  const e = $('error');
  e.hidden = !msg;
  e.textContent = msg || '';
}

let recoveryState = null;
let recoveryLoad = 0;
function clearPreview() {
  recoveryState = null;
  $('recovery-compare').hidden = true;
  $('recovery-start').hidden = true;
  $('recovery-note').textContent = '';
}
function hideRecovery() {
  recoveryLoad++;
  clearPreview();
  $('recovery').hidden = true;
}
function requestRecovery(action, extra = {}) {
  return chrome.runtime.sendMessage({ type: 'autotype-recover-' + action, tabId: state.tab.id,
    id: $('recovery-list').value, ...extra }).catch(error => ({ error: String(error.message || error) }));
}
async function refreshRecovery() {
  if (!state.tab || ['running','countdown'].includes(state.mode)) return hideRecovery();
  const serial = ++recoveryLoad;
  const response = await requestRecovery('list');
  if (serial !== recoveryLoad) return;
  const records = response?.records || [];
  const selected = $('recovery-list').value;
  $('recovery-list').replaceChildren(...records.map(record =>
    new Option(new Date(record.started).toLocaleString(), record.id)));
  if (records.some(r => r.id === selected)) $('recovery-list').value = selected;
  else clearPreview();
  $('recovery').hidden = !records.length;
}
$('recovery-list').addEventListener('change', clearPreview);
$('recovery-preview').addEventListener('click', async () => {
  clearPreview();
  const id = $('recovery-list').value;
  const data = await requestRecovery('preview');
  if ($('recovery-list').value !== id || $('recovery').hidden) return;
  if (!data || data.error) {
    $('recovery-note').textContent = data?.error || 'The editor could not be read.';
    return;
  }
  recoveryState = data;
  $('recovery-current').value = data.current ?? '';
  $('recovery-target').value = data.updated ?? data.intended ?? '';
  $('recovery-compare').hidden = false;
  $('recovery-start').hidden = data.matches || data.sourceOnly;
  $('recovery-note').textContent = data.sourceOnly ? 'The insertion point could not be verified. Copy the saved text for manual recovery.'
    : data.matches ? 'The document already matches. You can forget this record.' : 'Review both versions and any edits made since the interruption.';
});
$('recovery-start').addEventListener('click', async () => {
  if (!recoveryState) return;
  const result = await requestRecovery('start', { current: recoveryState.current });
  if (result?.error) { clearPreview(); $('recovery-note').textContent = result.error; }
});
$('recovery-forget').addEventListener('click', async () => {
  if (!confirm('Forget this saved recovery target? The document itself will stay as it is.')) return;
  const result = await requestRecovery('forget');
  if (result?.error) { $('recovery-note').textContent = result.error; return; }
  clearPreview();
  await refreshRecovery();
});
let countdownTimer = 0;
function showCountdown(endsAt) {
  const overlay = $('countdown');
  const tick = () => {
    const left = Math.max(1, Math.ceil((endsAt - Date.now()) / 1000));
    $('count').textContent = left;
  };
  tick();
  overlay.hidden = false;
  clearInterval(countdownTimer);
  countdownTimer = setInterval(tick, 200);
}
function hideCountdown() {
  clearInterval(countdownTimer);
  $('countdown').hidden = true;
}

function markPad(run) {
  const editing = run.kind === 'edit';
  const expected = editing
    ? draftKey(`${state.current}\u0001${state.updated}`, 'edit', 0)
    : draftKey(state.text, state.draftSeed, state.settings.roughness);
  const same = (editing ? !!state.diff : !!state.draft) && run.key === expected;
  const pad = $(editing ? 'edit-pad' : 'pad');
  const edits = [...pad.querySelectorAll('.edit')];
  const fixing = run.mode === 'running' && !!run.status?.fix;
  const doneCount = run.counters.fix;
  const up = run.order === 'up';
  let current = null;
  edits.forEach((n, i) => {
    const k = up ? edits.length - 1 - i : i;
    n.classList.toggle('done', same && k < doneCount);
    const isCurrent = same && fixing && k === doneCount;
    n.classList.toggle('current', isCurrent);
    if (isCurrent) current = n;
  });
  if (current && current !== state.lastCurrent) current.scrollIntoView({ block: 'nearest' });
  state.lastCurrent = current;
  const p = same && !editing && run.mode === 'running' ? run.status?.p : null;
  pad.querySelectorAll('p.active').forEach((n) => {
    if (Number(n.dataset.p) !== p) n.classList.remove('active');
  });
  if (p) {
    const node = pad.querySelector(`p[data-p="${p}"]`);
    if (node && !node.classList.contains('active')) {
      node.classList.add('active');
      node.scrollIntoView({ block: 'nearest' });
    }
  }
}

function renderRunning(run) {
  $('run-target').textContent = run.tabTitle || '';
  $('c-typo').textContent = run.counters.typo;
  $('c-rethink').textContent = run.counters.rethink;
  $('c-fix').textContent = run.counters.fix;
  $('c-fix-total').textContent = run.totalFixes;
  $('c-fix-word').textContent = run.kind === 'edit' ? 'edits' : 'revisions';
  $('progress-fill').style.width = `${run.total ? (run.elapsed / run.total) * 100 : 0}%`;
  $('time-left').textContent = run.mode === 'running' ? `${formatDuration(run.total - run.elapsed)} left` : '';
  $('run-view').classList.toggle('paused', run.paused);
  $('pause').textContent = run.paused ? 'Resume' : 'Pause';
  $('pause').disabled = run.mode !== 'running';
  const line = $('fixline');
  line.replaceChildren();
  if (run.mode === 'countdown') {
    $('status').textContent = 'Starting…';
  } else if (run.paused) {
    $('status').textContent = 'Paused';
    line.textContent = "Don't click inside your document while paused; typing resumes wherever the cursor is.";
  } else if (run.status) {
    $('status').textContent = run.status.s;
    const fix = run.status.fix;
    if (fix && fix.type === 'edit') {
      if (fix.from) line.append(el('del', null, shorten(fix.from.trim() || fix.from)));
      if (fix.from && fix.to) line.append(' ');
      if (fix.to) line.append(el('ins', null, shorten(fix.to.trim() || fix.to)));
    } else if (fix) {
      line.append(`Fix ${fix.n} of ${fix.of}: `);
      const wordSwap = ['synonym', 'wordy', 'phrase', 'connective', 'agreement', 'homophone', 'plural', 'preposition', 'article'].includes(fix.type);
      if (wordSwap && fix.from && fix.to) line.append(el('del', null, fix.from.trim()), ' ', el('ins', null, fix.to.trim()));
      else line.append(fix.label);
    }
  }
  const hint = $('shortcut-hint');
  hint.hidden = !state.shortcuts;
  if (state.shortcuts) {
    hint.textContent = `${describeShortcut(state.shortcuts.pause)} pauses and ${describeShortcut(state.shortcuts.startStop)} stops, from any tab. Closing this panel doesn't stop typing.`;
  }
  markPad(run);
}

function showResult(run) {
  const r = run.result || {};
  const c = r.counters || run.counters;
  const words = r.words ?? run.words ?? 0;
  const editing = run.kind === 'edit';
  if (r.notStarted) {
    $('result-title').textContent = "Didn't start";
    $('result-summary').textContent = `Nothing was typed: ${r.failure}.`;
  } else if (r.finished && editing) {
    $('result-title').textContent = 'Done';
    const typos = c.typo ? ` and fixed ${c.typo} ${c.typo === 1 ? 'typo' : 'typos'} along the way` : '';
    $('result-summary').textContent = `Made ${c.fix} ${c.fix === 1 ? 'edit' : 'edits'} in ${formatDuration(r.elapsed || 0)}${typos}.`;
  } else if (r.finished) {
    $('result-title').textContent = 'Done';
    const bits = [`Typed ${words.toLocaleString()} ${words === 1 ? 'word' : 'words'} in ${formatDuration(r.elapsed || 0)}`];
    bits.push(`fixed ${c.typo} ${c.typo === 1 ? 'typo' : 'typos'}`);
    if (c.fix) bits.push(`made ${c.fix} ${c.fix === 1 ? 'revision' : 'revisions'}`);
    $('result-summary').textContent = `${bits.slice(0, -1).join(', ')}${bits.length > 1 ? ' and ' : ''}${bits[bits.length - 1]}.`;
  } else {
    $('result-title').textContent = 'Stopped';
    let why = '';
    if (r.failure) why = ` It stopped because ${r.failure}.`;
    else if (r.detachReason === 'canceled_by_user') why = ' Typing stopped because the debugging bar was closed.';
    else if (r.detachReason === 'target_closed') why = ' Typing stopped because the tab was closed.';
    $('result-summary').textContent = `Stopped ${Math.round((r.progress || 0) * 100)}% of the way through. Whatever was typed is still on the page.${why}`;
  }
  const box = $('result-check');
  const target = editing ? 'updated version' : 'original';
  const docs = run.tabUrl ? /^https:\/\/docs\.google\.com\/document\//.test(run.tabUrl) : false;
  const where = docs ? 'Your Doc' : 'The text box';
  const lines = [];
  if (r.check === 'match') lines.push(`${where} now matches your ${target} exactly.`);
  if (r.check === 'mismatch') lines.push(`${where} doesn't match your ${target} exactly. The page may have changed something while it was typed, like autocorrect.`);
  // The checks every 5 edits.
  if (r.checkOff) lines.push(r.checkOff);
  else if (r.checks) {
    const fixedSome = r.repairs ? ` It caught and fixed ${r.repairs} ${r.repairs === 1 ? 'mistake' : 'mistakes'} along the way.` : ' Every check came back right.';
    lines.push(`It reread the page ${r.checks} ${r.checks === 1 ? 'time' : 'times'} to check its work (every 5 edits).${fixedSome}`);
  }
  box.hidden = !lines.length;
  box.classList.toggle('bad', r.check === 'mismatch');
  box.textContent = lines.join(' ');
  markPad(run);
}

// Draws whatever the background worker reports. Safe to call any number of times.
function applyRun(run) {
  const was = state.run?.mode;
  state.run = run;
  if (run.mode === 'countdown' && !run.fromShortcut) {
    setMode('countdown');
    $('idle-view').hidden = true;
    showCountdown(run.countdownEnds);
    return;
  }
  hideCountdown();
  if (run.mode === 'countdown' || run.mode === 'running') {
    if (state.mode !== 'running') setMode('running');
    if (run.mode === 'running' && was !== 'running') {
      // Keep the legal pad in view: its red marks turn blue as each fix lands.
      const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
      $(run.kind === 'edit' ? 'changes-label' : 'draft-label').scrollIntoView({ block: 'start', behavior: calm ? 'auto' : 'smooth' });
    }
    renderRunning(run);
  } else if (run.mode === 'done') {
    if (state.mode !== 'done') setMode('done');
    showResult(run);
  } else {
    if (state.mode !== 'idle') setMode('idle');
    markPad(run);
  }
}

async function start() {
  if (state.mode !== 'idle') return;
  showError('');
  await refreshTarget();
  const reason = blockedReason(state.tab?.url);
  if (reason) {
    showError(reason);
    return;
  }
  if (state.view === 'edit') {
    if (!state.diff?.edits.length) {
      showError('Scan or paste your document and the updated version first.');
      return;
    }
    const res = await chrome.runtime.sendMessage({
      type: 'autotype-start',
      kind: 'edit',
      tabId: state.tab.id,
      current: state.current,
      currentFrom: state.currentFrom,
      updated: state.updated,
      settings: state.settings,
    }).catch((err) => ({ error: String(err?.message || err) }));
    if (res?.error) showError(res.error);
    return;
  }
  if (!state.draft) {
    showError('Paste your text first.');
    return;
  }
  const res = await chrome.runtime.sendMessage({
    type: 'autotype-start',
    tabId: state.tab.id,
    text: state.text,
    settings: state.settings,
    draftSeed: state.draftSeed,
  }).catch((err) => ({ error: String(err?.message || err) }));
  if (res?.error) showError(res.error);
}

function send(type) {
  return chrome.runtime.sendMessage({ type }).catch(() => {});
}

// ---- slider limits page ------------------------------------------------------

function limitsError(msg) {
  const e = $('limits-error');
  e.hidden = !msg;
  e.textContent = msg || '';
}

function buildLimits() {
  const list = $('limits-list');
  list.replaceChildren();
  for (const cfg of ALL_SLIDERS) {
    const row = el('div', 'limit-row');
    const name = el('span', 'label', cfg.label);
    const vals = el('span', 'vals');
    const box = (end) => {
      const input = el('input', 'num');
      input.type = 'number';
      input.id = `lim-${cfg.key}-${end}`;
      input.step = isDecimal(cfg) ? 0.1 : 1;
      input.setAttribute('aria-label', `${cfg.label}, ${end === 'min' ? 'lowest' : 'highest'} value`);
      input.addEventListener('change', () => saveLimit(cfg));
      return input;
    };
    vals.append(box('min'), 'to', box('max'), el('span', 'unit', LIMIT_UNITS[cfg.key] || 's'));
    row.append(name, vals);
    list.append(row);
  }
}

function fillLimits() {
  for (const cfg of ALL_SLIDERS) {
    $(`lim-${cfg.key}-min`).value = fmtNum(cfg, cfg.min);
    $(`lim-${cfg.key}-max`).value = fmtNum(cfg, cfg.max);
  }
}

function saveLimit(cfg) {
  const lo = parseFloat($(`lim-${cfg.key}-min`).value);
  const hi = parseFloat($(`lim-${cfg.key}-max`).value);
  const [floor, ceiling] = HARD_LIMITS[cfg.key];
  const round = (v) => (isDecimal(cfg) ? Math.round(v * 10) / 10 : Math.round(v));
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
    limitsError(`${cfg.label}: enter a number in both boxes.`);
    return;
  }
  if (lo < floor || hi > ceiling) {
    limitsError(`${cfg.label} can go from ${floor} to ${ceiling}.`);
    return;
  }
  if (round(hi) <= round(lo)) {
    limitsError(`${cfg.label}: the highest value has to be above the lowest.`);
    return;
  }
  limitsError('');
  const next = [round(lo), round(hi)];
  const [dLo, dHi] = DEFAULT_LIMITS[cfg.key];
  if (next[0] === dLo && next[1] === dHi) delete state.limits[cfg.key];
  else state.limits[cfg.key] = next;
  chrome.storage.local.set({ autoTypeLimits: state.limits });
  applyLimits();
  fillLimits();
  save();
  refreshDraftSoon();
}

function openLimits() {
  fillLimits();
  limitsError('');
  $('limits-view').hidden = false;
  $('limits-title').focus();
}

function closeLimits() {
  $('limits-view').hidden = true;
  $('open-limits').focus();
}

// ---- wiring ----------------------------------------------------------------

async function init() {
  try {
    state.platform = (await chrome.runtime.getPlatformInfo()).os;
  } catch {
    /* default */
  }

  $('sliders').append(...MAIN_SLIDERS.map(buildSlider));
  $('sliders-more').append(...MORE_SLIDERS.map(buildSlider));

  const stored = await chrome.storage.local.get(['autoType', 'autoTypeShortcuts', 'autoTypeLimits']);
  const saved = stored.autoType;
  if (saved) {
    state.text = saved.text || '';
    if (saved.v === 2 && saved.settings) {
      state.settings = normalizeSettings(saved.settings);
      state.preset = saved.preset ?? null;
    }
    if (saved.draftSeed) state.draftSeed = saved.draftSeed;
    state.current = saved.current || '';
    state.currentFrom = saved.currentFrom || null;
    state.updated = saved.updated || '';
    if (saved.tab === 'edit') state.view = 'edit';
  }
  state.shortcuts = stored.autoTypeShortcuts || defaultShortcuts();
  if (!stored.autoTypeShortcuts) chrome.storage.local.set({ autoTypeShortcuts: state.shortcuts });
  renderShortcuts();

  state.limits = stored.autoTypeLimits || {};
  buildLimits();
  applyLimits();
  state.ready = true;
  $('source').value = state.text;
  setPreset(state.preset);
  updateSourceMeta();
  refreshDraft();

  $('current').value = state.current;
  $('updated').value = state.updated;
  refreshEdit();

  const win = await chrome.windows.getCurrent();
  state.windowId = win.id;
  await refreshTarget();
  // Pick up a run that started earlier (or while this panel was closed).
  const res = await chrome.runtime.sendMessage({ type: 'autotype-get' }).catch(() => null);
  if (res?.run) applyRun(res.run);
  setView(state.view);
  await refreshRecovery();
}

$('source').addEventListener('input', (e) => {
  state.text = e.target.value;
  updateSourceMeta();
  save();
  refreshDraftSoon();
});
$('current').addEventListener('input', (e) => {
  state.current = e.target.value;
  state.currentFrom = null;
  state.currentTyped += 1;
  state.scanInfo = null;
  save();
  refreshEditSoon();
});
$('updated').addEventListener('input', (e) => {
  state.updated = e.target.value;
  save();
  refreshEditSoon();
});
$('clear-current').addEventListener('click', () => {
  setCurrent('', null);
  $('current').focus();
});
$('clear-updated').addEventListener('click', () => {
  state.updated = '';
  $('updated').value = '';
  save();
  refreshEdit();
  $('updated').focus();
});
$('scan').addEventListener('click', () => scan(false));
document.querySelectorAll('.tabs button').forEach((b) => {
  b.addEventListener('click', () => setView(b.dataset.view));
});
$('clear').addEventListener('click', () => {
  state.text = '';
  $('source').value = '';
  updateSourceMeta();
  save();
  refreshDraft();
  $('source').focus();
});
document.querySelectorAll('.presets button').forEach((b) => {
  b.addEventListener('click', () => applyPreset(b.dataset.preset));
});
$('reshuffle').addEventListener('click', () => {
  state.draftSeed = randomSeed();
  save();
  refreshDraft();
});
$('open-practice').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('practice.html') });
});
$('start').addEventListener('click', () => start());
$('open-limits').addEventListener('click', openLimits);
$('limits-done').addEventListener('click', closeLimits);
$('limits-reset').addEventListener('click', () => {
  state.limits = {};
  chrome.storage.local.set({ autoTypeLimits: {} });
  applyLimits();
  fillLimits();
  limitsError('');
  save();
  refreshDraftSoon();
});
$('pause').addEventListener('click', () => send('autotype-pause'));
$('stop').addEventListener('click', () => send('autotype-stop'));
$('cancel-countdown').addEventListener('click', () => send('autotype-stop'));
$('again').addEventListener('click', async () => {
  send('autotype-reset');
  await refreshTarget();
  // The document just changed, so read it again before the next round.
  if (state.view === 'edit') setTimeout(autoScan, 300);
});
document.querySelectorAll('.keycap').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (state.recording === btn.dataset.action) {
      stopRecording();
      keysNote(KEYS_NOTE);
    } else startRecording(btn.dataset.action);
  });
});

document.addEventListener('keydown', (e) => {
  if (!$('limits-view').hidden && e.key === 'Escape') {
    closeLimits();
    return;
  }
  if (state.recording) {
    handleRecordingKey(e);
    return;
  }
  for (const action of Object.keys(ACTION_NAMES)) {
    if (matchesEvent(e, state.shortcuts?.[action])) {
      e.preventDefault();
      onShortcut(action);
      return;
    }
  }
  if (e.key === 'Escape' && state.run?.mode === 'running') send('autotype-pause');
  if (e.key === 'Escape' && state.run?.mode === 'countdown') send('autotype-stop');
}, true);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.autoTypeShortcuts?.newValue) {
    state.shortcuts = changes.autoTypeShortcuts.newValue;
    renderShortcuts();
  }
});

// A shortcut pressed in this panel's tab starts exactly what this panel shows
// (Writer or Editor, with these boxes), even if another panel saved since.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'autotype-panel-state') return false;
  if (!state.ready || msg.tabId == null || msg.tabId !== state.ownTabId) return false;
  sendResponse({
    tab: state.view,
    text: state.text,
    current: state.current,
    currentFrom: state.currentFrom,
    updated: state.updated,
    settings: state.settings,
    draftSeed: state.draftSeed,
  });
  return false;
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== 'autotype-run') return;
  const mine = state.ownTabId == null || (msg.scannedTab ?? msg.run?.tabId) === state.ownTabId;
  if (mine && msg.scanned != null && state.view === 'edit' && msg.scanned !== state.current) setCurrent(msg.scanned, msg.scannedFrom);
  if (msg.run) applyRun(msg.run);
  if (msg.error) showError(msg.error);
});

chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (state.mode === 'idle' && tabId === state.tab?.id && (info.title || info.url || info.status === 'complete')) refreshTarget();
});

// Exposed for automated tests only.
window.autoType = {
  state,
  start,
  pin: (tabId) => {
    state.pinnedTabId = tabId;
    return refreshTarget();
  },
};

init();
