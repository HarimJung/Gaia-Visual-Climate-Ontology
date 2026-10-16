// R3: derived values are stored apart from base values. The reader (the single
// door, AD-8) refuses a torn publish and a header drift — base.csv gaining a
// derived_rule column is a header drift, so it surfaces here — and every
// derived row must name its rule.
import { rootArg, violation, note } from './_lib.mjs';
import { readGraph } from '../reader/reader.mjs';

const root = rootArg();

let g;
try {
  g = readGraph(root);
} catch (e) {
  violation(`R3: ${e.message}`);
  process.exit(1);
}
if (g === null) {
  note('no data/graph yet — the builder (WP-05) produces it');
  process.exit(0);
}

g.derived.forEach((r, i) => {
  if (!r.derived_rule) {
    violation(`R3: derived.csv row ${i + 2} (${r.iso3} ${r.record_key}) names no derived_rule`);
  }
});
note(`${g.base.length} base rows, ${g.derived.length} derived rows, columns separated`);
