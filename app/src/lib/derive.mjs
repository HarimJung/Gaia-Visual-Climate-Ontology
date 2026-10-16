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
