// R6: every published figure resolves to a census key, so the committed
// census must be exactly what the graph yields — this gate recomputes the
// census from the graph (read via the single-door reader) and compares it
// with the committed one key for key.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { rootArg, violation, note } from './_lib.mjs';
import { readGraph } from '../reader/reader.mjs';
import { computeCensus } from '../build/census.mjs';

const root = rootArg();

let g;
try {
  g = readGraph(root);
} catch (e) {
  violation(`R6: ${e.message}`);
  process.exit(1);
}
if (g === null) {
  note('no data/graph yet — the builder (WP-05) produces it');
  process.exit(0);
}
if (g.census === null) {
  violation('R6: data/graph exists without census.json — figures have nothing to link to');
  process.exit(1);
}
const vocabPath = join(root, 'engine', 'generated', 'vocab.json');
if (!existsSync(vocabPath)) {
  violation('R6: engine/generated/vocab.json missing — census cannot be recomputed');
  process.exit(1);
}
const vocab = JSON.parse(readFileSync(vocabPath, 'utf8'));
const states = (vocab.facet_values?.['FACET-EPISTEMIC-STATE'] ?? []).map((s) => String(s).toLowerCase());

const fresh = computeCensus(g.base, g.derived, states);
const committed = g.census;

const keys = new Set([...Object.keys(fresh), ...Object.keys(committed)]);
let mismatches = 0;
for (const k of [...keys].sort()) {
  if (fresh[k] !== committed[k]) {
    mismatches++;
    violation(`R6: census key "${k}" committed=${committed[k] ?? 'missing'} recomputed=${fresh[k] ?? 'missing'}`);
  }
}
if (mismatches === 0) note(`${keys.size} census keys recomputed from the graph and equal`);
