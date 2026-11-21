#!/usr/bin/env node
// Renders docs/EVALUATION.md from ../.studio-build/eval-report-v2.json (written by tests/unit/eval2.test.ts). No hand-typed numbers.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const r = JSON.parse(fs.readFileSync(path.join(root, '.studio-build/eval-report-v2.json'), 'utf8'));
const V = ['supported', 'partial', 'contradicted', 'insufficient', 'unreadable'];
const cols = [...V, 'claim_not_found'];
const matrix = (m) => ['| expected \\ said | ' + cols.join(' | ') + ' |', '|---|' + cols.map(() => '---:').join('|') + '|', ...V.map((e) => `| **${e}** | ${cols.map((p) => m.confusion[e][p]).join(' | ')} |`)].join('\n');
const label = { frozen22: 'frozen 22 (inspected in pass 1; rules were revised after seeing them)', dev15: 'dev 15 (pass 1 development set)', dev2: 'dev2 (new development documents; rules revised with these in view)', unseen: 'unseen (new documents written before the revision; run once)' };
const row = (name, m) => `| ${name} | ${m.claims} | ${m.sourceDocuments} | ${m.exact}/${m.claims} | ${m.genuinelyUnsupported} | **${m.unsafeApprovals.count}/${m.unsafeApprovals.outOf}** | ${m.wronglyFlaggedSupported.total}/${m.wronglyFlaggedSupported.outOf} (contradicted ${m.wronglyFlaggedSupported.calledContradicted}, partial ${m.wronglyFlaggedSupported.calledPartial}, abstained ${m.wronglyFlaggedSupported.abstained}) | ${m.unsupportedButWrongKind.count}/${m.unsupportedButWrongKind.outOf} | ${m.abstentions.total} (correct ${m.abstentions.correct}) |`;

let md = `# Evidence-checker measurement (generated; do not edit by hand)

Source: \`.studio-build/eval-report-v2.json\`, written by \`app/tests/unit/eval2.test.ts\`. Regenerate with \`cd app && npx vitest run tests/unit/eval2.test.ts && node scripts/render-eval-report.mjs\`.

${r.note}

**Definitions.** *Genuinely unsupported* = the label is anything other than \`supported\` (partial, contradicted or insufficient). *Unsafe approval* = a genuinely unsupported claim called \`supported\`; its denominator is the count of genuinely unsupported claims, never the total. *Wrongly flagged* = a supported claim called partial, contradicted or insufficient, reported separately from unsafe approvals. *Wrong kind* = genuinely unsupported but given a different non-supported label. *Abstention* = \`insufficient\` or \`unreadable\`.

## Headline table
| Split | Claims | Source docs | Exact | Genuinely unsupported | Unsafe approvals | Supported claims wrongly flagged | Unsupported, wrong kind | Abstentions |
|---|---:|---:|---:|---:|---:|---|---:|---:|
`;
for (const k of ['frozen22', 'unseen', 'dev2', 'dev15']) {
  md += row(`${k} baseline`, r.sets[k].baseline) + '\n' + row(`${k} revised`, r.sets[k].revised) + '\n';
}
md += `\nThe frozen 22 contain **${r.sets.frozen22.revised.genuinelyUnsupported} genuinely unsupported** claims. "Zero unsafe approvals" on them means 0 of ${r.sets.frozen22.revised.genuinelyUnsupported}, not 0 of 22. On the unseen split it is **${r.sets.unseen.revised.unsafeApprovals.count} of ${r.sets.unseen.revised.genuinelyUnsupported}**: ${r.sets.unseen.revised.unsafeApprovals.items.map((i) => '`' + i + '`').join(', ')}.\n`;
md += `\nAn optional live verifier on these same inputs: **not run** (no credentials in the build environment). The runner is \`app/scripts/eval-live-verifier.ts\`; it refuses to call anything without a key, a price and an authorized budget.\n`;

md += `\n## Named regressions from pass 1 (desired behaviour, current status)\n| Item | Desired | Baseline | Current rules | Now predicts | Why it matters |\n|---|---|---|---|---|---|\n`;
for (const n of r.namedRegressions) md += `| \`${n.id}\` | ${n.desired} | ${n.baselineStatus} | **${n.currentStatus}** | ${n.currentPrediction} | ${n.label} |\n`;

for (const k of ['frozen22', 'unseen']) {
  md += `\n## ${label[k]}\n\n### Baseline rules\n${matrix(r.sets[k].baseline)}\n\n### Revised rules\n${matrix(r.sets[k].revised)}\n`;
  md += `\nMisses under the revised rules (expected -> said):\n${r.sets[k].missesRevised.map((m) => `- \`${m.id}\` [${m.tag}]: ${m.expected} -> ${m.predicted}${m.reason ? ' (' + String(m.reason).slice(0, 110) + ')' : ''}`).join('\n') || '- none'}\n`;
}
md += `\n## What changed between baseline and revised
Revised rules add: clause-scoped negation and figures (so a negated comment about significance is not a negation of the gain), a damaged-figure guard for OCR digits, abstention when claim and passage are in different languages, a passage choice that prefers a sentence stating a direction, and a direction lexicon that knows "cooler/warmer" and ignores "or more" and quantifier "more". The baseline path is preserved so both run on identical inputs; the baseline shares the causal-marker module, so two bug fixes (negated random assignment; the adjective "lower") apply to both. Baseline reproduction of the frozen 22 predictions is exact (tested).

## Honest limits
- Small synthetic sets. The unseen split has ${r.sets.unseen.revised.sourceDocuments} documents and ${r.sets.unseen.revised.claims} claims; do not read these as accuracy for real coursework.
- After the first unseen run, one bug found by an unrelated fresh assignment (the adjective "lower" read as a causal verb) was fixed. It had been masking a role-swap weakness, which raised unseen unsafe approvals from 1/16 to 2/16. The unseen split is therefore not untouched in the strict sense; the number is reported as it stands.
- The rules were tuned on the frozen 22 and dev2, so their improvement on those sets is not evidence of generalisation. The unseen result is the fairer one: exact ${r.sets.unseen.baseline.exact} -> ${r.sets.unseen.revised.exact} of ${r.sets.unseen.revised.claims}, unsafe approvals unchanged.
`;
fs.writeFileSync(path.join(root, 'docs/EVALUATION.md'), md);
console.log('wrote docs/EVALUATION.md');
