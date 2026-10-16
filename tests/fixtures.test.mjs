// Fixture honesty harness (WP-07). The app's view JSON and census are
// hand-built stand-ins for the WP-06 reader, so every value they carry must be
// recomputable from, or quoted verbatim out of, the country ledgers in
// engine/seed — nothing invented, nothing dropped. Country identity is never
// named here: ledgers and views are enumerated (R1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCSVWithHeader } from '../engine/lib/csv.mjs';
import { countsFromRows } from '../app/src/lib/derive.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const ledgerRows = [];
const countriesDir = join(repo, 'engine', 'seed', 'countries');
for (const e of readdirSync(countriesDir, { withFileTypes: true })) {
  if (!e.isDirectory()) continue;
  const p = join(countriesDir, e.name, 'documents.csv');
  if (existsSync(p)) ledgerRows.push(...parseCSVWithHeader(readFileSync(p, 'utf8')).rows);
}

const census = JSON.parse(readFileSync(join(repo, 'app', 'fixtures', 'census.json'), 'utf8'));
const viewsDir = join(repo, 'app', 'fixtures', 'views');
const views = readdirSync(viewsDir)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => JSON.parse(readFileSync(join(viewsDir, f), 'utf8')));

const vocab = JSON.parse(readFileSync(join(repo, 'engine', 'generated', 'vocab.json'), 'utf8'));
const STATES = new Set(vocab.facet_values['FACET-EPISTEMIC-STATE'].map((s) => s.toLowerCase()));

test('census counts are recomputable from the ledgers', () => {
  const by = (f) => ledgerRows.filter(f).length;
  assert.deepEqual(census.counts, {
    documents_on_record: ledgerRows.length,
    documents_with_bytes: by((r) => r.sha256 !== ''),
    documents_without_bytes: by((r) => r.sha256 === ''),
    source_urls_recorded: by((r) => r.source_url !== ''),
    states_observed: by((r) => r.state === 'observed'),
    states_pledged: by((r) => r.state === 'pledged'),
    states_unknown: by((r) => r.state === 'unknown'),
    states_absent: by((r) => r.state === 'absent'),
  });
});

test('every census count carries a derivation sentence', () => {
  assert.deepEqual(Object.keys(census.derivations).sort(), Object.keys(census.counts).sort());
  for (const d of Object.values(census.derivations)) assert.ok(d.length > 0);
});

test('view rows mirror the ledger exactly — no invented or dropped values', () => {
  const byId = new Map(ledgerRows.map((r) => [r.doc_id, r]));
  const viewRows = views.flatMap((v) => v.rows);
  assert.equal(viewRows.length, ledgerRows.length, 'every ledger row appears in a view');
  for (const row of viewRows) {
    const src = byId.get(row.doc_id);
    assert.ok(src, `${row.doc_id} exists in a ledger`);
    for (const k of ['title', 'doc_type', 'date', 'source_url', 'sha256', 'official_english', 'state', 'state_reason']) {
      assert.equal(row[k], src[k], `${row.doc_id}.${k} matches the ledger`);
    }
    for (const k of ['size_bytes', 'pages']) {
      assert.equal(row[k] === null ? '' : String(row[k]), src[k], `${row.doc_id}.${k} matches the ledger`);
    }
    if (row.quote) {
      assert.ok(src.note.includes(row.quote.text), `${row.doc_id} quote text is verbatim in the ledger note`);
      assert.ok(src.note.includes(row.quote.reading), `${row.doc_id} quote reading is verbatim in the ledger note`);
    }
    if (row.refusal) {
      assert.ok(src.state_reason.includes(row.refusal), `${row.doc_id} refusal is verbatim from state_reason`);
    }
    for (const p of row.provenance) {
      assert.ok(src.note.includes(p), `${row.doc_id} provenance item is verbatim in the ledger note: "${p}"`);
    }
  }
});

test('treaty-status figures trace to a receipt that holds a page quote', () => {
  for (const v of views) {
    for (const t of v.treaty_status) {
      const row = v.rows.find((r) => r.doc_id === t.receipt);
      assert.ok(row && row.quote, `${t.treaty_label} points at a row with a quote`);
      for (const ev of t.events) {
        assert.ok(row.quote.reading.includes(ev.date), `${ev.date} appears in the quote reading`);
        assert.ok(row.quote.text.includes(ev.display), `"${ev.display}" appears verbatim in the quote`);
      }
    }
  }
});

test('views speak only the four-state vocabulary, with reasons where state is unknown', () => {
  for (const v of views) {
    for (const r of v.rows) {
      assert.ok(STATES.has(r.state), `${r.doc_id} state "${r.state}" is canon vocabulary`);
      if (r.state === 'unknown') assert.ok(r.state_reason.length > 0, `${r.doc_id} unknown carries a reason`);
    }
    assert.ok(STATES.has(v.next_date.state));
    if (v.next_date.state === 'unknown') assert.ok(v.next_date.reason.length > 0);
    assert.ok(v.next_date.date === null || typeof v.next_date.date === 'string');
    // A shown date is a figure: it must carry its label and a receipt naming a
    // ledger row, or the template would render an untraceable number.
    if (v.next_date.date !== null) {
      assert.ok(typeof v.next_date.label === 'string' && v.next_date.label.length > 0, 'a shown next date carries its label');
      assert.ok(
        v.rows.some((r) => r.doc_id === v.next_date.receipt),
        'next_date.receipt names a ledger row in this view',
      );
    }
    for (const s of v.strip.segments) {
      assert.ok(s.census_key in census.counts, `strip segment "${s.label}" counts via a census key`);
    }
  }
});

// ---------------------------------------------------------------------------
// World surface (WP-07): the checks below run against whichever views
// directory is active — the reader's data/views when it holds country views,
// else the fixtures — exactly the door's own order (app/src/lib/data.mjs).
const readerDir = join(repo, 'data', 'views');
const readerCountries = join(readerDir, 'countries');
const readerActive =
  existsSync(readerCountries) && readdirSync(readerCountries).some((f) => f.endsWith('.json'));
const activeViews = readerActive
  ? readdirSync(readerCountries)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .map((f) => JSON.parse(readFileSync(join(readerCountries, f), 'utf8')))
  : views;
const activeCensus = readerActive
  ? JSON.parse(readFileSync(join(readerDir, 'census.json'), 'utf8'))
  : census;

test('world index: per-country counts recompute from the active views', () => {
  assert.ok(activeViews.length > 0, 'at least one country view is active');
  const seen = new Set();
  for (const v of activeViews) {
    assert.ok(!seen.has(v.country.iso3), `${v.country.iso3} appears in exactly one view`);
    seen.add(v.country.iso3);
    const c = countsFromRows(v.rows, Object.keys(activeCensus.counts));
    assert.equal(c.documents_on_record, v.rows.length, `${v.country.iso3} documents_on_record`);
    assert.equal(
      c.documents_with_bytes + c.documents_without_bytes,
      v.rows.length,
      `${v.country.iso3} bytes/no-bytes partition the rows`,
    );
    const stateSum = Object.entries(c)
      .filter(([k]) => k.startsWith('states_'))
      .reduce((n, [, x]) => n + x, 0);
    assert.equal(stateSum, v.rows.length, `${v.country.iso3} states partition the rows`);
    for (const [k, n] of Object.entries(c)) {
      assert.ok(Number.isInteger(n) && n >= 0, `${v.country.iso3} ${k} is a non-negative integer`);
      assert.ok(k in activeCensus.derivations, `${v.country.iso3} count key "${k}" has a derivation sentence`);
    }
  }
});

test(
  'reader index.json matches the active views one-to-one, counts recomputed',
  { skip: !readerActive && 'fixture fallback active — no reader index yet' },
  () => {
    const idx = JSON.parse(readFileSync(join(readerDir, 'index.json'), 'utf8'));
    assert.ok(typeof idx.as_of === 'string' && idx.as_of.length > 0, 'index carries as_of');
    assert.equal(idx.countries.length, activeViews.length, 'one index row per country view');
    const byIso = new Map(idx.countries.map((c) => [c.iso3, c]));
    for (const v of activeViews) {
      const e = byIso.get(v.country.iso3);
      assert.ok(e, `${v.country.iso3} present in index.json`);
      assert.equal(e.name_en, v.country.name_en, `${v.country.iso3} name_en matches its view`);
      assert.ok(typeof e.ledger === 'string' && e.ledger.length > 0, `${v.country.iso3} entry names its ledger`);
      assert.deepEqual(
        e.counts,
        countsFromRows(v.rows, Object.keys(activeCensus.counts)),
        `${v.country.iso3} index counts recompute from its view rows`,
      );
    }
  },
);

test('no percentage anywhere: strip copy, derivations, and the built world ledger', () => {
  for (const v of activeViews) {
    for (const s of [v.strip.heading, v.strip.note, ...v.strip.segments.map((x) => x.label)]) {
      assert.ok(!s.includes('%'), `strip text carries a percentage: "${s}"`);
    }
  }
  for (const d of Object.values(activeCensus.derivations)) {
    assert.ok(!d.includes('%'), `census derivation carries a percentage: "${d}"`);
  }
  // The world ledger moved from / to /ledger/ when the story became the front door.
  const built = join(repo, 'app', 'dist', 'ledger', 'index.html');
  if (!existsSync(built)) return; // CI builds before tests run, so this arm is armed there
  const text = readFileSync(built, 'utf8')
    .replace(/<(script|style)[\s\S]*?<\/\1>/g, ' ')
    .replace(/<[^>]*>/g, ' '); // attributes (URL-encoded hrefs) drop with the tags
  assert.ok(!text.includes('%'), 'the built world ledger renders a percentage');
});

test('built world ledger: one row per active view, every count linked to that country census row', () => {
  const built = join(repo, 'app', 'dist', 'ledger', 'index.html');
  if (!existsSync(built)) return; // CI builds before tests run, so this arm is armed there
  const html = readFileSync(built, 'utf8');
  for (const v of activeViews) {
    const iso3 = v.country.iso3.toLowerCase();
    assert.ok(html.includes(`href="/country/${iso3}/"`), `${v.country.iso3} row links to its country page`);
    const keys = ['documents_on_record', 'documents_with_bytes', ...v.strip.segments.map((s) => s.census_key)];
    for (const key of keys) {
      assert.ok(
        html.includes(`href="/country/${iso3}/#census-${key}"`),
        `${v.country.iso3} ${key} figure links to that country's census row`,
      );
    }
  }
});
