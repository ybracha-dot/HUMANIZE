# Writing Studio (personal edition)

A private writing workspace: course material + rubric + your idea or draft + a source reader + a decision queue + exact export, in one place. Built from `Writing-Studio-Master.md`; extended in a second pass (`docs/` has the details). The AutoType extension from the kit is in `autotype/`.

- Repository: https://github.com/ybracha-dot/HUMANIZE, branch `claude/elegant-fermat-lrojox` (the exact commit is in `git log -1`).
- Local demo status: **works with no key** (fixture mode). Live provider: **not run, no credentials** in the build environment; the one remaining step is below.

## Launch
Needs Node >= 22.13 (built-in `node:sqlite`).
```bash
cd app && npm ci && npm start          # http://127.0.0.1:8787, demo mode, no key
```
`npm start` runs the API, the durable-queue worker (a separate process) and the UI. Data lives in `app/.data/` (gitignored). Dev mode with hot reload: `npm run dev`.

## Reproduce the checks
```bash
cd app
npm run typecheck && npx vitest run     # strict types; 130 tests
npm run test:smoke                      # builds, then drives real Chromium through the whole student journey
node scripts/run-assignment.mjs --mode fixture   # a fresh synthetic assignment through the UI, with receipts
cd ../autotype && npm test && CHROMIUM_PATH=/path/to/chrome python3 tests/browser_recovery.py
cd .. && python3 test_supervisor.py
```

## The live run (the one remaining credential step)
No `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` exists in the build environment, so **no live provider call was made and there are no live receipts**. Running the script here refuses cleanly (exit 3) and prints this. To run it yourself, in the shell that launches it (names only; the values are yours):
```bash
export ANTHROPIC_API_KEY=...                  # or OPENAI_API_KEY=... plus STUDIO_OPENAI_MODEL=<model>
export STUDIO_ANTHROPIC_MODEL=<model id>      # optional; default claude-sonnet-5-5
export STUDIO_PRICES_JSON='{"anthropic:<model id>":{"inputPerMTok":<USD>,"outputPerMTok":<USD>}}'   # copy from the provider's current price page; never assumed
export STUDIO_LIVE_BUDGET_USD=1               # your spending authorization for the run
cd app && node scripts/run-assignment.mjs --mode live
```
It starts with one small probe request, then runs the fresh assignment (idea, thesis, outline, draft, Deep review with critique, exact source passage, decision, Evidence review, export) and writes `../.studio-build/receipts/<time>-live.json` with: UI mode badge, provider id and model id for every call, latency, input/output tokens, cost, whether the suggestion was supported by the source (verdict, engine, passage, quote), export SHA-256. It aborts if a fixture result would appear in a live run. With one provider configured, the reviewer is labelled "a second pass by the same model, not independent"; with `OPENAI_API_KEY` + `STUDIO_OPENAI_MODEL` as well it uses two vendors. The optional live evidence verifier: `STUDIO_EVAL_BUDGET_USD=1 npx tsx scripts/eval-live-verifier.ts [--dry-run]`.

What the live path **has** been verified against: a local HTTP mock of the Anthropic API (`--mode mock-live`; request shape, retry, uncertain billing, schema repair, price gating, budget degradation, claim ids sent to the verifier, one-small-probe, receipts). Receipts from that mode are labelled MOCK and are not provider evidence.

## What I ran in this pass, and what is inherited
Ran in this pass (Linux, Node 22.23.5, headless Chromium 1243):
| Check | Result |
|---|---|
| `npm run typecheck` | clean (1 s) |
| `npx vitest run` | 130 tests passed (17 s) |
| `npm run test:smoke` (real Chromium, full journey, mobile 390 px) | passed (11.8 s run; 17 s with build) |
| `node scripts/run-assignment.mjs --mode fixture` | passed, 11 s, 10 free calls, export sha256 `c238de795ed8161f60025ede4c83f62f099b6d5b4ec069515a41812891ae1c67` (identical on repeat) |
| `--mode mock-live` | passed; 12 calls with receipts (MOCK) |
| `autotype` `npm test`, `browser_recovery.py`, `test_supervisor.py` | passed (16 s, 19 s, under 1 s) |
| StoryScope builder run twice | byte-identical output |
Inherited from the first pass and **not** re-run now: nothing relied on without re-running; the Postgres RLS test (7 tests) is part of the 130 and was re-run.

Never run: a live provider, desktop Chrome on macOS, a disposable Google Doc, a wall-clock soak, hosted Supabase.

## The fresh assignment (not the attendance demo)
"Assignment 3: Trees and city heat": a different course, a 5-criterion rubric (Claim 25, Mechanism 20, Use of evidence 30, Objections 15, Style 10), an APA/length/deadline sheet, a 3-page PDF reading with roman-numeral printed page labels (v-vii). Driven through the same UI a student uses (`scripts/run-assignment.mjs`). Fixture-mode receipt (`.studio-build/receipts/*-fixture.json`): mode badge "Demo mode: fixture rules, no key", provider `fixture:rules/1` (not a model), 10 calls, $0, the student's causal sentence "Tree canopy reduced afternoon surface temperatures." became "Tree canopy was associated with lower afternoon surface temperatures. This comparison shows an association rather than an effect: richer neighborhoods may just have other cooling features.", the evidence link opened *viewer page 2, printed page vi* with "2.1 degrees C cooler … than blocks with under 10% canopy" highlighted, the verifier called the accepted text **supported** (deterministic-revised/2), and the exported text equals the approved text on screen.

The run found defects the attendance demo could not, now fixed with regression tests: a negated "not assigned at random" was read as a randomized design (it made a causal claim **supported**); the adjective "lower" was read as a causal verb (the app's own rewrite got flagged, then rewritten again into "was associated with was associated with"); evidence pointed at the sentence describing the study instead of the finding; the quantifier "more" was read as a direction. Still open and recorded as expected-failure tests: a reversed comparison or swapped roles can be approved; a projection that drops its condition can be approved.

## StoryScope (offline mapping applied)
Paper: arXiv:2604.03136v6, COLM 2026, read locally (`fixtures/upstream/StoryScope-v6.pdf`, SHA-256 `929fd1ad...c0643a`; taxonomy SHA-256 `e7302f37...65d5`, byte-identical to the vendored copy). The builder cross-checks all 33 sidecar rows against the paper's printed Table 16 (values, encoding, direction, pages) and fails on any mismatch.
| Count | Value |
|---|---|
| Taxonomy features / dimensions | 304 unique ids / 10 |
| Core comparisons (Tables 14-15, values Table 16) | 33 = 20 model-elevated + 13 human-elevated |
| Distinct core features | 30 |
| Features with core evidence / without | 30 / 274 (kept `unknown`, with the note that absence here is not absence from the paper) |
| Features that appear in both directions (by answer option) | 3: `AGENT_EMO_009`, `SIT_MET_008`, `PLT_THM_009` |
| Encodings | 14 prevalence percentages, 14 Likert-scale means, 5 ordinal-code means, kept distinct |
| Table 17 per-source fingerprints | kept separate, not mapped |
Each comparison stores: table, row, printed and PDF page, answer option, encoding and what the number means, human and model-average values as printed, the **printed** gap (e.g. -0.65, not a recomputed -0.66), population (human sample vs average of five LLMs), domain (short fiction). Narrative guidance is scoped to **fiction**. The paper reports explicit emotion labels as *more* common in human stories (29% vs 8%), so that check is craft advice, not a human-likeness claim; its note says so. Tests: ID coverage, option validity, overlap, locators, idempotence, a corrupted sidecar being rejected.

## Evidence checker: denominators
Full tables and confusion matrices: `docs/EVALUATION.md` (generated from the test report). Summary:
| Split | Claims / docs | Genuinely unsupported | Exact baseline -> revised | Unsafe approvals | Supported claims wrongly flagged (revised) | Abstentions (revised) |
|---|---|---:|---|---:|---|---:|
| frozen 22 (inspected in pass 1) | 22 / 16 | **7** | 17 -> 20 | **0 of 7** | 2 of 15 (both abstentions) | 4 |
| unseen (written before revision, run once) | 29 / 8 | **16** | 18 -> 20 | **2 of 16** | 4 of 13 (1 partial, 3 abstained) | 6 |
The earlier "zero unsafe approvals" is 0 of 7, not of 22, and it does not hold on unseen data: 2 of 16 (a projection that drops "subject to board approval"; a role swap, "drivers reported lower stress than cyclists"). The five pass-1 failures are named regressions with the desired behaviour: three are now met (OCR digit, two negation-scope cases), two remain unmet (faithful translation, true paraphrase) and are expected-failure tests. No live verifier result exists (not run).

## Operations
`docs/OPERATIONS.md`: SQLite is the active runtime; PGlite is the migration/RLS test; hosted Supabase is a separate, unprovisioned deployment target with its checklist. Private files verified with two identities and a read-only member: exact-byte read, cross-workspace denial, signed expiring links (tamper, re-point and expiry refused), delete removes bytes and derived data. Which cleaning stages run in which path, with code and test, is in the same file; the upstream `clean-user-facing-text` skill is optional and not used by the app.

## AutoType
`docs/EXTENSION.md` (inspection and test record) and `docs/MAC-CHECKLIST.md` (the exact owner steps and a blank record for browser version, document type, duration, interruption, final comparison). Local fixture tests are kept distinct from desktop Chrome, a Google Doc and a soak, none of which was run. Replayed input is an automated contribution and is reported separately.

## Decisions you should know about
- The upstream `clean-user-facing-text` workflow (lowering detector scores, paraphrasing to reduce watermarks) and the repo's watermark-stealing module are **not** used. The app's own hygiene removes invisible characters; no detector result decides readiness. `skills/ACTIVATION.md` has the optional command for your own machine.
- Personal skills are not activated anywhere (the build ran in a cloud container); `skills/ACTIVATION.md` has the steps.
- AutoType Writer mode simulates hesitant typing; the app does not use it (see `docs/EXTENSION.md`).

## Shortest path to a five-student private pilot
`docs/PILOT.md`, last section. In short: you run the live smoke once; each student runs `npm ci && npm start` locally (demo mode or their own small-limit key), two counterbalanced assignments each, collect only the CSV and counts, blind-score the rubric, and brief students on the checker's known weak spots. No hosted deployment is needed.

## If the next session starts with an empty chat
Read this file, `Writing-Studio-Master.md`, `.studio-build/state.json` and `git log`. Re-prove the baseline: `cd app && npm ci && npm run typecheck && npx vitest run`.

## Layout
`app/shared` pure logic · `app/server` API, queue, worker, providers, files, export · `app/src` React UI · `app/supabase/migrations` hosted schema + RLS · `app/fixtures` sample and fresh assignments, evaluation corpora, upstream material and provenance · `app/scripts` builders and runners · `skills/` · `docs/` · `autotype/` · `.studio-build/` state, evaluation reports, receipts.
