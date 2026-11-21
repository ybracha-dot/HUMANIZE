# Five-writer pilot instrument

Goal: observe whether fewer manual handoffs and less conflict-resolution time are worth a separate purchase, without claiming a grade effect.

**Design.** Five willing writers, two comparable assignments each. Counterbalance: half use their usual process first, half use Writing Studio first. Record assignment difficulty (writer's 1-5 rating) before starting.

**Per assignment record** (`docs/pilot-template.csv`): writer id (pseudonym), assignment id, arm (usual / studio), baseline tools used, minutes of *active* revision (studio: from the app's counts; usual: self-report with a timer), number of tools switched between, unsupported claims remaining at submission (count from the app's evidence panel, or by a second reader for the usual arm), whether the writer can explain the strongest evidence and one rejected suggestion (yes/no, asked cold the next day), blind rubric score from a reader who does not know the arm, unsolicited return for the next assignment (yes/no, among writers who had one), willingness to pay real money for the next assignment (amount offered, 0 allowed), and what was said.

**Reading the result.** n=5: report each writer's pair and ranges. Do not average into a causal claim. A high acceptance rate can mean the interface encourages clicking; pair it with the blind scores and the "explain a rejected suggestion" check.

**In-app counts** (no essay text): Settings > Pilot counts, or `GET /api/pilot/summary`. Activation = at least one verified evidence jump and one recorded decision.

**Economics placeholder.** Contribution per paying user = collected revenue - refunds - payment fees - model input/output - OCR - storage - compute - support. Break-even completed runs = contribution before inference / variable cost per completed run. Use measured medians and 95th percentiles, current provider prices, and include abandoned and failed jobs. The brief's $8 / $0.40 / 20-run example is illustrative only.
