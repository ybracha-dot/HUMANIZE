import { z } from 'zod';
import { compareMeaning, type Finding } from './meaning.ts';

export const ISSUES = [
  'unsupported_causality', 'unsupported_claim', 'number_mismatch', 'citation_missing', 'missing_requirement', 'weak_argument',
  'unclear_sentence', 'stock_phrase', 'style', 'structure', 'other',
] as const;
export type Issue = (typeof ISSUES)[number];
export const STYLE_ISSUES: Issue[] = ['stock_phrase', 'style', 'unclear_sentence'];

export const EvidenceRefSchema = z.object({
  passageId: z.string().min(1),
  relationship: z.enum(['supports_replacement', 'supports_original', 'contradicts_original', 'context']),
});

/** What a model (or the fixture engine) may return. IDs, revision and decision are assigned by the app. */
export const RawProposalSchema = z.object({
  paragraphId: z.string().min(1),
  original: z.string().min(1),
  replacement: z.string(),
  issue: z.enum(ISSUES),
  reason: z.string().default(''),
  rubricCriterionId: z.string().nullable().optional(),
  evidence: z.array(EvidenceRefSchema).default([]),
  meaningChange: z.string().default(''),
  requiresDecision: z.boolean().default(false),
  start: z.number().int().nonnegative().optional(),
});
export type RawProposal = z.infer<typeof RawProposalSchema>;
export const RawProposalListSchema = z.object({ proposals: z.array(RawProposalSchema) });

export const ProposalSchema = RawProposalSchema.extend({
  id: z.string(),
  baseRevision: z.string(),
  start: z.number().int().nonnegative(),
  decision: z.enum(['pending', 'accepted', 'rejected', 'edited', 'superseded', 'conflict']),
  verifier: z.enum(['acceptable', 'decision_required', 'failed']),
  findings: z.array(z.object({ category: z.string(), severity: z.string(), message: z.string(), original: z.string(), candidate: z.string() })),
  provider: z.string(),
  policyVersion: z.string(),
  contextBefore: z.string(),
  contextAfter: z.string(),
});
export type Proposal = z.infer<typeof ProposalSchema>;

export interface Para { id: string; text: string; kind?: 'p' | 'h' }
export interface Lock { id: string; paragraphId: string; kind: 'paragraph' | 'span'; text: string; start: number; end: number; note?: string; thesis?: boolean }

export interface ValidationContext {
  baseRevision: string;
  currentRevision: string;
  paragraphs: Para[];
  locks: Lock[];
  allowedPassageIds: Set<string>;
  provider: string;
  policyVersion: string;
}

export type ValidationResult =
  | { ok: true; proposal: Omit<Proposal, 'id'>; warnings: string[] }
  | { ok: false; errors: string[] };

const CTX = 24;

/** Validate a raw proposal. Everything the model claimed about location and evidence is re-checked here. */
export function validateProposal(raw: unknown, ctx: ValidationContext): ValidationResult {
  const parsed = RawProposalSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) };
  const p = parsed.data;
  const errors: string[] = [];
  const warnings: string[] = [];
  if (ctx.baseRevision !== ctx.currentRevision) errors.push(`stale base revision ${ctx.baseRevision}; current is ${ctx.currentRevision}`);
  const para = ctx.paragraphs.find((x) => x.id === p.paragraphId);
  if (!para) return { ok: false, errors: [...errors, `paragraph ${p.paragraphId} is not in this revision`] };
  // Locate the original text.
  let start = -1;
  if (p.start !== undefined) {
    if (para.text.slice(p.start, p.start + p.original.length) === p.original) start = p.start;
    else errors.push('original text does not appear at the stated offset (offsets are UTF-16 code units within the paragraph)');
  } else {
    const first = para.text.indexOf(p.original);
    if (first < 0) errors.push('original text not found in the paragraph');
    else if (para.text.indexOf(p.original, first + 1) >= 0) errors.push('original text appears more than once; an explicit offset is required');
    else start = first;
  }
  if (errors.length) return { ok: false, errors };
  const end = start + p.original.length;
  for (const l of ctx.locks.filter((l) => l.paragraphId === p.paragraphId)) {
    if (l.kind === 'paragraph' || (start < l.end && end > l.start)) return { ok: false, errors: [`overlaps a locked ${l.kind}${l.thesis ? ' (thesis)' : ''}; locked text cannot be changed. Add a note challenging it instead.`] };
  }
  if (p.replacement === p.original) return { ok: false, errors: ['replacement is identical to the original'] };
  // Evidence must belong to the current workspace/assignment. Model-supplied sources are rejected.
  const evidence = p.evidence.filter((e) => {
    const ok = ctx.allowedPassageIds.has(e.passageId);
    if (!ok) warnings.push(`evidence ${e.passageId} rejected: not a passage of this assignment`);
    return ok;
  });
  const needsEvidence = (['unsupported_causality', 'unsupported_claim', 'number_mismatch'] as Issue[]).includes(p.issue);
  if (needsEvidence && !evidence.length) warnings.push('no valid evidence passage; marked as requiring a decision');
  const meaning = compareMeaning(p.original, p.replacement);
  const isStyle = STYLE_ISSUES.includes(p.issue);
  // A style-only suggestion that changes meaning materially is a failed suggestion, not a decision for the writer.
  const verifier: Proposal['verifier'] = isStyle && meaning.material.length ? 'failed' : meaning.outcome;
  const requiresDecision = p.requiresDecision || verifier === 'decision_required' || (needsEvidence && !evidence.length);
  return {
    ok: true, warnings,
    proposal: {
      ...p, evidence, start, requiresDecision,
      meaningChange: p.meaningChange || meaning.material.map((m) => m.message).join(' '),
      baseRevision: ctx.baseRevision, decision: 'pending', verifier,
      findings: meaning.findings.map((f: Finding) => ({ category: f.category, severity: f.severity, message: f.message, original: f.original, candidate: f.candidate })),
      provider: ctx.provider, policyVersion: ctx.policyVersion,
      contextBefore: para.text.slice(Math.max(0, start - CTX), start), contextAfter: para.text.slice(end, end + CTX),
    },
  };
}

export type ApplyResult =
  | { ok: true; paragraphs: Para[]; newText: string }
  | { ok: false; reason: 'paragraph_missing' | 'locked' | 'anchor_changed' | 'ambiguous'; detail: string; headText?: string };

/** Apply a proposal to a revision that may be newer than its base. Rebases only when the anchor still matches uniquely. */
export function applyProposal(p: Pick<Proposal, 'paragraphId' | 'original' | 'replacement' | 'start' | 'contextBefore' | 'contextAfter'>, paragraphs: Para[], locks: Lock[]): ApplyResult {
  const para = paragraphs.find((x) => x.id === p.paragraphId);
  if (!para) return { ok: false, reason: 'paragraph_missing', detail: 'The paragraph no longer exists in the current revision.' };
  let at = para.text.slice(p.start, p.start + p.original.length) === p.original
    && para.text.slice(Math.max(0, p.start - p.contextBefore.length), p.start) === p.contextBefore
    && para.text.slice(p.start + p.original.length, p.start + p.original.length + p.contextAfter.length) === p.contextAfter ? p.start : -1;
  if (at < 0) {
    // Rebase: the exact original with its surrounding context must still occur exactly once.
    const needle = p.contextBefore + p.original + p.contextAfter;
    const first = para.text.indexOf(needle);
    if (first < 0) return { ok: false, reason: 'anchor_changed', detail: 'The sentence changed since this suggestion was made.', headText: para.text };
    if (para.text.indexOf(needle, first + 1) >= 0) return { ok: false, reason: 'ambiguous', detail: 'The anchor now appears more than once.', headText: para.text };
    at = first + p.contextBefore.length;
  }
  const end = at + p.original.length;
  for (const l of locks.filter((l) => l.paragraphId === p.paragraphId)) {
    if (l.kind === 'paragraph' || (at < l.end && end > l.start)) return { ok: false, reason: 'locked', detail: 'The text is locked.' };
  }
  const newText = para.text.slice(0, at) + p.replacement + para.text.slice(end);
  return { ok: true, newText, paragraphs: paragraphs.map((x) => (x.id === para.id ? { ...x, text: newText } : x)) };
}

/** After any edit, every lock must still hold. Returns violated lock ids. */
export function lockViolations(before: Para[], after: Para[], locks: Lock[]): string[] {
  const bad: string[] = [];
  for (const l of locks) {
    const b = before.find((p) => p.id === l.paragraphId); const a = after.find((p) => p.id === l.paragraphId);
    if (!b) continue;
    if (!a) { bad.push(l.id); continue; }
    if (l.kind === 'paragraph') { if (a.text !== b.text) bad.push(l.id); }
    else if (!a.text.includes(l.text)) bad.push(l.id);
  }
  return bad;
}

/** Re-locate a span lock inside updated paragraph text (offsets shift when earlier text changes). */
export function relocateLocks(paragraphs: Para[], locks: Lock[]): Lock[] {
  return locks.map((l) => {
    const para = paragraphs.find((p) => p.id === l.paragraphId);
    if (!para || l.kind === 'paragraph') return l;
    const i = para.text.indexOf(l.text);
    return i >= 0 ? { ...l, start: i, end: i + l.text.length } : l;
  });
}

/** Tolerant JSON extraction for model output. Throws if no JSON object is present. */
export function extractJson(text: string): unknown {
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = fence ? fence[1] : text;
  const a = body.indexOf('{'); const b = body.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('no JSON object in model output');
  return JSON.parse(body.slice(a, b + 1));
}
