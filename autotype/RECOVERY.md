# AutoType 1.5.0 | Long sessions and recovery

## Install and start

Unzip Writing-Studio-Kit.zip. In Chrome open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select the `autotype` folder that contains `manifest.json`. If Chrome already loads a previous unpacked copy at a different path, disable that copy before enabling this one to avoid duplicate shortcuts. If an old run is active, let it finish or stop it first. A run started in 1.4.0 has no durable recovery target that 1.5.0 can import.

Pin AutoType, open its practice page, focus the target field, and start from Writer or Editor in the side panel. For a long session pick the desired typing pace and pause settings. The estimate is based on planned work; retries, machine suspension and the editor's own save latency can change elapsed time. Long sessions use the same controls. The panel can be closed while the worker is active.

## When an interruption occurs

1. Return to the same document and same field. For a multi-tab Google Doc, select the original document tab. Open the AutoType panel. Its **Interrupted sessions** section lists locally saved targets for that document.
2. Focus the original text field, then select the session and **Review remaining work**. Compare the current editor text and saved result. Any edits made by someone else since the interruption also appear in that comparison.
3. Choose **Resume reviewed changes**. AutoType reads the current document again, checks the target after the countdown, and constructs a fresh edit plan. A changed document requires a fresh preview. A confirmed match removes the saved record after successful recovery.
4. If the document already matches, forget the record. If the original insertion point could not be verified or the editor could not be read, copy the saved text and reconcile it yourself. If all you need is the draft, this can be quicker than resuming timed playback.

The recovery target is in this browser profile's extension storage. Forgetting the target deletes that recovery copy. Uninstalling or clearing extension storage can erase it. The extension uses the uploaded version's debugger permission and document reader; the recovery changes add no permissions. A physical computer that is asleep cannot dispatch input. A progress bar cannot certify input reached an external document.

## What changed

- Saves a recovery goal before the first editing action. For a verified selection in a text field, the goal includes the text outside the selection. An ambiguous insertion point in a populated document requires verification or manual recovery.
- Adds early and periodic text checks on long action sequences, including sequences with few stylistic events. Shows progress during long scheduled pauses. Supports pause and stop during a long wait.
- Puts timeouts on document reads and debugger commands, retries transient read failures, and gives Google Docs time to settle after a repair. Repeated mismatches, unexpected fields and changed targets can still interrupt playback.
- Serializes starts, waits for cleanup left by an old worker and detects navigation during a run. It does not retry an uncertain keypress blindly.
- Offers current-versus-target review after interruption. Resume checks the document, field and contents again. Recovery is available even after a fresh worker starts, provided the local recovery data and target document are available.
- Simulated edits are automated playback. Use Writing Studio's observed events to report a real writing process.

## Verification

Run `npm test` with Node 24 from this folder. This includes the original planning, diff and reader regressions, an eight-hour virtual-clock schedule with an additional three-hour pause, bounded read retry tests, and a real Node worker termination and recovery exercise with simulated Chrome APIs.

For a browser integration test, install the Python Playwright package in an isolated development environment. With Chromium available, run `python3 tests/browser_recovery.py`. If needed, set `CHROMIUM_PATH` to the browser executable. The test uses a new temporary profile and a localhost editor. It does not access a Google account. The Chromium process in the build environment was blocked at startup by an OS socket restriction. No live Chrome or Google Docs result or real eight-hour soak is claimed for this release.

The regression suite covers ordinary editor text. Prefer a copy of a live document for your initial compatibility test, especially one with complex tables, drawings, suggestions, or collaborators. Preserve the exact error and its approximate location if a run repeatedly stops.
