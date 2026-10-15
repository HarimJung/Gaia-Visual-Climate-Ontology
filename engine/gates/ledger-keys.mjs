// ledger-keys: country document ledgers (engine/seed/countries/*/documents.csv)
// — exact header, unique L1 keys, 4-state discipline. Counts are printed, not
// asserted (R6 spirit: counted, never claimed).
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { rootArg, violation, note } from './_lib.mjs';
import { parseCSV } from '../lib/csv.mjs';

const root = rootArg();
const HEADER =
  'doc_id,title,doc_type,date,source_url,sha256,size_bytes,pages,official_english,state,state_reason,note';
const COLS = HEADER.split(',');
const DOC_TYPES = new Set([
  'treaty-status-list',
  'ndc',
  'btr',
  'legislation',
  'institution-register',
  'regulatory-parameter',
  'dataset',
  'assessment',
]);
const STATES = new Set(['observed', 'unknown']);

const countriesDir = join(root, 'engine', 'seed', 'countries');
const ledgers = existsSync(countriesDir)
  ? readdirSync(countriesDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => ({ country: e.name, path: join(countriesDir, e.name, 'documents.csv') }))
      .filter((l) => existsSync(l.path))
      .sort((a, b) => a.country.localeCompare(b.country))
  : [];

if (ledgers.length === 0) {
  note('note: no country ledgers yet (engine/seed/countries/*/documents.csv)');
  process.exit(0);
}

const dupes = (xs) => [...new Set(xs.filter((x, i) => xs.indexOf(x) !== i))];

for (const { country, path } of ledgers) {
  const rel = `engine/seed/countries/${country}/documents.csv`;
  let rows;
  try {
    rows = parseCSV(readFileSync(path, 'utf8'));
  } catch (e) {
    violation(`ledger-keys: ${rel}: ${e.message}`);
    continue;
  }
  if (rows.length === 0 || rows[0].join(',') !== HEADER) {
    violation(`ledger-keys: ${rel}: header must be exactly "${HEADER}"`);
    continue;
  }
  const docs = rows
    .slice(1)
    .map((r, i) => {
      if (r.length !== COLS.length) {
        violation(`ledger-keys: ${rel}: row ${i + 2} has ${r.length} fields, expected ${COLS.length}`);
        return null;
      }
      return Object.fromEntries(COLS.map((c, j) => [c, r[j]]));
    })
    .filter(Boolean);

  const n = docs.length;
  const ids = docs.map((d) => d.doc_id);
  const urls = docs.map((d) => d.source_url).filter(Boolean);
  const shas = docs.map((d) => d.sha256).filter(Boolean);
  const uniq = (xs) => new Set(xs).size;

  for (const d of dupes(ids)) violation(`ledger-keys: ${rel}: duplicate doc_id "${d}"`);
  for (const d of dupes(urls)) violation(`ledger-keys: ${rel}: duplicate source_url "${d}"`);
  for (const d of dupes(shas)) violation(`ledger-keys: ${rel}: duplicate sha256 "${d}"`);

  let stateOk = 0;
  let typeOk = 0;
  let noBytesOk = 0;
  for (const d of docs) {
    if (!d.doc_id) violation(`ledger-keys: ${rel}: row with empty doc_id`);
    if (STATES.has(d.state)) stateOk++;
    else violation(`ledger-keys: ${rel}: doc_id "${d.doc_id}" state "${d.state}" not in {observed, unknown}`);
    if (DOC_TYPES.has(d.doc_type)) typeOk++;
    else violation(`ledger-keys: ${rel}: doc_id "${d.doc_id}" doc_type "${d.doc_type}" not in the allowed set`);
    const excused = d.state === 'unknown' && d.state_reason;
    if (!d.sha256 && !excused) {
      violation(
        `ledger-keys: ${rel}: doc_id "${d.doc_id}" has no sha256 — state must be unknown with a non-empty state_reason`,
      );
    } else {
      noBytesOk++;
    }
    if (!d.source_url && !excused) {
      violation(
        `ledger-keys: ${rel}: doc_id "${d.doc_id}" has no source_url — state must be unknown with a non-empty state_reason`,
      );
    }
  }

  note(
    `${rel}: ${n} rows, doc_id ${uniq(ids)}/${n} unique, ` +
      `source_url ${uniq(urls)}/${urls.length} unique of ${urls.length} non-empty, ` +
      `sha256 ${uniq(shas)}/${shas.length} unique of ${shas.length} non-empty, ` +
      `state ${stateOk}/${n} valid, doc_type ${typeOk}/${n} valid, no-bytes rule ${noBytesOk}/${n} ok`,
  );
}
