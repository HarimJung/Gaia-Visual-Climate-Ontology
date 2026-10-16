// AD-8: the graph has ONE reader. Only engine/reader/reader.mjs may name the
// graph files' location — every other engine module gets graph rows from the
// reader (the builder, the producer, takes the directory from the reader's
// one definition). A second parser would fork the row contract, so a path
// reference into the graph directory from anywhere else in engine/ fails CI.
import { readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rootArg, walk, violation, note, lineOf } from './_lib.mjs';

const root = rootArg();
const self = fileURLToPath(import.meta.url); // this gate spells the banned patterns
const STR_RE = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g;
// A path INTO the graph dir, the dir itself, or a bare 'graph' path segment.
const INTO = /data[\\/]graph[\\/]/;
const DIR_END = /(^|[\\/])data[\\/]graph$/;
// join(..., 'data', 'graph', ...) spelled as adjacent segment literals.
const PAIR = /['"`]data['"`]\s*,\s*['"`]graph['"`]/;

const files = walk(join(root, 'engine'))
  .filter((p) => /\.(ts|js|mjs)$/.test(p))
  .filter((p) => {
    if (p === self) return false;
    const rel = relative(root, p).split(sep).join('/');
    return rel !== 'engine/reader/reader.mjs';
  });

let scanned = 0;
for (const file of files) {
  scanned++;
  const text = readFileSync(file, 'utf8');
  const rel = relative(root, file).split(sep).join('/');
  const flag = (idx, what) =>
    violation(
      `single-door: ${rel}:${lineOf(text, idx)} ${what} — ` +
        'engine code reads the graph through engine/reader/reader.mjs only (AD-8)',
    );
  for (const m of text.matchAll(STR_RE)) {
    const inner = m[0].slice(1, -1);
    if (inner === 'graph' || INTO.test(inner) || DIR_END.test(inner)) {
      flag(m.index, `names the graph location ("${inner}")`);
    }
  }
  const pm = PAIR.exec(text);
  if (pm) flag(pm.index, 'joins a path into the graph directory');
}
note(`${scanned} engine file(s) hold the single-door discipline`);
