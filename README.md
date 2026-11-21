# Writing Studio (personal edition)

A private writing workspace: course material + rubric + your idea or draft + a source reader + a decision queue + exact export, in one place. Built from `Writing-Studio-Master.md`. The AutoType extension from the kit is in `autotype/` (see `docs/EXTENSION.md`).

## Launch (zero keys)
Needs Node >= 22.13 (uses the built-in `node:sqlite`). From a fresh clone:
```bash
cd app && npm ci && npm start
```
Open http://127.0.0.1:8787. `npm start` runs the API server, the durable-queue worker (a separate process) and the UI. Data lives in `app/.data/` (gitignored). In local mode every browser on this machine reaches the same workspace; the server binds to 127.0.0.1 only.

Dev with hot reload: `npm run dev` (Vite on :5173). Other commands: `npm run typecheck`, `npm test`, `npm run test:smoke` (builds, then drives Chromium), `npm run format:check`.

## Environment variables (all optional; names only, never put values in git)
`ANTHROPIC_API_KEY`, `STUDIO_ANTHROPIC_MODEL` (default `claude-sonnet-5-5`), `OPENAI_API_KEY` + `STUDIO_OPENAI_MODEL` (required for OpenAI), `STUDIO_PRICES_JSON` (or enter prices in Settings), `STUDIO_DATA_DIR`, `PORT`, `HOST`, `STUDIO_LEASE_MS`, `STUDIO_MAX_OUTPUT_TOKENS`, `STUDIO_PROVIDER_TIMEOUT_MS`, `STUDIO_FIXTURE_SHARPEN=0` (turn off the demo "sharpen" rule), `STUDIO_LOCAL_MODE` (set by `npm start`).

## 90-second demo (demo mode, no key)
1. Home > **Load the sample assignment** (synthetic fixture data; badge says *Demo mode: fixture rules, no key*).
2. **Brief** tab: items quote your uploaded sheets; a length conflict between the syllabus (Aug 28) and the assignment (Oct 3) is shown for you to resolve. Click **Source** on an item to jump to the exact quote.
3. **Idea & outline**: type *I think attendance helps, but motivated students might also show up more.* > **Find two directions** > choose **Association claim, with limits** > **Build outline** > **Generate a reviewable draft**.
4. In the editor replace the second paragraph with `Attendance is associated with higher exam scores.` Put the cursor in paragraph 1 and click **Lock thesis**.
5. **Review** > **Start quick review** (free, fixture engine). Two suggestions appear: one adds a self-selection limitation; one "sharpens" the claim to *raises* and is flagged *asserts causation*.
6. On the limitation card click **Open evidence**: the reader opens **Viewer page 2 · printed page 14** with *Students chose whether to attend.* highlighted. **Back to draft** returns focus to the sentence.
7. Focus the causal card and press `r` (keep original); press **Accept** on the limitation. The approved sentence is *Attendance is associated with higher exam scores. Because students chose whether to attend, this shows an association rather than an effect: motivated students might also show up more.*
8. **Export** > DOCX / TXT (identical to the approved text, hash shown) and the **process report**. **History** shows every version; **Restore** adds a version without erasing any.

The sharpen rule is a labelled fixture behavior that mimics a common model habit so the verifier's catch can be shown without a key. It is not part of the verification logic.

## Verify live mode
1. `export ANTHROPIC_API_KEY=...` (and optionally `OPENAI_API_KEY=... STUDIO_OPENAI_MODEL=...`), restart.
2. Settings > **Live**, then enter the provider's current prices for each `provider:model` (unknown prices block paid use; nothing is guessed). Set a per-assignment budget.
3. Run a review. Every suggestion shows its provider id (`anthropic:...`); the Review panel shows an estimate before dispatch and says whether the reviewer is independent (two vendors) or a second pass by one model. Spend appears in Settings.

## What was verified, and how (this build: Linux, Node 22.23.5, Chromium 1243 headless)
| Check | Result | Longest |
|---|---|---|
| `npm run typecheck` (strict) | clean | 1 s |
| `npx vitest run`: 92 tests (unit, integration, mock-provider, Postgres RLS) | passed | 10 s |
| Real SIGKILL of a worker process mid-stage, recovered by a second worker | passed, one output per stage, no duplicate revision | 2.3 s |
| `npm run test:smoke`: real Chromium through the whole journey above, new browser profile reopen, DOCX/TXT exactness, history, 390 px mobile | passed | 11.7 s |
| Supabase migrations in Postgres (PGlite): two users, read-only member, anon, cross-tenant search, worker tenancy, expired lease | 7 passed | 1.6 s |
| `autotype/` `npm test` (incl. virtual 8-hour schedule, worker termination) | passed | 14 s |
| `autotype/tests/browser_recovery.py` real Chromium | passed (after a test-harness CSP fix) | 17 s |
| `python3 test_supervisor.py` | OK | 0.5 s |
| Fresh `npm ci` then `npm start` with no keys | works | 10 s install |

**Evaluation** (`.studio-build/eval-report.json`): 26 original fixtures (en/es/he, OCR, bilingual, history, finance, long work). Held-out claims: 22, exact 0.77, zero unsafe passes, retrieval hit@1 19/20. Misses are recorded and explained: an OCR digit, cross-language wording, a true paraphrase with no shared words, two negation-scope cases. Meaning-drift recall: 6/6 dev, 7/8 held-out (spelled-out numbers missed); 0 false alarms on 11 clean edits. This is a small synthetic set; it is not a population accuracy claim.

## Simulated, mocked, or not done
- **No live provider call was made** (no keys here). Anthropic/OpenAI adapters were verified against a local HTTP mock only.
- Demo mode's drafting/editing/critique is deterministic rules labelled `fixture`, not a language model.
- Supabase: schema + RLS verified in Postgres, but **not applied to any hosted project**, the app's data layer is SQLite (hosted wiring is future work), and storage-bucket policies (`0002`) are untested.
- Not run: live Google Doc test, multi-hour wall-clock soak of the extension, multi-tab document test, Safari/Firefox, Mac Chrome. No OCR is installed (scanned PDFs get manual passage entry).
- Not built, by instruction: billing, deployment, outreach, Google Docs export, LMS access.
- Held-out misses above are real limits: lexical retrieval only, English-centric rules, digits-only numbers.

## Decisions you should know about
- **Skills:** Humanizer is vendored (MIT) and `writing-studio-hygiene` is authored under `skills/`. Nothing was installed into any `~/.claude` (the build ran in a cloud container); exact one-step activation is in `skills/ACTIVATION.md`. The upstream `clean-user-facing-text` skill was reviewed and **not** installed: its main workflow measures and lowers AI-detector scores and suggests paraphrasing to reduce watermarks, and the repo also holds a SynthID watermark-stealing module. That conflicts with this app's rule that no detector result decides readiness. If you want it anyway on your own machine, the command is in `skills/ACTIVATION.md`.
- **AutoType Writer mode** simulates hesitant typing. The app does not use it, labels any replay as automated input, and the report never presents it as writing. See `docs/EXTENSION.md`.
- The in-app clarity policy is versioned (`writing-studio-policy/1`) and recorded on every suggestion.

## True blockers and the one next action for each
| Blocker | Next action |
|---|---|
| StoryScope paper unreadable (arxiv.org blocked here); per-feature direction of association is `unknown` in the manifest | Allow `arxiv.org` for the build environment, or drop the PDF in the repo, then rerun `npx tsx scripts/build-taxonomy-manifest.ts` and fill `directionReported` |
| No live-provider verification | Set a key, follow "Verify live mode", run one Deep review |
| Mac Chrome soak / Google Docs test for AutoType | On your Mac: load `autotype/` unpacked, follow `autotype/RECOVERY.md`, run a 4-hour test on a disposable Doc |
| Skills not active on your machine | Run the three steps in `skills/ACTIVATION.md` |

## If the next session starts with an empty chat
Read this file, `Writing-Studio-Master.md`, then `.studio-build/state.json` (last verified milestone and evidence) and `git log`. Run `cd app && npm ci && npm run typecheck && npx vitest run` to re-prove the baseline. Optional bounded supervisor: `python3 run_studio.py --repo . --hours 4 --budget-usd <your ceiling>`.

## Layout
`app/shared` pure logic (meaning checks, verifier, brief extraction, proposals, voice) · `app/server` API, queue, worker, providers, export · `app/src` React UI · `app/supabase/migrations` hosted schema + RLS · `app/fixtures` sample assignment, eval corpus, upstream provenance · `skills/` · `docs/` · `autotype/` extension · `.studio-build/` state and eval report.
