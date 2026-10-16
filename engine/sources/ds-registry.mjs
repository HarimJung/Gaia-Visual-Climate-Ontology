// ds-registry: the UNFCCC NDC registry index via the openclimatedata/ndcs
// mirror. Parses EVERY party row — no filtering, no country logic in code
// (R1); the country set is whatever the data carries. Run from the repo root:
//   node engine/sources/ds-registry.mjs [--force]
import { pathToFileURL } from 'node:url';
import { basename } from 'node:path';
import { rootArg } from '../gates/_lib.mjs';
import { parseCSVWithHeader } from '../lib/csv.mjs';
import { assertLicensed, hasFlag, loadContract, snapshot, writeCanon, writeManifest } from './_base.mjs';

const REQUIRED_COLUMNS = [
  'code',
  'party',
  'title',
  'fileType',
  'language',
  'version',
  'status',
  'submissionDate',
  'encodedAbsUrl',
  'originalFilename',
];

export function parseRegistry(text) {
  const { header, rows } = parseCSVWithHeader(text);
  for (const col of REQUIRED_COLUMNS) {
    if (!header.includes(col)) throw new Error(`registry csv is missing the "${col}" column`);
  }
  const byCode = new Map();
  for (const r of rows) {
    if (!r.code) throw new Error(`registry csv row for party "${r.party}" has an empty code`);
    if (!byCode.has(r.code)) byCode.set(r.code, { code: r.code, party: r.party, documents: [] });
    byCode.get(r.code).documents.push({
      title: r.title,
      file_type: r.fileType,
      language: r.language,
      version: r.version,
      status: r.status,
      submission_date: r.submissionDate,
      url: r.encodedAbsUrl,
      original_filename: r.originalFilename,
    });
  }
  const parties = [...byCode.values()].sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  for (const p of parties) {
    // latest = the most recent submission date over every document the party
    // has; a tie keeps the later file row. No judgement, just the data.
    let latest = null;
    for (const d of p.documents) {
      if (latest === null || d.submission_date >= latest.submission_date) latest = d;
    }
    p.latest = {
      title: latest.title,
      version: latest.version,
      submission_date: latest.submission_date,
      url: latest.url,
    };
  }
  return { parties, row_count: rows.length };
}

async function main() {
  const root = rootArg();
  const id = 'registry';
  const contract = loadContract(root, id);
  assertLicensed(root, contract.license_id ?? id);
  const filename = basename(new URL(contract.url).pathname);
  const snap = await snapshot(root, contract.url, id, filename, contract.success_criteria, {
    force: hasFlag('--force'),
  });
  const parsed = parseRegistry(snap.bytes.toString('utf8'));
  writeCanon(root, id, {
    source_id: id,
    snapshot_sha256: snap.meta.sha256,
    retrieved_at: snap.meta.retrieved_at,
    stale: snap.stale ? { reason: snap.meta.stale_reason, marked_at: snap.meta.stale_marked_at } : null,
    party_count: parsed.parties.length,
    row_count: parsed.row_count,
    parties: parsed.parties,
  });
  writeManifest(root, id);
  console.log(
    `${id}: ${parsed.parties.length} parties / ${parsed.row_count} document rows` +
      `${snap.reused ? ' (snapshot reused)' : ''}${snap.stale ? ` STALE: ${snap.meta.stale_reason}` : ''}`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
