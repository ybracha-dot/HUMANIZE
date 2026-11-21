// Listens for AutoType's keyboard shortcuts on every page (and inside the
// editing frames of apps like Google Docs) and passes them to the side panel.
// The shortcuts themselves are set in the side panel.

(() => {
  if (globalThis.__autoTypeShortcuts) return;
  globalThis.__autoTypeShortcuts = true;

  const isMac = /Mac/i.test(navigator.userAgentData?.platform || navigator.platform || '');
  const fallback = {
    startStop: { code: 'KeyB', shift: true, meta: isMac, ctrl: !isMac, alt: false },
    pause: { code: 'KeyP', shift: true, meta: isMac, ctrl: !isMac, alt: false },
  };
  let shortcuts = fallback;

  try {
    chrome.storage.local.get('autoTypeShortcuts').then((r) => {
      if (r.autoTypeShortcuts) shortcuts = r.autoTypeShortcuts;
    }, () => {});
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.autoTypeShortcuts) shortcuts = changes.autoTypeShortcuts.newValue || fallback;
    });
  } catch {
    return;
  }

  const matches = (e, s) => !!s && e.code === s.code && e.shiftKey === !!s.shift && e.metaKey === !!s.meta
    && e.ctrlKey === !!s.ctrl && e.altKey === !!s.alt;

  // The Editor asks the page for its text: Google Docs' own plain-text export
  // (fetched from the doc's tab with your sign-in), or the text box you're in.
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

  if (window === window.top) {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      // Sent only by AutoType's background worker, never by the panel.
      if (msg?.type !== 'autotype-read') return false;
      readDocument(globalThis.autoTypeDocsText).then(sendResponse, (err) => sendResponse({ error: `Couldn't read this page (${err?.message || err}). Paste the text instead.` }));
      return true;
    });
  }

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    for (const action of ['startStop', 'pause']) {
      if (!matches(e, shortcuts[action])) continue;
      e.preventDefault();
      e.stopImmediatePropagation();
      try {
        chrome.runtime.sendMessage({ type: 'autotype-shortcut', action }).catch(() => {});
      } catch {
        /* extension was reloaded; this page needs a refresh */
      }
      return;
    }
  }, true);
})();
