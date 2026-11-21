# AutoType 1.5.0: inspection and test record

Inspected: every file in `autotype/` (manifest, `background.js`, `driver/`, `engine/`, `docs-reader.js`, `shortcuts.js`, `sidepanel.*`, tests, `README.md`, `RECOVERY.md`).

## What it is
A Chrome MV3 extension. The **Editor** tab reads a document and applies only the changes to turn it into an updated version, in place, using real key events sent through `chrome.debugger`. The **Writer** tab types a finished text with a rough first draft, deliberate typos, pauses and later "revisions". 1.5.0 adds a durable recovery target (full intended text saved before the first key), bounded reads with retry, periodic verification, and a review-then-resume flow after an interruption.

## Permissions and surface
`debugger` (shows Chrome's "started debugging this browser" bar), `tabs`, `storage`, `sidePanel`, and content scripts on `<all_urls>` in all frames. That is broad. It is acceptable for a private, side-loaded personal tool; it is not something to ship in a public listing.

## What was run (this environment: Linux, Node 22.23.5, Chromium 1243 headless)
| Check | Result |
|---|---|
| `npm test` in `autotype/` (6 original regression suites + eight-hour virtual-clock schedule + stop-during-wait + bounded retry + recovery separation + real worker-termination exercise) | all passed |
| `python3 test_supervisor.py` (kit launcher) | 5 tests passed |
| `tests/browser_recovery.py` against a fresh Chromium profile: panel closed mid-run, whole browser restarted, stale review rejected, exact verified resume, checkpoint removed | passed (the kit's author could not start Chromium; here it launches) |

One harness fix was needed: the test used Playwright `wait_for_function` on the extension page, which evaluates a string and is blocked by the page's CSP. It now polls with `page.evaluate`. The extension code is unchanged.

**Not run:** a live Google Doc, an elapsed multi-hour soak on the owner's Mac/Chrome, a multi-tab document test. A virtual-clock pass and a wall-clock soak answer different questions; only the first was done.

## How it relates to Writing Studio
Nothing in the web app calls the extension. By design, any text that arrives by replay is recorded as **automated input**, never as an authorship event (`POST /api/documents/:id/events` with `simulated: true`, and the process report lists it separately). A practice playback cannot create observed typing.

## A caution, stated plainly
The Writer mode exists to make typed text look like it was composed with hesitation and corrections. Used on a document whose edit history or an authorship tool (version history, Grammarly Authorship, an instructor's review) is meant to show how it was written, that misrepresents the process. This build does not extend that behavior, does not wire it into the app, and the app's report will never present replay as writing. Use the Editor/recovery features for your own documents where the rules allow them, and follow your course's assistance policy.
