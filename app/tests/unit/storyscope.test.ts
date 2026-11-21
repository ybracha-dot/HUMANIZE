import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import manifest from '../../shared/storyscope-manifest.json';
import { NARRATIVE_CHECKS, checkNarrative } from '../../shared/storyscope.ts';
import { textToParas } from './util';

const tax = JSON.parse(fs.readFileSync('fixtures/upstream/storyscope-taxonomy.json', 'utf8'));
const ids: string[] = [];
for (const d of Object.values<any>(tax.feature_taxonomy)) for (const a of Object.values<any>(d.aspects)) for (const f of a.features) ids.push(f.id);

describe('StoryScope manifest covers the actual upstream taxonomy', () => {
  it('has exactly one entry per published feature, matching the taxonomy metadata', () => {
    expect(ids.length).toBe(tax.taxonomy_metadata.total_features);
    expect(new Set(ids).size).toBe(ids.length);
    expect(manifest.features.map((f) => f.id).sort()).toEqual([...ids].sort());
  });
  it('every entry has identifier/path, dimension, measured genre, direction status and an editorial use or omission reason', () => {
    for (const f of manifest.features) {
      expect(f.path).toContain(f.id);
      expect(Object.keys(tax.feature_taxonomy)).toContain(f.dimension);
      expect(f.measuredIn).toMatch(/fiction/);
      expect(f.directionReported).toBe('unknown'); // the paper was not readable here; nothing is claimed
      expect(f.editorialUse.kind === 'check' ? !!f.editorialUse.checkId : f.editorialUse.reason!.length > 20).toBe(true);
    }
  });
  it('dimension counts match the upstream metadata and every linked check exists', () => {
    for (const [dim, n] of Object.entries<number>(tax.taxonomy_metadata.dimension_coverage)) expect(manifest.features.filter((f) => f.dimension === dim).length).toBe(n);
    const checkIds = new Set(NARRATIVE_CHECKS.map((c) => c.id));
    for (const f of manifest.features) if (f.editorialUse.kind === 'check') expect(checkIds.has(f.editorialUse.checkId!)).toBe(true);
    for (const c of NARRATIVE_CHECKS.filter((c) => c.taxonomyIds.length)) for (const id of c.taxonomyIds) expect(ids).toContain(id);
  });
});

describe('each narrative check speaks where it should and stays silent where the wording should stay', () => {
  for (const c of NARRATIVE_CHECKS) {
    it(c.id, () => {
      for (const t of c.flag) expect(c.detect(textToParas(t)).length, 'should flag: ' + t).toBeGreaterThan(0);
      for (const t of c.keep) expect(c.detect(textToParas(t)).length, 'should keep: ' + t).toBe(0);
    });
  }
  it('is not applied to academic arguments', () => {
    expect(checkNarrative(textToParas('Attendance raised scores.'), 'academic_argument').applicable).toBe(false);
  });
});
