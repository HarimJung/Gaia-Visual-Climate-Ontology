// Runs every gate in this directory and prints a digest: one line per failure,
// "YYYY-MM-DD | <gate> | <message>" (R13-ingestable shape). Exit 1 if any failed.
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { rootArg } from './_lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = rootArg();
const today = new Date().toISOString().slice(0, 10);

const gates = readdirSync(here)
  .filter((f) => f.endsWith('.mjs') && f !== 'run.mjs' && !f.startsWith('_'))
  .sort();

let failed = 0;
for (const g of gates) {
  const name = g.replace(/\.mjs$/, '');
  const r = spawnSync(process.execPath, [join(here, g), '--root', root], { encoding: 'utf8' });
  const notes = (r.stdout || '').trim();
  if (r.status === 0) {
    console.log(`ok   ${name}${notes ? ' — ' + notes.replace(/\n/g, '; ') : ''}`);
  } else {
    failed++;
    const msgs = (r.stderr || '').trim().split('\n').filter(Boolean);
    if (msgs.length === 0) msgs.push(`exit ${r.status}`);
    for (const m of msgs) console.log(`${today} | ${name} | ${m}`);
  }
}
process.exit(failed > 0 ? 1 : 0);
