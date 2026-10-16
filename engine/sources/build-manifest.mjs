// build-manifest: regenerate data/sources/MANIFEST.json from the per-source
// manifests (which are built from the cache sidecars). Durable location per
// snapshot follows the license register via each source's contract (R12):
// use_allowed=yes → a public release asset URL; anything else → cache-only
// (bytes identified by their committed sha256, no public mirror).
//   node engine/sources/build-manifest.mjs --tag snapshots-2026-10-15
import { pathToFileURL } from 'node:url';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { rootArg } from '../gates/_lib.mjs';
import { parseCSVWithHeader } from '../lib/csv.mjs';
import { writeCanon } from './_base.mjs';

const RELEASE_BASE = 'https://github.com/HarimJung/Gaia-Visual-Climate-Ontology/releases';

export function buildManifest(root, tag) {
  const licenseRows = new Map(
    parseCSVWithHeader(readFileSync(join(root, 'data', 'licenses.csv'), 'utf8')).rows.map((r) => [r.source_id, r]),
  );
  const contractsDir = join(root, 'engine', 'sources', 'contracts');
  const useAllowed = new Map();
  for (const f of readdirSync(contractsDir)) {
    if (!f.endsWith('.json')) continue;
    const c = JSON.parse(readFileSync(join(contractsDir, f), 'utf8'));
    // redistribution needs every governing row (byte source AND content) to say yes
    const ids = [c.license_id, c.content_license_id].filter(Boolean);
    const grades = ids.map((id) => licenseRows.get(id)?.use_allowed ?? 'missing');
    useAllowed.set(c.source_id, grades.every((g) => g === 'yes') ? 'yes' : grades.join('+'));
  }

  const manifestsDir = join(root, 'data', 'manifests');
  const snapshots = [];
  for (const f of readdirSync(manifestsDir).sort()) {
    if (!f.endsWith('.json')) continue;
    const m = JSON.parse(readFileSync(join(manifestsDir, f), 'utf8'));
    for (const e of m.entries) {
      const durable =
        useAllowed.get(m.source_id) === 'yes'
          ? `${RELEASE_BASE}/download/${tag}/${m.source_id}.${e.filename}`
          : 'cache-only';
      snapshots.push({
        source_id: m.source_id,
        filename: e.filename,
        sha256: e.sha256,
        size_bytes: e.size_bytes,
        retrieved_at: e.retrieved_at,
        durable,
      });
    }
  }

  return {
    generated_at: new Date().toISOString(),
    release: { tag, url: `${RELEASE_BASE}/tag/${tag}` },
    redistribution_rule:
      'durable is a public release asset URL only where data/licenses.csv says use_allowed=yes for every register row governing the snapshot (byte source and content); all other snapshots are cache-only (bytes in the uncommitted local cache, identified by these sha256 manifests).',
    retention_policy:
      'cache retention: per-country cap 20 document snapshots, retention period 400 days from retrieved_at (covers the longest staleness budget of 90 days plus an annual submission cycle); evicted bytes remain identified by their committed sha256 and can be refetched and re-verified against it.',
    snapshot_count: snapshots.length,
    snapshots,
  };
}

async function main() {
  const root = rootArg();
  const i = process.argv.indexOf('--tag');
  const tag = i !== -1 ? process.argv[i + 1] : null;
  if (!tag) throw new Error('--tag <release tag> is required');
  const manifest = buildManifest(root, tag);
  const p = writeCanon(root, 'MANIFEST', manifest);
  if (!existsSync(p)) throw new Error('manifest write failed');
  console.log(`MANIFEST: ${manifest.snapshot_count} snapshots → ${p}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
