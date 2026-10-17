// Census derivation arithmetic in one place: the exact rules the census
// derivation sentences state, shared by the door's fixture-fallback index and
// by the honesty tests (which recompute the reader's counts with it). The key
// set arrives as data — the census counts keys — never a hand enum (R2). An
// unexpected state in the rows creates a new states_* key instead of being
// dropped, so a vocabulary mismatch fails loudly downstream.
export function countsFromRows(rows, keys) {
  const counts = Object.fromEntries(keys.map((k) => [k, 0]));
  const bump = (k) => {
    counts[k] = (counts[k] ?? 0) + 1;
  };
  counts.documents_on_record = rows.length;
  for (const r of rows) {
    bump(r.sha256 ? 'documents_with_bytes' : 'documents_without_bytes');
    if (r.source_url) bump('source_urls_recorded');
    bump(`states_${r.state}`);
  }
  return counts;
}

// THE SOURCE FAMILIES — one per kind of source the runtime reads, which is
// what the hero's complication wheels are cut from. The universe comes from
// every row the runtime holds (so the set is the same object on every
// record); the tooth count comes from ONE record's rows. A family that
// record has nothing from keeps its wheel and gets zero teeth — the
// instrument never drops a wheel it cannot fill, and never invents teeth
// for one. Order: how much of the whole record each family carries, then by
// name, so the layout is deterministic and no number sets a position.
export function sourceFamilies(allRows, rows) {
  const total = new Map();
  for (const r of allRows) total.set(r.doc_type, (total.get(r.doc_type) ?? 0) + 1);
  return [...total.keys()]
    .sort((a, b) => total.get(b) - total.get(a) || (a < b ? -1 : 1))
    .map((key) => {
      const docs = rows.filter((r) => r.doc_type === key);
      return { key, label: String(key).replace(/[-_]/g, ' '), n: docs.length, first: docs[0] ?? null };
    });
}

// A build-unique suffix for SVG fragment ids. The dial is rendered more than
// once on a page (the cover's hero, the pinned instrument's fallback, the
// record stage's seated hero); without this every copy would define the same
// `dial-cotes` and the whole page would paint from the first one's defs.
let n = 0;
export const nextUid = () => `d${++n}`;
