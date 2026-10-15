#!/usr/bin/env node
// R7: the only sanctioned way to change a golden file. Requires an explicit,
// recorded reason and prints a diff summary before copying.
import { copyFileSync, existsSync, readFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const ri = argv.indexOf('--reason');
const reason = ri !== -1 ? argv[ri + 1] : undefined;
const files = argv.filter((_, i) => i !== ri && i !== ri + 1);

function usage(msg) {
  console.error(msg);
  console.error('usage: node tools/update-golden.mjs --reason "<why the expected output changed>" <new-file> <golden-file>');
  console.error('Golden files change only through this script; the reason is part of the run log (R7).');
  process.exit(1);
}

if (ri === -1 || !reason || !reason.trim()) {
  usage('update-golden: refused — a non-empty --reason "<text>" is required.');
}
if (files.length !== 2) {
  usage(
    'update-golden: expected exactly <new-file> <golden-file>. ' +
      'No goldens exist yet (S0); this script is still the only path that will ever update one.',
  );
}
const [src, dest] = files;
if (!existsSync(src)) usage(`update-golden: new file not found: ${src}`);

const oldText = existsSync(dest) ? readFileSync(dest, 'utf8') : '';
const newText = readFileSync(src, 'utf8');
const oldLines = oldText.split('\n');
const newLines = newText.split('\n');
const oldSet = new Set(oldLines);
const newSet = new Set(newLines);
const added = newLines.filter((l) => !oldSet.has(l)).length;
const removed = oldLines.filter((l) => !newSet.has(l)).length;

// ponytail: set-based line diff summary; a positional diff can come when goldens exist
console.log(`diff summary: ${oldLines.length} -> ${newLines.length} lines (+${added} / -${removed})`);
console.log(`reason: ${reason}`);
copyFileSync(src, dest);
console.log(`updated: ${dest}`);
