import { describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import manifest from '../../shared/storyscope-manifest.json';
import { NARRATIVE_CHECKS, checkNarrative } from '../../shared/storyscope.ts';
import { CHECK_TAXONOMY_LINKS } from '../../shared/storyscope-links.ts';
import { textToParas } from './util';

const U = (f: string) => path.resolve('fixtures/upstream', f);
const tax = JSON.parse(fs.readFileSync(U('storyscope-taxonomy.json'), 'utf8'));
const side = JSON.parse(fs.readFileSync(U('storyscope-core-comparisons.json'), 'utf8'));
const tables = JSON.parse(fs.readFileSync(U('storyscope-paper-tables.json'), 'utf8'));
const sha = (f: string) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const feats = new Map<string, any>();
for (const d of Object.values<any>(tax.feature_taxonomy)) for (const a of Object.values<any>(d.aspects)) for (const f of a.features) feats.set(f.id, f);
const F = manifest.features as any[];
const byId = new Map(F.map((f) => [f.id, f]));
const evidence = F.flatMap((f) => f.evidence.map((e: any) => ({ id: f.id, ...e })));

describe('inputs are the files the handoff names', () => {
  it('paper, taxonomy and licence hashes match the handoff', () => {
    expect(sha(U('StoryScope-v6.pdf'))).toBe('929fd1add912dc030ed280451ab4f9a70378e2ded5d255aadad8012521c0643a');
    expect(sha(U('storyscope-taxonomy.json'))).toBe('e7302f37e437928a16149e0c4bba2432d7f148cf65bf5d16772ac65e97265d5e');
    expect(side.paperSHA256).toBe(sha(U('StoryScope-v6.pdf')));
    expect(side.taxonomySHA256).toBe(sha(U('storyscope-taxonomy.json')));
  });
});

describe('ID coverage', () => {
  it('304 unique taxonomy ids, one manifest entry each, every sidecar id exists', () => {
    expect(feats.size).toBe(304);
    expect(F.map((f) => f.id).sort()).toEqual([...feats.keys()].sort());
    for (const c of side.comparisons) expect(feats.has(c.featureId), c.featureId).toBe(true);
  });
  it('30 distinct core features carry evidence; the other 274 stay unknown with an honest note', () => {
    const withEv = F.filter((f) => f.evidence.length);
    expect(withEv).toHaveLength(30);
    const unknown = F.filter((f) => !f.evidence.length);
    expect(unknown).toHaveLength(274);
    for (const f of unknown) {
      expect(f.directionStatus).toBe('unknown');
      expect(f.directionSummary).toBeNull();
      expect(f.directionNote).toMatch(/absence here does not establish absence/);
    }
    expect(manifest.coreEvidence.featuresWithoutCoreEvidence).toBe(274);
  });
  it('33 comparisons: 20 model-elevated (Table 14) and 13 human-elevated (Table 15)', () => {
    expect(evidence).toHaveLength(33);
    expect(evidence.filter((e) => e.higherIn === 'model_average' && e.table === 14)).toHaveLength(20);
    expect(evidence.filter((e) => e.higherIn === 'human_sample' && e.table === 15)).toHaveLength(13);
    expect(evidence.filter((e) => (e.higherIn === 'model_average') !== (e.table === 14))).toEqual([]);
  });
});

describe('answer-option validity and encoding', () => {
  it('every option is an exact taxonomy value; only percentages carry options; options are never normalised', () => {
    for (const e of evidence) {
      if (e.answerOption === null) {
        expect(e.encoding).not.toBe('prevalence_percent');
        continue;
      }
      expect(feats.get(e.id).values, `${e.id}: ${e.answerOption}`).toContain(e.answerOption);
      expect(e.encoding).toBe('prevalence_percent');
    }
  });
  it('keeps "a number on a scale" distinct from "a percentage of stories with a response"', () => {
    const kinds = new Set(evidence.map((e) => e.encoding));
    expect([...kinds].sort()).toEqual(['ordinal_code_mean', 'prevalence_percent', 'scale_mean']);
    for (const e of evidence) {
      if (e.encoding === 'prevalence_percent') {
        expect(e.human.printed).toMatch(/%$/);
        expect(e.reportedGap.unit).toBe('percentage points');
        expect(e.valueMeaning).toMatch(/share of stories/);
      } else {
        expect(e.human.printed).not.toMatch(/%/);
        expect(e.valueMeaning).toMatch(/not a share of stories/);
      }
    }
    expect(evidence.filter((e) => e.encoding === 'prevalence_percent')).toHaveLength(14);
    expect(evidence.filter((e) => e.encoding === 'scale_mean')).toHaveLength(14);
    expect(evidence.filter((e) => e.encoding === 'ordinal_code_mean')).toHaveLength(5);
  });
  it("preserves the paper's rounded values and quotes the printed gap, not a recomputed one", () => {
    const e = evidence.find((x) => x.id === 'SIT_MET_303')!;
    expect(e.human).toEqual({ value: 3.28, printed: '3.28' });
    expect(e.modelAverage).toEqual({ value: 3.94, printed: '3.94' });
    expect(e.reportedGap.printed).toBe('−0.65'); // 3.28 - 3.94 would be -0.66; the authors print -0.65
    expect(e.reportedGap.value).toBe(-0.65);
    const emo = evidence.find((x) => x.id === 'AGENT_EMO_009' && x.higherIn === 'model_average')!;
    expect(emo.answerOption).toBe('embodied_sensations_and_metaphors');
    expect(emo.reportedGap.printed).toBe('−42'); // 38% vs 81% is a 43-point difference; the printed gap is -42
  });
});

describe('overlap', () => {
  it('exactly three features appear in both directions, each by a different answer option', () => {
    expect(manifest.coreEvidence.overlapFeatureIds).toEqual(['AGENT_EMO_009', 'PLT_THM_009', 'SIT_MET_008']);
    for (const id of manifest.coreEvidence.overlapFeatureIds) {
      const f = byId.get(id);
      expect(f.directionSummary).toBe('differs_by_answer_option');
      expect(f.evidence).toHaveLength(2);
      expect(new Set(f.evidence.map((e: any) => e.higherIn)).size).toBe(2);
      expect(new Set(f.evidence.map((e: any) => e.answerOption)).size).toBe(2);
    }
    expect(F.filter((f) => f.directionSummary === 'differs_by_answer_option')).toHaveLength(3);
    // a second direction never overwrites the first
    expect(byId.get('AGENT_EMO_009').evidence.map((e: any) => `${e.table}:${e.answerOption}`)).toEqual([
      '14:embodied_sensations_and_metaphors',
      '15:explicit_emotion_labels',
    ]);
  });
});

describe('locators', () => {
  it("every comparison names table, row, printed and PDF page; they agree with the paper's own captions", () => {
    for (const e of evidence) {
      expect([14, 15]).toContain(e.table);
      expect(e.tableRow).toBeGreaterThan(0);
      expect(e.printedPage).toBe(e.table === 14 ? 24 : 25);
      expect(e.pdfPage).toBe(e.printedPage);
      expect(e.valuesTable).toBe(16);
      expect(e.valuesPrintedPage).toBe(26);
      expect(e.valuesPdfPage).toBe(26);
      expect(e.domain).toBe('short fiction');
      expect(e.comparison).toBe('human_sample_vs_model_average');
      expect(e.population).toMatch(/average over five LLMs/);
    }
    for (const t of [14, 15]) expect(Math.max(...evidence.filter((e) => e.table === t).map((e) => e.tableRow))).toBe(t === 14 ? 20 : 13);
    expect(tables.locators.table14).toEqual({ pdfPage: 24, printedPage: 24 });
    expect(tables.locators.table16).toEqual({ pdfPage: 26, printedPage: 26 });
  });
  it('Table 17 per-source fingerprints are kept separate and not mapped to ids', () => {
    expect(manifest.separateAnalyses.table17.printedPage).toBe(27);
    expect(manifest.separateAnalyses.table17.note).toMatch(/never merged/);
    expect(JSON.stringify(F)).not.toMatch(/SHAP|uniqueness ratio/); // fingerprint data is not merged into per-feature evidence
  });
});

describe('the builder is deterministic and verifies against the paper', () => {
  it('running it twice yields byte-identical, logically identical output equal to the committed manifest', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-'));
    const run = (n: string) => {
      const o = path.join(dir, n);
      execFileSync('npx', ['tsx', 'scripts/build-taxonomy-manifest.ts', '--out', o], { stdio: 'pipe' });
      return fs.readFileSync(o, 'utf8');
    };
    const a = run('a.json');
    const b = run('b.json');
    expect(a).toBe(b);
    expect(JSON.parse(a)).toEqual(JSON.parse(b));
    expect(JSON.parse(a)).toEqual(manifest);
    expect(a).not.toMatch(/generated\W*:\W*"\d{4}-/); // no timestamps
  }, 60000);
  const havePdftotext = spawnSync('pdftotext', ['-v']).status !== null && !spawnSync('pdftotext', ['-v']).error;
  (havePdftotext ? it : it.skip)('re-reading the vendored PDF reproduces the committed table extraction (needs poppler pdftotext)', () => {
    const o = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ss-')), 't.json');
    execFileSync('node', ['scripts/extract-storyscope-paper.mjs', '--out', o], { stdio: 'pipe' });
    expect(JSON.parse(fs.readFileSync(o, 'utf8'))).toEqual(tables);
    expect(tables.table16).toHaveLength(33);
  });
  it('a corrupted sidecar is rejected, not repaired', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-bad-'));
    fs.cpSync('fixtures', path.join(tmp, 'fixtures'), { recursive: true });
    fs.cpSync('shared', path.join(tmp, 'shared'), { recursive: true });
    const sc = path.join(tmp, 'fixtures/upstream/storyscope-core-comparisons.json');
    const j = JSON.parse(fs.readFileSync(sc, 'utf8'));
    j.comparisons[1].answerOption = 'not_a_real_option';
    fs.writeFileSync(sc, JSON.stringify(j));
    const r = spawnSync(path.resolve('node_modules/.bin/tsx'), [path.resolve('scripts/build-taxonomy-manifest.ts'), '--out', path.join(tmp, 'o.json')], {
      cwd: tmp,
      encoding: 'utf8',
    });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/not among the taxonomy values/);
  }, 60000);
});

describe('narrative guidance stays scoped to fiction and honest about the evidence', () => {
  it('every taxonomy-linked check applies to fiction only; personal narrative gets none of it', () => {
    for (const c of NARRATIVE_CHECKS.filter((c) => c.taxonomyIds.length)) expect(c.genres).toEqual(['fiction']);
    const r = checkNarrative(textToParas('I felt nervous. Then I was proud.'), 'personal_narrative');
    expect(r.applicable).toBe(false);
    expect(r.note).toMatch(/scoped to fiction/);
    expect(checkNarrative(textToParas('I felt nervous. Then I was proud.'), 'fiction').applicable).toBe(true);
  });
  it("linked ids exist; links match the manifest; evidence notes quote the paper's actual numbers", () => {
    for (const [check, ids] of Object.entries(CHECK_TAXONOMY_LINKS))
      for (const id of ids) {
        expect(feats.has(id)).toBe(true);
        expect((byId.get(id).editorialUse as any).checkId).toBe(check);
      }
    const note = (id: string) => NARRATIVE_CHECKS.find((c) => c.id === id)!.evidenceNote!;
    const emo = evidence.find((e) => e.id === 'AGENT_EMO_009' && e.answerOption === 'explicit_emotion_labels')!;
    expect(emo.higherIn).toBe('human_sample');
    expect(note('named_emotion')).toContain(`${emo.human.value}% vs ${emo.modelAverage.value}%`);
    expect(note('named_emotion')).toMatch(/not a claim that labelling reads as machine-written/);
    const mor = evidence.find((e) => e.id === 'SIT_MET_303')!;
    expect(note('moral_restates_action')).toContain(`${mor.human.value} vs ${mor.modelAverage.value}`);
    expect(note('moral_restates_action')).toContain(mor.reportedGap.printed.replace('−', '-'));
    const nar = evidence.find((e) => e.id === 'SIT_MET_501')!;
    expect(note('narrator_verdict')).toContain(`${nar.human.value}% of human-sample stories vs ${nar.modelAverage.value}%`);
  });
  it('each narrative check speaks where it should and stays silent where the wording should stay', () => {
    for (const c of NARRATIVE_CHECKS) {
      for (const t of c.flag) expect(c.detect(textToParas(t)).length, `${c.id} should flag: ${t}`).toBeGreaterThan(0);
      for (const t of c.keep) expect(c.detect(textToParas(t)).length, `${c.id} should keep: ${t}`).toBe(0);
    }
  });
  it('overall manifest counts and omission reasons', () => {
    expect(F).toHaveLength(304);
    for (const f of F) expect(f.editorialUse.kind === 'check' ? !!f.editorialUse.checkId : f.editorialUse.reason.length > 20).toBe(true);
    for (const f of F) expect(f.measuredIn).toMatch(/short fiction/);
  });
});
