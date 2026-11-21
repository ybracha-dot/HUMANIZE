// File ingestion. Imported material is DATA. Nothing parsed here is ever executed or obeyed.
import mammoth from 'mammoth';

export const PARSE_VERSION = 'ingest/1';
export const LIMITS = {
  maxBytes: 25 * 1024 * 1024,
  maxPages: 400,
  maxTextChars: 3_000_000,
};
export const ACCEPTED = ['text/plain', 'text/markdown', 'application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'] as const;

export interface ParsedPage {
  pageIndex: number;
  pageLabel: string | null;
  text: string;
}
export interface ParsedPassage {
  pageIndex: number;
  pageLabel: string | null;
  section: string | null;
  paraIndex: number;
  text: string;
  pageOffset: number;
}
export interface ParseResult {
  status: 'ok' | 'unreadable' | 'needs_ocr';
  error?: string;
  pageCount: number;
  passages: ParsedPassage[];
  mime: string;
}

function sniff(buf: Buffer, declared: string, filename: string): string | null {
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (buf[0] === 0x50 && buf[1] === 0x4b && /\.docx$/i.test(filename)) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (/\.(txt|md|markdown)$/i.test(filename) || declared.startsWith('text/')) {
    // reject binary masquerading as text
    const sample = buf.subarray(0, 4096);
    let bad = 0;
    for (const b of sample) if (b === 0 || b < 9 || (b > 13 && b < 32)) bad++;
    if (bad > sample.length * 0.02) return null;
    return /\.md|\.markdown/i.test(filename) ? 'text/markdown' : 'text/plain';
  }
  return null;
}

const looksHeading = (l: string) => {
  const t = l.trim();
  if (!t || t.length > 80) return false;
  if (/^#{1,6}\s/.test(t)) return true;
  if (/[.,;:!?]$/.test(t)) return false;
  const words = t.split(/\s+/);
  if (words.length > 10) return false;
  return /^[A-Z0-9]/.test(t) && (t === t.toUpperCase() || words.filter((w) => /^[A-Z]/.test(w)).length >= Math.ceil(words.length * 0.6));
};

/** Turn a page of text into passages (paragraphs). Offsets are into the page text, original typography kept. */
export function passagesFromPage(page: ParsedPage, startPara: number, carrySection: string | null): { passages: ParsedPassage[]; section: string | null } {
  const out: ParsedPassage[] = [];
  let section = carrySection;
  const text = page.text.replace(/\r\n?/g, '\n');
  const re = /\n[ \t]*\n+/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let n = startPara;
  const chunks: { s: number; e: number }[] = [];
  while ((m = re.exec(text))) {
    chunks.push({ s: last, e: m.index });
    last = m.index + m[0].length;
  }
  chunks.push({ s: last, e: text.length });
  for (const c of chunks) {
    const raw = text.slice(c.s, c.e);
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const lead = raw.length - raw.trimStart().length;
    if (looksHeading(trimmed) && !trimmed.includes('\n')) {
      section = trimmed.replace(/^#{1,6}\s*/, '');
      continue;
    }
    // split very long paragraphs at sentence boundaries into <= ~900 char passages
    if (trimmed.length > 1100) {
      let pos = 0;
      const sentences = [...trimmed.matchAll(/[^.!?]*[.!?]+["')\]]*(?:\s+|$)|[^.!?]+$/g)];
      let cur = '';
      let curStart = 0;
      for (const s of sentences) {
        if (cur && (cur + s[0]).length > 900) {
          out.push({
            pageIndex: page.pageIndex,
            pageLabel: page.pageLabel,
            section,
            paraIndex: ++n,
            text: cur.trim(),
            pageOffset: c.s + lead + curStart,
          });
          cur = '';
          curStart = s.index!;
        }
        cur += s[0];
        pos = s.index! + s[0].length;
      }
      if (cur.trim())
        out.push({
          pageIndex: page.pageIndex,
          pageLabel: page.pageLabel,
          section,
          paraIndex: ++n,
          text: cur.trim(),
          pageOffset: c.s + lead + curStart,
        });
      void pos;
    } else {
      out.push({
        pageIndex: page.pageIndex,
        pageLabel: page.pageLabel,
        section,
        paraIndex: ++n,
        text: trimmed,
        pageOffset: c.s + lead,
      });
    }
  }
  return { passages: out, section };
}

async function parsePdf(buf: Buffer): Promise<{ pages: ParsedPage[] } | { error: string }> {
  const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
  let doc: any;
  const task = pdfjs.getDocument({
    data: new Uint8Array(buf),
    useSystemFonts: true,
    isEvalSupported: false,
    disableFontFace: true,
    verbosity: 0,
  });
  try {
    doc = await task.promise;
  } catch (e: any) {
    return {
      error: `PDF could not be opened (${e?.name ?? 'error'}). It may be corrupt or password protected.`,
    };
  }
  if (doc.numPages > LIMITS.maxPages)
    return {
      error: `PDF has ${doc.numPages} pages; the limit is ${LIMITS.maxPages}.`,
    };
  let labels: string[] | null = null;
  try {
    labels = await doc.getPageLabels();
  } catch {
    labels = null;
  }
  const pages: ParsedPage[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    // group items into lines by baseline y, then paragraphs by vertical gap
    const items = (content.items as any[]).filter((it) => typeof it.str === 'string');
    const lines: { y: number; text: string }[] = [];
    for (const it of items) {
      const y = Math.round(it.transform[5]);
      const line = lines.find((l) => Math.abs(l.y - y) <= 2);
      if (line) line.text += (line.text && it.str && !/\s$/.test(line.text) && !/^\s/.test(it.str) ? ' ' : '') + it.str;
      else lines.push({ y, text: it.str });
    }
    lines.sort((a, b) => b.y - a.y);
    const gaps = lines
      .slice(1)
      .map((l, k) => lines[k].y - l.y)
      .filter((g) => g > 0)
      .sort((a, b) => a - b);
    const median = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 14;
    let text = '';
    lines.forEach((l, k) => {
      if (!l.text.trim()) return;
      if (k > 0) text += lines[k - 1].y - l.y > median * 1.45 ? '\n\n' : '\n';
      text += l.text.trim();
    });
    pages.push({ pageIndex: i, pageLabel: labels?.[i - 1] ?? null, text });
    page.cleanup();
  }
  await task.destroy?.();
  return { pages };
}

export async function parseFile(buf: Buffer, filename: string, declaredMime = ''): Promise<ParseResult> {
  const fail = (error: string, mime = declaredMime || 'application/octet-stream'): ParseResult => ({
    status: 'unreadable',
    error,
    pageCount: 0,
    passages: [],
    mime,
  });
  if (buf.length > LIMITS.maxBytes) return fail(`File is ${(buf.length / 1048576).toFixed(1)} MB; the limit is ${LIMITS.maxBytes / 1048576} MB.`);
  if (!buf.length) return fail('File is empty.');
  const mime = sniff(buf, declaredMime, filename);
  if (!mime) return fail('Unsupported or unrecognised file type. Accepted: TXT, Markdown, PDF, DOCX. Paste the text instead.');
  let pages: ParsedPage[] = [];
  try {
    if (mime === 'application/pdf') {
      const r = await parsePdf(buf);
      if ('error' in r) return fail(r.error, mime);
      pages = r.pages;
      const chars = pages.reduce((a, p) => a + p.text.replace(/\s/g, '').length, 0);
      if (chars < 20 * Math.max(1, pages.length)) {
        return {
          status: 'needs_ocr',
          error:
            'This PDF has no usable text layer (likely scanned). OCR is not available in this local build. Paste or type the relevant passages by hand and they will be stored with their page numbers.',
          pageCount: pages.length,
          passages: [],
          mime,
        };
      }
    } else if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      const r = await mammoth.extractRawText({ buffer: buf });
      pages = [{ pageIndex: 1, pageLabel: null, text: r.value }];
    } else {
      pages = [
        {
          pageIndex: 1,
          pageLabel: null,
          text: buf.toString('utf8').replace(/^﻿/, ''),
        },
      ];
    }
  } catch (e: any) {
    return fail(`Could not read this file (${e?.message?.slice(0, 120) ?? 'parse error'}).`, mime);
  }
  if (pages.reduce((a, p) => a + p.text.length, 0) > LIMITS.maxTextChars) return fail('Extracted text is too large.', mime);
  const passages: ParsedPassage[] = [];
  let para = 0;
  let section: string | null = null;
  for (const p of pages) {
    const r = passagesFromPage(p, para, section);
    passages.push(...r.passages);
    para += r.passages.length;
    section = r.section;
  }
  if (!passages.length)
    return {
      status: 'unreadable',
      error: 'No text was found in this file.',
      pageCount: pages.length,
      passages: [],
      mime,
    };
  return { status: 'ok', pageCount: pages.length, passages, mime };
}

/** Pasted text becomes a single-page source. */
export function parsePasted(text: string): ParseResult {
  const r = passagesFromPage({ pageIndex: 1, pageLabel: null, text }, 0, null);
  if (!r.passages.length)
    return {
      status: 'unreadable',
      error: 'No text was provided.',
      pageCount: 1,
      passages: [],
      mime: 'text/plain',
    };
  return {
    status: 'ok',
    pageCount: 1,
    passages: r.passages,
    mime: 'text/plain',
  };
}
