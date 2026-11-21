---
name: writing-studio-hygiene
description: Text hygiene pass for prose the user owns. Audits and removes invisible or confusable Unicode (zero-width spaces, word joiners, stray BOMs, soft hyphens, tag characters, bidi overrides) while keeping meaningful characters (emoji joiners, Persian/Indic joiners, direction marks beside right-to-left text, non-breaking spaces, accents). Use after editing any prose deliverable. Does not rewrite wording and makes no claim about AI detectors.
license: MIT
---

# Writing Studio hygiene

Run after the Humanizer clarity pass on any original prose deliverable.

1. Audit: `npx tsx app/scripts/unicode-clean.ts --audit FILE` (from the Writing Studio repo). Each hit shows its code point, whether it will be removed or kept, and why.
2. If hits are marked `remove`, clean: `npx tsx app/scripts/unicode-clean.ts FILE -o FILE.cleaned`. Review the diff; use the cleaned file only if every removal is intended.
3. Never change wording in this step. Never touch quotations, citations, code, or text the user marked locked.
4. Report what was removed and kept. Do not claim the text is "undetectable", "human-written" or "watermark-free": hygiene removes characters, it proves nothing about authorship, and required assistance disclosures stay in the document.

Provenance: behavior is an independent TypeScript reimplementation of the Layer A idea in guillaumemeyer/watermarks-remover (MIT, `clean-user-facing-text`, commit 5a62be6). That skill's detector-score workflow is intentionally not part of this one.
