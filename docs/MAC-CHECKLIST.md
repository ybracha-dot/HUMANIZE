# AutoType on your Mac: what only you can verify

No Mac, desktop Chrome or Google account was available to the build. Local fixture tests are **not** a substitute for these, and the record below is intentionally blank until you fill it.

| Level | What it proves | Status |
|---|---|---|
| Node suites + virtual 8-hour clock + worker termination (`autotype/`) | logic and recovery bookkeeping | passed (Linux, simulated Chrome APIs) |
| `browser_recovery.py` in headless Linux Chromium against a localhost textarea | panel closed, browser restarted, stale review rejected, exact resume | passed |
| **Desktop Chrome on macOS, real extension, local page** | key events, debugger bar, shortcuts, side panel | **not run** |
| **A disposable Google Doc** | Docs autocorrect, the simple-view reader, page breaks | **not run** |
| **Wall-clock soak (4 h) incl. an interruption** | long-run stability | **not run** |

## Steps (about 20 minutes plus the soak)
1. Chrome 116+ on macOS. `chrome://extensions` → Developer mode → Load unpacked → the `autotype` folder. Note the Chrome version (`chrome://version`).
2. In a **new, empty, disposable** Google Doc turn off Tools > Preferences automatic substitutions, smart quotes and Smart Compose (see `autotype/README.md`). Do not use a graded or shared document.
3. Short run: Editor tab, paste a 3-paragraph original in "Current document", a lightly changed version in "Updated version", Start. Confirm the panel says the Doc matches exactly. Compare text with a diff (File > Download > .txt, then `diff`).
4. Interruption: start a longer run, close the side panel, quit Chrome (⌘Q) mid-run, reopen, open the same Doc tab, use **Interrupted sessions > Review remaining work > Resume**. Confirm the final text equals the target.
5. Soak: a run planned for 4 hours with pauses. Keep the Mac awake (`caffeinate -dimsu`). Do not touch the Doc. Record every interruption.
6. Multi-tab: repeat step 3 in a Doc with two tabs; confirm recovery offers only the tab you started in.

## Record (fill in)
```
Mac model / macOS:
Chrome version:
Document type (plain text field / Google Doc, single or multi-tab):
Planned duration / actual elapsed (wall clock):
Interruptions (what, when, how recovered):
Final content comparison (method, result, any difference):
Anything the extension refused or got wrong:
```

## Integrity note
Anything typed by replay is an **automated contribution**. Writing Studio's process report lists it separately and never counts it as observed writing; do not present a replayed document as a record of how you wrote it.
