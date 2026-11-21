# Five-writer pilot instrument

Goal: observe whether fewer manual handoffs and less conflict-resolution time are worth a separate purchase, without claiming a grade effect.

**Design.** Five willing writers, two comparable assignments each. Counterbalance: half use their usual process first, half use Writing Studio first. Record assignment difficulty (writer's 1-5 rating) before starting.

**Per assignment record** (`docs/pilot-template.csv`): writer id (pseudonym), assignment id, arm (usual / studio), baseline tools used, minutes of *active* revision (studio: from the app's counts; usual: self-report with a timer), number of tools switched between, unsupported claims remaining at submission (count from the app's evidence panel, or by a second reader for the usual arm), whether the writer can explain the strongest evidence and one rejected suggestion (yes/no, asked cold the next day), blind rubric score from a reader who does not know the arm, unsolicited return for the next assignment (yes/no, among writers who had one), willingness to pay real money for the next assignment (amount offered, 0 allowed), and what was said.

**Reading the result.** n=5: report each writer's pair and ranges. Do not average into a causal claim. A high acceptance rate can mean the interface encourages clicking; pair it with the blind scores and the "explain a rejected suggestion" check.

**In-app counts** (no essay text): Settings > Pilot counts, or `GET /api/pilot/summary`. Activation = at least one verified evidence jump and one recorded decision.

**Economics placeholder.** Contribution per paying user = collected revenue - refunds - payment fees - model input/output - OCR - storage - compute - support. Break-even completed runs = contribution before inference / variable cost per completed run. Use measured medians and 95th percentiles, current provider prices, and include abandoned and failed jobs. The brief's $8 / $0.40 / 20-run example is illustrative only.


## Shortest path to a five-student private pilot
Nothing here needs a hosted deployment or paid infrastructure. Each student runs the app on their own laptop; their papers never leave it.

1. **You, once (the one credential step):** run the live smoke so you know the live path works with a real model and what it costs. See README, "Live run". Until this passes, run the pilot in demo mode and say so to the students.
2. **Install packet per student:** Node >= 22.13, `git clone`, `cd app && npm ci && npm start`, and either demo mode (no key) or a key you or they provide with a small spending limit set at the provider. Do not share one key across students.
3. **Tell them plainly:** suggestions in demo mode come from fixed rules, not a model; `supported` means "no rule objected", not "true"; they decide every change; the report is not proof of authorship.
4. **Two assignments each, counterbalanced** (usual process vs. Writing Studio), per the design above. Use `docs/pilot-template.csv`. Collect only the CSV and the counts from Settings > Pilot counts; collect no essay text unless a student chooses to share it.
5. **Blind scoring:** strip tool names, give a reader the two papers in random order with the instructor's rubric.
6. **Known weak spots to brief the students on:** the checker can approve a reversed comparison or a role swap, a projection that drops its condition, and it cannot compare across languages (it abstains). Those are listed as expected-failure tests.
7. **Stop rule:** if any student's data directory or key is exposed, rotate the key, delete `app/.data`, and stop.
