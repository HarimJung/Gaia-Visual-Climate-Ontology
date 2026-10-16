// R9: no stored state queue. Staleness is never a flag written to disk — it is
// always the structural diff of two builds (engine/diff/diff.mjs recomputes
// queue depth and longest wait from the snapshots on every run). A file under
// data/ that looks like a stored queue, backlog or stale-flag list means the
// rule is being bypassed, so its mere existence fails the build.
import { join, relative, sep, basename } from 'node:path';
import { rootArg, walk, violation, note } from './_lib.mjs';

const root = rootArg();
// ponytail: name-based heuristic; widen to content inspection only if someone
// actually smuggles a queue under an innocent filename.
const BANNED = /queue|backlog|stale/i;

let scanned = 0;
for (const file of walk(join(root, 'data'))) {
  scanned++;
  if (BANNED.test(basename(file))) {
    violation(
      `R9: ${relative(root, file).split(sep).join('/')} looks like a stored queue/stale flag — ` +
        'stale is the diff of two builds (engine/diff/diff.mjs), never stored state',
    );
  }
}
note(`${scanned} file(s) under data/ scanned`);
