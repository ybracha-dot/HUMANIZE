// Build-time processing of the upstream StoryScope taxonomy plus the paper's core comparisons into shared/storyscope-manifest.json.
// Deterministic: same inputs, same bytes. No timestamps. Any inconsistency between the sidecar, the taxonomy and the paper's printed
// Table 16 is a hard error, never silently corrected.
// Usage: npx tsx scripts/build-taxonomy-manifest.ts [--out path]
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { CHECK_TAXONOMY_LINKS } from '../shared/storyscope-links.ts';

const arg = (k: string) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const U = (f: string) => path.resolve('fixtures/upstream', f);
const sha = (f: string) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const fail = (m: string): never => {
  console.error('manifest build FAILED: ' + m);
  process.exit(1);
};

const taxFile = U('storyscope-taxonomy.json');
const tax = JSON.parse(fs.readFileSync(taxFile, 'utf8'));
const side = JSON.parse(fs.readFileSync(U('storyscope-core-comparisons.json'), 'utf8'));
const tables = JSON.parse(fs.readFileSync(U('storyscope-paper-tables.json'), 'utf8'));
const pdfSha = sha(U('StoryScope-v6.pdf'));
const taxSha = sha(taxFile);

if (side.paperSHA256 !== pdfSha || tables.paperSHA256 !== pdfSha) fail('paper SHA-256 differs between the PDF, the sidecar and the extracted tables');
if (side.taxonomySHA256 !== taxSha) fail('taxonomy SHA-256 differs from the sidecar');

const features = new Map<string, any>();
for (const [dimKey, dim] of Object.entries<any>(tax.feature_taxonomy))
  for (const [aspectKey, aspect] of Object.entries<any>(dim.aspects))
    for (const f of aspect.features) {
      if (features.has(f.id)) fail(`duplicate taxonomy id ${f.id}`);
      features.set(f.id, { ...f, dimKey, aspectKey });
    }
if (features.size !== tax.taxonomy_metadata.total_features) fail('taxonomy id count differs from its metadata');

const ENC: Record<string, string> = { mean_scale: 'scale_mean', mean_ordinal_code: 'ordinal_code_mean', percent: 'prevalence_percent' };
const MEANING: Record<string, string> = {
  scale_mean: 'Mean of a 1-5 Likert rating across stories (a number on a scale, not a share of stories).',
  ordinal_code_mean: 'Mean of integer codes of an ordinal answer across stories (a number on a coded scale, not a share of stories).',
  prevalence_percent: 'Percentage of stories whose answer includes this option (a share of stories, not a rating).',
};
const UNIT: Record<string, string> = { scale_mean: 'scale points', ordinal_code_mean: 'ordinal-code points', prevalence_percent: 'percentage points' };

const used = new Set<number>();
const evidenceById = new Map<string, any[]>();
const comps: any[] = side.comparisons;
for (const c of comps) {
  const f = features.get(c.featureId) ?? fail(`sidecar feature ${c.featureId} is not in the taxonomy`);
  if (c.answerOption != null && !(f.values ?? []).includes(c.answerOption))
    fail(`${c.featureId}: answer option "${c.answerOption}" is not among the taxonomy values`);
  if (c.answerOption == null && c.unit === 'percent') fail(`${c.featureId}: a percentage needs an answer option`);
  if (c.answerOption != null && c.unit !== 'percent') fail(`${c.featureId}: an answer option implies a prevalence percentage`);
  const enc = ENC[c.unit] ?? fail(`unknown unit ${c.unit}`);
  const hit = tables.table16
    .map((r: any, i: number) => ({ r, i }))
    .filter(({ r, i }: any) => !used.has(i) && r.encoding === enc && r.human === c.humanValue && r.model === c.modelAverageValue);
  if (hit.length !== 1)
    fail(`${c.featureId} (table ${c.sourceTable} row ${c.tableRow}): expected exactly one matching printed Table 16 row, found ${hit.length}`);
  const { r, i } = hit[0];
  used.add(i);
  const expectedHigher = c.sourceTable === 14 ? 'model_average' : 'human_sample';
  if (c.higherIn !== expectedHigher) fail(`${c.featureId}: higherIn ${c.higherIn} contradicts table ${c.sourceTable}`);
  if (r.gap < 0 !== (c.higherIn === 'model_average')) fail(`${c.featureId}: printed gap sign (${r.gapPrinted}) contradicts higherIn ${c.higherIn}`);
  const loc = tables.locators[`table${c.sourceTable}`];
  const vloc = tables.locators.table16;
  if (loc.printedPage !== c.printedPage || vloc.printedPage !== c.valuesPrintedPage) fail(`${c.featureId}: sidecar page numbers disagree with the PDF`);
  const ev = {
    table: c.sourceTable,
    tableRow: c.tableRow,
    printedPage: c.printedPage,
    pdfPage: loc.pdfPage,
    valuesTable: c.valuesTable,
    valuesPrintedPage: c.valuesPrintedPage,
    valuesPdfPage: vloc.pdfPage,
    comparison: 'human_sample_vs_model_average',
    population: 'Human-authored story sample versus the average over five LLMs (the paper\'s Table 16 caption: "AI column averages across all five models").',
    domain: c.domain,
    answerOption: c.answerOption,
    encoding: enc,
    valueMeaning: MEANING[enc],
    higherIn: c.higherIn,
    human: { value: c.humanValue, printed: r.humanPrinted },
    modelAverage: { value: c.modelAverageValue, printed: r.aiPrinted },
    reportedGap: {
      value: r.gap,
      printed: r.gapPrinted,
      unit: UNIT[enc],
      definition: 'Human minus AI as printed in Table 16 (rounded by the authors); negative means model-elevated. Quote this, not a recomputed difference.',
    },
    paperLabel: r.label,
    theme: r.theme,
  };
  if (!evidenceById.has(c.featureId)) evidenceById.set(c.featureId, []);
  evidenceById.get(c.featureId)!.push(ev);
}
if (used.size !== tables.table16.length) fail(`${tables.table16.length - used.size} printed Table 16 row(s) were not matched by any sidecar comparison`);
const model = comps.filter((c) => c.higherIn === 'model_average').length;
const human = comps.filter((c) => c.higherIn === 'human_sample').length;
if (comps.length !== 33 || model !== 20 || human !== 13 || evidenceById.size !== 30 || side.distinctFeatures !== 30)
  fail(
    `core counts differ from the paper (33 rows / 20 model-elevated / 13 human-elevated / 30 distinct); got ${comps.length}/${model}/${human}/${evidenceById.size}`,
  );
const overlap = [...evidenceById.entries()]
  .filter(([, e]) => new Set(e.map((x) => x.higherIn)).size > 1)
  .map(([id]) => id)
  .sort();

const OMIT: Record<string, string> = {
  agents: 'Describes who the characters are and how they relate; that is a story choice, not a clarity problem a deterministic check can judge.',
  social_networks: 'Describes the social structure of the story world; a content choice with no mechanical editorial check.',
  setting: 'Describes where and when the story is set; a content choice. Only the writer can say what the setting should be.',
  events: 'Describes what happens and in what pattern; changing it changes the story, so it is left to the writer.',
  temporal_structure: 'Describes how time is ordered and paced; structural intent cannot be judged from surface text without model interpretation.',
  revelation: 'Describes information disclosure (suspense, twists); requires reading intent across the whole story, not derivable deterministically.',
  perspective: 'Describes narration and point of view; a deliberate voice choice that the writer, not a checker, should make.',
  situatedness: 'Describes genre and literary positioning; no mechanical editorial check.',
  plot: 'Describes themes, conflict and arc; a content choice. Only moral-explicitness is checked (see links).',
  style: 'A rating of prose texture that needs interpretation; personal style preferences are handled by the voice profile instead.',
};
const links = CHECK_TAXONOMY_LINKS;
const summary = (ev: any[]) =>
  new Set(ev.map((e) => e.higherIn)).size > 1 ? 'differs_by_answer_option' : ev[0].higherIn === 'model_average' ? 'model_elevated' : 'human_elevated';

const entries: any[] = [];
for (const f of features.values()) {
  const check = Object.entries(links).find(([, ids]) => ids.includes(f.id))?.[0] ?? null;
  const ev = evidenceById.get(f.id) ?? [];
  entries.push({
    id: f.id,
    path: `feature_taxonomy.${f.dimKey}.aspects.${f.aspectKey}.features[id=${f.id}]`,
    dimension: f.dimKey,
    aspect: f.aspectKey,
    name: f.name,
    type: f.type,
    measuredIn:
      'short fiction: ~5,000-word stories, human anthology stories vs five LLMs (paper and upstream README). Not validated for academic arguments, memos or other languages.',
    directionStatus: ev.length ? 'reported_in_core_tables' : 'unknown',
    directionSummary: ev.length ? summary(ev) : null,
    evidence: ev,
    ...(ev.length
      ? {}
      : {
          directionNote:
            'Not among the 30 core features of Tables 14-16. Other analyses in the paper (e.g. the per-source fingerprints of Table 17) were not extracted, so absence here does not establish absence from the paper.',
        }),
    editorialUse: check ? { kind: 'check', checkId: check } : { kind: 'omitted', reason: OMIT[f.dimKey] },
  });
}
const manifest = {
  generatedFrom: {
    repo: 'https://github.com/jenna-russell/storyscope',
    commit: 'b82d93534ab25dbf20dfe902c21e77d0b0602ca1',
    license: 'MIT',
    file: 'data/taxonomy.json',
    taxonomySHA256: taxSha,
    totalFeatures: tax.taxonomy_metadata.total_features,
  },
  paper: {
    title: 'StoryScope',
    arxiv: 'arXiv:2604.03136v6',
    venue: 'COLM 2026',
    authors: 'Russell, Rajendhran, Pham, Iyyer, Wieting',
    pdfSHA256: pdfSha,
    license: 'CC0 1.0, as stated in the handoff for this paper (not printed in the PDF text itself)',
    locators: tables.locators,
    tablesRead: tables.caption,
  },
  coreEvidence: {
    scope: side.scope,
    comparisons: comps.length,
    modelElevated: model,
    humanElevated: human,
    distinctFeatures: evidenceById.size,
    overlapFeatureIds: overlap,
    featuresWithoutCoreEvidence: features.size - evidenceById.size,
    caution:
      'A feature outside the core mapping may have evidence in other analyses; absence here does not mean the paper is silent. Directions describe a human sample versus an LLM average on short fiction; they say nothing about any single text, other genres, or other languages.',
  },
  separateAnalyses: {
    table17: {
      ...tables.locators.table17,
      note: 'Per-source fingerprint features (SHAP importance, uniqueness) are model-specific. They are not mapped to taxonomy ids and are never merged with the core human-vs-average comparisons.',
    },
  },
  readme: {
    stories: 61608,
    prompts: 10272,
    features: 304,
    humanVsAiMacroF1: 0.932,
    sixWayMacroF1: 0.684,
    note: 'Task results reported by the upstream README for its own corpus and classifier; they are not a property of any single text.',
  },
  features: entries,
};
const out = arg('--out') ?? path.resolve('shared/storyscope-manifest.json');
fs.writeFileSync(out, JSON.stringify(manifest, null, 1) + '\n');
console.log(
  `manifest: ${entries.length} features; core evidence ${comps.length} comparisons (${model} model-elevated, ${human} human-elevated) over ${evidenceById.size} features; overlap ${overlap.join(', ')}; ${entries.filter((e) => e.editorialUse.kind === 'check').length} linked to checks`,
);
