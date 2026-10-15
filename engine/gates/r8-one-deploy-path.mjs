// R8: there is exactly one deploy path, and it is CI. Manual deploy commands
// may not be documented in README or docs (the predecessor's manual path
// bypassed every gate).
import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { rootArg, walk, violation } from './_lib.mjs';

const root = rootArg();
const PATTERNS = [
  /wrangler\s+(deploy|publish)/i,
  /vercel\s+--prod/i,
  /npm\s+run\s+deploy/i,
  /gh-pages/i,
  /\brsync\b[^\n]*@/i,
];

const files = [join(root, 'README.md'), ...walk(join(root, 'docs'))].filter((p) => existsSync(p));
for (const file of files) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((l, i) => {
    for (const re of PATTERNS) {
      if (re.test(l)) {
        violation(
          `R8: ${relative(root, file)}:${i + 1} manual deploy command documented — the one deploy path is CI`,
        );
      }
    }
  });
}
