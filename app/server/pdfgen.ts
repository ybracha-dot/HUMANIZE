// Minimal PDF writer (pdf-lib, Helvetica). Used for the printable process report and for test PDFs with printed page labels.
import { PDFDocument, PDFName, StandardFonts, rgb } from 'pdf-lib';

export interface PdfPageSpec {
  lines: string[];
  heading?: string;
}
export interface PdfOptions {
  title?: string;
  labels?: {
    startIndex: number;
    style: 'D' | 'r' | 'R' | 'a' | 'A';
    start?: number;
    prefix?: string;
  }[];
}

const WIN_ANSI_SAFE = (s: string) =>
  s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, '?');

export async function makePdf(pages: PdfPageSpec[], opts: PdfOptions = {}): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setCreationDate(new Date('2000-01-01T00:00:00Z'));
  pdf.setModificationDate(new Date('2000-01-01T00:00:00Z'));
  if (opts.title) pdf.setTitle(opts.title);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  for (const spec of pages) {
    const page = pdf.addPage([612, 792]);
    let y = 740;
    if (spec.heading) {
      page.drawText(WIN_ANSI_SAFE(spec.heading), {
        x: 56,
        y,
        size: 14,
        font: bold,
        color: rgb(0, 0, 0),
      });
      y -= 28;
    }
    for (const line of spec.lines) {
      if (line === '') {
        y -= 10;
        continue;
      }
      page.drawText(WIN_ANSI_SAFE(line), {
        x: 56,
        y,
        size: 11,
        font,
        color: rgb(0, 0, 0),
      });
      y -= 15;
    }
  }
  if (opts.labels?.length) {
    const ctx = pdf.context;
    const nums: any[] = [];
    for (const l of opts.labels) {
      const d: any = { S: PDFName.of(l.style) };
      if (l.start) d.St = l.start;
      nums.push(l.startIndex, ctx.obj(d));
    }
    pdf.catalog.set(PDFName.of('PageLabels'), ctx.obj({ Nums: nums }));
  }
  return pdf.save();
}

/** Wrap text into lines of at most `width` characters (approximate for Helvetica 11pt on a 500pt measure). */
export function wrap(text: string, width = 92): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    if (!para.trim()) {
      out.push('');
      continue;
    }
    let line = '';
    for (const w of para.split(/\s+/)) {
      if ((line + ' ' + w).trim().length > width) {
        out.push(line);
        line = w;
      } else line = (line + ' ' + w).trim();
    }
    if (line) out.push(line);
  }
  return out;
}

export function paginate(lines: string[], perPage = 42, heading?: string): PdfPageSpec[] {
  const pages: PdfPageSpec[] = [];
  for (let i = 0; i < lines.length; i += perPage)
    pages.push({
      lines: lines.slice(i, i + perPage),
      heading: i === 0 ? heading : undefined,
    });
  return pages.length ? pages : [{ lines: [], heading }];
}
