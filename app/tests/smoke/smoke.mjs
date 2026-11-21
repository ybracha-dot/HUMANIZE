// Browser smoke test: runs the redesign journeys against fresh fixture-mode servers (no keys, temp data). Each journey asserts on rendered UI.
//   materials.mjs  new assignment (paste -> brief) and the attendance sample (resolve the length conflict, persists on reload)
//   flow.mjs       the whole paper: plan, draft (protect, autosave, stale tab), review (evidence, keyboard), new profile, export, history, phone
//   extras.mjs     locked stages, draft-first, mixed upload, theme, keyboard-only, 320px / 200% zoom
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const dir = path.dirname(new URL(import.meta.url).pathname);
let bad = 0;
for (const f of ['materials.mjs', 'flow.mjs', 'extras.mjs']) {
  const r = spawnSync(process.execPath, [path.join(dir, f)], { stdio: 'inherit', cwd: path.join(dir, '..', '..') });
  if (r.status !== 0) { bad++; console.error(`[smoke] ${f} FAILED`); }
}
console.log(bad ? `[smoke] ${bad} journey file(s) failed` : '[smoke] PASS: all journeys');
process.exitCode = bad ? 1 : 0;
