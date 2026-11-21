# Activating the personal writing skills (one step each, on YOUR machine)

State when this repo was built: bundles exist in this repo only. Nothing was written to any `~/.claude` directory, because the build ran in a cloud container that is not your computer. Until you run the steps below, Claude Code on your machine will not apply them.

## 1. Install the two skills (personal scope, all projects)
```bash
mkdir -p ~/.claude/skills
cp -r skills/humanizer ~/.claude/skills/humanizer
cp -r skills/writing-studio-hygiene ~/.claude/skills/writing-studio-hygiene
```
Or project scope only: copy them to `<project>/.claude/skills/` instead.

## 2. Merge the standing instruction into your personal instructions
Append to `~/.claude/CLAUDE.md` (do not replace what is already there):
```markdown
## Prose deliverables
On every original prose deliverable, apply the humanizer skill for clarity and my chosen voice, then run writing-studio-hygiene for text hygiene.
Preserve claims, hedges, numbers, attributions, quotes, citations, technical terms, meaningful Unicode, and locked text.
Surface a material change of meaning as a choice. Keep a strong original sentence when a rewrite adds nothing. Provide finished prose by default.
Never claim a rewrite makes text undetectable or proves authorship. Keep any required assistance disclosure.
```

## 3. Optional: the upstream `clean-user-facing-text` skill
The brief named it. It was reviewed (MIT) but not installed here: its main workflow measures and lowers statistical "AI-detector" scores and offers watermark-reduction paraphrasing, which conflicts with this app's rule that no detector result decides readiness. The repo also contains `remove-ai-marks` and a SynthID "stealer" module, which were not used. If you still want the upstream skill on your own machine, that is your call:
```bash
git clone https://github.com/guillaumemeyer/watermarks-remover && cd watermarks-remover
python3 install_skill.py --skill clean-user-facing-text --target claude-code
```
Note that its own `references/responsible-use.md` says not to misrepresent authorship or bypass disclosure requirements.

## In the deployed app
Independent API calls do not inherit Claude Code skills. The app applies the same two steps server-side (`app/shared/voice.ts`, `app/shared/unicode.ts`), records the policy version on every suggestion, and shows it in Settings.
