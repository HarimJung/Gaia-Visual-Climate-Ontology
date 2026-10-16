// R4: machines never emit verdicts. Every state in the published graph must be
// an epistemic state from the generated vocabulary (which has no verdict
// state), and the machine-emitter code must not even carry the verdict word.
import { existsSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { rootArg, walk, violation, note, lineOf } from './_lib.mjs';
import { readGraph } from '../reader/reader.mjs';

const root = rootArg();
const BANNED = /judged/i;

// Code scan: everything that assembles or re-serves machine output —
// the builder, the rules, the graph reader and the view generator.
let scanned = 0;
for (const dir of ['build', 'rules', 'reader', 'views']) {
  for (const file of walk(join(root, 'engine', dir))) {
    if (!/\.(ts|js|mjs)$/.test(file)) continue;
    scanned++;
    const text = readFileSync(file, 'utf8');
    const m = BANNED.exec(text);
    if (m) {
      violation(
        `R4: ${relative(root, file).split(sep).join('/')}:${lineOf(text, m.index)} carries the verdict word — ` +
          'machines never emit verdicts; verdicts come from the authoring path only',
      );
    }
  }
}

// Graph scan: every state must come from the generated vocabulary.
let g = null;
try {
  g = readGraph(root);
} catch (e) {
  violation(`R4: ${e.message}`);
}
let graphRows = 0;
if (g !== null) {
  const vocabPath = join(root, 'engine', 'generated', 'vocab.json');
  if (!existsSync(vocabPath)) {
    violation('R4: data/graph exists but engine/generated/vocab.json is missing — states cannot be validated');
  } else {
    const vocab = JSON.parse(readFileSync(vocabPath, 'utf8'));
    const states = (vocab.facet_values?.['FACET-EPISTEMIC-STATE'] ?? []).map((s) => String(s).toLowerCase());
    for (const [name, rows] of [['base.csv', g.base], ['derived.csv', g.derived]]) {
      graphRows += rows.length;
      rows.forEach((r, i) => {
        if (!states.includes(r.state)) {
          violation(`R4: ${name}:${i + 2} state "${r.state}" is not an epistemic state from the vocabulary`);
        }
      });
    }
  }
}
note(`${scanned} emitter file(s) and ${graphRows} graph row(s) scanned`);
