// R11: screens read only view JSON — enforced as an import-path lint, not a
// documentation rule. No file under app/ may import from engine/ (seeds,
// generated vocab, adapters: all of it); fixtures under app/fixtures are the
// single door. The reversed direction (engine importing app) is covered by the
// same scan running on specifiers, which name their target path either way.
import { readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { rootArg, walk, violation, lineOf, note } from './_lib.mjs';

const root = rootArg();
const CODE_EXT = /\.(ts|js|mjs|astro)$/;
// import x from '…' · import '…' · import('…') · import.meta.glob('…') · require('…')
const IMPORT_RE = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\bimport\.meta\.glob\s*\(\s*|\brequire\s*\(\s*)(['"])([^'"\n]+)\1/g;
const ENGINE_PATH = /(^|\/)engine\//;

const files = walk(join(root, 'app'))
  .filter((p) => CODE_EXT.test(p))
  .filter((p) => {
    const rel = relative(root, p).split(sep).join('/');
    return !rel.startsWith('app/dist/') && !rel.startsWith('app/.astro/');
  });

let checked = 0;
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const rel = relative(root, file).split(sep).join('/');
  for (const m of text.matchAll(IMPORT_RE)) {
    checked += 1;
    const spec = m[2];
    if (ENGINE_PATH.test(spec)) {
      violation(
        `R11: ${rel}:${lineOf(text, m.index)} imports "${spec}" — ` +
          'screens read only view JSON under app/fixtures, never seeds or engine internals',
      );
    }
  }
}
note(`${checked} import path(s) checked across ${files.length} app source file(s)`);
