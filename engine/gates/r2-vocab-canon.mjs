// R2: the single vocabulary canon is the seed CSV. Hand-written vocabulary
// declarations in engine code are banned; vocabulary arrives via codegen only.
import { readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { rootArg, walk, violation } from './_lib.mjs';

const root = rootArg();
const BAD = /\benum\s|z\.enum\(/;

const files = walk(join(root, 'engine'))
  .filter((p) => /\.(ts|js|mjs)$/.test(p))
  .filter((p) => !relative(root, p).split(sep).join('/').startsWith('engine/generated/'));

for (const file of files) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((l, i) => {
    if (BAD.test(l)) {
      violation(
        `R2: ${relative(root, file)}:${i + 1} hand-written vocabulary declaration — ` +
          'vocabulary is generated from the seed (engine/generated/vocab.ts)',
      );
    }
  });
}
