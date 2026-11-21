// Deterministic assignment-brief extraction. Every item carries the exact source passage and
// offsets so the UI can jump to it. Imported documents are DATA: text inside them is only ever
// quoted, never executed or obeyed.
import { splitSentences } from './text.ts';

export type BriefKind = 'deliverable' | 'word_range' | 'page_range' | 'citation_style' | 'deadline' | 'criterion' | 'assistance' | 'format';

export interface BriefItem {
  kind: BriefKind;
  /** stable key used to keep user corrections across reprocessing */
  key: string;
  label: string;
  value: string;
  /** structured value, e.g. {min,max} for ranges, {points} for criteria */
  data?: Record<string, unknown>;
  sourceId: string;
  sourceTitle: string;
  sourceDate?: string;
  passageId: string;
  quote: string;
  start: number;
  end: number;
}

export interface BriefConflict {
  kind: BriefKind;
  a: BriefItem;
  b: BriefItem;
  note: string;
}
export interface BriefResult {
  items: BriefItem[];
  missing: { kind: BriefKind; note: string }[];
  conflicts: BriefConflict[];
}

export interface BriefSource {
  sourceId: string;
  title: string;
  kind: 'syllabus' | 'assignment' | 'rubric' | 'reading' | 'feedback' | 'note';
  date?: string;
  passages: { id: string; text: string }[];
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);

export function extractBrief(sources: BriefSource[]): BriefResult {
  const items: BriefItem[] = [];
  const seen = new Set<string>();
  const push = (it: BriefItem) => {
    const k = `${it.sourceId}|${it.key}|${it.passageId}|${it.start}`;
    if (!seen.has(k)) {
      seen.add(k);
      items.push(it);
    }
  };

  for (const src of sources) {
    if (src.kind === 'reading' || src.kind === 'feedback' || src.kind === 'note') continue;
    for (const p of src.passages) {
      const mk = (kind: BriefKind, key: string, label: string, value: string, start: number, end: number, data?: Record<string, unknown>) =>
        push({
          kind,
          key,
          label,
          value,
          data,
          sourceId: src.sourceId,
          sourceTitle: src.title,
          sourceDate: src.date,
          passageId: p.id,
          quote: p.text.slice(start, end),
          start,
          end,
        });

      // Word range ------------------------------------------------------------------------
      for (const m of p.text.matchAll(/(\d[\d,]{2,5})\s*(?:-|–|—|to)\s*(\d[\d,]{2,5})\s*words?/gi)) {
        const min = +m[1].replace(/,/g, '');
        const max = +m[2].replace(/,/g, '');
        mk('word_range', 'word_range', 'Length', `${min}–${max} words`, m.index!, m.index! + m[0].length, { min, max });
      }
      for (const m of p.text.matchAll(/\b(?:at least|minimum(?: of)?|no fewer than)\s+(\d[\d,]{2,5})\s*words?/gi))
        mk('word_range', 'word_range', 'Length', `at least ${m[1]} words`, m.index!, m.index! + m[0].length, { min: +m[1].replace(/,/g, '') });
      for (const m of p.text.matchAll(/\b(?:at most|maximum(?: of)?|no more than|not exceed(?:ing)?|up to)\s+(\d[\d,]{2,5})\s*words?/gi))
        mk('word_range', 'word_range', 'Length', `at most ${m[1]} words`, m.index!, m.index! + m[0].length, { max: +m[1].replace(/,/g, '') });
      for (const m of p.text.matchAll(/(\d{1,2})\s*(?:-|–|to)\s*(\d{1,2})\s*pages?/gi))
        mk('page_range', 'page_range', 'Pages', `${m[1]}–${m[2]} pages`, m.index!, m.index! + m[0].length, { min: +m[1], max: +m[2] });

      // Citation system -------------------------------------------------------------------
      for (const m of p.text.matchAll(/\b(MLA|APA|Chicago|Harvard|IEEE|Turabian)\b(?:\s*\(?\d{1,2}(?:th|st|nd|rd)\s+ed(?:ition)?\)?)?/g))
        mk('citation_style', 'citation_style', 'Citation system', m[0].trim(), m.index!, m.index! + m[0].length, { style: m[1] });

      // Deadline --------------------------------------------------------------------------
      const dl =
        /\bdue\b[^.\n]{0,40}?((?:(?:Mon|Tues?|Wed(?:nes)?|Thu(?:rs)?|Fri|Sat|Sun)[a-z]*,?\s+)?(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:,\s*\d{4})?|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)(?:\s*(?:at|by)\s+(\d{1,2}(?::\d{2})?\s?(?:[ap]\.?m\.?)|noon|midnight))?(?:\s+((?:[ECMP][SD]T|UTC|GMT|ET|CT|MT|PT|Eastern|Pacific|Central)\b(?:\s+Time)?))?/gi;
      for (const m of p.text.matchAll(dl)) {
        const tz = m[3] ?? null;
        mk('deadline', 'deadline', 'Deadline', [m[1], m[2], tz].filter(Boolean).join(' '), m.index!, m.index! + m[0].length, {
          date: m[1],
          time: m[2] ?? null,
          timezone: tz,
        });
      }

      // Criteria: "Argument (30 points)", "Evidence – 25%", "Clarity: 20 pts"
      for (const line of lineSpans(p.text)) {
        const m = /^[\s\-*•\d.)]*([A-Z][\p{L}&,'’ /\-]{2,60}?)\s*(?:[(\[]|[-–—:]\s*)\s*(\d{1,3})\s*(%|points?|pts?)\)?\]?(?:\s*[-–—:]\s*(.+))?$/u.exec(
          line.text,
        );
        if (m && !/due|words?|pages?/i.test(m[1])) {
          const label = m[1].trim();
          mk(
            'criterion',
            `criterion:${slug(label)}`,
            label,
            `${m[2]}${m[3] === '%' ? '%' : ' points'}${m[4] ? ' — ' + m[4].trim() : ''}`,
            line.start,
            line.end,
            {
              points: +m[2],
              unit: m[3] === '%' ? 'percent' : 'points',
              description: m[4]?.trim() ?? null,
            },
          );
        }
      }

      // Assistance policy as stated -------------------------------------------------------
      for (const s of splitSentences(p.text)) {
        if (
          /\b(AI|A\.I\.|artificial intelligence|generative|ChatGPT|large language model|LLM|Claude|Copilot|outside (?:help|assistance)|collaborat\w+|plagiari\w+|academic (?:integrity|honesty))\b/.test(
            s.text,
          )
        ) {
          mk('assistance', `assistance:${slug(s.text.slice(0, 30))}`, 'Assistance as stated', s.text, s.start, s.end);
        }
      }

      // Deliverable -----------------------------------------------------------------------
      for (const s of splitSentences(p.text)) {
        if (
          /\b(write|submit|prepare|compose|draft|produce)\b[^.]{0,80}\b(essay|memo|paper|report|response|analysis|reflection|brief|composition|argument)\b/i.test(
            s.text,
          ) &&
          s.text.length < 400
        ) {
          mk('deliverable', 'deliverable', 'Deliverable', s.text, s.start, s.end);
        }
      }
    }
  }

  // Conflicts: same single-valued kind from different sources with different values.
  const conflicts: BriefConflict[] = [];
  for (const kind of ['word_range', 'citation_style', 'deadline', 'page_range'] as BriefKind[]) {
    const ofKind = items.filter((i) => i.kind === kind);
    for (let x = 0; x < ofKind.length; x++)
      for (let y = x + 1; y < ofKind.length; y++) {
        const a = ofKind[x];
        const b = ofKind[y];
        if (a.sourceId === b.sourceId) continue;
        if (normValue(a) !== normValue(b))
          conflicts.push({
            kind,
            a,
            b,
            note: `${a.sourceTitle}${a.sourceDate ? ' (' + a.sourceDate + ')' : ''} says "${a.value}" but ${b.sourceTitle}${b.sourceDate ? ' (' + b.sourceDate + ')' : ''} says "${b.value}". Choose which governs.`,
          });
      }
  }

  const missing: BriefResult['missing'] = [];
  const have = (k: BriefKind) => items.some((i) => i.kind === k);
  if (!have('deliverable'))
    missing.push({
      kind: 'deliverable',
      note: 'No sentence states what to submit (essay, memo, paper...).',
    });
  if (!have('word_range') && !have('page_range')) missing.push({ kind: 'word_range', note: 'No length requirement found.' });
  if (!have('citation_style')) missing.push({ kind: 'citation_style', note: 'No citation system named.' });
  if (!have('deadline')) missing.push({ kind: 'deadline', note: 'No deadline found.' });
  else if (items.filter((i) => i.kind === 'deadline').every((i) => !i.data?.timezone))
    missing.push({
      kind: 'deadline',
      note: 'Deadline found but no timezone stated.',
    });
  if (!have('criterion'))
    missing.push({
      kind: 'criterion',
      note: 'No rubric criteria with weights found.',
    });
  if (!have('assistance'))
    missing.push({
      kind: 'assistance',
      note: 'No statement about permitted assistance. Ask your instructor; do not assume.',
    });
  return { items, missing, conflicts };
}

function normValue(i: BriefItem): string {
  if (i.kind === 'word_range' || i.kind === 'page_range') return `${i.data?.min ?? ''}-${i.data?.max ?? ''}`;
  if (i.kind === 'citation_style') return String(i.data?.style ?? i.value).toLowerCase();
  return i.value.toLowerCase().replace(/\s+/g, ' ');
}

function lineSpans(text: string): { text: string; start: number; end: number }[] {
  const out: { text: string; start: number; end: number }[] = [];
  let pos = 0;
  for (const l of text.split('\n')) {
    out.push({
      text: l.trim(),
      start: pos + (l.length - l.trimStart().length),
      end: pos + l.length,
    });
    pos += l.length + 1;
  }
  return out.filter((l) => l.text);
}
