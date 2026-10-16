// WP-09 acceptance (spec §4, R9, AD-12), literal: "amendment injected → the
// shaken-claims list reproduces". Two synthetic snapshots are built in a temp
// root, a synthetic amendment is injected (one source document's sha256
// changes and one treaty event date changes; a second source re-anchors with
// fresh evidence), the diff runs TWICE, and the tests assert the exact shaken
// set, the view-field fan-out, the staleness flags, and byte determinism.
// No live network, no stored state anywhere.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { BASE_COLUMNS, DERIVED_COLUMNS, toCSV } from '../engine/build/rows.mjs';
import { runDiff, digestLines } from '../engine/diff/diff.mjs';

const roots = [];
process.on('exit', () => {
  for (const d of roots) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      // best effort
    }
  }
});

// Synthetic anchors and clocks — nothing here touches real data.
const SHA_A1 = 'a'.repeat(64); // src-a document before the amendment
const SHA_A2 = 'b'.repeat(64); // src-a document after the amendment
const SHA_B1 = 'c'.repeat(64); // src-b before
const SHA_B2 = 'd'.repeat(64); // src-b after
const SHA_C = 'e'.repeat(64); //  src-c, untouched
const T0 = '2026-09-01T00:00:00.000Z'; // original evidence retrieval
const T_FRESH = '2026-10-10T00:00:00.000Z'; // src-b refetched evidence
const BUILT_FROM = '2026-09-01T01:00:00.000Z';
const BUILT_TO = '2026-10-11T00:00:00.000Z'; // 40 days after T0
const ID_FROM = 'f0'.repeat(32);
const ID_TO = 'e1'.repeat(32);

function row(over) {
  return {
    iso3: '',
    record_key: '',
    value: '',
    state: 'observed',
    reason: '',
    anchor_kind: 'cell',
    anchor_source_id: '',
    anchor_sha256: '',
    anchor_locator: 'page 1',
    retrieved_at: T0,
    ...over,
  };
}

const FROM_BASE = [
  row({ iso3: 'AAA', record_key: 'treaty.tr1.action.date', value: '2017-02-15', anchor_source_id: 'src-a', anchor_sha256: SHA_A1 }),
  row({ iso3: 'AAA', record_key: 'treaty.tr1.action.kind', value: 'ratification', anchor_source_id: 'src-a', anchor_sha256: SHA_A1 }),
  row({ iso3: 'BBB', record_key: 'treaty.tr1.action.date', value: '2018-03-03', anchor_source_id: 'src-a', anchor_sha256: SHA_A1 }),
  row({ iso3: 'AAA', record_key: 'reg.latest.date', value: '2016-01-01', anchor_kind: 'dataset', anchor_source_id: 'src-b', anchor_sha256: SHA_B1 }),
  row({ iso3: 'CCC', record_key: 'reg.listed', value: 'Cccland', anchor_kind: 'dataset', anchor_source_id: 'src-c', anchor_sha256: SHA_C }),
];
const FROM_DERIVED = [
  { ...row({ iso3: 'AAA', record_key: 'treaty.tr1.standing', value: 'party', anchor_source_id: 'src-a', anchor_sha256: SHA_A1 }), derived_rule: 'standing-v1' },
];

// The synthetic amendment: src-a reissued (sha changes everywhere it anchors,
// one treaty event date changes, evidence NOT refetched — stays 40 days old);
// src-b re-anchored with fresh evidence; src-c untouched.
const amend = (r) => {
  const t = { ...r };
  if (t.anchor_sha256 === SHA_A1) t.anchor_sha256 = SHA_A2;
  if (t.anchor_sha256 === SHA_B1) {
    t.anchor_sha256 = SHA_B2;
    t.retrieved_at = T_FRESH;
  }
  if (t.iso3 === 'AAA' && t.record_key === 'treaty.tr1.action.date') t.value = '2018-01-01';
  return t;
};
const TO_BASE = FROM_BASE.map(amend);
const TO_DERIVED = FROM_DERIVED.map(amend);

const VIEW = {
  view: 'country-ledger',
  country: { iso3: 'AAA', name_en: 'Aaaland' },
  treaty_status: [{ treaty_label: 'tr1', events: [{ label: 'ratified', date: '2017-02-15' }], receipt: 'aaa-src-a' }],
  rows: [
    { doc_id: 'aaa-src-a', title: 'status list', sha256: SHA_A1, state: 'observed' },
    { doc_id: 'aaa-src-b', title: 'registry snapshot', sha256: SHA_B1, state: 'observed' },
    { doc_id: 'aaa-src-c', title: 'untouched doc', sha256: SHA_C, state: 'observed' },
  ],
};

function buildJson(id, builtAt, shas) {
  return JSON.stringify({
    build_id: id,
    built_at: builtAt,
    inputs: {
      sources: {
        'src-a': { snapshot_sha256: shas.a, retrieved_at: T0 },
        'src-b': { snapshot_sha256: shas.b },
        'src-c': { snapshot_sha256: SHA_C },
      },
    },
    counts: { base_rows: 5, derived_rows: 1 },
  });
}

function put(root, rel, content) {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
}

function makeRoot() {
  const root = mkdtempSync(join(tmpdir(), 'wp09-'));
  roots.push(root);
  put(root, 'engine/sources/contracts/src-a.json', JSON.stringify({ source_id: 'src-a', staleness_budget_days: 10 }));
  put(root, 'engine/sources/contracts/src-b.json', JSON.stringify({ source_id: 'src-b', staleness_budget_days: 400 }));
  put(root, 'snapA/base.csv', toCSV(BASE_COLUMNS, FROM_BASE));
  put(root, 'snapA/derived.csv', toCSV(DERIVED_COLUMNS, FROM_DERIVED));
  put(root, 'snapA/build.json', buildJson(ID_FROM, BUILT_FROM, { a: SHA_A1, b: SHA_B1 }));
  put(root, 'snapA/views/countries/aaa.json', JSON.stringify(VIEW));
  put(root, 'snapB/base.csv', toCSV(BASE_COLUMNS, TO_BASE));
  put(root, 'snapB/derived.csv', toCSV(DERIVED_COLUMNS, TO_DERIVED));
  put(root, 'snapB/build.json', buildJson(ID_TO, BUILT_TO, { a: SHA_A2, b: SHA_B2 }));
  put(root, 'snapB/views/countries/aaa.json', JSON.stringify(VIEW));
  return root;
}

function diffOnce(root, outName) {
  return runDiff(join(root, 'snapA'), join(root, 'snapB'), { root, outDir: join(root, outName) });
}

test('amendment injected → the exact shaken-claims list reproduces', () => {
  const root = makeRoot();
  const { report } = diffOnce(root, 'out1');

  // Every claim that rested on the changed anchors — and nothing else.
  assert.deepEqual(
    report.shaken_claims.map((c) => `${c.file} ${c.iso3} ${c.record_key} ${c.anchor_source_id}`),
    [
      'base AAA reg.latest.date src-b',
      'base AAA treaty.tr1.action.date src-a',
      'base AAA treaty.tr1.action.kind src-a',
      'base BBB treaty.tr1.action.date src-a',
      'derived AAA treaty.tr1.standing src-a',
    ],
  );
  // The untouched src-c claim never appears.
  assert.ok(!report.shaken_claims.some((c) => c.anchor_source_id === 'src-c'));

  // Changed-anchor grouping: two documents shook.
  assert.deepEqual(
    report.changed_anchors.map((g) => [g.source_id, g.from_sha256, g.to_sha256s, g.claims]),
    [
      ['src-a', SHA_A1, [SHA_A2], 4],
      ['src-b', SHA_B1, [SHA_B2], 1],
    ],
  );
  assert.equal(report.changed_anchors[0].input_path, 'sources.src-a.snapshot_sha256');

  // Substantive change: exactly the injected treaty event date.
  assert.deepEqual(report.base.changed, [
    {
      iso3: 'AAA',
      record_key: 'treaty.tr1.action.date',
      anchor_source_id: 'src-a',
      changed_fields: { value: { from: '2017-02-15', to: '2018-01-01' } },
      ledger_url: '/country/aaa/',
    },
  ]);
  assert.equal(report.base.added.length, 0);
  assert.equal(report.base.removed.length, 0);
});

test('view fields resting on a shaken anchor are listed with receipt deep links', () => {
  const root = makeRoot();
  const { report } = diffOnce(root, 'out1');
  assert.equal(report.views.available, true);
  assert.deepEqual(
    report.views.shaken_fields.map((f) => [f.path, f.receipt_url]),
    [
      ['rows[doc_id=aaa-src-a]', '/receipt/aaa/aaa-src-a/'],
      ['rows[doc_id=aaa-src-b]', '/receipt/aaa/aaa-src-b/'],
      ['treaty_status[0].receipt', '/receipt/aaa/aaa-src-a/'],
    ],
  );
});

test('AD-12: shaken claims past their staleness budget are flagged; fresh ones are not', () => {
  const root = makeRoot();
  const { report } = diffOnce(root, 'out1');
  for (const c of report.shaken_claims.filter((c) => c.anchor_source_id === 'src-a')) {
    assert.equal(c.age_days, 40, `${c.record_key} age`);
    assert.equal(c.budget_days, 10);
    assert.equal(c.over_sla, true, `${c.record_key} must be flagged past budget`);
  }
  const fresh = report.shaken_claims.find((c) => c.anchor_source_id === 'src-b');
  assert.equal(fresh.budget_days, 400);
  assert.equal(fresh.over_sla, false);
  // Recomputed queue numbers (AD-12's first two monitoring figures) — never stored.
  assert.equal(report.sla.queue_depth, 5);
  assert.equal(report.sla.over_sla, 4);
  assert.equal(report.sla.longest_wait_days, 40);
  assert.equal(report.sla.as_of, BUILT_TO);
});

test('running the diff TWICE produces byte-identical report and digest (determinism)', () => {
  const root = makeRoot();
  const one = diffOnce(root, 'out1');
  const two = diffOnce(root, 'out2');
  assert.equal(readFileSync(one.jsonPath, 'utf8'), readFileSync(two.jsonPath, 'utf8'));
  assert.equal(readFileSync(one.mdPath, 'utf8'), readFileSync(two.mdPath, 'utf8'));
  assert.ok(one.jsonPath.endsWith(`${ID_FROM.slice(0, 12)}__${ID_TO.slice(0, 12)}.json`));
});

test('digest follows the R13 line shape, dated by the to-build, one line per change', () => {
  const root = makeRoot();
  const { report, digest } = diffOnce(root, 'out1');
  const lines = digestLines(report);
  assert.ok(lines.length > 0);
  for (const l of lines) {
    assert.match(l, /^\d{4}-\d{2}-\d{2} \| [^|]+ \| .+$/, l);
    assert.ok(l.startsWith(BUILT_TO.slice(0, 10)), 'digest lines are dated by the to-build, not the wall clock');
  }
  // 2 anchors + 1 substantive change + 3 view fields = 6 changes, 6 lines.
  assert.equal(lines.length, 6);
  for (const l of lines) assert.ok(digest.includes(l));
  assert.ok(digest.includes('/receipt/aaa/aaa-src-a/'), 'digest deep-links into receipt URLs');
});

test('a snapshot diffed against itself reports no structural change', () => {
  const root = makeRoot();
  const { report, digest } = runDiff(join(root, 'snapA'), join(root, 'snapA'), { root, outDir: join(root, 'out-self') });
  assert.equal(report.shaken_claims.length, 0);
  assert.equal(report.base.changed.length, 0);
  assert.equal(report.views.shaken_fields.length, 0);
  assert.match(digest, /No structural change between the two builds\./);
});

test('a from-snapshot without reader views says so instead of inventing fan-out', () => {
  const root = makeRoot();
  rmSync(join(root, 'snapA', 'views'), { recursive: true, force: true });
  const { report } = diffOnce(root, 'out1');
  assert.equal(report.views.available, false);
  assert.match(report.views.reason, /no reader-produced views/);
  assert.equal(report.shaken_claims.length, 5, 'graph-level shaken set is unaffected');
});

test('a build_id prefix resolves to the live data/graph snapshot', () => {
  const root = makeRoot();
  // Make snapB the "live" graph of this root, then address it by id prefix.
  for (const f of ['base.csv', 'derived.csv', 'build.json']) {
    put(root, `data/graph/${f}`, readFileSync(join(root, 'snapB', f), 'utf8'));
  }
  const { report } = runDiff(join(root, 'snapA'), ID_TO.slice(0, 12), { root, outDir: join(root, 'out-id') });
  assert.equal(report.to.build_id, ID_TO);
});
