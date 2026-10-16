// WP-06 harness: the view generator (graph → data/views) and the single-door
// reader discipline. Honesty doctrine unchanged: every value a view carries is
// a graph value or recomputable from the view rows; an undetected mutation
// means the TEST is wrong, never the rule. No country identity is named here
// (R1 spirit): countries come from the graph, the fixture comparison keys off
// the committed fixture files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { readGraph } from '../engine/reader/reader.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const generator = join(repo, 'engine', 'views', 'generate.mjs');
const singleDoorGate = join(repo, 'engine', 'gates', 'r-reader-single-door.mjs');

const scratch = [];
process.on('exit', () => {
  for (const d of scratch) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      // best effort
    }
  }
});
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'wp06-'));
  scratch.push(d);
  return d;
};
const run = (args) => spawnSync(process.execPath, args, { encoding: 'utf8' });

const vocab = JSON.parse(readFileSync(join(repo, 'engine', 'generated', 'vocab.json'), 'utf8'));
const STATES = vocab.facet_values['FACET-EPISTEMIC-STATE'].map((s) => s.toLowerCase());
const DOC_TYPES = new Set(vocab.facet_values['FACET-DOC-TYPE'].map((s) => s.toLowerCase()));

const graph = readGraph(repo);
const countryCodes = graph === null ? new Set() : new Set(graph.base.map((r) => r.iso3).filter((s) => /^[A-Z]{3}$/.test(s)));

// The live reader output (CI generates it before tests; locally, build:views).
const viewsDir = join(repo, 'data', 'views');
const live = existsSync(join(viewsDir, 'countries')) && readdirSync(join(viewsDir, 'countries')).some((f) => f.endsWith('.json'));
const liveViews = live
  ? readdirSync(join(viewsDir, 'countries'))
      .filter((f) => f.endsWith('.json'))
      .sort()
      .map((f) => ({ file: f, view: JSON.parse(readFileSync(join(viewsDir, 'countries', f), 'utf8')) }))
  : [];
const skipLive = !live && 'data/views not generated — run npm run build:views first (CI does)';

// ---------------------------------------------------------------- contract
test('one view per graph country, filenames match, as_of/build_id from build.json', { skip: skipLive }, () => {
  assert.equal(liveViews.length, countryCodes.size, 'one view file per country subject in the graph');
  const asOf = graph.build.built_at.slice(0, 10);
  for (const { file, view } of liveViews) {
    assert.equal(file, `${view.country.iso3.toLowerCase()}.json`, 'file is named by its own iso3');
    assert.ok(countryCodes.has(view.country.iso3), `${view.country.iso3} is a graph country`);
    assert.equal(view.as_of, asOf, 'as_of comes from build.json');
    assert.equal(view.build_id, graph.build.build_id, 'build_id comes from build.json');
  }
});

test('every generated view holds the frozen contract and the honesty rules', { skip: skipLive }, () => {
  for (const { view } of liveViews) {
    const where = view.country.iso3;
    // Everything the graph recorded about this country, as searchable text.
    const mine = graph.base.filter((r) => r.iso3 === where);
    const values = new Set(mine.map((r) => r.value).filter(Boolean));
    const locators = new Set(mine.map((r) => r.anchor_locator).filter(Boolean));
    const anchors = new Set(mine.map((r) => r.anchor_sha256).filter(Boolean));
    const notes = mine.filter((r) => r.record_key.endsWith('.note')).map((r) => r.value);
    const inGraphText = (s) => [...locators, ...notes].some((t) => t.includes(s));

    assert.equal(view.view, 'country-ledger');
    assert.ok(view.contract.length > 0 && view.country.name_en.length > 0);
    const ids = new Set();
    for (const r of view.rows) {
      const at = `${where} ${r.doc_id}`;
      assert.ok(!ids.has(r.doc_id), `${at}: doc_id unique in its view`);
      ids.add(r.doc_id);
      for (const k of ['title', 'doc_type', 'date', 'source_url', 'sha256', 'official_english', 'state', 'state_reason']) {
        assert.equal(typeof r[k], 'string', `${at}: ${k} is a string`);
      }
      assert.ok(r.title.length > 0, `${at}: title present`);
      assert.ok(DOC_TYPES.has(r.doc_type), `${at}: doc_type "${r.doc_type}" is canon vocabulary`);
      for (const k of ['size_bytes', 'pages']) {
        assert.ok(r[k] === null || Number.isInteger(r[k]), `${at}: ${k} null or integer`);
      }
      assert.ok(STATES.includes(r.state), `${at}: state is canon vocabulary`);
      if (r.state === 'unknown' || r.state === 'absent') {
        assert.ok(r.state_reason.length > 0, `${at}: ${r.state} carries a reason`);
      }
      // Machine-linked values: nothing a screen shows is invented.
      if (r.sha256) {
        assert.ok(values.has(r.sha256) || anchors.has(r.sha256), `${at}: sha256 is a graph value or anchor`);
      }
      if (r.source_url) {
        assert.ok(
          values.has(r.source_url) || locators.has(r.source_url) || inGraphText(r.source_url),
          `${at}: source_url is on the graph record`,
        );
      }
      if (r.date) {
        assert.ok(values.has(r.date) || inGraphText(r.date), `${at}: date is on the graph record`);
      }
      if (r.quote) {
        assert.ok(Number.isInteger(r.quote.page) && r.quote.page >= 1, `${at}: quote page is a positive integer`);
        assert.ok(inGraphText(r.quote.text), `${at}: quote text is verbatim graph text`);
      }
      if (r.refusal !== null) {
        assert.ok(r.state_reason.includes(r.refusal), `${at}: refusal is verbatim from state_reason`);
      }
      assert.ok(Array.isArray(r.provenance), `${at}: provenance is a list`);
      for (const p of r.provenance) {
        assert.ok(inGraphText(p), `${at}: provenance item is verbatim graph text: "${p}"`);
      }
    }
    for (const t of view.treaty_status) {
      const row = view.rows.find((r) => r.doc_id === t.receipt);
      assert.ok(row && row.quote, `${where} ${t.treaty_label}: receipt row carries a quote`);
      assert.ok(t.events.length > 0, `${where} ${t.treaty_label}: a treaty line without events would be empty`);
      for (const ev of t.events) {
        assert.ok(row.quote.reading.includes(ev.date), `${where} ${t.treaty_label}: ${ev.date} in quote reading`);
        assert.ok(row.quote.text.includes(ev.display), `${where} ${t.treaty_label}: "${ev.display}" verbatim in quote text`);
      }
    }
    assert.ok(STATES.includes(view.next_date.state));
    if (view.next_date.date === null) {
      assert.ok(view.next_date.reason.length > 0, `${where}: empty next_date carries a reason`);
    } else {
      assert.ok(view.rows.some((r) => r.doc_id === view.next_date.receipt), `${where}: next_date receipt is a row`);
    }
    const segStates = view.strip.segments.map((s) => s.state);
    assert.deepEqual(segStates, STATES, `${where}: strip segments cover the vocabulary states in order`);
  }
});

test('reader census: world counts sum the index, graph census carried verbatim', { skip: skipLive }, () => {
  const census = JSON.parse(readFileSync(join(viewsDir, 'census.json'), 'utf8'));
  const index = JSON.parse(readFileSync(join(viewsDir, 'index.json'), 'utf8'));
  assert.deepEqual(census.graph, graph.census, 'graph census is copied byte-for-byte');
  for (const k of Object.keys(census.counts)) {
    assert.ok(k in census.derivations, `census key "${k}" carries a derivation sentence`);
    assert.equal(
      census.counts[k],
      index.countries.reduce((n, c) => n + c.counts[k], 0),
      `world count "${k}" is the sum over the index`,
    );
  }
});

// ------------------------------------------------------- fixture comparison
// The committed fixture views were the WP-06 output contract. Each fixture
// view's country must now come out of the generator at least as rich: same
// ledger values field for field, quotes and refusals intact, treaty events
// carrying the same dates.
test('each fixture country is generated at least as rich as its fixture', { skip: skipLive }, () => {
  const fixDir = join(repo, 'app', 'fixtures', 'views');
  for (const f of readdirSync(fixDir).filter((x) => x.endsWith('.json')).sort()) {
    const fix = JSON.parse(readFileSync(join(fixDir, f), 'utf8'));
    const gen = liveViews.find(({ view }) => view.country.iso3 === fix.country.iso3)?.view;
    assert.ok(gen, `${fix.country.iso3} is generated`);
    assert.equal(gen.country.name_en, fix.country.name_en, 'same recorded country name');
    for (const fr of fix.rows) {
      const gr = gen.rows.find((r) => r.doc_id === fr.doc_id);
      assert.ok(gr, `${fr.doc_id}: fixture row present in the generated view`);
      for (const k of ['title', 'doc_type', 'date', 'source_url', 'sha256', 'size_bytes', 'pages', 'official_english', 'state', 'state_reason']) {
        assert.deepEqual(gr[k], fr[k], `${fr.doc_id}.${k} survives builder→reader→view`);
      }
      assert.deepEqual(gr.quote, fr.quote, `${fr.doc_id}: quote survives verbatim`);
      assert.deepEqual(gr.refusal, fr.refusal, `${fr.doc_id}: refusal survives verbatim`);
      if (fr.receipt_scope !== null) assert.ok(gr.receipt_scope !== null, `${fr.doc_id}: receipt scope still stated`);
      if (fr.provenance.length > 0) assert.ok(gr.provenance.length > 0, `${fr.doc_id}: provenance still carried`);
    }
    for (const ft of fix.treaty_status) {
      const dates = ft.events.map((e) => e.date).sort();
      const match = gen.treaty_status.find((t) => t.events.map((e) => e.date).sort().join() === dates.join());
      assert.ok(match, `a generated treaty line carries the dates ${dates.join(', ')}`);
      const receipt = gen.rows.find((r) => r.doc_id === match.receipt);
      assert.ok(receipt && receipt.quote, 'and its receipt holds a quote');
    }
  }
});

// ------------------------------------------------------------- determinism
test('generator is deterministic: two runs, byte-identical output', () => {
  const a = join(tmp(), 'a');
  const b = join(tmp(), 'b');
  for (const out of [a, b]) {
    const r = run([generator, '--root', repo, '--out', out]);
    assert.equal(r.status, 0, `generation succeeds.\n${r.stderr}`);
  }
  const files = (d) => [
    ...readdirSync(join(d, 'countries')).map((f) => `countries/${f}`),
    'index.json',
    'census.json',
  ];
  assert.deepEqual(files(a).sort(), files(b).sort());
  for (const f of files(a)) {
    assert.equal(readFileSync(join(a, f), 'utf8'), readFileSync(join(b, f), 'utf8'), `${f} byte-identical`);
  }
});

// ---------------------------------------------------------------- mutation
test('a graph row with a bogus state fails view generation and writes nothing', () => {
  const root = tmp();
  cpSync(join(repo, 'engine', 'generated'), join(root, 'engine', 'generated'), { recursive: true });
  cpSync(join(repo, 'data', 'graph'), join(root, 'data', 'graph'), { recursive: true });
  const basePath = join(root, 'data', 'graph', 'base.csv');
  const text = readFileSync(basePath, 'utf8');
  const mutated = text.replace(',observed,', ',bogus,');
  assert.notEqual(mutated, text, 'fixture must contain an observed row to corrupt');
  writeFileSync(basePath, mutated);
  const r = run([generator, '--root', root]);
  assert.notEqual(r.status, 0, `mutation NOT detected — the test or generator is wrong.\n${r.stdout}${r.stderr}`);
  assert.match(r.stderr, /bogus/);
  assert.match(r.stderr, /publish blocked/);
  assert.ok(!existsSync(join(root, 'data', 'views')), 'nothing written on a blocked publish');
});

test('single-door gate: a second graph parser planted in engine/ is detected; the repo passes', () => {
  const clean = run([singleDoorGate, '--root', repo]);
  assert.equal(clean.status, 0, `repo violates its own single door:\n${clean.stderr}`);

  const root = tmp();
  mkdirSync(join(root, 'engine', 'rules'), { recursive: true });
  writeFileSync(
    join(root, 'engine', 'rules', 'rogue.mjs'),
    "import { readFileSync } from 'node:fs';\nimport { join } from 'node:path';\n" +
      "export const sneak = (root) => readFileSync(join(root, 'data', 'graph', 'base.csv'), 'utf8');\n",
  );
  const r = run([singleDoorGate, '--root', root]);
  assert.notEqual(r.status, 0, 'mutation NOT detected — the gate is wrong');
  assert.match(r.stderr, /single-door/);
});
