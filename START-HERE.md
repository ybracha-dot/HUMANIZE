# Writing Studio kit

## Have Claude build the app

Extract the complete ZIP into a new folder. Open that folder in Claude Code and paste this:

> Read Writing-Studio-Master.md and execute the personal release through M7. Inspect the included autotype extension before changing it. Build the first usable workflow, run the checks, record the last verified milestone on disk, and continue. Deliver the launch command, working demo, and an honest account of live and simulated verification.

The supplied Markdown contains the complete prompt. The web app is the deliverable Claude will build. The extension and optional build supervisor are already implemented. The personal edition, competition demo and later commercial requirements are specified separately.

## Use the extension now

Open chrome://extensions in desktop Chrome, enable Developer mode, click **Load unpacked**, and choose the extracted **autotype** folder. Full recovery instructions and compatibility details are in [autotype/RECOVERY.md](autotype/RECOVERY.md).

## Run Claude in bounded sessions

On macOS or Linux, configure Claude Code in this folder first. Run `python3 run_studio.py --help` for options. Example: `python3 run_studio.py --repo . --hours 4 --budget-usd 5`. The $5 is an example estimated usage ceiling for one invocation. Each new launch starts its own ceiling. Monitor actual account usage. Keep the host awake while a local build runs.

## Verification supplied

The original extension regressions, five new Node checks including a real worker termination with Chrome API stand-ins, and five offline supervisor tests passed. The timer test simulated eight scheduled hours and an additional three-hour pause. The included browser test was attempted; local Chromium could not start because the environment blocked its socket. Live Google Docs, a real-time multihour Chrome soak, and a paid Claude build were not executed.

To reproduce: from `autotype/` run `npm test` with Node 24. From the kit root run `python3 test_supervisor.py`. With Python Playwright and Chromium installed, run `python3 autotype/tests/browser_recovery.py`. Test files use synthetic data.
