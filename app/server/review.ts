// Stage executor for review runs. Pure of queue mechanics: given a leased stage it returns an output and the side
// effects to apply atomically with the commit. Deterministic code owns protected spans, numbers, anchors and ranking;
// models (or the fixture engine) only interpret.
import { all, clock, one, own, type DB } from './db.ts';
import { BudgetError, costOf, priceFor, recordFree, reserve, markUncertain, release, settle, runSpend, usedUsd, type Price } from './spend.ts';
import { stageOutput, STAGE_PLAN, type RunMode, type StageClaim } from './jobs.ts';
import {
  activeLocks,
  evidencePassages,
  getBrief,
  getAssignmentState,
  getSettings,
  headRevision,
  insertProposals,
  replaceAudits,
  revisionRow,
  confirmedPreferences,
  type Ctx,
  type EvidencePassage,
} from './store.ts';
import { selectProviders, type ProviderSet } from './providers/index.ts';
import { UncertainError, type CallControl, type CallResult, type Provider } from './providers/types.ts';
import { SCHEMAS, type Role } from './roles.ts';
import { validateProposal, type Lock, type Para, type RawProposal, type Proposal } from '../shared/proposals.ts';
import { verifyParagraph, mergeVerdicts, type ClaimVerdict } from '../shared/evidence.ts';
import { countWords } from '../shared/text.ts';
import { extractCitations, extractNumbers, extractQuotes } from '../shared/meaning.ts';
import { POLICY_VERSION, voiceEdit, type VoiceProfile } from '../shared/voice.ts';
import { cleanUnicode } from '../shared/unicode.ts';

export interface StageCtx {
  db: DB;
  c: Ctx;
  claim: StageClaim;
  run: Record<string, any>;
  providers: ProviderSet;
  heartbeat: () => void;
  fault: (point: string) => Promise<void>;
}
export interface StageResult {
  output: any;
  sideEffects?: () => void;
}

class SchemaError extends Error {}
const OPTIONAL_STAGES = new Set(['critic_blind', 'critic_check', 'repair', 'verify_final']);
export const isOptionalStage = (name: string) => OPTIONAL_STAGES.has(name);

// ---- provider dispatch with spend control ---------------------------------------------------
async function dispatch(sc: StageCtx, provider: Provider, role: Role, input: any, ctl?: CallControl): Promise<CallResult> {
  const settings = getSettings(sc.c);
  const assignment = own(sc.db, 'assignments', sc.run.assignment_id, sc.c.ws);
  if (!provider.paid) {
    const res = await provider.call(role, input, ctl);
    recordFree(sc.db, {
      ws: sc.c.ws,
      assignmentId: sc.run.assignment_id,
      runId: sc.run.id,
      stageId: sc.claim.stageId,
      attempt: sc.claim.attempt,
      provider: provider.id,
      model: provider.model,
      latencyMs: res.latencyMs,
    });
    return res;
  }
  const price: Price | null = priceFor(settings.prices, provider.id);
  if (!price)
    throw new BudgetError(
      'price_unconfigured',
      `No price is configured for ${provider.id}. Add input/output prices in Settings before using this provider; unknown prices are never assumed.`,
    );
  const est = provider.estimate(role, input, ctl);
  const upper =
    costOf(price, {
      inputTokens: est.inputTokens,
      outputTokens: est.outputTokens,
    }) * 1.1;
  const rid = reserve(sc.db, {
    ws: sc.c.ws,
    assignmentId: sc.run.assignment_id,
    runId: sc.run.id,
    stageId: sc.claim.stageId,
    attempt: sc.claim.attempt,
    provider: provider.id,
    model: provider.model,
    upperBoundUsd: upper,
    assignmentCap: sc.run.budget_usd ?? assignment?.budget_usd ?? null,
    monthlyCap: settings.monthlyLimitUsd,
  });
  await sc.fault('after_reserve');
  try {
    const res = await provider.call(role, input, ctl);
    settle(sc.db, rid, {
      actualUsd: costOf(price, res.usage),
      inputTokens: res.usage.inputTokens,
      outputTokens: res.usage.outputTokens,
      cachedTokens: res.usage.cachedTokens,
      latencyMs: res.latencyMs,
      priceRev: price.rev,
    });
    return res;
  } catch (e) {
    if (e instanceof UncertainError) markUncertain(sc.db, rid);
    else release(sc.db, rid);
    throw e;
  }
}

export async function callRole(
  sc: StageCtx,
  which: 'editor' | 'critic' | 'verifier',
  role: Role,
  input: any,
  ctl?: CallControl,
): Promise<{
  output: any;
  meta: { provider: string; vendor: string; model: string; paid: boolean };
}> {
  const provider = sc.providers[which];
  let current = input;
  for (let pass = 0; pass < 2; pass++) {
    const res = await dispatch(sc, provider, role, current, ctl);
    const parsed = SCHEMAS[role].safeParse(res.output);
    if (parsed.success)
      return {
        output: parsed.data,
        meta: {
          provider: res.provider,
          vendor: res.vendor,
          model: res.model,
          paid: res.paid,
        },
      };
    // one schema repair attempt; on a second failure the prior document is retained
    current = {
      ...input,
      _schemaRepair: {
        errors: parsed.error.issues.slice(0, 8).map((i) => `${i.path.join('.')}: ${i.message}`),
        previous: res.output,
      },
    };
  }
  throw new SchemaError(`${provider.id} returned output that did not match the ${role} schema twice; the existing document was left unchanged.`);
}

// ---- inputs ---------------------------------------------------------------------------------
export function loadReviewInput(sc: StageCtx) {
  const rev = revisionRow(sc.c, sc.run.base_revision);
  const locks = activeLocks(sc.c, sc.run.document_id);
  const passages = evidencePassages(sc.c, sc.run.assignment_id);
  const brief = getBrief(sc.c, sc.run.assignment_id);
  const criteria = brief.items
    .filter((i) => i.kind === 'criterion')
    .map((i) => ({
      id: i.key,
      label: i.label as string,
      points: (i.data as any)?.points ?? null,
    }));
  const citationStyle = brief.items.find((i) => i.kind === 'citation_style')?.value ?? null;
  const assignment = own(sc.db, 'assignments', sc.run.assignment_id, sc.c.ws)!;
  const state = getAssignmentState(sc.c, sc.run.assignment_id);
  const settings = getSettings(sc.c);
  return {
    paragraphs: rev.paragraphs.filter((p) => p.text.trim()),
    allParagraphs: rev.paragraphs,
    locks,
    passages,
    brief: { criteria, citationStyle },
    profile: settings.voiceProfile as VoiceProfile,
    notes: {
      objection: state.idea?.extraction?.objection ?? null,
      claim: state.idea?.extraction?.claim ?? null,
    },
    prefs: confirmedPreferences(sc.c, assignment.course_id).map((p) => ({
      comment: p.comment,
      instructor: p.instructor,
    })),
    language: assignment.language as string,
  };
}
const toIndexed = (ps: EvidencePassage[]) => ps.map((p) => ({ ...p }));

// ---- stages ---------------------------------------------------------------------------------
export interface Requirement {
  id: string;
  kind: string;
  status: 'met' | 'missing' | 'unknown';
  message: string;
  sourcePassageId?: string;
}

export function checkRequirements(paragraphs: Para[], brief: ReturnType<typeof getBrief>): { requirements: Requirement[]; wordCount: number } {
  const text = paragraphs.map((p) => p.text).join('\n\n');
  const words = countWords(text);
  const reqs: Requirement[] = [];
  const len = brief.items.find((i) => i.kind === 'word_range');
  if (len) {
    let min = (len.data as any)?.min as number | undefined;
    let max = (len.data as any)?.max as number | undefined;
    if (len.status === 'corrected') {
      const m = /(\d[\d,]*)\D+(\d[\d,]*)/.exec(len.value ?? '');
      if (m) {
        min = +m[1].replace(/,/g, '');
        max = +m[2].replace(/,/g, '');
      }
    }
    const ok = (min == null || words >= min) && (max == null || words <= max);
    reqs.push({
      id: 'req_length',
      kind: 'length',
      status: ok ? 'met' : 'missing',
      message: ok ? `${words} words is within "${len.value}".` : `${words} words; the assignment asks for "${len.value}".`,
      sourcePassageId: len.passageId ?? undefined,
    });
  }
  const style = brief.items.find((i) => i.kind === 'citation_style');
  if (style) {
    const n = extractCitations(text).length;
    reqs.push({
      id: 'req_citations',
      kind: 'citation',
      status: n ? 'met' : 'missing',
      message: n
        ? `${n} in-text citation(s) found; the assignment names ${style.value}. Format is not verified.`
        : `No in-text citations found, but the assignment names ${style.value}.`,
      sourcePassageId: style.passageId ?? undefined,
    });
  }
  for (const crit of brief.items.filter((i) => i.kind === 'criterion')) {
    const label = String(crit.label);
    if (/evidence|source|support/i.test(label)) {
      const has = extractCitations(text).length + extractQuotes(text).length + extractNumbers(text).filter((n) => n.unit !== 'year').length > 0;
      reqs.push({
        id: `req_${crit.key}`,
        kind: 'evidence',
        status: has ? 'met' : 'missing',
        message: has ? `Draft cites or quotes specific evidence (${label}).` : `"${label}" is graded but the draft has no figure, quotation or citation.`,
        sourcePassageId: crit.passageId ?? undefined,
      });
    } else if (/counter|objection|opposing|alternative/i.test(label)) {
      const has = /\b(however|critics?|skeptic\w*|objection|alternative|might also|although|counter\w*|on the other hand)\b/i.test(text);
      reqs.push({
        id: `req_${crit.key}`,
        kind: 'counterargument',
        status: has ? 'met' : 'missing',
        message: has ? 'The draft engages an objection.' : `"${label}" is graded but no objection is addressed.`,
        sourcePassageId: crit.passageId ?? undefined,
      });
    } else if (/argument|thesis|claim/i.test(label)) {
      const first = countWords(paragraphs[0]?.text ?? '');
      reqs.push({
        id: `req_${crit.key}`,
        kind: 'thesis',
        status: first >= 12 ? 'met' : 'missing',
        message: first >= 12 ? 'An opening claim is present. Whether it is arguable is your call.' : 'The opening paragraph is too short to state a thesis.',
        sourcePassageId: crit.passageId ?? undefined,
      });
    } else
      reqs.push({
        id: `req_${crit.key}`,
        kind: 'criterion',
        status: 'unknown',
        message: `"${label}" is a graded criterion this tool cannot check automatically.`,
        sourcePassageId: crit.passageId ?? undefined,
      });
  }
  return { requirements: reqs, wordCount: words };
}

const priorityClass = (p: { issue: string; findings?: any[] }) => {
  if (p.issue === 'number_mismatch' || p.issue === 'unsupported_causality') return 0;
  if (p.issue === 'missing_requirement') return 1;
  if (['unsupported_claim', 'citation_missing', 'weak_argument', 'structure'].includes(p.issue)) return 2;
  return 3;
};

function policyPass(replacement: string, profile: VoiceProfile, original: string): string {
  // Humanizer-rules step (mechanical, meaning-checked) then hygiene step. Both versioned via POLICY_VERSION.
  const v = voiceEdit(replacement, profile);
  const clean = cleanUnicode(v.noChange ? replacement : v.replacement).text;
  return clean === original ? replacement : clean;
}

export async function executeStage(sc: StageCtx): Promise<StageResult> {
  const name = sc.claim.name;
  const input = loadReviewInput(sc);
  const fault = sc.fault;
  switch (name) {
    case 'assignment_check': {
      const brief = getBrief(sc.c, sc.run.assignment_id);
      return { output: checkRequirements(input.allParagraphs, brief) };
    }
    case 'split_claims': {
      const claims = input.paragraphs.map((p) => ({
        paragraphId: p.id,
        claims: verifyParagraph(p.text, [], `${p.id}_c`).claims,
      }));
      return {
        output: {
          claims: claims.map((c) => ({
            paragraphId: c.paragraphId,
            claims: c.claims,
          })),
        },
      };
    }
    case 'verify': {
      const passages = toIndexed(input.passages);
      const rows: any[] = [];
      for (const p of input.paragraphs) {
        const base = verifyParagraph(p.text, passages, `${p.id}_c`);
        base.claims.forEach((cl, i) =>
          rows.push({
            paragraphId: p.id,
            claim: cl,
            verdict: base.verdicts[i],
          }),
        );
      }
      let modelNote: string | null = null;
      if (sc.providers.verifier.paid) {
        try {
          const r = await callRole(sc, 'verifier', 'evidence_verifier', {
            paragraphs: input.paragraphs,
            claims: rows.map((x) => ({ claimId: x.claim.id, paragraphId: x.paragraphId, text: x.claim.text })),
            passages,
            locks: input.locks,
          });
          for (const mv of r.output.verdicts as any[]) {
            const row = rows.find((x) => x.claim.id === mv.claimId);
            if (!row) continue;
            // a model-named passage must belong to this assignment; otherwise ignore the model's passage
            const pid = passages.some((p) => p.id === mv.passageId) ? mv.passageId : row.verdict.passageId;
            const merged = mergeVerdicts(row.verdict, {
              ...row.verdict,
              verdict: mv.verdict,
              passageId: pid,
              reasons: mv.reasons,
              engine: r.meta.provider,
            });
            row.verdict = merged;
          }
        } catch (e) {
          if (e instanceof BudgetError || e instanceof UncertainError) modelNote = `Model verification skipped: ${(e as Error).message}`;
          else throw e;
        }
      }
      await fault('before_commit');
      const baseRev = sc.run.base_revision as string;
      return {
        output: { rows, modelNote },
        sideEffects: () =>
          replaceAudits(
            sc.c,
            sc.run.document_id,
            baseRev,
            sc.run.id,
            rows.map((r) => ({
              paragraphId: r.paragraphId,
              claimId: r.claim.id,
              claim: r.claim.text,
              start: r.claim.start,
              end: r.claim.end,
              verdict: r.verdict.verdict,
              passageId: r.verdict.passageId,
              quote: r.verdict.quote,
              reasons: r.verdict.reasons,
              stale: r.verdict.stale,
              engine: r.verdict.engine,
            })),
          ),
      };
    }
    case 'argument_edit':
    case 'edit_unsupported': {
      const r = await callRole(sc, 'editor', 'argument_editor', {
        paragraphs: input.paragraphs,
        locks: input.locks,
        passages: toIndexed(input.passages),
        brief: input.brief,
        profile: input.profile,
        notes: input.notes,
        prefs: input.prefs,
        language: input.language,
      });
      await fault('before_commit');
      return {
        output: { proposals: r.output.proposals, provider: r.meta.provider },
      };
    }
    case 'critic_blind': {
      const r = await callRole(sc, 'critic', 'critic_blind', {
        paragraphs: input.paragraphs,
        passages: toIndexed(input.passages),
        locks: input.locks,
        profile: input.profile,
      });
      return {
        output: { weaknesses: r.output.weaknesses, provider: r.meta.provider },
      };
    }
    case 'critic_check': {
      const edit = stageOutput(sc.db, sc.run.id, 'argument_edit');
      const blind = stageOutput(sc.db, sc.run.id, 'critic_blind');
      if (!edit?.proposals?.length) return { output: { verdicts: [], provider: null } };
      // the reviewer sees the candidate text and issue but NOT the editor's reasoning
      const candidates = (edit.proposals as RawProposal[]).map((p, index) => ({
        index,
        paragraphId: p.paragraphId,
        original: p.original,
        replacement: p.replacement,
        issue: p.issue,
      }));
      const r = await callRole(sc, 'critic', 'critic_check', {
        candidates,
        passages: toIndexed(input.passages),
        paragraphs: input.paragraphs,
        blind: blind?.weaknesses ?? [],
      });
      return {
        output: { verdicts: r.output.verdicts, provider: r.meta.provider },
      };
    }
    case 'repair': {
      const edit = stageOutput(sc.db, sc.run.id, 'argument_edit');
      const check = stageOutput(sc.db, sc.run.id, 'critic_check');
      const failed = (check?.verdicts ?? [])
        .filter((v: any) => v.verdict !== 'accept')
        .map((v: any) => ({
          raw: edit.proposals[v.index],
          replacement: edit.proposals[v.index].replacement,
          reasons: v.reasons,
          index: v.index,
        }))
        .filter((x: any) => x.raw && !['style', 'stock_phrase', 'unclear_sentence'].includes(x.raw.issue));
      if (!failed.length) return { output: { repaired: [] } };
      const r = await callRole(sc, 'editor', 'repair', {
        failed,
        passages: toIndexed(input.passages),
        locks: input.locks,
        notes: input.notes,
      });
      const repaired = (r.output.proposals as RawProposal[]).map((p) => ({
        ...p,
        _replaces: failed.find((f: any) => f.raw.paragraphId === p.paragraphId && f.raw.original === p.original)?.index ?? null,
      }));
      return { output: { repaired, provider: r.meta.provider } };
    }
    case 'verify_final': {
      const edit = stageOutput(sc.db, sc.run.id, 'argument_edit');
      const rep = stageOutput(sc.db, sc.run.id, 'repair');
      const passages = toIndexed(input.passages);
      const post: Record<string, ClaimVerdict[]> = {};
      const cands: RawProposal[] = [...(edit?.proposals ?? []), ...((rep?.repaired ?? []) as RawProposal[])];
      cands.forEach((p, i) => {
        post[String(i)] = verifyParagraph(p.replacement, passages, `v${i}_`).verdicts;
      });
      return { output: { post } };
    }
    case 'finalize':
      return finalize(sc, input);
  }
  throw new Error(`unknown stage ${name}`);
}

function finalize(sc: StageCtx, input: ReturnType<typeof loadReviewInput>): StageResult {
  const mode = sc.run.mode as RunMode;
  const editName = mode === 'evidence' ? 'edit_unsupported' : 'argument_edit';
  const edit = stageOutput(sc.db, sc.run.id, editName);
  const check = stageOutput(sc.db, sc.run.id, 'critic_check');
  const blind = stageOutput(sc.db, sc.run.id, 'critic_blind');
  const repair = stageOutput(sc.db, sc.run.id, 'repair');
  const ac = stageOutput(sc.db, sc.run.id, 'assignment_check');
  const degraded: { stage: string; reason: string }[] = [];
  for (const s of STAGE_PLAN[mode]) {
    const o = stageOutput(sc.db, sc.run.id, s.name);
    if (o?.skipped) degraded.push({ stage: s.name, reason: o.reason });
  }

  let raws: (RawProposal & { _critic?: any })[] = (edit?.proposals ?? []).map((p: RawProposal, i: number) => ({
    ...p,
    _critic: check?.verdicts?.find((v: any) => v.index === i) ?? null,
    _origIndex: i,
  }));
  for (const r of (repair?.repaired ?? []) as any[]) {
    const at = raws.findIndex((x: any) => x._origIndex === r._replaces);
    if (at >= 0)
      raws[at] = {
        ...r,
        _critic: {
          verdict: 'revise',
          reasons: ['Repaired after the independent review.'],
          repaired: true,
        },
        _origIndex: r._replaces,
      } as any;
  }
  const baseRev = sc.run.base_revision as string;
  const ctxV = {
    baseRevision: baseRev,
    currentRevision: baseRev,
    paragraphs: input.allParagraphs,
    locks: input.locks as Lock[],
    allowedPassageIds: new Set(input.passages.map((p) => p.id)),
    provider: edit?.provider ?? sc.providers.editor.id,
    policyVersion: POLICY_VERSION,
  };
  const valid: (Omit<Proposal, 'id'> & {
    _critic?: any;
    rank?: number;
    disagreement?: unknown;
    critic?: unknown;
  })[] = [];
  const dropped: { reason: string; issue: string }[] = [];
  for (const raw of raws) {
    const { _critic, ...rest } = raw as any;
    delete (rest as any)._origIndex;
    delete (rest as any)._replaces;
    const original = input.allParagraphs.find((p) => p.id === rest.paragraphId)?.text ?? '';
    const replacement = ['stock_phrase', 'style', 'unclear_sentence'].includes(rest.issue)
      ? policyPass(rest.replacement, input.profile, original)
      : cleanUnicode(rest.replacement).text;
    const v = validateProposal({ ...rest, replacement }, ctxV);
    if (!v.ok) {
      dropped.push({ reason: v.errors.join('; '), issue: rest.issue });
      continue;
    }
    if (v.proposal.verifier === 'failed') {
      dropped.push({
        reason: `failed meaning check: ${v.proposal.findings
          .filter((f) => f.severity === 'material')
          .map((f) => f.category)
          .join(', ')}`,
        issue: rest.issue,
      });
      continue;
    }
    valid.push({ ...v.proposal, _critic });
  }
  // second opinion -> disagreement (style disagreements are never worth a round)
  for (const p of valid) {
    const cv = (p as any)._critic;
    delete (p as any)._critic;
    const isStyle = ['stock_phrase', 'style', 'unclear_sentence'].includes(p.issue);
    if (cv && cv.verdict !== 'accept' && !isStyle && !cv.repaired) {
      p.requiresDecision = true;
      p.disagreement = {
        editor: { provider: p.provider, reason: p.reason },
        critic: {
          provider: check?.provider ?? null,
          verdict: cv.verdict,
          reasons: cv.reasons,
        },
        settleBy: settleBy(p, input.passages),
      };
    }
    if (cv)
      p.critic = {
        provider: check?.provider ?? null,
        verdict: cv.verdict,
        reasons: cv.reasons,
        repaired: !!cv.repaired,
        independent: sc.providers.independent,
      };
  }
  // priority, rubric weight (only when the instructor supplied points), then document order; suppress duplicates on the same text
  const weight = new Map(input.brief.criteria.map((c) => [c.id, c.points ?? 0]));
  const order = new Map(input.allParagraphs.map((p, i) => [p.id, i]));
  valid.sort(
    (a, b) =>
      priorityClass(a) - priorityClass(b) ||
      (weight.get(b.rubricCriterionId ?? '') ?? 0) - (weight.get(a.rubricCriterionId ?? '') ?? 0) ||
      (order.get(a.paragraphId) ?? 0) - (order.get(b.paragraphId) ?? 0) ||
      a.start - b.start,
  );
  const kept: typeof valid = [];
  for (const p of valid) {
    if (
      kept.some((k) => k.paragraphId === p.paragraphId && k.issue === p.issue && p.start < k.start + k.original.length && p.start + p.original.length > k.start)
    ) {
      dropped.push({
        reason: 'duplicate criticism of the same text',
        issue: p.issue,
      });
      continue;
    }
    kept.push(p);
  }
  const cap = mode === 'quick' ? 3 : mode === 'evidence' ? 6 : 5;
  const top = kept.slice(0, cap).map((p, i) => ({ ...p, rank: i + 1 }));
  const overflow = kept.length - top.length;

  // evidence audit of the base revision (deterministic baseline) so the evidence panel always has data
  const passages = toIndexed(input.passages);
  const audits: Parameters<typeof replaceAudits>[4] = [];
  if (mode !== 'evidence') {
    for (const p of input.paragraphs) {
      const r = verifyParagraph(p.text, passages, `${p.id}_c`);
      r.claims.forEach((cl, i) =>
        audits.push({
          paragraphId: p.id,
          claimId: cl.id,
          claim: cl.text,
          start: cl.start,
          end: cl.end,
          verdict: r.verdicts[i].verdict,
          passageId: r.verdicts[i].passageId,
          quote: r.verdicts[i].quote,
          reasons: r.verdicts[i].reasons,
          stale: r.verdicts[i].stale,
          engine: r.verdicts[i].engine,
        }),
      );
    }
  }
  const verifyOut = stageOutput(sc.db, sc.run.id, 'verify');
  const summary = {
    proposalCount: top.length,
    overflow,
    considered: raws.length,
    dropped,
    requirements: ac?.requirements ?? [],
    wordCount: ac?.wordCount ?? null,
    degraded,
    providers: {
      editor: sc.providers.editor.id,
      critic: check?.provider ?? (mode === 'deep' ? null : undefined),
      independent: sc.providers.independent,
      independence: sc.providers.independence,
    },
    blindWeaknesses: blind?.weaknesses?.length ?? null,
    evidence: verifyOut
      ? {
          claims: verifyOut.rows.length,
          unsupported: verifyOut.rows.filter((r: any) => r.verdict.verdict !== 'supported').length,
          modelNote: verifyOut.modelNote,
        }
      : null,
    policyVersion: POLICY_VERSION,
    mode,
    spend: (() => {
      const s = runSpend(sc.db, sc.run.id);
      return {
        paidCalls: s.paidCalls,
        settledUsd: s.settledUsd,
        uncertainUsd: s.uncertainUsd,
        calls: s.calls,
      };
    })(),
  };
  return {
    output: { summary, proposals: top.length },
    sideEffects: () => {
      insertProposals(sc.c, sc.run.document_id, sc.run.id, top as any);
      if (audits.length) replaceAudits(sc.c, sc.run.document_id, baseRev, sc.run.id, audits);
    },
  };
}

function settleBy(p: { issue: string; evidence: { passageId: string }[] }, passages: EvidencePassage[]): string {
  const pid = p.evidence[0]?.passageId;
  const where = pid ? ` (see ${pid})` : '';
  if (p.issue === 'unsupported_causality')
    return `A source that describes random assignment, or a comparison that controls for who chose each group${where}, would settle whether a causal claim is justified.`;
  if (p.issue === 'number_mismatch') return `Check the figure against the quoted passage${where}.`;
  return `A passage that states the claim directly${where} would settle it.${passages.length ? '' : ' No readings are loaded yet.'}`;
}

// ---- estimate shown before committing paid calls ---------------------------------------------
export function estimateRun(c: Ctx, documentId: string, mode: RunMode) {
  const settings = getSettings(c);
  const { revision } = headRevision(c, documentId);
  const words = revision.paragraphs.reduce((a, p) => a + countWords(p.text), 0);
  let set: ProviderSet;
  try {
    set = selectProviders(settings.mode);
  } catch (e: any) {
    return {
      mode,
      words,
      error: e.message,
      stages: [],
      paid: false,
      costUsd: null as number | null,
      priceMissing: false,
      label: 'unavailable',
    };
  }
  const tokens = Math.ceil(words * 1.4) + 1500;
  const stages = STAGE_PLAN[mode].map((s) => {
    const prov = s.provider ? set[s.provider] : null;
    const paid = !!prov?.paid;
    const price = prov && paid ? priceFor(settings.prices, prov.id) : null;
    const cost = paid && price ? costOf(price, { inputTokens: tokens, outputTokens: 2000 }) * 1.1 : paid ? null : 0;
    return {
      name: s.name,
      provider: prov?.id ?? 'deterministic',
      paid,
      estCostUsd: cost,
      priceMissing: paid && !price,
    };
  });
  const paid = stages.some((s) => s.paid);
  const priceMissing = stages.some((s) => s.priceMissing);
  const costUsd = priceMissing ? null : stages.reduce((a, s) => a + (s.estCostUsd ?? 0), 0);
  const assignmentId = one(c.db, 'SELECT assignment_id FROM documents WHERE id=? AND workspace_id=?', documentId, c.ws)?.assignment_id as string;
  return {
    mode,
    words,
    affectedParagraphs: revision.paragraphs.length,
    stages,
    paid,
    costUsd,
    priceMissing,
    independent: set.independent,
    independence: set.independence,
    notes: set.notes,
    usedUsd: usedUsd(c.db, c.ws, { assignmentId }),
    label: paid ? (priceMissing ? 'price not configured' : 'estimated upper bound') : 'free (deterministic fixture)',
  };
}
void all;
void clock;
