# Operations: persistence, tenancy, files, cleaning stages, hosted settings

## 1. What is actually running
| Layer | Active in the personal edition | Verified how | Not the same as |
|---|---|---|---|
| Database | **SQLite** (`node:sqlite`, file `app/.data/studio.db`, WAL) | every integration test and the Chromium smoke use it | the Postgres schema below |
| Original files | local disk, `app/.data/files/<workspace>_<sha256>` | `tests/integration/private-files.test.ts` (two identities + a read-only member) | Supabase Storage |
| Tenancy | application-level: every query is scoped by `workspace_id` through the token's membership | isolation tests across 11 read routes and 6 write routes; private-files test | database row-level security |
| Queue/worker | SQLite leases in `run_stages`, worker is a separate process | real `SIGKILL` test | `app.lease_stage` in Postgres |
| Postgres schema + RLS | **migration files only** (`app/supabase/migrations/0001`, `0002`) | **PGlite** (Postgres in WASM) test: `tests/integration/rls.test.ts`, 7 tests | a hosted Supabase project (never provisioned) |

For local-first personal use SQLite is the right choice and needs no account. PGlite is a *migration and policy test harness*, not a deployment. A hosted Supabase project is a separate deployment target, not built or paid for here.

## 2. Private files (verified, two real test identities)
- `GET /api/sources/:id/file` returns the exact original bytes (SHA-256 in `x-file-hash`) to members of the owning workspace only. Another workspace gets 404; an unauthenticated caller 401.
- `POST /api/sources/:id/file-link` mints a link signed with an HMAC (`STUDIO_LINK_SECRET`, or an auto-generated `.data/link-secret`, mode 0600) that names the **workspace, source, file hash and expiry**. TTL 10 s to 1 h (default 5 min). A tampered signature, a link re-pointed at another workspace, and an expired link are refused (403 / 403 / 410); a deleted source yields 404.
- A link is a bearer credential for one file until it expires. Anyone who holds it can read that file. Treat it like a password for the minute it lives.
- `DELETE /api/sources/:id` (owners/editors) removes all versions, derived passages, evidence audits that cited them, brief items, and the file bytes **unless another source in the same workspace still uses the same bytes**. Another workspace's identical copy is separate and untouched (tested).
- Read-only members can read and mint links, but cannot delete (403, tested).
- Not covered: backups you make yourself, browser caches of a downloaded file, and the OS file permissions of `app/.data`: the directory is created 0700 and the originals, link secret and local token are written 0600, but the SQLite database file itself follows your umask.

## 3. Before onboarding unrelated users to a hosted deployment (not required for the personal edition)
1. Wire the data layer to Postgres (today only the schema and RLS policies exist; the app does not call them).
2. Apply `0001`/`0002` to a **development** Supabase project, then repeat `rls.test.ts` against it with two real accounts (the PGlite run does not prove Supabase's `auth.uid()`, JWT claims, or storage policies).
3. Create the private `sources` bucket (policies in `0002`), upload/read/delete with the two accounts, check signed-URL expiry with Supabase's own signer, and confirm the second workspace is denied.
4. Run the worker with the service role only on the server; it must keep calling `app.commit_stage`, which re-checks tenancy.
5. Keep provider keys, `STUDIO_LINK_SECRET` and the service-role key server-side. None belongs in the browser bundle.

Hosted settings that must be explicit (none is set in this repo): Supabase project URL, anon key (browser), service-role key (worker only), storage bucket name and signed-URL TTL, `STUDIO_LINK_SECRET`, provider keys and `STUDIO_PRICES_JSON`, per-assignment and monthly budgets, data-retention period, and the list of members and roles per workspace.

## 4. Which cleaning stages run, where
The app does **not** execute the upstream Claude Code skills. It runs its own reimplementation, in every path that produces or previews text.

| Path | Clarity rules (Humanizer subset, `shared/voice.ts`) | Hygiene (`shared/unicode.ts`) | Meaning check (`shared/meaning.ts`) | Code | Test |
|---|---|---|---|---|---|
| Live review: model suggestion stored | yes, for style issues (`stock_phrase`, `style`, `unclear_sentence`) | yes, for **every** suggestion | yes, always; style-only suggestions that change meaning are dropped | `server/review.ts` `finalize`, `policyPass` | `policy-paths.test.ts` (live, mock model) |
| Demo (fixture) review | yes (fixture editor calls `voiceEdit`, then the same finalize step) | yes | yes | `server/providers/fixture.ts`, `finalize` | `policy-paths.test.ts` (demo path) |
| Voice preview / Settings | yes, with the writer's profile | yes (hits reported) | yes | `POST /api/voice/preview` | `policy-paths.test.ts`, `voice-feedback.test.ts` |
| Export (DOCX/TXT) | no: exports the approved text exactly | no | no | `server/exporter.ts` | `workflow.test.ts`, `smoke.mjs` (byte-identical) |
| Claude Code on your machine | only if you install the skills (`skills/ACTIVATION.md`) | only if installed | n/a | `skills/` | not exercised here |

Preserved in each: the writer's chosen voice (profile), quoted text, numbers, citations, hedges, and meaningful Unicode (accents, Hebrew direction marks, emoji joiners). The upstream `clean-user-facing-text` skill is **optional** and not used by the app, because the app has the native alternative above and the upstream workflow's score-lowering levers conflict with this app's policy.

## 5. Evidence-checker truth in one paragraph
The checker is lexical and sentence-local. It is good at: a wrong figure, a dropped negation or qualifier, a projection stated as fact, a causal claim on an association-only source, derived percentage points. It is weak at: paraphrase with no shared words, cross-language wording (it abstains), role swaps and reversed comparisons, and conditions attached to a projection. Those weak spots are recorded as expected-failure tests (`tests/unit/eval2.test.ts`, `core.test.ts`). A `supported` verdict means "no rule objected", not "true". The student decides.
