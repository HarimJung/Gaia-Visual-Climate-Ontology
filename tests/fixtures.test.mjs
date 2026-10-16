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
