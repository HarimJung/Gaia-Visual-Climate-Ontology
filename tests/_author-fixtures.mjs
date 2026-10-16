// Shared synthetic-root builder for the WP-08 tests (not a test file itself).
// Builds a minimal repo root — graph via the real column contract, generated
// vocab copied from the repo, hand-built view JSON — so every verdict rule and
// both sides of the AD-12 threshold are testable without touching live data.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASE_COLUMNS, DERIVED_COLUMNS } from '../engine/build/rows.mjs';

export const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const BID = 'ab'.repeat(32); // synthetic 64-hex build id

const vocabSrc = readFileSync(join(repo, 'engine', 'generated', 'vocab.json'), 'utf8');

export const baseRow = (o) =>
  [
    o.iso3 ?? 'ZZA',
    o.record_key,
    o.value ?? 'x',
    o.state ?? 'observed',
    o.reason ?? '',
    o.anchor_kind ?? 'file',
    o.anchor_source_id ?? 'src-a',
    o.anchor_sha256 ?? 'e'.repeat(64),
    o.anchor_locator ?? 'loc',
    o.retrieved_at ?? '',
  ].join(',');

export const vrow = (o) => ({
  size_bytes: null,
  pages: o.pages ?? null,
  quote: o.quote ?? null,
  refusal: null,
  receipt_scope: null,
  provenance: [],
  doc_id: o.doc_id,
  title: o.title ?? o.doc_id,
  doc_type: o.doc_type ?? 'ndc',
  date: o.date ?? '',
  source_url: o.source_url ?? '',
  sha256: o.sha256 ?? '',
  official_english: 'unknown',
  state: o.state ?? 'observed',
  state_reason: o.state_reason ?? '',
});

export function makeRoot({
  cleanup,
  baseRows = [],
  views = {}, // { ZZA: [vrow, ...] }
  builtAt = '2026-01-31T00:00:00.000Z',
  contracts = [{ source_id: 'src-a', staleness_budget_days: 30 }],
  viewBuildId = BID,
} = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'wp08-root-'));
  if (cleanup) cleanup.push(dir);
  const put = (rel, content) => {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), content);
  };
  put('engine/generated/vocab.json', vocabSrc);
  for (const c of contracts) {
    put(`engine/sources/contracts/${c.source_id}.json`, JSON.stringify(c) + '\n');
  }
  put('data/graph/base.csv', [BASE_COLUMNS.join(','), ...baseRows].join('\n') + '\n');
  put('data/graph/derived.csv', DERIVED_COLUMNS.join(',') + '\n');
  put('data/graph/build.json', JSON.stringify({ build_id: BID, built_at: builtAt }) + '\n');
  put('data/graph/census.json', '{}\n');
  for (const [iso3, rows] of Object.entries(views)) {
    const v = {
      view: 'country-ledger',
      as_of: builtAt.slice(0, 10),
      build_id: viewBuildId,
      country: { iso3, name_en: `Country ${iso3}` },
      rows,
    };
    put(`data/views/countries/${iso3.toLowerCase()}.json`, JSON.stringify(v, null, 1) + '\n');
  }
  return dir;
}

// A root whose graph is healthy (one fresh anchored row) with the given views.
export function makeViewRoot(views, cleanup) {
  return makeRoot({
    cleanup,
    baseRows: [baseRow({ record_key: 'k.fresh', retrieved_at: '2026-01-30T00:00:00.000Z' })],
    views,
  });
}
