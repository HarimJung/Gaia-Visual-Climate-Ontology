// Graph row model (AD-8): the fixed CSV shape of data/graph/, the R5 row
// contract, and serialization. Shared by the builder and the gates so the
// publish rule has exactly one definition. Parsing lives in the reader
// (engine/reader/reader.mjs) — the single door to the graph files.

export const BASE_COLUMNS = [
  'iso3',
  'record_key',
  'value',
  'state',
  'reason',
  'anchor_kind',
  'anchor_source_id',
  'anchor_sha256',
  'anchor_locator',
  'retrieved_at',
];
export const DERIVED_COLUMNS = [...BASE_COLUMNS, 'derived_rule'];
export const ANCHOR_KINDS = ['sentence', 'cell', 'dataset', 'file', 'listing'];

export function anchored(row) {
  return Boolean(row.anchor_kind && row.anchor_source_id && row.anchor_sha256 && row.anchor_locator);
}

// R5: the publish contract for one row. Returns the list of problems (empty =
// publishable). `states` is the epistemic-state list from the generated
// vocabulary (R2) — lowercased.
export function rowProblems(row, states) {
  const out = [];
  if (!row.iso3) out.push('empty subject key');
  if (!row.record_key) out.push('empty record_key');
  if (!states.includes(row.state)) out.push(`state "${row.state}" is not in the generated vocabulary`);
  if (row.anchor_kind && !ANCHOR_KINDS.includes(row.anchor_kind)) {
    out.push(`anchor_kind "${row.anchor_kind}" is not an anchor kind`);
  }
  if (row.anchor_sha256 && !/^[0-9a-f]{64}$/.test(row.anchor_sha256)) {
    out.push('anchor_sha256 is not 64 lowercase hex characters');
  }
  const a = anchored(row);
  if (row.anchor_kind && !a) out.push('partial anchor: kind present but source/sha/locator incomplete');
  if ((row.state === 'observed' || row.state === 'pledged') && !a) {
    out.push(`state "${row.state}" requires a full anchor`);
  }
  if ((row.state === 'observed' || row.state === 'pledged') && !row.value) {
    out.push(`state "${row.state}" requires a value`);
  }
  if ((row.state === 'unknown' || row.state === 'absent') && !row.reason) {
    out.push(`state "${row.state}" requires a reason`);
  }
  if (!a && !(row.state && row.reason)) out.push('no anchor and no state+reason');
  return out;
}

export function toCSV(columns, rows) {
  const esc = (v) => {
    const s = String(v ?? '');
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [columns.join(','), ...rows.map((r) => columns.map((c) => esc(r[c])).join(','))].join('\n') + '\n';
}
