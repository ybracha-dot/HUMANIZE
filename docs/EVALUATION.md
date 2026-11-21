# Evidence-checker measurement (generated; do not edit by hand)

Source: `.studio-build/eval-report-v2.json`, written by `app/tests/unit/eval2.test.ts`. Regenerate with `cd app && npx vitest run tests/unit/eval2.test.ts && node scripts/render-eval-report.mjs`.

Small synthetic sets. Numbers describe these fixtures only; they are not population accuracy. unseen was written before the revised rules and run once.

**Definitions.** *Genuinely unsupported* = the label is anything other than `supported` (partial, contradicted or insufficient). *Unsafe approval* = a genuinely unsupported claim called `supported`; its denominator is the count of genuinely unsupported claims, never the total. *Wrongly flagged* = a supported claim called partial, contradicted or insufficient, reported separately from unsafe approvals. *Wrong kind* = genuinely unsupported but given a different non-supported label. *Abstention* = `insufficient` or `unreadable`.

## Headline table
| Split | Claims | Source docs | Exact | Genuinely unsupported | Unsafe approvals | Supported claims wrongly flagged | Unsupported, wrong kind | Abstentions |
|---|---:|---:|---:|---:|---:|---|---:|---:|
| frozen22 baseline | 22 | 16 | 17/22 | 7 | **0/7** | 2/15 (contradicted 0, partial 1, abstained 1) | 3/7 | 2 (correct 1) |
| frozen22 revised | 22 | 16 | 20/22 | 7 | **0/7** | 2/15 (contradicted 0, partial 0, abstained 2) | 0/7 | 4 (correct 2) |
| unseen baseline | 29 | 8 | 18/29 | 16 | **2/16** | 5/13 (contradicted 1, partial 1, abstained 3) | 4/16 | 6 (correct 1) |
| unseen revised | 29 | 8 | 20/29 | 16 | **2/16** | 4/13 (contradicted 0, partial 1, abstained 3) | 3/16 | 6 (correct 1) |
| dev2 baseline | 9 | 5 | 4/9 | 5 | **0/5** | 3/4 (contradicted 2, partial 1, abstained 0) | 2/5 | 1 (correct 0) |
| dev2 revised | 9 | 5 | 7/9 | 5 | **0/5** | 1/4 (contradicted 0, partial 0, abstained 1) | 1/5 | 3 (correct 1) |
| dev15 baseline | 15 | 14 | 15/15 | 9 | **0/9** | 0/6 (contradicted 0, partial 0, abstained 0) | 0/9 | 1 (correct 1) |
| dev15 revised | 15 | 14 | 15/15 | 9 | **0/9** | 0/6 (contradicted 0, partial 0, abstained 0) | 0/9 | 1 (correct 1) |

The frozen 22 contain **7 genuinely unsupported** claims. "Zero unsafe approvals" on them means 0 of 7, not 0 of 22. On the unseen split it is **2 of 16**: `U5/Capital expenditures will be $15 million`, `U7/Drivers reported lower stress than cycli`.

An optional live verifier on these same inputs: **not run** (no credentials in the build environment). The runner is `app/scripts/eval-live-verifier.ts`; it refuses to call anything without a key, a price and an authorized budget.

## Named regressions from pass 1 (desired behaviour, current status)
| Item | Desired | Baseline | Current rules | Now predicts | Why it matters |
|---|---|---|---|---|---|
| `h03/averaged 84` | insufficient | not met | **met** | insufficient | OCR digit damage (B4 for 84) must not be read as a figure; abstain, do not call it contradicted |
| `h07/Lack of sleep` | partial | not met | **met** | partial | A negation in a different clause must not decide the claim; a causal claim on an association is partial |
| `h08/gained 4 points` | partial | not met | **met** | partial | A negated significance comment is not a negation of the gain; the claim drops the qualifier, so partial |
| `h04/62% of students` | supported | not met | **not met** | insufficient | A faithful translation of a Spanish passage should be supported |
| `h05/attended frequently` | supported | not met | **not met** | insufficient | A true paraphrase with no shared words should be supported |

## frozen 22 (inspected in pass 1; rules were revised after seeing them)

### Baseline rules
| expected \ said | supported | partial | contradicted | insufficient | unreadable | claim_not_found |
|---|---:|---:|---:|---:|---:|---:|
| **supported** | 13 | 1 | 0 | 1 | 0 | 0 |
| **partial** | 0 | 0 | 2 | 0 | 0 | 0 |
| **contradicted** | 0 | 0 | 3 | 0 | 0 | 0 |
| **insufficient** | 0 | 0 | 1 | 1 | 0 | 0 |
| **unreadable** | 0 | 0 | 0 | 0 | 0 | 0 |

### Revised rules
| expected \ said | supported | partial | contradicted | insufficient | unreadable | claim_not_found |
|---|---:|---:|---:|---:|---:|---:|
| **supported** | 13 | 0 | 0 | 2 | 0 | 0 |
| **partial** | 0 | 2 | 0 | 0 | 0 | 0 |
| **contradicted** | 0 | 0 | 3 | 0 | 0 | 0 |
| **insufficient** | 0 | 0 | 0 | 2 | 0 | 0 |
| **unreadable** | 0 | 0 | 0 | 0 | 0 | 0 |

Misses under the revised rules (expected -> said):
- `h04/62% of students` [bilingual]: supported -> insufficient (The claim is in en and the passage is in es. This checker compares wording, so it cannot judge support across )
- `h05/attended frequently` [paraphrase]: supported -> insufficient (No passage shares meaningful vocabulary with this claim.)

## unseen (new documents written before the revision; run once)

### Baseline rules
| expected \ said | supported | partial | contradicted | insufficient | unreadable | claim_not_found |
|---|---:|---:|---:|---:|---:|---:|
| **supported** | 8 | 1 | 1 | 3 | 0 | 0 |
| **partial** | 1 | 2 | 1 | 1 | 0 | 0 |
| **contradicted** | 1 | 0 | 7 | 1 | 0 | 0 |
| **insufficient** | 0 | 1 | 0 | 1 | 0 | 0 |
| **unreadable** | 0 | 0 | 0 | 0 | 0 | 0 |

### Revised rules
| expected \ said | supported | partial | contradicted | insufficient | unreadable | claim_not_found |
|---|---:|---:|---:|---:|---:|---:|
| **supported** | 9 | 1 | 0 | 3 | 0 | 0 |
| **partial** | 1 | 3 | 0 | 1 | 0 | 0 |
| **contradicted** | 1 | 0 | 7 | 1 | 0 | 0 |
| **insufficient** | 0 | 1 | 0 | 1 | 0 | 0 |
| **unreadable** | 0 | 0 | 0 | 0 | 0 | 0 |

Misses under the revised rules (expected -> said):
- `U3/ההשתתפות הקבועה גרמה לעלייה בציונים.` [hebrew_causal]: partial -> insufficient (No passage shares meaningful vocabulary with this claim.)
- `U5/Capital expenditures will be $15 million` [projection]: partial -> supported (Terms, figures and direction match the passage.)
- `U5/Gross margin improved by 1.7 percentage ` [derived_pct]: supported -> partial ("1.7 percentage points" is derived from 38.1% and 36.4% in the passage.)
- `U5/Net sales increased because of higher pr` [unsupported_cause]: insufficient -> partial ("because of" asserts causation, but the passage does not describe a design that can establish a cause.)
- `U7/Cyclists felt less stressed than drivers` [paraphrase]: supported -> insufficient (No passage shares meaningful vocabulary with this claim.)
- `U7/Students in small classes performed bett` [paraphrase]: supported -> insufficient (Only a small part of the claim is covered by the best passage.)
- `U7/Drivers reported lower stress than cycli` [direction]: contradicted -> supported (Terms, figures and direction match the passage.)
- `U8/45% of surveyed households had broadband` [cross_language]: supported -> insufficient (The claim is in en and the passage is in es. This checker compares wording, so it cannot judge support across )
- `U8/60% of surveyed households had broadband` [cross_language]: contradicted -> insufficient (The claim is in en and the passage is in es. This checker compares wording, so it cannot judge support across )

## What changed between baseline and revised
Revised rules add: clause-scoped negation and figures (so a negated comment about significance is not a negation of the gain), a damaged-figure guard for OCR digits, abstention when claim and passage are in different languages, a passage choice that prefers a sentence stating a direction, and a direction lexicon that knows "cooler/warmer" and ignores "or more" and quantifier "more". The baseline path is preserved so both run on identical inputs; the baseline shares the causal-marker module, so two bug fixes (negated random assignment; the adjective "lower") apply to both. Baseline reproduction of the frozen 22 predictions is exact (tested).

## Honest limits
- Small synthetic sets. The unseen split has 8 documents and 29 claims; do not read these as accuracy for real coursework.
- After the first unseen run, one bug found by an unrelated fresh assignment (the adjective "lower" read as a causal verb) was fixed. It had been masking a role-swap weakness, which raised unseen unsafe approvals from 1/16 to 2/16. The unseen split is therefore not untouched in the strict sense; the number is reported as it stands.
- The rules were tuned on the frozen 22 and dev2, so their improvement on those sets is not evidence of generalisation. The unseen result is the fairer one: exact 18 -> 20 of 29, unsafe approvals unchanged.
