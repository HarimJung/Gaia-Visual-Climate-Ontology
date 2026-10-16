// Census (R6): every published figure resolves to one of these flat counters,
// and every counter is recomputable from the graph CSVs alone — the
// r6-census-fresh gate recomputes this function's output and compares it with
// the committed data/graph/census.json byte for byte.
import { ANCHOR_KINDS, anchored } from './rows.mjs';

const CODE_RE = /^[A-Z]{3}$/; // pattern, not an instance literal (R1)
const censusKey = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_');

export function computeCensus(base, derived, states) {
  const c = {};
  const inc = (k, n = 1) => {
    c[k] = (c[k] ?? 0) + n;
  };
  c.base_rows = base.length;
  c.derived_rows = derived.length;
  for (const s of states) c[`values_${censusKey(s)}`] = 0;
  for (const k of ANCHOR_KINDS) c[`anchor_${k}`] = 0;
  c.rows_anchored = 0;
  c.rows_unanchored_with_reason = 0;
  for (const r of [...base, ...derived]) {
    inc(`values_${censusKey(r.state)}`);
    if (anchored(r)) {
      inc('rows_anchored');
      inc(`anchor_${r.anchor_kind}`);
    } else {
      inc('rows_unanchored_with_reason');
    }
  }

  const subjects = new Set();
  const countries = new Set();
  const unresolvedSubjects = new Set();
  const btrSubjects = new Set();
  const ledgerSubjects = new Set();
  c.parties_in_registry = 0;
  c.ndc_documents_indexed = 0;
  c.ndc_documents_with_bytes = 0;
  c.btr_folders_listed = 0;
  c.btr_reports_submitted = 0;
  c.ledger_documents = 0;
  const treatyActionRe = /^treaty\.([^.]+)\.action\.date$/;
  const treatySigRe = /^treaty\.([^.]+)\.signature\.date$/;
  const treatyHeaderRe = /^treaty\.([^.]+)\.(parties|signatories)\.header$/;
  for (const r of base) {
    subjects.add(r.iso3);
    if (CODE_RE.test(r.iso3)) countries.add(r.iso3);
    if (r.record_key.startsWith('party.identity.')) unresolvedSubjects.add(r.iso3);
    if (r.record_key === 'ndc.registry.listed') inc('parties_in_registry');
    if (r.record_key.startsWith('ndc.document.')) {
      inc('ndc_documents_indexed');
      if (r.state === 'observed' && r.anchor_kind === 'file') inc('ndc_documents_with_bytes');
    }
    if (/^btr\.folder\..+\.listed$/.test(r.record_key)) {
      inc('btr_folders_listed');
      btrSubjects.add(r.iso3);
    }
    if (/^btr\.folder\..+\.submitted$/.test(r.record_key) && r.value === 'true') inc('btr_reports_submitted');
    if (r.record_key.startsWith('ledger.')) {
      inc('ledger_documents');
      ledgerSubjects.add(r.iso3);
    }
    let m;
    if ((m = treatyActionRe.exec(r.record_key)) && r.state === 'observed') {
      inc(`untc_${censusKey(m[1])}_parties`);
    } else if ((m = treatySigRe.exec(r.record_key)) && r.state === 'observed') {
      inc(`untc_${censusKey(m[1])}_signatories`);
    } else if ((m = treatyHeaderRe.exec(r.record_key))) {
      // The total the depositary PDF itself prints — stated beside the count
      // of rows this graph read from the same PDF, so both numbers are public.
      c[`untc_${censusKey(m[1])}_${m[2]}_header`] = Number(r.value);
    }
  }
  c.entities_with_record = subjects.size;
  c.countries_with_record = countries.size;
  c.entities_unresolved = unresolvedSubjects.size;
  c.btr_countries_listed = btrSubjects.size;
  c.countries_with_ledger = ledgerSubjects.size;

  return Object.fromEntries(Object.entries(c).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}
