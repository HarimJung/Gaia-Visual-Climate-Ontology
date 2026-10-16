// Graph reader (AD-8): the ONE module that opens data/graph/. Gates, the
// verifier and the view generator all consume this reader; nothing else in
// engine/ touches the graph files (enforced by r-reader-single-door). The
// builder (engine/build/build.mjs) is the matching producer.
//
// readGraph(root) returns
//   null                                  — no graph has been published yet
//   { base, derived, census, build, computed_build_id }
//                                         — the published graph, parsed
// and throws on a torn or malformed publish (some files present, others
// missing, or a CSV whose header is not the fixed column set). census and
// build are null when their JSON file is absent — their gates decide whether
// that is a violation.
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { parseCSVWithHeader } from '../lib/csv.mjs';
import { BASE_COLUMNS, DERIVED_COLUMNS } from '../build/rows.mjs';

const DIR = ['data', 'graph'];
const FILES = ['base.csv', 'derived.csv', 'census.json', 'build.json'];

// The one definition of where the live graph lives. The builder (producer)
// and the diff tool (snapshot locator) take it from here.
export const graphDirOf = (root) => join(root, ...DIR);

// The public, repo-relative name of the file every published count is
// recomputable from — what views cite as their ledger.
export const LEDGER_REL = [...DIR, 'base.csv'].join('/');

// Parse one snapshot directory's CSV pair (the diff tool reads arbitrary
// snapshot dirs, not only the live graph). Headers are enforced here, so no
// consumer ever re-parses graph CSVs itself.
export function readSnapshotCSVs(dir) {
  return {
    base: parseGraphCSV(join(dir, 'base.csv'), 'base.csv', BASE_COLUMNS),
    derived: parseGraphCSV(join(dir, 'derived.csv'), 'derived.csv', DERIVED_COLUMNS),
  };
}

function parseGraphCSV(path, name, columns) {
  const { header, rows } = parseCSVWithHeader(readFileSync(path, 'utf8'));
  if (header.join(',') !== columns.join(',')) {
    throw new Error(`${name} header is "${header.join(',')}" — must be exactly "${columns.join(',')}"`);
  }
  return rows;
}

export function readGraph(root) {
  const dir = graphDirOf(root);
  const paths = Object.fromEntries(FILES.map((f) => [f, join(dir, f)]));
  const present = FILES.filter((f) => existsSync(paths[f]));
  if (present.length === 0) return null;
  // The CSV pair is the publish unit: anything on disk without both halves is
  // a torn publish, never a readable graph.
  const missing = ['base.csv', 'derived.csv'].filter((f) => !existsSync(paths[f]));
  if (missing.length > 0) {
    throw new Error(`torn publish: ${present.join(', ')} present but ${missing.join(', ')} missing`);
  }
  const bytes = {
    base: readFileSync(paths['base.csv']),
    derived: readFileSync(paths['derived.csv']),
  };
  return {
    ...readSnapshotCSVs(dir),
    census: existsSync(paths['census.json']) ? JSON.parse(readFileSync(paths['census.json'], 'utf8')) : null,
    build: existsSync(paths['build.json']) ? JSON.parse(readFileSync(paths['build.json'], 'utf8')) : null,
    // The hash the committed build_id must equal — recomputed here so no
    // consumer re-opens the CSV bytes to check it.
    computed_build_id: createHash('sha256').update(Buffer.concat([bytes.base, bytes.derived])).digest('hex'),
  };
}
