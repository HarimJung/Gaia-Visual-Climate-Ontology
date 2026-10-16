// Anchor verification: every anchor_sha256 in the published graph must be a
// hash recorded by an input this repo holds — a source snapshot, a manifest
// entry, or a country seed ledger. Where the bytes are locally cached, the
// cache sidecar hash is re-checked against the actual bytes. A corrupted or
// invented anchor fails with exit 1.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGraph } from '../reader/reader.mjs';

function arg(name, dflt) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? resolve(process.argv[i + 1]) : dflt;
}
const root = arg('--root', resolve(dirname(fileURLToPath(import.meta.url)), '..', '..'));

let failed = 0;
const bad = (msg) => {
  failed++;
  console.error(`verify: ${msg}`);
};
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const HEX64 = /\b[0-9a-f]{64}\b/g;

let g;
try {
  g = readGraph(root);
} catch (e) {
  console.error(`verify: ${e.message}`);
  process.exit(1);
}
if (g === null) {
  console.error('verify: no published graph — run the builder first');
  process.exit(1);
}
const { base, derived } = g;

// Recorded hashes: every 64-hex string an input file carries counts as a
// recorded hash. ponytail: a text sweep, not per-field parsing — tighten to
// field-aware extraction if false acceptances ever matter.
const recorded = new Set();
const sweep = (path) => {
  for (const m of readFileSync(path, 'utf8').matchAll(HEX64)) recorded.add(m[0]);
};
for (const dir of [join(root, 'data', 'sources'), join(root, 'data', 'manifests')]) {
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir).sort()) if (f.endsWith('.json')) sweep(join(dir, f));
}
const countriesDir = join(root, 'engine', 'seed', 'countries');
if (existsSync(countriesDir)) {
  for (const e of readdirSync(countriesDir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const p = join(countriesDir, e.name, 'documents.csv');
    if (!existsSync(p)) continue;
    sweep(p);
    // The ledger file is itself an input the repo holds: its own hash anchors
    // the builder's per-field ledger rows, so it counts as recorded.
    recorded.add(sha256(readFileSync(p)));
  }
}
if (recorded.size === 0) bad('no recorded hashes found under data/sources, data/manifests or the country seeds');

// Local cache bytes: re-hash and compare with each sidecar.
const cacheShas = new Set();
const cacheDir = join(root, 'data', 'cache');
if (existsSync(cacheDir)) {
  const walk = (dir, out = []) => {
    for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p, out);
      else out.push(p);
    }
    return out;
  };
  for (const f of walk(cacheDir)) {
    if (f.endsWith('.meta.json')) continue;
    const h = sha256(readFileSync(f));
    cacheShas.add(h);
    const metaPath = `${f}.meta.json`;
    if (existsSync(metaPath)) {
      const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
      if (meta.sha256 && meta.sha256 !== h) {
        bad(`cache bytes do not match their sidecar: ${relative(root, f).split(sep).join('/')}`);
      }
    }
  }
}

let anchors = 0;
let locallyHeld = 0;
for (const [label, rows] of [['base', base], ['derived', derived]]) {
  for (const r of rows) {
    if (!r.anchor_sha256) continue;
    anchors++;
    if (!recorded.has(r.anchor_sha256)) {
      bad(`${label} ${r.iso3} ${r.record_key}: anchor_sha256 ${r.anchor_sha256} is recorded by no input`);
    }
    if (cacheShas.has(r.anchor_sha256)) locallyHeld++;
  }
}

// The committed build_id must still be the hash of the committed CSV bytes
// (the reader recomputes that hash as it reads them).
if (g.build !== null) {
  if (g.build.build_id !== g.computed_build_id) {
    bad(`build_id ${g.build.build_id} does not match the CSV bytes (${g.computed_build_id})`);
  }
} else {
  bad('the published graph carries no build.json');
}

console.log(
  `verify: ${anchors} anchored rows against ${recorded.size} recorded hashes; ` +
    `${locallyHeld} anchors with locally cached bytes; ${failed} failure(s)`,
);
process.exit(failed > 0 ? 1 : 0);
