# Upstream material reviewed

| Upstream | Commit | License | What is here / how it is used |
|---|---|---|---|
| https://github.com/jenna-russell/storyscope | b82d93534ab25dbf20dfe902c21e77d0b0602ca1 | MIT | `storyscope-taxonomy.json` is `data/taxonomy.json` unmodified (304 features, 10 dimensions). Used at build time only, to generate `shared/storyscope-manifest.json`. |
| https://github.com/blader/humanizer | a32f24407364c74c812b43c15926d638bee1e072 | MIT (SKILL.md v4.0.0) | SKILL.md vendored unmodified in `skills/humanizer/`; a subset of its pattern catalog is also reimplemented server-side in `shared/voice.ts`. |
| https://github.com/guillaumemeyer/watermarks-remover | 5a62be6338d2812372b1da440e55c82922f97d53 | MIT | `skills/clean-user-facing-text` read. Layer A behavior (contextual invisible-Unicode cleanup) reimplemented in `shared/unicode.ts`. The skill's "detector levers" workflow, `remove-ai-marks`, and `stealer` (SynthID watermark stealing) were reviewed and deliberately NOT used or vendored. |

Not read: the StoryScope paper (arXiv 2604.03136). `arxiv.org` is outside this build environment's network allowlist, so no
statement about per-feature direction of association is made anywhere in this repository. Corpus-level numbers quoted in the app
come from the upstream README only (61,608 stories; 304 features; 93.2% macro-F1 human-vs-AI; 68.4% macro-F1 six-way attribution).
