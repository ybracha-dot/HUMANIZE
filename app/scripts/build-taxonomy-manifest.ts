// Build-time processing of the upstream StoryScope taxonomy into shared/storyscope-manifest.json.
// Usage: npx tsx scripts/build-taxonomy-manifest.ts [path/to/taxonomy.json]
import fs from 'node:fs';
import path from 'node:path';
import { CHECK_TAXONOMY_LINKS } from '../shared/storyscope-links.ts';

const src = process.argv[2] ?? path.resolve('fixtures/upstream/storyscope-taxonomy.json');
const tax = JSON.parse(fs.readFileSync(src, 'utf8'));

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
const entries: any[] = [];
for (const [dimKey, dim] of Object.entries<any>(tax.feature_taxonomy)) {
  for (const [aspectKey, aspect] of Object.entries<any>(dim.aspects)) {
    for (const f of aspect.features) {
      const check = Object.entries(links).find(([, ids]) => ids.includes(f.id))?.[0] ?? null;
      entries.push({
        id: f.id,
        path: `feature_taxonomy.${dimKey}.aspects.${aspectKey}.features[id=${f.id}]`,
        dimension: dimKey,
        aspect: aspectKey,
        name: f.name,
        type: f.type,
        measuredIn:
          'long-form fiction: ~5,000-word stories, human anthology stories vs five LLMs (upstream README). Not validated for academic arguments, memos or other languages.',
        directionReported: 'unknown',
        directionNote:
          'The paper was not readable in this build environment (arxiv.org not reachable). Upstream README reports only corpus-level results, so no per-feature direction is claimed.',
        editorialUse: check ? { kind: 'check', checkId: check } : { kind: 'omitted', reason: OMIT[dimKey] },
      });
    }
  }
}
const manifest = {
  generatedFrom: {
    repo: 'https://github.com/jenna-russell/storyscope',
    commit: 'b82d93534ab25dbf20dfe902c21e77d0b0602ca1',
    license: 'MIT',
    file: 'data/taxonomy.json',
    totalFeatures: tax.taxonomy_metadata.total_features,
  },
  readme: {
    stories: 61608,
    prompts: 10272,
    features: 304,
    humanVsAiMacroF1: 0.932,
    sixWayMacroF1: 0.684,
    note: 'Numbers are the task results reported by the upstream README for its own corpus and classifier; they are not a property of any single text.',
  },
  features: entries,
};
fs.writeFileSync(path.resolve('shared/storyscope-manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
console.log(
  `manifest: ${entries.length} features, ${entries.filter((e) => e.editorialUse.kind === 'check').length} linked to checks, ${entries.filter((e) => e.editorialUse.kind === 'omitted').length} omitted with a reason`,
);
