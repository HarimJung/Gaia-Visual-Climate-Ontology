// R7: goldens change only through tools/update-golden.mjs (with a reason).
// No error or help string may teach a copy-overwrite of a golden file.
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rootArg, walk, violation } from './_lib.mjs';

const root = rootArg();
const self = fileURLToPath(import.meta.url);
const CP_HINT = /cp .*golden/;
const APPROVE_HINT = 'If intended';

for (const dir of ['engine', 'tests']) {
  for (const file of walk(join(root, dir))) {
    if (file === self) continue; // this gate defines the banned patterns
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const lines = text.split('\n');
    lines.forEach((l, i) => {
      if (CP_HINT.test(l) || l.includes(APPROVE_HINT)) {
        violation(
          `R7: ${relative(root, file)}:${i + 1} teaches overwriting a golden — ` +
            'goldens change only via tools/update-golden.mjs --reason "<text>"',
        );
      }
    });
  }
}
