// CLI for the hygiene skill: npx tsx scripts/unicode-clean.ts [--audit] FILE [-o OUT]
import fs from 'node:fs';
import { auditUnicode, cleanUnicode } from '../shared/unicode.ts';
const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('-') && a !== args[args.indexOf('-o') + 1]);
if (!file) { console.error('usage: unicode-clean.ts [--audit] FILE [-o OUT]'); process.exit(2); }
const text = fs.readFileSync(file, 'utf8');
if (args.includes('--audit')) {
  const hits = auditUnicode(text);
  for (const h of hits) console.log(`${h.verdict.toUpperCase().padEnd(6)} ${h.hex} ${h.name} at ${h.index}: ${h.reason}`);
  console.log(`${hits.length} hit(s): ${hits.filter((h) => h.verdict === 'remove').length} to remove, ${hits.filter((h) => h.verdict === 'keep').length} kept.`);
} else {
  const r = cleanUnicode(text);
  const out = args[args.indexOf('-o') + 1];
  if (args.includes('-o') && out) fs.writeFileSync(out, r.text); else process.stdout.write(r.text);
  console.error(`removed ${r.removed.length}, kept ${r.kept.length}`);
}
