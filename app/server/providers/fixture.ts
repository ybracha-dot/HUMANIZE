// FIXTURE provider: deterministic local rules. It is NOT a language model and is labelled "fixture" everywhere.
// It exists so the whole workflow runs without a key. Drafting assembles the writer's own claims and quoted passages;
// live mode writes prose. Verification logic lives in shared/ and is not specific to any demo.
import type { CallControl, CallResult, Provider } from './types.ts';
import type { Role } from '../roles.ts';
import { verifyParagraph, PassageIndex, splitClaims, tokenize, type IndexedPassage } from '../../shared/evidence.ts';
import { causalMarker, compareMeaning, extractCitations, extractNumbers } from '../../shared/meaning.ts';
import { clarityFlags, voiceEdit, NEUTRAL_PROFILE, POLICY_VERSION, type VoiceProfile } from '../../shared/voice.ts';
import { splitSentences, findQuote } from '../../shared/text.ts';
import type { Lock, Para, RawProposal } from '../../shared/proposals.ts';

export const FIXTURE_ID = 'fixture:rules/1';

const UP = /^(rais\w+|improv\w+|boost\w*|increas\w+|enhanc\w+)$/i;
const DOWN = /^(reduc\w+|lower\w*|decreas\w+|cut|cuts)$/i;

const lowerFirst = (s: string) => (s ? s[0].toLowerCase() + s.slice(1) : s);
const stripEnd = (s: string) => s.trim().replace(/[.!?]+$/, '');

/** Rewrite "A raised B" as "A was associated with higher B" and add the source's design limitation. Returns null if the sentence shape is not recognised. */
export function associationRewrite(claim: string, passageText: string, objection?: string | null): string | null {
  const m = /^(.{3,80}?)\s+(rais\w+|improv\w+|boost\w*|increas\w+|enhanc\w+|reduc\w+|lower\w*|decreas\w+)\s+(.{3,120}?)([.!?]?)$/i.exec(claim.trim());
  let head: string | null = null;
  if (m && (UP.test(m[2]) || DOWN.test(m[2]))) head = `${m[1]} was associated with ${UP.test(m[2]) ? 'higher' : 'lower'} ${stripEnd(m[3])}.`;
  else {
    const s = /^(.{3,80}?)\s+(?:causes?|caused|leads? to|led to|results? in|resulted in|drives?|drove|produces?|produced)\s+(.{3,120}?)([.!?]?)$/i.exec(claim.trim());
    if (s) head = `${s[1]} was associated with ${stripEnd(s[2])}.`;
  }
  if (!head) return null;
  return `${head} ${limitationSentence(passageText, objection)}`;
}

/** The design limitation a reader needs, built from the source's own wording and the writer's stated objection. */
export function limitationSentence(passageText: string, objection?: string | null): string {
  const cue = splitSentences(passageText).find((s) => /chose whether|self[- ]select|volunt|opt(?:ed)? in|their own choice|not randomly/i.test(s.text));
  const cueClause = cue ? lowerFirst(stripEnd(cue.text)) : null;
  const confound = objection ? stripEnd(objection) : 'other differences between the groups could explain the gap';
  return cueClause
    ? `Because ${cueClause}, this shows an association rather than an effect: ${lowerFirst(confound)}.`
    : `This comparison shows an association rather than an effect: ${lowerFirst(confound)}.`;
}

/** The source's design note (e.g. "students chose whether to attend") may sit in a different passage of the same source. */
function designCue(passages: IndexedPassage[], hit: IndexedPassage): IndexedPassage | null {
  const key = (id: string) => id.replace(/_p\d+$/, '');
  return passages.find((x) => key(x.id) === key(hit.id) && /chose whether|self[- ]select|volunt\w+|opt(?:ed)? in|their own choice|not randomly/i.test(x.text)) ?? null;
}

const ASSOC_CLAIM = /^(.{3,80}?)\s+(?:is|was|are|were)\s+(?:associated|correlated|linked)\s+with\s+(higher|lower|greater|more|less|fewer)\s+(.{3,120}?)([.!?]?)$/i;
const LIMIT_PRESENT = /\b(chose|self[- ]select\w*|motivated|confound\w*|cannot rule out|rather than an effect|selection)\b/i;

function criterionFor(brief: any, re: RegExp): string | null {
  const c = (brief?.criteria ?? []).find((x: any) => re.test(x.label));
  return c?.id ?? null;
}

function lockRanges(locks: Lock[], paragraphId: string) { return locks.filter((l) => l.paragraphId === paragraphId).map((l) => ({ start: l.start, end: l.end })); }

function argumentEditor(input: any): { proposals: RawProposal[] } {
  const paragraphs: Para[] = input.paragraphs ?? [];
  const locks: Lock[] = input.locks ?? [];
  const passages: IndexedPassage[] = input.passages ?? [];
  const profile: VoiceProfile = input.profile ?? NEUTRAL_PROFILE;
  const objection: string | null = input.notes?.objection ?? null;
  const out: RawProposal[] = [];
  const evCrit = criterionFor(input.brief, /evidence|source|support/i);
  const argCrit = criterionFor(input.brief, /argument|thesis|claim/i);
  const style = /mla|apa/i.exec(input.brief?.citationStyle ?? '')?.[0] ?? null;
  for (const p of paragraphs) {
    if (locks.some((l) => l.paragraphId === p.id && l.kind === 'paragraph')) continue;
    const ranges = lockRanges(locks, p.id);
    const overlapsLock = (s: number, e: number) => ranges.some((r) => s < r.end && e > r.start);
    const { claims, verdicts } = verifyParagraph(p.text, passages, `${p.id}_c`);
    claims.forEach((cl, i) => {
      const v = verdicts[i];
      if (overlapsLock(cl.start, cl.end)) return;
      const passage = passages.find((x) => x.id === v.passageId);
      const cm = causalMarker(cl.text);
      if (v.verdict === 'partial' && cm && passage) {
        const rep = associationRewrite(cl.text, passage.text, objection);
        if (rep) out.push({ paragraphId: p.id, original: cl.text, start: cl.start, replacement: rep, issue: 'unsupported_causality', reason: `"${cm}" claims a cause. ${v.reasons.find((r) => /causation/.test(r)) ?? 'The source supports an association.'}`, rubricCriterionId: evCrit ?? argCrit, evidence: [{ passageId: passage.id, relationship: 'supports_replacement' }, { passageId: passage.id, relationship: 'contradicts_original' }], meaningChange: 'Removes a causal claim that this comparison cannot establish and states the limitation.', requiresDecision: true });
      } else if (v.verdict === 'contradicted' && passage) {
        // swap a mismatched figure for the passage's figure only when there is exactly one candidate
        const cn = extractNumbers(cl.text).filter((n) => n.unit !== 'year');
        const pn = extractNumbers(v.quote?.text ?? passage.text).filter((n) => n.unit !== 'year');
        const wrong = cn.find((n) => !pn.some((q) => Math.abs(q.value - n.value) < 1e-9));
        const right = wrong && pn.filter((q) => q.unit === wrong.unit);
        if (wrong && right && right.length === 1) {
          const at = cl.text.indexOf(wrong.raw);
          out.push({ paragraphId: p.id, original: cl.text, start: cl.start, replacement: cl.text.slice(0, at) + right[0].raw + cl.text.slice(at + wrong.raw.length), issue: 'number_mismatch', reason: v.reasons.join(' '), rubricCriterionId: evCrit, evidence: [{ passageId: passage.id, relationship: 'contradicts_original' }, { passageId: passage.id, relationship: 'supports_replacement' }], meaningChange: `Changes ${wrong.raw} to ${right[0].raw} to match the source.`, requiresDecision: true });
        }
      } else if (v.verdict === 'supported' && passage && ASSOC_CLAIM.test(cl.text) && designCue(passages, passage)) {
        const cue = designCue(passages, passage)!;
        // (1) precise limitation: the objection rubric criterion rewards naming what the comparison cannot show
        if (!LIMIT_PRESENT.test(p.text)) {
          out.push({ paragraphId: p.id, original: cl.text, start: cl.start, replacement: `${cl.text} ${limitationSentence(cue.text, objection)}`, issue: 'missing_requirement', reason: 'The claim is an association from a comparison where participants chose their own group, but the paragraph never says what that comparison cannot show.', rubricCriterionId: criterionFor(input.brief, /objection|counter|alternative/i) ?? argCrit, evidence: [{ passageId: cue.id, relationship: 'supports_replacement' }], meaningChange: 'Adds a limitation sentence; the claim itself is unchanged.', requiresDecision: true });
        }
        // (2) FIXTURE_SHARPENER: mimics the common model habit of "tightening" a hedged claim into a causal one, so the
        // verifier's overstatement check can be demonstrated without a live model. Disable with STUDIO_FIXTURE_SHARPEN=0.
        if (process.env.STUDIO_FIXTURE_SHARPEN !== '0') {
          const m = ASSOC_CLAIM.exec(cl.text)!;
          const up = /higher|greater|more/i.test(m[2]);
          out.push({ paragraphId: p.id, original: cl.text, start: cl.start, replacement: `${m[1]} ${up ? 'raises' : 'lowers'} ${m[3].replace(/[.!?]+$/, '')}.`, issue: 'weak_argument', reason: 'The claim is hedged ("associated with"); a punchier version reads as more confident.', rubricCriterionId: argCrit, evidence: [{ passageId: passage.id, relationship: 'context' }], meaningChange: '', requiresDecision: false });
        }
      } else if (v.verdict === 'supported' && passage && !extractCitations(cl.text).length && extractNumbers(cl.text).some((n) => n.unit !== 'year') && style) {
        const label = (passage as any).pageLabel ?? (passage as any).pageIndex;
        const short = String((passage as any).sourceTitle ?? 'Source').split(/[:–—]/)[0].trim();
        const withCite = cl.text.replace(/([.!?])?$/, ` (${short}, p. ${label})$1`);
        out.push({ paragraphId: p.id, original: cl.text, start: cl.start, replacement: withCite, issue: 'citation_missing', reason: `This figure comes from ${passage.id} but carries no citation.`, rubricCriterionId: evCrit, evidence: [{ passageId: passage.id, relationship: 'supports_original' }], meaningChange: 'Adds a citation; check the author and page format required by the assignment.', requiresDecision: true });
      }
    });
    // clarity: sentence-level mechanical edits, outside locks and protected spans
    for (const s of splitSentences(p.text)) {
      if (overlapsLock(s.start, s.end)) continue;
      if (out.some((o) => o.paragraphId === p.id && o.start! < s.end && o.start! + o.original.length > s.start)) continue;
      const r = voiceEdit(s.text, profile, []);
      if (!r.noChange) {
        const rules = r.changes.map((c) => c.rule);
        out.push({ paragraphId: p.id, original: s.text, start: s.start, replacement: r.replacement, issue: rules.every((x) => x === 'em_dash') ? 'style' : 'stock_phrase', reason: r.changes.map((c) => c.effect).join(' '), rubricCriterionId: criterionFor(input.brief, /clarity|style|writing/i), evidence: [], meaningChange: '', requiresDecision: false });
      }
    }
  }
  return { proposals: out };
}

function criticBlind(input: any) {
  const passages: IndexedPassage[] = input.passages ?? [];
  const weaknesses: any[] = [];
  for (const p of input.paragraphs as Para[]) {
    const { verdicts } = verifyParagraph(p.text, passages, `${p.id}_b`);
    const order = ['contradicted', 'partial', 'insufficient'];
    const worst = verdicts.filter((v) => order.includes(v.verdict)).sort((a, b) => order.indexOf(a.verdict) - order.indexOf(b.verdict))[0];
    if (worst) {
      const kind = worst.verdict === 'contradicted' ? 'number_mismatch' : worst.verdict === 'partial' && causalMarker(worst.claim) ? 'unsupported_causality' : 'unsupported_claim';
      weaknesses.push({ paragraphId: p.id, kind, quote: worst.claim, note: worst.reasons.join(' '), passageId: worst.passageId });
    } else {
      const f = clarityFlags(p.text, input.profile ?? NEUTRAL_PROFILE)[0];
      if (f) weaknesses.push({ paragraphId: p.id, kind: 'style', quote: f.quote, note: f.effect, passageId: null });
    }
  }
  return { weaknesses };
}

function criticCheck(input: any) {
  const passages: IndexedPassage[] = input.passages ?? [];
  const verdicts = (input.candidates as any[]).map((c) => {
    const reasons: string[] = [];
    const m = compareMeaning(c.original, c.replacement);
    const declared = c.issue === 'number_mismatch' || c.issue === 'citation_missing';
    for (const f of m.material) if (!(declared && ['number_removed', 'number_introduced', 'unit_changed', 'citation_changed'].includes(f.category))) reasons.push(`Introduces: ${f.message}`);
    const { verdicts: vs } = verifyParagraph(c.replacement, passages, 'k');
    for (const v of vs) {
      if (v.verdict === 'contradicted') reasons.push(`The replacement claim "${v.claim}" is contradicted by ${v.passageId}.`);
      if (v.verdict === 'partial' && causalMarker(v.claim)) reasons.push(`The replacement still asserts causation: "${v.claim}".`);
    }
    return { index: c.index, verdict: reasons.length ? (reasons.some((r) => /contradicted|causation/.test(r)) ? 'reject' : 'revise') : 'accept', reasons };
  });
  return { verdicts };
}

function repair(input: any) {
  const out: RawProposal[] = [];
  for (const c of input.failed as any[]) {
    const ps: IndexedPassage[] = input.passages ?? [];
    const idx = new PassageIndex(ps);
    const claim = splitClaims(c.replacement, 'r').find((x) => causalMarker(x.text));
    if (!claim) continue;
    const hit = idx.search(claim.text, 1)[0]?.passage;
    const rew = hit ? associationRewrite(claim.text, hit.text, input.notes?.objection) : null;
    if (rew) out.push({ ...c.raw, replacement: c.replacement.replace(claim.text, rew), reason: `${c.raw.reason} (repaired after review)` });
  }
  return { proposals: out };
}

// --- idea, thesis, outline, draft ----------------------------------------------------------------
function thesisOptions(input: any) {
  const note: string = input.note ?? '';
  const passages: IndexedPassage[] = input.passages ?? [];
  const parts = note.split(/\b(?:but|however|although|though|yet)\b/i).map((s) => s.trim().replace(/^[,;\s]+|[,;\s]+$/g, ''));
  const claimRaw = parts[0].replace(/^I (?:think|believe|feel|guess) (?:that )?/i, '').replace(/[.!?]+$/, '');
  const objection = parts[1] ? parts.slice(1).join(' but ').replace(/[.!?]+$/, '') : null;
  const bec = /\bbecause\b(.+)$/i.exec(claimRaw);
  const claim = (claimRaw.replace(/\s*\bbecause\b.+$/i, '') || claimRaw).trim();
  const mechanism = bec ? bec[1].trim() : null;
  const idx = new PassageIndex(passages);
  const sup = idx.search(note, 3).filter((h) => h.coverage >= 0.2).map((h) => h.passage.id);
  const cue = passages.find((p) => /chose whether|self[- ]select|volunt|survey|observational|correlat|associated/i.test(p.text));
  const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
  const evidenceNeeded = objection ? [`Evidence that separates the effect of the claim from this alternative: ${objection}.`] : ['Evidence from a comparison that does not depend on who chose which group.'];
  const questions: string[] = [];
  if (!mechanism) questions.push('How would this work? Name the mechanism you have in mind.');
  if (!objection) questions.push('What is the strongest objection a skeptical reader would raise?');
  return {
    extraction: { claim: cap(claim), mechanism, objection, evidenceNeeded },
    questions: questions.slice(0, 2),
    options: [
      { id: 'opt_association', label: 'Association claim, with limits', thesis: `${cap(claim)}, but the evidence in the readings supports an association rather than a proven effect${objection ? ` because ${objection}` : ''}.`, summary: 'A narrower paper: argue what the data shows and be explicit about what it cannot show.', supportingPassageIds: sup, weakeningFact: 'Evidence that the gap disappears once prior differences between the groups are accounted for.' },
      { id: 'opt_mechanism', label: 'Mechanism claim, argued conditionally', thesis: `${cap(claim)}, and the strongest case for this is the mechanism${mechanism ? ` that ${mechanism}` : ''}; it holds only if ${objection ?? 'other explanations'} can be set aside.`, summary: 'A bolder paper: argue the effect and spend a section earning it against the strongest alternative.', supportingPassageIds: sup, weakeningFact: cue ? `${cue.id}: a comparison where participants chose their own group cannot separate the effect from who chose it.` : 'A study showing no effect where assignment was random.' },
    ],
  };
}

function outline(input: any) {
  const thesis: string = input.thesis ?? '';
  const passages: IndexedPassage[] = input.passages ?? [];
  const idx = new PassageIndex(passages);
  const ev = idx.search(thesis, 2).map((h) => h.passage.id);
  const objection = input.notes?.objection;
  return { items: [
    { id: 'o1', purpose: 'Introduce the question and state the thesis', claim: thesis, evidencePassageIds: [], openQuestions: [] },
    { id: 'o2', purpose: 'Present the strongest evidence from the readings', claim: 'The readings show a measurable difference that fits the thesis.', evidencePassageIds: ev, openQuestions: ['Which figure is the most important to quote exactly?'] },
    { id: 'o3', purpose: 'Address the strongest objection and say what the evidence cannot show', claim: objection ? `A skeptic would say: ${objection}.` : 'A skeptic would offer an alternative explanation.', evidencePassageIds: ev, openQuestions: ['What would settle this?'] },
    { id: 'o4', purpose: 'Conclude with what follows and what remains open', claim: 'State the narrowest conclusion the evidence supports.', evidencePassageIds: [], openQuestions: [] },
  ] };
}

function draftParagraph(input: any) {
  const item = input.item ?? {};
  const passages: IndexedPassage[] = input.passages ?? [];
  const cited = (item.evidencePassageIds as string[] ?? []).map((id) => passages.find((p) => p.id === id)).filter(Boolean) as (IndexedPassage & { pageLabel?: string; pageIndex?: number; sourceTitle?: string })[];
  const claim = String(item.claim ?? '').trim();
  const pieces = [claim && (/[.!?]$/.test(claim) ? claim : claim + '.')];
  for (const p of cited.slice(0, 2)) {
    const s = splitSentences(p.text).slice(0, 2).map((x) => x.text).join(' ');
    pieces.push(`${s} (${String(p.sourceTitle ?? 'Source').split(/[:–—]/)[0].trim()}, p. ${p.pageLabel ?? p.pageIndex ?? '?'})`);
  }
  return { text: pieces.filter(Boolean).join(' ') };
}

function evidenceVerifier(input: any) {
  const verdicts: any[] = [];
  for (const p of input.paragraphs as Para[]) {
    const r = verifyParagraph(p.text, input.passages ?? [], `${p.id}_c`);
    r.verdicts.forEach((v) => verdicts.push({ claimId: v.claimId, verdict: v.verdict, passageId: v.passageId, reasons: v.reasons }));
  }
  return { verdicts };
}

export class FixtureProvider implements Provider {
  id = FIXTURE_ID;
  vendor = 'fixture' as const;
  model = 'rules/1';
  paid = false;
  estimate() { return { inputTokens: 0, outputTokens: 0 }; }
  async call(role: Role, input: any, _ctl?: CallControl): Promise<CallResult> {
    const t0 = Date.now();
    let output: any;
    switch (role) {
      case 'argument_editor': output = argumentEditor(input); break;
      case 'critic_blind': output = criticBlind(input); break;
      case 'critic_check': output = criticCheck(input); break;
      case 'repair': output = repair(input); break;
      case 'thesis_options': output = thesisOptions(input); break;
      case 'outline': output = outline(input); break;
      case 'draft_paragraph': output = draftParagraph(input); break;
      case 'evidence_verifier': output = evidenceVerifier(input); break;
      case 'voice_editor': { const r = voiceEdit(input.text, input.profile ?? NEUTRAL_PROFILE, input.locks ?? []); output = { replacement: r.replacement, reason: r.reason }; break; }
      default: throw new Error(`unknown role ${role}`);
    }
    return { output, usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0 }, latencyMs: Date.now() - t0, provider: FIXTURE_ID, vendor: 'fixture', model: this.model, paid: false };
  }
}
void POLICY_VERSION; void tokenize; void findQuote;
