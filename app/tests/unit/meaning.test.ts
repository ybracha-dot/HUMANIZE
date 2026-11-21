import { describe, expect, it } from 'vitest';
import { compareMeaning } from '../../shared/meaning.ts';
import { auditUnicode, cleanUnicode } from '../../shared/unicode.ts';
import { findQuote, normalizeWithMap } from '../../shared/text.ts';

const cats = (a: string, b: string) => compareMeaning(a, b).findings.map((f) => f.category);

describe('meaning preservation fixtures (brief section 10)', () => {
  it('margin 42% to 48% rewritten as "up 6%" flags the unit and states both readings', () => {
    const r = compareMeaning('Margin rose from 42% to 48%.', 'Margin was up 6%.');
    const f = r.findings.find((x) => x.category === 'unit_changed')!;
    expect(f).toBeTruthy();
    expect(f.message).toContain('6 percentage points');
    expect(f.message).toContain('14.3%');
    expect(f.message).toMatch(/do not assume/i);
    expect(r.outcome).toBe('decision_required');
  });
  it('"did not show a statistically significant increase" -> "no increase" changes the inference', () => {
    const r = compareMeaning('The sample did not show a statistically significant increase.', 'There was no increase.');
    expect(r.findings.some((f) => f.category === 'qualification_dropped' && /statistically significant/.test(f.original))).toBe(true);
    expect(r.outcome).toBe('decision_required');
  });
  it('projection presented as realized loses attribution, hedge and horizon', () => {
    const c = cats('The filing projects savings after rollout.', 'The program realized savings.');
    expect(c).toContain('attribution_dropped');
    expect(c).toContain('hedge_dropped');
    expect(c).toContain('condition_dropped');
  });
  it('the management/$3M bad rewrite loses attribution, approximation, expectation, condition and period', () => {
    const o = 'Management expects the program to save about $3 million annually after full rollout.';
    const c = cats(o, 'The program saves $3 million a year.');
    expect(c).toEqual(expect.arrayContaining(['attribution_dropped', 'hedge_dropped', 'condition_dropped']));
  });
  it('the faithful alternative passes with no material finding', () => {
    const o = 'Management expects the program to save about $3 million annually after full rollout.';
    const r = compareMeaning(o, 'Management expects annual savings of about $3 million once the program is fully in place.');
    expect(r.material).toEqual([]);
    expect(r.outcome).toBe('acceptable');
  });
  it('introduced causation is flagged, association is not', () => {
    expect(cats('Attendance and scores were higher together.', 'Attendance raised scores.')).toContain('causal_introduced');
    expect(cats('The policy raised attendance.', 'Attendance rose after the policy began.')).not.toContain('causal_introduced');
  });
  it('a changed quotation fails verification outright', () => {
    const r = compareMeaning('Miller calls it "a quiet revolution" (Miller 10).', 'Miller calls it a quiet change (Miller 10).');
    expect(r.outcome).toBe('failed');
  });
  it('a dropped citation is material', () => {
    expect(cats('Rates fell (Smith 2020).', 'Rates fell.')).toContain('citation_changed');
  });
  it('numbers written identically with different formatting are the same number', () => {
    expect(cats('Revenue reached 1,200 units.', 'Revenue reached 1200 units.')).toEqual([]);
  });
  it('a pure style edit with nothing lost is acceptable', () => {
    expect(compareMeaning('Moreover, the results were good.', 'The results were good.').outcome).toBe('acceptable');
  });
  it('accents, Hebrew and emoji joiners survive; losing them is flagged', () => {
    const o = 'La educación importa. שלום 👩‍💻 “ok”';
    expect(compareMeaning(o, 'La educación importa. שלום 👩‍💻 "ok"').material).toEqual([]);
    expect(cats(o, 'La educacion importa. שלום 👩‍💻 "ok"')).toContain('character_lost');
    expect(cats(o, 'La educación importa. שלום 👩💻 "ok"')).toContain('character_lost');
  });
});

describe('unicode hygiene is contextual', () => {
  it('removes zero-width space and word joiner, keeps ZWJ emoji and Hebrew marks', () => {
    const t = 'He​llo wo⁠rld 👩‍💻 ‏שלום‏';
    const r = cleanUnicode(t);
    expect(r.text).toBe('Hello world 👩‍💻 ‏שלום‏');
    expect(r.removed.map((h) => h.hex).sort()).toEqual(['U+200B', 'U+2060']);
  });
  it('keeps Persian ZWNJ between letters and removes a stray one', () => {
    expect(cleanUnicode('می‌خواهم').removed).toHaveLength(0);
    expect(cleanUnicode('plain‌text').removed).toHaveLength(1);
  });
  it('flags tag characters outside flags and bidi overrides', () => {
    const hits = auditUnicode('a\u{E0041}b‮c');
    expect(hits.every((h) => h.verdict === 'remove')).toBe(true);
    expect(hits).toHaveLength(2);
  });
  it('keeps NBSP', () => {
    expect(cleanUnicode('10 %').text).toBe('10 %');
  });
});

describe('normalized quote matching maps back to original typography', () => {
  it('finds a quote across line breaks, NBSP and curly quotes', () => {
    const page = 'Students said “it was\n   a quiet revolution” in 2019.';
    const hit = findQuote(page, '"it was a quiet revolution"')!;
    expect(page.slice(hit.start, hit.end)).toBe('“it was\n   a quiet revolution”');
  });
  it('joins hyphenated line breaks', () => {
    expect(normalizeWithMap('attend-\nance rose').norm).toBe('attendance rose');
  });
});
