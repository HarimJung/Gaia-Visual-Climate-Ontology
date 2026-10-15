// Shared gate plumbing. Convention: violations go to stderr (and exit 1),
// informational notes and counts go to stdout.
import { readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function rootArg(argv = process.argv) {
  const i = argv.indexOf('--root');
  return i !== -1 && argv[i + 1]
    ? resolve(argv[i + 1])
    : resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
}

export function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== '.git' && e.name !== 'node_modules') walk(p, out);
    } else if (e.isFile()) {
      out.push(p);
    }
  }
  return out;
}

export function violation(msg) {
  process.exitCode = 1;
  console.error(msg);
}

export function note(msg) {
  console.log(msg);
}

export function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}
