// WP-05 mutation harness: the graph builder, its publish-blocking gates
// (r3–r6) and the anchor verifier. Doctrine unchanged: an undetected mutation
// means the TEST is wrong, never the rule.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { BASE_COLUMNS, DERIVED_COLUMNS, toCSV } from '../engine/build/rows.mjs';
import { computeCensus } from '../engine/build/census.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const gatesDir = join(repo, 'engine', 'gates');
const builder = join(repo, 'engine', 'build', 'build.mjs');
const verifier = join(repo, 'engine', 'build', 'verify.mjs');

const fixtures = [];
process.on('exit', () => {
  for (const d of fixtures) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      // best effort
    }
  }
});

function fixture(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'wp05-fixture-'));
  fixtures.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
  return dir;
}

function run(args) {
  return spawnSync(process.execPath, args, { encoding: 'utf8' });
}
const gate = (name, root) => run([join(gatesDir, name), '--root', root]);
const detected = (r) =>
  assert.notEqual(r.status, 0, `mutation NOT detected — the test or gate is wrong.\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
const clean = (r) => assert.equal(r.status, 0, `expected a pass.\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);

const STATES = ['observed', 'pledged', 'unknown', 'absent'];
const VOCAB = JSON.stringify({
  facet_values: {
    'FACET-EPISTEMIC-STATE': STATES.map((s) => s.toUpperCase()),
    'FACET-PARTY-STANDING': ['PARTY', 'SIGNED-NOT-RATIFIED', 'WITHDRAWN', 'NOT-LISTED'],
  },
});
const SHA = 'a'.repeat(64);
const row = (over = {}) => ({
  iso3: 'AAA',
  record_key: 'ndc.registry.listed',
  value: 'Testland',
  state: 'observed',
  reason: '',
  anchor_kind: 'dataset',
  anchor_source_id: 'registry',
  anchor_sha256: SHA,
  anchor_locator: 'row code=AAA',
  retrieved_at: '2026-01-01T00:00:00Z',
  ...over,
});

// A minimal valid published graph: one anchored base row, one derived row,
// a census computed by the same shared function the gate recomputes with.
function cleanGraph() {
  const base = [row()];
  const derived = [row({ record_key: 'treaty.tt.standing', value: 'party', derived_rule: 'standing-v1' })];
  return {
    'engine/generated/vocab.json': VOCAB,
    'data/graph/base.csv': toCSV(BASE_COLUMNS, base),
    'data/graph/derived.csv': toCSV(DERIVED_COLUMNS, derived),
    'data/graph/census.json': JSON.stringify(computeCensus(base, derived, STATES), null, 2) + '\n',
  };
}

// A full real-input fixture for builder runs: the committed snapshots, seeds
// and generated vocabulary, copied so a parallel ingest cannot move under us.
function realFixture() {
  const dir = fixture();
  for (const rel of ['data/sources', 'data/manifests', 'engine/generated', 'engine/seed']) {
    cpSync(join(repo, rel), join(dir, rel), { recursive: true });
  }
  return dir;
}
const build = (root) => run([builder, '--root', root]);

// ------------------------------------------------------------- determinism
test('builder is deterministic: two runs, byte-identical CSVs, equal build_id', () => {
  const dir = realFixture();
  clean(build(dir));
  const read = (f) => readFileSync(join(dir, 'data', 'graph', f), 'utf8');
  const first = {
    base: read('base.csv'),
    derived: read('derived.csv'),
    census: read('census.json'),
    id: JSON.parse(read('build.json')).build_id,
  };
  clean(build(dir));
  assert.equal(read('base.csv'), first.base);
  assert.equal(read('derived.csv'), first.derived);
  assert.equal(read('census.json'), first.census);
  assert.equal(JSON.parse(read('build.json')).build_id, first.id);
  assert.match(first.id, /^[0-9a-f]{64}$/);
});

test('census reconciles with the inputs it was built from', () => {
  const dir = realFixture();
  clean(build(dir));
  const census = JSON.parse(readFileSync(join(dir, 'data', 'graph', 'census.json'), 'utf8'));
  const sources = join(dir, 'data', 'sources');
  const registry = JSON.parse(readFileSync(join(sources, 'registry.json'), 'utf8'));
  assert.equal(census.parties_in_registry, registry.parties.length);
  const untc = JSON.parse(readFileSync(join(sources, 'untc.json'), 'utf8'));
  for (const doc of untc.documents) {
    const t = doc.treaty.replace(/[^a-z0-9]+/g, '_');
    // The count of rows this graph read from the status PDF must equal the
    // total the depositary itself prints on that PDF — both are published.
    assert.equal(census[`untc_${t}_parties`], census[`untc_${t}_parties_header`], t);
    assert.equal(census[`untc_${t}_parties_header`], Number(doc.parties_header), t);
    assert.equal(census[`untc_${t}_signatories`], census[`untc_${t}_signatories_header`], t);
  }
  const ndc = JSON.parse(readFileSync(join(sources, 'ndc-docs.json'), 'utf8'));
  assert.equal(census.ndc_documents_indexed, ndc.outcomes.length);
  assert.equal(census.ndc_documents_with_bytes, ndc.outcomes.filter((o) => o.outcome === 'ok' && o.sha256).length);
  const btr = JSON.parse(readFileSync(join(sources, 'btr-listing.json'), 'utf8'));
  assert.equal(census.btr_folders_listed, btr.parties.length);
  assert.equal(census.values_pledged, 0); // nothing in these sources pledges
});

// ------------------------------------------------- R5 live publish blocking
test('builder exits 1 and writes nothing when a row cannot be anchored', () => {
  const dir = realFixture();
  // Strip the registry snapshot hash: every registry row loses its anchor.
  const regPath = join(dir, 'data', 'sources', 'registry.json');
  const reg = JSON.parse(readFileSync(regPath, 'utf8'));
  delete reg.snapshot_sha256;
  writeFileSync(regPath, JSON.stringify(reg));
  const r = build(dir);
  detected(r);
  assert.match(r.stderr, /publish blocked/);
  assert.match(r.stderr, /ndc\.registry\.listed/);
  const out = join(dir, 'data', 'graph');
  assert.ok(!existsSync(out) || readdirSync(out).length === 0, 'no partial files on an aborted build');
});

test('builder refuses a source snapshot it does not represent', () => {
  const dir = realFixture();
  writeFileSync(join(dir, 'data', 'sources', 'mystery.json'), JSON.stringify({ source_id: 'mystery' }));
  const r = build(dir);
  detected(r);
  assert.match(r.stderr, /mystery/);
  assert.ok(!existsSync(join(dir, 'data', 'graph')));
});

// ---------------------------------------------------------------- r3 gate
test('r3 detects a derived_rule column planted in base.csv', () => {
  const files = cleanGraph();
  files['data/graph/base.csv'] = toCSV(
    [...BASE_COLUMNS, 'derived_rule'],
    [{ ...row(), derived_rule: 'smuggled' }],
  );
  const r = gate('r3-derived-separate.mjs', fixture(files));
  detected(r);
  assert.match(r.stderr, /derived_rule/);
});

test('r3 detects a derived row that names no rule', () => {
  const files = cleanGraph();
  files['data/graph/derived.csv'] = toCSV(DERIVED_COLUMNS, [
    { ...row({ record_key: 'treaty.tt.standing', value: 'party' }), derived_rule: '' },
  ]);
  detected(gate('r3-derived-separate.mjs', fixture(files)));
});

test('r3 detects a torn publish (base without derived)', () => {
  const files = cleanGraph();
  delete files['data/graph/derived.csv'];
  detected(gate('r3-derived-separate.mjs', fixture(files)));
});

test('r3 passes the clean graph and notes when no graph exists', () => {
  clean(gate('r3-derived-separate.mjs', fixture(cleanGraph())));
  const r = gate('r3-derived-separate.mjs', fixture({}));
  clean(r);
  assert.match(r.stdout, /no data\/graph/);
});

// ---------------------------------------------------------------- r4 gate
test('r4 detects a graph state outside the vocabulary', () => {
  const banned = 'jud' + 'ged';
  const files = cleanGraph();
  files['data/graph/derived.csv'] = toCSV(DERIVED_COLUMNS, [
    { ...row({ record_key: 'treaty.tt.standing', value: 'party', state: banned, reason: 'x' }), derived_rule: 'standing-v1' },
  ]);
  const r = gate('r4-no-judged.mjs', fixture(files));
  detected(r);
  assert.match(r.stderr, new RegExp(banned));
});

test('r4 detects the verdict word in rule code', () => {
  const banned = 'jud' + 'ged';
  const files = cleanGraph();
  files['engine/rules/evil.mjs'] = `export const s = '${banned}';\n`;
  detected(gate('r4-no-judged.mjs', fixture(files)));
});

test('r4 passes clean emitters and a clean graph', () => {
  const files = cleanGraph();
  files['engine/rules/ok.mjs'] = 'export const ok = 1;\n';
  clean(gate('r4-no-judged.mjs', fixture(files)));
});

// ---------------------------------------------------------------- r5 gate
test('r5 detects an anchorless observed row planted in the committed graph', () => {
  const files = cleanGraph();
  files['data/graph/base.csv'] = toCSV(BASE_COLUMNS, [
    row(),
    row({ record_key: 'ndc.registry.latest.title', anchor_sha256: '', state: 'observed' }),
  ]);
  const r = gate('r5-publish-blocking.mjs', fixture(files));
  detected(r);
  assert.match(r.stderr, /anchor/);
});

test('r5 detects a row with neither anchor nor reason', () => {
  const files = cleanGraph();
  files['data/graph/base.csv'] = toCSV(BASE_COLUMNS, [
    row(),
    row({
      record_key: 'btr.folder.x.reports',
      value: '',
      state: 'unknown',
      reason: '',
      anchor_kind: '',
      anchor_source_id: '',
      anchor_sha256: '',
      anchor_locator: '',
    }),
  ]);
  detected(gate('r5-publish-blocking.mjs', fixture(files)));
});

test('r5 passes the clean graph (and proves the live builder aborts)', () => {
  const r = gate('r5-publish-blocking.mjs', fixture(cleanGraph()));
  clean(r);
  assert.match(r.stdout, /builder abort verified/);
});

// ---------------------------------------------------------------- r6 gate
test('r6 detects a tampered census counter', () => {
  const files = cleanGraph();
  const census = JSON.parse(files['data/graph/census.json']);
  census.base_rows += 1;
  files['data/graph/census.json'] = JSON.stringify(census, null, 2) + '\n';
  const r = gate('r6-census-fresh.mjs', fixture(files));
  detected(r);
  assert.match(r.stderr, /base_rows/);
});

test('r6 detects a graph published without a census', () => {
  const files = cleanGraph();
  delete files['data/graph/census.json'];
  detected(gate('r6-census-fresh.mjs', fixture(files)));
});

test('r6 passes the clean graph', () => {
  clean(gate('r6-census-fresh.mjs', fixture(cleanGraph())));
});

// ---------------------------------------------------------------- verifier
test('verify passes a fresh real build, then fails on one corrupted anchor', () => {
  const dir = realFixture();
  clean(build(dir));
  clean(run([verifier, '--root', dir]));
  const basePath = join(dir, 'data', 'graph', 'base.csv');
  const text = readFileSync(basePath, 'utf8');
  const corrupted = text.replace(/[0-9a-f]{64}/, 'deadbeef'.repeat(8));
  assert.notEqual(corrupted, text, 'fixture must contain an anchor to corrupt');
  writeFileSync(basePath, corrupted);
  const r = run([verifier, '--root', dir]);
  detected(r);
  assert.match(r.stderr, /anchor_sha256/);
});
