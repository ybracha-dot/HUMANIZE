// Google Docs draws its text on a canvas, so AutoType reads the simple HTML
// view Docs serves at /mobilebasic (same address as the doc, so the page is
// allowed to read it) and turns it into the characters the cursor moves
// through in the editor:
//   - one line per paragraph or list item
//   - a tab as \t (the HTML view shows it as eight no-break spaces)
//   - a soft line break (Shift+Enter) as \n
//   - a page break or line as \f, a picture or footnote mark as \ufffc:
//     one arrow-key step each, and never typed or deleted
//   - no header, footer, comments or footnote text (they aren't in the body)
// Loaded as a content script, by the practice page, and by the background.
globalThis.autoTypeDocsText = function docsHtmlToText(html) {
  html = String(html || '');
  const open = html.search(/<div\b[^>]*\bclass="[^"]*\bdoc-content\b[^"]*"[^>]*>/i);
  if (open < 0) return null;
  const VOID = /^(br|hr|img|meta|link|input|wbr|col|source|area|base|embed|param|track)$/;
  const BLOCK = /^(p|h[1-6]|li)$/;
  const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };
  const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
    }
    return NAMED[e.toLowerCase()] ?? whole;
  });
  const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|([^<]+)/g;
  re.lastIndex = html.indexOf('>', open) + 1;
  const stack = []; // open tags inside doc-content
  const lines = [];
  let cur = null; // text of the paragraph being read
  let blockDepth = -1;
  let skipDepth = -1; // inside a header, footer, or comment or footnote list
  let markDepth = -1; // inside a comment or footnote marker like [a] or [1]
  let pending = ''; // page breaks waiting for the paragraph they belong to
  let m;
  while ((m = re.exec(html))) {
    if (m[0].startsWith('<!--')) continue;
    const [, close, rawTag, attrs, text] = m;
    if (text != null) {
      if (cur != null && skipDepth < 0 && markDepth < 0) cur += decode(text);
      continue;
    }
    const tag = rawTag.toLowerCase();
    if (!close) {
      if (tag === 'script' || tag === 'style') {
        const end = html.indexOf(`</${tag}`, re.lastIndex);
        re.lastIndex = end < 0 ? html.length : end;
        continue;
      }
      if (VOID.test(tag) || /\/\s*$/.test(attrs)) {
        if (skipDepth >= 0 || markDepth >= 0) continue;
        if (tag === 'br') {
          if (cur != null) cur += '\n';
        } else if (tag === 'hr') {
          if (cur != null) cur += '\f';
          else pending += '\f';
        } else if (tag === 'img') {
          if (cur != null) cur += '\ufffc';
          else pending += '\ufffc';
        }
        continue;
      }
      stack.push(tag);
      const depth = stack.length;
      if (skipDepth >= 0 || markDepth >= 0) continue;
      if (tag === 'div' && depth === 1) {
        skipDepth = depth; // header, footer, comments, footnotes
        continue;
      }
      if (tag === 'a') {
        const href = /\bhref\s*=\s*"#(cmnt|ftnt)(_ref)?\d+"/i.exec(attrs);
        if (href && href[2]) {
          // The list of comments or footnotes at the end: the body is over.
          cur = null;
          break;
        }
        if (href) {
          if (href[1].toLowerCase() === 'ftnt' && cur != null) cur += '\ufffc';
          markDepth = depth;
          continue;
        }
      }
      if (BLOCK.test(tag) && cur == null) {
        cur = pending;
        pending = '';
        blockDepth = depth;
      }
      continue;
    }
    if (!stack.length) break; // the end of doc-content
    const i = stack.lastIndexOf(tag);
    if (i < 0) continue;
    const depth = i + 1;
    stack.length = i;
    if (skipDepth >= 0) {
      if (depth <= skipDepth) skipDepth = -1;
      continue;
    }
    if (markDepth >= 0 && depth <= markDepth) markDepth = -1;
    if (cur != null && depth <= blockDepth) {
      lines.push(cur);
      cur = null;
      blockDepth = -1;
    }
  }
  if (cur != null) lines.push(cur);
  // A rule left over at the very end (before the footnotes) isn't in the body.
  return lines.join('\n').replace(/\u00a0{8}/g, '\t').replace(/\u00a0/g, ' ');
};
