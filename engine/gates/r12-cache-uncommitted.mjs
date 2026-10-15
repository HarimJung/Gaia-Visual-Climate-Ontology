// R12: caches are never committed. .gitignore must cover them and git must
// track nothing under them.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { rootArg, violation, note } from './_lib.mjs';

const root = rootArg();
const REQUIRED = ['data/cache', 'engine/cache'];

const gi = join(root, '.gitignore');
const lines = existsSync(gi)
  ? readFileSync(gi, 'utf8')
      .split('\n')
      .map((l) => l.trim().replace(/^\//, '').replace(/\/$/, ''))
  : [];
for (const req of REQUIRED) {
  if (!lines.includes(req)) {
    violation(`R12: .gitignore does not cover ${req}/ — caches must be uncommittable`);
  }
}

const r = spawnSync('git', ['-C', root, 'ls-files', '--', ...REQUIRED], { encoding: 'utf8' });
if (r.error || r.status !== 0) {
  note('note: not a git repository — tracked-cache check skipped');
} else {
  for (const f of r.stdout.split('\n').filter(Boolean)) {
    violation(`R12: ${f} is tracked by git — caches are never committed`);
  }
}
