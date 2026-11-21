// AutoType's background worker. It owns every typing run, so a run keeps going
// when the side panel is hidden, closed or reopened. The side panel is only a
// remote control, and it lives in the one tab where you open it.

import { makeDraft } from './engine/degrade.js';
import { buildPlan, buildEditPlan, simulate, normalizeSettings, addChecks, buildFixPlan } from './engine/plan.js';
import { editorDiff, plainQuotes } from './engine/diff.js';
import { randomSeed } from './engine/rng.js';
import { draftKey, glen } from './engine/text.js';
import { CdpDriver } from './driver/cdp.js';
import { Runner } from './driver/runner.js';
import { RECORD_PREFIX, fullTarget, pageIdentity, retryRead, withDeadline } from './driver/recovery.js';
import './docs-reader.js';

// ---- side panel: one per tab -------------------------------------------------

// No panel anywhere by default; clicking the toolbar icon turns it on for that
// tab only, so it doesn't follow you to other tabs.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
chrome.sidePanel.setOptions({ enabled: false }).catch(() => {});

chrome.action.onClicked.addListener((tab) => {
  // Not awaited: open() has to happen inside the click.
  chrome.sidePanel.setOptions({ tabId: tab.id, path: `sidepanel.html?tab=${tab.id}`, enabled: true });
  chrome.sidePanel.open({ tabId: tab.id }).catch(() => {});
});

// ---- setup -----------------------------------------------------------------

async function ensureShortcuts() {
  const { autoTypeShortcuts } = await chrome.storage.local.get('autoTypeShortcuts');
  if (autoTypeShortcuts) return;
  const { os } = await chrome.runtime.getPlatformInfo();
  const mac = os === 'mac';
  await chrome.storage.local.set({
    autoTypeShortcuts: {
      startStop: { code: 'KeyB', shift: true, meta: mac, ctrl: !mac, alt: false },
      pause: { code: 'KeyP', shift: true, meta: mac, ctrl: !mac, alt: false },
    },
  });
}

chrome.runtime.onInstalled.addListener(({ reason }) => {
  ensureShortcuts();
  if (reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('practice.html?welcome=1') });
  }
});
chrome.runtime.onStartup.addListener(ensureShortcuts);

// ---- run state ---------------------------------------------------------------

const run = {
  mode: 'idle', // idle | countdown | running | done
  kind: 'write', // write | edit
  order: 'down', // edits go top to bottom, or bottom to top
  paused: false,
  fromShortcut: false,
  tabId: null,
  tabTitle: '',
  tabUrl: '',
  key: null,
  status: null,
  elapsed: 0,
  total: 0,
  counters: { typo: 0, rethink: 0, fix: 0 },
  totalFixes: 0,
  words: 0,
  countdownEnds: 0,
  detachReason: null,
  result: null,
};
let driver = null;
let starting = false;
let stopRequested = false;
let activeRecord = null;
const live = () => starting || run.mode === 'countdown' || run.mode === 'running';
const writeRecord = () => chrome.storage.local.set({ [RECORD_PREFIX + activeRecord.id]: { ...activeRecord } });
async function saveProgress(checked = false) {
  if (!activeRecord) return;
  if (checked) activeRecord.lastVerified = Date.now();
  await writeRecord();
}
async function recordsFor(tabId) {
  const tab = await chrome.tabs.get(tabId);
  const identity = pageIdentity(tab.url);
  const all = await chrome.storage.local.get(null);
  return Object.entries(all).filter(([k,v]) => k.startsWith(RECORD_PREFIX) && v.identity === identity)
    .map(([,v]) => v).sort((a,b) => b.started - a.started);
}
async function recoveryPreview(tabId, id) {
  if (live()) throw new Error('Finish or stop the active run first.');
  const record = (await recordsFor(tabId)).find(r => r.id === id);
  if (!record) throw new Error('No recovery record for this document.');
  const read = await scanTab(tabId);
  if (record.target == null) return { sourceOnly: true, intended: record.intended };
  if (typeof read?.text !== 'string' || read.source !== record.source || (record.box && read.box !== record.box))
    throw new Error('Focus the original editor and try again. The document or field could not be verified.');
  return { current: read.text, updated: record.target, box: record.box, source: record.source,
    id, identity: record.identity, settings: record.settings, matches: read.text === record.target };
}
let runner = null;
let cancelWait = null;
let keepAlive = 0;
let lastProgressSent = 0;

const snapshot = () => JSON.parse(JSON.stringify(run));

function broadcast(extra = {}) {
  chrome.runtime.sendMessage({ type: 'autotype-run', run: snapshot(), ...extra }).catch(() => {});
}

function updateBadge() {
  const text = run.mode === 'running' ? (run.paused ? 'II' : 'ON') : run.mode === 'countdown' ? '...' : '';
  chrome.action.setBadgeText({ text }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ color: run.paused ? '#8b92a1' : '#5a0220' }).catch(() => {});
}

function changed(extra) {
  broadcast(extra);
  updateBadge();
}

// Long pauses can outlast the worker's idle timer; a light API call keeps it awake.
function startKeepAlive() {
  stopKeepAlive();
  keepAlive = setInterval(() => chrome.runtime.getPlatformInfo().catch(() => {}), 20000);
}
function stopKeepAlive() {
  clearInterval(keepAlive);
  keepAlive = 0;
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

function attachErrorMessage(err) {
  const msg = String(err?.message || err);
  if (/already attached/i.test(msg)) return 'Something else is already controlling that tab (DevTools or another extension). Close it and try again.';
  if (/file:/i.test(msg) || /file access/i.test(msg)) return 'To type into a local file, turn on "Allow access to file URLs" for AutoType in chrome://extensions.';
  if (/cannot access|cannot attach/i.test(msg)) return "Chrome doesn't let extensions type into this page.";
  return `Couldn't start typing: ${msg}`;
}

function cancellableWait(ms) {
  return new Promise((resolve) => {
    const t = setTimeout(() => {
      cancelWait = null;
      resolve(true);
    }, ms);
    cancelWait = () => {
      clearTimeout(t);
      cancelWait = null;
      resolve(false);
    };
  });
}

// ---- starting, running, stopping -------------------------------------------

// Checks everything and attaches to the tab, then answers right away; the run
// itself carries on in the background.
async function begin(input) {
  if (live()) return { error: 'Another run is active or is starting.' };
  starting = true;
  stopRequested = false;
  try {
    await startupCleanup;
    return await prepare(input);
  } catch (err) {
    if (driver) await finish({ finished: false, failure: String(err?.message || err), progress: 0 });
    return { error: String(err?.message || err) };
  } finally {
    starting = false;
  }
}
async function prepare({ recovery, tabId, text, settings, draftSeed, fromShortcut, previewed, kind = 'write', current, currentFrom, updated }) {
  if (run.mode === 'countdown' || run.mode === 'running') return { error: 'AutoType is already typing.' };
  const tab = tabId != null ? await chrome.tabs.get(tabId).catch(() => null) : null;
  if (!tab) return { error: 'That tab is closed.' };
  if (recovery && pageIdentity(tab.url) !== recovery.identity) return { error: 'The target document changed. Reopen the recovered document.' };
  const reason = blockedReason(tab.url);
  if (reason) return { error: reason };

  const s = normalizeSettings(settings);
  const seed = draftSeed ?? 1;
  let plan;
  let job;
  let scanned = null;
  if (kind === 'edit') {
    // Read the document again right before editing, so the edits land on what's really there.
    const fresh = await scanTab(tab.id);
    if (fresh?.text != null) {
      if (recovery && (fresh.text !== current || fresh.source !== recovery.source ||
          (recovery.box && recovery.box !== fresh.box))) return { error: 'The document changed. Preview recovery again.' };
      if (!fresh.text.trim() && !recovery) {
        broadcast({ scanned: fresh.text, scannedFrom: fresh.source, scannedTab: tab.id });
        return { error: "This document is empty, so there's nothing to edit. To type something new, switch AutoType to Writer." };
      }
      // If the page holds something quite different from the document the
      // changes were worked out for (another doc, a big paste), show the new
      // changes instead of guessing.
      if (current?.trim() && driftSize(current, fresh.text) > Math.max(80, 0.15 * fresh.text.length)) {
        broadcast({ scanned: fresh.text, scannedFrom: fresh.source, scannedTab: tab.id });
        return { error: 'The document changed since it was read, so nothing was typed. AutoType read it again: check the changes, then start again.' };
      }
      scanned = fresh;
      current = fresh.text;
    } else if (currentFrom) {
      // Current document was read from this page earlier, but now the cursor
      // is somewhere AutoType can't read (like a rich-text editor), so there's
      // no telling the two are the same text.
      return { error: "AutoType can't read the spot where the cursor is now, so it can't be sure Current document matches it. Paste that text into Current document, then start again." };
    }
    if ((!current?.trim() && !recovery) || typeof updated !== 'string' || (!updated.trim() && !recovery)) return { error: 'Scan or paste your document and the updated version first.' };
    let diff;
    try {
      diff = editorDiff(current, updated, { looseQuotes: !recovery && (scanned?.source || currentFrom) === 'docs', trimEnd: !recovery });
    } catch (err) {
      return { error: `${err?.message || err} Nothing was changed.` };
    }
    if (!diff.edits.length) return { error: 'Your document already matches the updated version, so there is nothing to change.' };
    // The shortcut skips the preview, so it never rewrites most of a document unseen.
    if (fromShortcut && !previewed && diff.edits.reduce((n, h) => n + (h.e - h.s), 0) > 0.5 * diff.before.trim().length) {
      return { error: 'That would rewrite most of this document. Open the panel and check the changes first.' };
    }
    plan = buildEditPlan(current, updated, s, { diff, runSeed: randomSeed() });
    // Replay the edits on a copy of the current document: it must end on the updated version.
    if (simulate(plan.actions, diff.before, '') !== diff.after) return { error: "These edits couldn't be planned exactly. Check both boxes and try again." };
    job = { kind, before: diff.before, after: diff.after, key: draftKey(`${current}\u0001${updated}`, 'edit', 0), fixes: diff.edits.length, words: 0, order: plan.order };
    if (recovery && diff.after !== updated) return { error: 'The remaining changes cross embedded document objects. Review the saved target manually.' };
    job.source = scanned?.source || currentFrom || null;
    job.recovery = recovery;
    job.settings = s;
    plan.actions = addChecks(plan.actions, { every: CHECK_EVERY, events: ['fix'], firstKeys: 24, maxKeys: 1000, prefix: diff.before });
  } else {
    if (!text?.trim()) return { error: 'Paste your text into AutoType first.' };
    const draft = makeDraft(text, s.roughness, seed);
    plan = buildPlan(text, s, { draft, runSeed: randomSeed() });
    // Replay the plan on a model of the page first: it must land on the exact text.
    if (simulate(plan.actions) !== draft.text) {
      return { error: 'These settings produced a plan that would not match your text. Press Reshuffle and try again.' };
    }
    job = { kind, before: null, after: draft.text, key: draftKey(text, seed, s.roughness), fixes: draft.total, words: draft.words, order: 'down' };
    job.settings = s;
    plan.actions = addChecks(plan.actions, { every: CHECK_EVERY, events: ['fix', 'typo', 'rethink'], firstKeys: 24, maxKeys: 1000 });
  }

  const { os } = await chrome.runtime.getPlatformInfo();
  // autoTypeForceMac lets the automated tests try the Mac key commands elsewhere.
  const d = new CdpDriver(tab.id, { mac: globalThis.autoTypeForceMac ?? os === 'mac' });
  try {
    await d.attach();
  } catch (err) {
    return { error: attachErrorMessage(err) };
  }
  driver = d;
  chrome.storage.session.set({ attachedTab: tab.id }).catch(() => {});

  const wait = fromShortcut ? 700 : Math.max(0, s.countdown) * 1000;
  Object.assign(run, {
    mode: 'countdown',
    kind: job.kind,
    order: job.order,
    paused: false,
    fromShortcut: !!fromShortcut,
    tabId: tab.id,
    tabTitle: tab.title || '',
    tabUrl: tab.url || '',
    key: job.key,
    status: null,
    elapsed: 0,
    total: plan.stats.totalMs,
    counters: { typo: 0, rethink: 0, fix: 0, repair: 0 },
    totalFixes: job.fixes,
    words: job.words,
    countdownEnds: Date.now() + wait,
    detachReason: null,
    result: null,
  });
  startKeepAlive();
  changed(scanned ? { scanned: scanned.text, scannedFrom: scanned.source, scannedTab: tab.id } : undefined);
  play(plan, job, wait).catch(async (err) => {
    await finish({ finished: false, failure: String(err?.message || err), progress: 0 });
  });
  return { ok: true };
}

// ---- checking the work every 5 edits ----------------------------------------

const CHECK_EVERY = 5;
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const normText = (t) => String(t ?? '').replace(/\r\n?/g, '\n');

// Where typed text went into a document: before = the page before typing,
// after = the page now, typed = what the plan typed so far.
function findInsertion(before, after, typed) {
  if (after.length !== before.length + typed.length) return null;
  let common = 0;
  while (common < before.length && before[common] === after[common]) common++;
  let found = null;
  for (let p = Math.min(common, before.length); p >= 0 && p >= common - typed.length; p--) {
    if (after.startsWith(typed, p) && after.slice(0, p) === before.slice(0, p) && after.slice(p + typed.length) === before.slice(p)) {
      if (found !== null) return null;
      found = p;
    }
  }
  return found;
}

// Rereads the page at each check. When the page is right it returns nothing;
// when it isn't, it returns the keystrokes that go back and fix it (followed
// by another check). Gives up, stopping the run, if a fix doesn't stick twice.
async function makeChecker(job, settings) {
  const st = { off: null, base: '', p0: 0, docs: job.source === 'docs', box: null, tries: 0, checks: 0, repairs: 0, lastFinalOk: false };
  const canon = (t) => {
    const x = normText(t);
    return st.docs ? plainQuotes(x).replace(/ /g, ' ') : x;
  };
  const read = async () => {
    try {
      const r = await driver?.evaluate(`(${readDocument.toString()})(${globalThis.autoTypeDocsText.toString()})`);
      return r && r.text != null ? r : null;
    } catch {
      return null;
    }
  };
  const first = await retryRead(read);
  const targetTab = await chrome.tabs.get(run.tabId);
  if (pageIdentity(targetTab.url) !== pageIdentity(run.tabUrl)) throw new Error('the target document changed during setup');
  if (job.recovery && (!first || first.text !== job.before || first.source !== job.recovery.source ||
      (job.recovery.box && first.box !== job.recovery.box) || first.focused === false))
    throw new Error('The target changed or lost focus. Preview the remaining changes again.');
  if (first?.focused === false) throw new Error('focus the target text box before the countdown ends');
  if (!first) {
    st.off = "AutoType can't read this editor, so it typed without checking its work.";
  } else {
    st.docs = first.source === 'docs';
    st.box = first.box || null;
    if (job.kind === 'write') {
      st.base = normText(first.text);
      if (first.source === 'box' && first.selectionEnd > first.selectionStart) {
        st.p0 = first.selectionStart;
        st.base = st.base.slice(0, st.p0) + st.base.slice(first.selectionEnd);
      } else {
        st.p0 = first.source === 'box' && first.caret != null ? first.caret : st.base ? null : 0;
      }
    } else if (canon(first.text) !== canon(job.before)) {
      st.off = "The page doesn't read back the same as Current document, so this run isn't checked.";
    }
  }
  activeRecord = {
    id: job.recovery?.id || crypto.randomUUID(),
    identity: pageIdentity(run.tabUrl), started: Date.now(), lastVerified: null,
    settings, source: first?.source || null, box: st.box, intended: job.after,
    target: first && !st.off ? fullTarget(job, st.base, st.p0) : null,
  };
  if (activeRecord.target != null) activeRecord.intended = null;
  await saveProgress();
  const say = (text) => {
    run.status = { s: text, p: null, fix: null };
    broadcast();
  };
  return {
    get state() {
      return st;
    },
    async check(a) {
      if (st.off || !driver) return [];
      const c = a.check;
      st.checks++;
      say(c.recheck ? 'Checking the fix' : c.final ? 'Checking all of it one last time' : c.from > c.to ? 'Verifying the current text' : `Checking edits ${c.from} to ${c.to}`);
      await sleep(st.docs ? 1000 : 150); // Docs needs a moment to save what was just typed
      let actual = null;
      let expected = null;
      const attempts = st.docs ? (c.recheck ? 5 : 3) : 1;
      for (let attempt = 0; attempt < attempts; attempt++) {
        if (attempt) {
          say('Waiting for the editor to save before checking again');
          await sleep(Math.min(4000, 600 * 2 ** attempt));
        }
        if (stopRequested) return [];
        const got = await retryRead(read, { notify: n => say('Waiting for the document to respond (retry ' + n + ')') });
        if (!got) {
          throw new Error('the document could not be read after three attempts. Reopen the original and review its recovery record');
        }
        if (got.source !== first.source || (st.box && (got.box !== st.box || got.focused === false))) {
          throw new Error('the cursor moved to a different box, so it stopped instead of typing there');
        }
        actual = normText(got.text);
        if (job.kind === 'write' && st.p0 == null) {
          const at = findInsertion(canon(st.base), canon(actual), canon(c.text));
          if (at != null) st.p0 = at;
          else continue;
        }
        const p0 = job.kind === 'write' ? st.p0 : 0;
        expected = job.kind === 'write' ? st.base.slice(0, p0) + c.text + st.base.slice(p0) : c.text;
        if (canon(actual) === canon(expected)) {
          st.tries = 0;
          const learnedOffset = activeRecord.target == null && job.kind === 'write' && st.p0 != null;
          if (learnedOffset) {
            activeRecord.target = fullTarget(job, st.base, st.p0);
            activeRecord.intended = null;
          }
          if (learnedOffset || c.final || Date.now() - (activeRecord.lastVerified || 0) >= 30000) await saveProgress(true);
          if (c.final) st.lastFinalOk = true;
          say(c.final ? 'Checked: everything matches' : `Checked: edits ${c.from} to ${c.to} are right`);
          return [];
        }
      }
      if (job.kind === 'write' && st.p0 == null) throw new Error('the original insertion point could not be verified. Inspect the draft before continuing');
      const p0 = job.kind === 'write' ? st.p0 : 0;
      if (st.tries >= 2) {
        throw new Error(`it fixed the same spot twice and the page changed it back${describeDifference(actual, expected)}. In Google Docs, turn off the automatic options in Tools > Preferences, then start again`);
      }
      st.tries++;
      const cursor = glen(expected.slice(0, p0)) + c.cursor;
      const fix = buildFixPlan(actual, expected, cursor, settings, { looseQuotes: st.docs, runSeed: randomSeed() });
      const size = fix.diff.edits.reduce((n, h) => n + (h.e - h.s) + h.text.length, 0);
      if (!fix.ok) throw new Error("it found a mistake it couldn't plan a fix for");
      // Fixing a few spots is a check's job; rewriting most of the page isn't.
      if (size > 200 + 0.6 * expected.length) {
        throw new Error("the page doesn't look like what AutoType typed anymore, so it stopped instead of rewriting it");
      }
      st.repairs += fix.fixes;
      say(`Found ${fix.fixes === 1 ? 'a mistake' : `${fix.fixes} mistakes`}. Going back to fix ${fix.fixes === 1 ? 'it' : 'them'}`);
      return [...fix.actions, { d: 0, check: { ...c, recheck: true } }];
    },
  };
}

// " (it should say "x" but says "y")", around the first spot that differs.
function describeDifference(actual, expected) {
  let i = 0;
  while (i < actual.length && i < expected.length && actual[i] === expected[i]) i++;
  const clip = (t) => JSON.stringify(t.slice(Math.max(0, i - 12), i + 12).replace(/\n/g, ' '));
  return i >= Math.max(actual.length, expected.length) ? '' : ` (it should say ${clip(expected)} but says ${clip(actual)})`;
}

async function play(plan, job, wait) {
  const go = await cancellableWait(wait);
  if (!go || !driver) {
    await finish(null);
    return;
  }
  if (job.before != null) {
    // Editing counts characters from the top of the document, so a plain text
    // box has to hold exactly the "current" version. (Rich editors can't be read.)
    let value = null;
    try {
      value = await driver.readFocusedText();
    } catch {
      /* not readable */
    }
    if (value != null && value !== job.before) {
      await finish({ finished: false, notStarted: true, progress: 0, failure: "the text box doesn't match Current document, so nothing was changed. Paste exactly what's in it" });
      return;
    }
  }
  run.mode = 'running';
  changed();
  const checker = await makeChecker(job, job.settings);
  if (stopRequested || !driver?.attached) {
    await finish({ finished: false, progress: 0, failure: 'the run was interrupted during setup' });
    return;
  }
  run.checking = checker.state.off ? 'off' : 'on';
  runner = new Runner(plan.actions, driver, {
    onCheck: (a) => checker.check(a),
    onStatus: (_s, a) => {
      run.status = { s: a.s, p: a.p ?? null, fix: a.fix ?? null };
      broadcast();
    },
    onEvent: (ev) => {
      run.counters[ev] = (run.counters[ev] || 0) + 1;
      if (ev === 'fix' && run.status?.fix) run.status = { ...run.status, fix: null };
      broadcast();
    },
    onProgress: (elapsed, total) => {
      run.elapsed = elapsed;
      run.total = total;
      const now = Date.now();
      if (now - lastProgressSent > 200) {
        lastProgressSent = now;
        broadcast();
      }
    },
    onPause: (paused) => {
      run.paused = paused;
      changed();
    },
  });
  const startedAt = Date.now();
  let finished = false;
  let failure = null;
  try {
    finished = await runner.run();
  } catch (err) {
    failure = String(err?.message || err);
  }
  let check = null;
  if (finished && checker.state.lastFinalOk) check = 'match';
  if (finished && driver?.attached) {
    try {
      const value = await driver.readFocusedText();
      if (value != null && activeRecord?.target != null) check = value === activeRecord.target ? 'match' : 'mismatch';
    } catch {
      /* page closed or navigated */
    }
  }
  await finish({
    finished,
    failure,
    check,
    checks: checker.state.checks,
    repairs: checker.state.repairs,
    checkOff: checker.state.off,
    elapsed: Date.now() - startedAt,
    progress: runner?.total ? runner.elapsed / runner.total : 1,
  });
}

async function finish(result) {
  stopKeepAlive();
  const d = driver;
  driver = null;
  runner = null;
  if (d) await d.detach();
  await chrome.storage.session.remove('attachedTab').catch(() => {});
  if (activeRecord && result?.finished && result.check === 'match') {
    await chrome.storage.local.remove(RECORD_PREFIX + activeRecord.id).catch(() => {});
  }
  activeRecord = null;
  run.paused = false;
  if (!result) {
    run.mode = 'idle';
    run.result = null;
  } else {
    run.mode = 'done';
    run.result = { ...result, detachReason: run.detachReason, counters: { ...run.counters }, words: run.words };
  }
  changed();
}

function togglePause() {
  if (!runner) return;
  if (runner.paused) runner.resume();
  else runner.pause();
}

function stop() {
  stopRequested = true;
  if (cancelWait) cancelWait();
  else runner?.stop();
}

// ---- reading the document (Editor) -------------------------------------------

// Runs inside the page. Google Docs: its own plain-text export (same as File >
// Download > Plain text), fetched from the doc's tab with your sign-in. Other
// pages: the text box you clicked into, or the only text box there.
async function readDocument(toText) {
  const m = location.href.match(/^https:\/\/docs\.google\.com\/document\/(u\/\d+\/)?d\/([\w-]+)/);
  if (m) {
    // Docs hands its text download to another Google address the page can't
    // read, so read the Doc's simple HTML view instead (same address), for the
    // tab of the Doc that's open.
    const docTab = new URL(location.href).searchParams.get('tab');
    const query = docTab && /^t\.[\w-]+$/.test(docTab) ? `?tab=${docTab}` : '';
    const res = await fetch(`${location.origin}/document/${m[1] || ''}d/${m[2]}/mobilebasic${query}`, { credentials: 'include', signal: AbortSignal.timeout(8000) });
    const text = res.ok ? toText(await res.text()) : null;
    if (text == null) return { error: `Google Docs wouldn't share the text${res.ok ? '' : ` (error ${res.status})`}. Paste it instead.`, docs: true };
    return { text, source: 'docs' };
  }
  let el = document.activeElement;
  while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
  if (el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && /^(text|search)?$/i.test(el.type || '')))) {
    const box = `${el.tagName}#${el.id || el.name || [...document.querySelectorAll(el.tagName)].indexOf(el)}`;
    return { text: el.value, source: 'box', box, selectionStart: el.selectionStart, selectionEnd: el.selectionEnd, caret: el.selectionDirection === 'backward' ? el.selectionStart : el.selectionEnd };
  }
  // A rich-text editor (or one inside a frame) can't be read reliably, so don't guess.
  if (el && (el.isContentEditable || el.tagName === 'IFRAME')) {
    return { error: "AutoType can't read this kind of editor. Paste its text into Current document instead." };
  }
  const boxes = [...document.querySelectorAll('textarea')].filter((t) => t.offsetParent !== null);
  if (boxes.length === 1) {
      const box = boxes[0];
      return { text: box.value, source: 'box', box: box.tagName + '#' + (box.id || box.name || [...document.querySelectorAll(box.tagName)].indexOf(box)), focused: false };
    }
  return { error: "Couldn't find the text on this page. Click into it and scan again, or paste it instead." };
}

async function scanTab(tabId) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab) return { error: 'That tab is closed.' };
  if (blockedReason(tab.url)) return { error: "Chrome doesn't let extensions read this page." };
  // Usually AutoType's own script in the page answers.
  let fromPage = null;
  try {
    fromPage = await withDeadline(chrome.tabs.sendMessage(tabId, { type: 'autotype-read' }, { frameId: 0 }), 10000, 'The document read timed out.');
  } catch {
    /* no AutoType script in this tab (extension page, or opened before install) */
  }
  if (fromPage?.text != null || fromPage?.error) return fromPage;
  // Otherwise run the same reader through the debugger for a moment.
  if (driver) return { error: 'AutoType is busy typing.' };
  const target = { tabId };
  try {
    await chrome.debugger.attach(target, '1.3');
  } catch {
    return { error: "Couldn't read this page. Paste the text instead." };
  }
  try {
    const r = await withDeadline(chrome.debugger.sendCommand(target, 'Runtime.evaluate', {
      expression: `(${readDocument.toString()})(${globalThis.autoTypeDocsText.toString()})`,
      awaitPromise: true,
      returnByValue: true,
    }), 12000, 'The document read timed out.');
    return r?.result?.value || { error: "Couldn't read this page. Paste the text instead." };
  } catch {
    return { error: "Couldn't read this page. Paste the text instead." };
  } finally {
    await chrome.debugger.detach(target).catch(() => {});
  }
}

// ---- shortcuts ---------------------------------------------------------------

const lastFired = {};
async function onShortcut(action, tabId) {
  const now = Date.now();
  if (now - (lastFired[action] || 0) < 350) return;
  lastFired[action] = now;
  if (action === 'pause') {
    if (run.mode === 'running') togglePause();
    return;
  }
  if (run.mode === 'countdown' || run.mode === 'running') {
    stop();
    return;
  }
  // Start typing into the tab where the keys were pressed: with what that
  // tab's panel shows if it's open, otherwise with what was saved last.
  const live = await chrome.runtime.sendMessage({ type: 'autotype-panel-state', tabId }).catch(() => null);
  const autoType = live || (await chrome.storage.local.get('autoType')).autoType;
  const res = await begin({
    tabId,
    kind: autoType?.tab === 'edit' ? 'edit' : 'write',
    text: autoType?.text,
    current: autoType?.current,
    currentFrom: autoType?.currentFrom,
    updated: autoType?.updated,
    settings: autoType?.settings,
    draftSeed: autoType?.draftSeed,
    fromShortcut: true,
    previewed: !!live,
  });
  if (res.error) {
    broadcast({ error: res.error });
    flagError(res.error);
  }
}

// With the panel closed, a shortcut that can't start shows "!" on the toolbar
// icon for a few seconds; hovering the icon gives the reason.
let flagTimer = 0;
function flagError(message) {
  clearTimeout(flagTimer);
  chrome.action.setBadgeText({ text: '!' }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ color: '#b3261e' }).catch(() => {});
  chrome.action.setTitle({ title: `AutoType didn't start. ${message}` }).catch(() => {});
  flagTimer = setTimeout(() => {
    chrome.action.setTitle({ title: 'Open AutoType' }).catch(() => {});
    updateBadge();
  }, 6000);
}

// How many characters differ between two readings of a document.
function driftSize(a, b) {
  try {
    return editorDiff(a, b, { looseQuotes: true }).edits.reduce((n, h) => n + (h.e - h.s) + h.text.length, 0);
  } catch {
    return Infinity;
  }
}

// Only fires if someone also assigns keys at chrome://extensions/shortcuts.
chrome.commands.onCommand.addListener((command, tab) => {
  const action = command === 'start-stop' ? 'startStop' : command === 'pause' ? 'pause' : null;
  if (action) onShortcut(action, tab?.id);
});

// ---- messages from the panel and pages -------------------------------------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg?.type) {
    case 'autotype-recover-list':
    case 'autotype-recover-preview':
    case 'autotype-recover-start':
    case 'autotype-recover-forget': {
      if (sender.url?.split('?')[0] !== chrome.runtime.getURL('sidepanel.html')) return false;
      (async () => {
        if (live()) throw new Error('Wait for the active run to finish or stop it first.');
        const records = await recordsFor(msg.tabId);
        if (msg.type.endsWith('-list')) return { records: records.map(({ id, started, lastVerified }) => ({ id, started, lastVerified })) };
        if (!records.some(r => r.id === msg.id)) throw new Error('No matching record for this page.');
        if (msg.type.endsWith('-forget')) { await chrome.storage.local.remove(RECORD_PREFIX + msg.id); return { ok: true }; }
        const preview = await recoveryPreview(msg.tabId, msg.id);
        if (msg.type.endsWith('-preview')) return preview;
        if (preview.sourceOnly || preview.matches || msg.current !== preview.current) throw new Error('Refresh the recovery preview before continuing.');
        return begin({ ...preview, tabId: msg.tabId, recovery: preview, currentFrom: preview.source, kind: 'edit' });
      })().then(sendResponse, err => sendResponse({ error: String(err?.message || err) }));
      return true;
    }
    case 'autotype-get':
      sendResponse({ run: snapshot() });
      return false;
    case 'autotype-start':
      begin({ ...msg, fromShortcut: false }).then(sendResponse);
      return true;
    case 'autotype-pause':
      togglePause();
      sendResponse({});
      return false;
    case 'autotype-stop':
      stop();
      sendResponse({});
      return false;
    case 'autotype-reset':
      if (run.mode === 'done') {
        run.mode = 'idle';
        run.result = null;
        changed();
      }
      sendResponse({});
      return false;
    case 'autotype-shortcut':
      onShortcut(msg.action, msg.tabId ?? sender.tab?.id);
      return false;
    case 'autotype-scan':
      scanTab(msg.tabId).then(sendResponse);
      return true;
    default:
      return false;
  }
});

chrome.debugger.onDetach.addListener((source, reason) => {
  if (source.tabId !== run.tabId || !driver) return;
  run.detachReason = reason;
  driver.attached = false;
  stop();
});

// A fresh worker has no run, so any debugger left attached is stale.
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (driver && tabId === run.tabId && (change.status === 'loading' || (change.url && pageIdentity(change.url) !== pageIdentity(run.tabUrl)))) {
    run.detachReason = 'navigation';
    stop();
  }
});
const startupCleanup = chrome.storage.session.get('attachedTab').then(async ({ attachedTab }) => {
  if (attachedTab != null && !driver) {
    await chrome.debugger.detach({ tabId: attachedTab }).catch(() => {});
    await chrome.storage.session.remove('attachedTab');
  }
}).catch(() => {});

// For automated tests.
globalThis.autoTypeRun = snapshot;
