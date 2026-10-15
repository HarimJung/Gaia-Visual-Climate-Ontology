// R2: committed engine/generated/ must equal what codegen produces from the
// seed right now. Drift means someone edited generated output or skipped codegen.
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { rootArg, violation, note } from './_lib.mjs';

const root = rootArg();
const codegen = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'tools', 'codegen.mjs');
const tmp = mkdtempSync(join(tmpdir(), 'vocab-fresh-'));
try {
  const r = spawnSync(process.execPath, [codegen, '--root', root, '--out', tmp], {
    encoding: 'utf8',
  });
  if (r.status === 2) {
    note('skipped: no platform seed yet (codegen exit 2) — WP-02 supplies it');
  } else if (r.status !== 0) {
    violation(`R2: codegen failed: ${(r.stderr || '').trim()}`);
  } else {
    for (const f of ['vocab.ts', 'vocab.json']) {
      const committed = join(root, 'engine', 'generated', f);
      if (!existsSync(committed)) {
        violation(`R2: engine/generated/${f} missing — run npm run codegen and commit the output`);
        continue;
      }
      if (readFileSync(committed, 'utf8') !== readFileSync(join(tmp, f), 'utf8')) {
        violation(`R2: engine/generated/${f} is stale — regenerate from the seed (npm run codegen)`);
      }
    }
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
