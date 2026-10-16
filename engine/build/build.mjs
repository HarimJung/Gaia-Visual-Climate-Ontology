// WP-05 graph builder. Assembles data/graph/ (base.csv, derived.csv,
// build.json, census.json) from the committed source snapshots and seeds.
//
//   R1  no instance literals: every country set below is read from data —
//       registry parties, status-list rows, listing folders, seed directories.
//   R3  derived rows are produced by engine/rules/ and written only to
//       derived.csv.
//   R5  publish blocking: every row must carry a full anchor or a state with a
//       reason. Any unresolved row aborts the whole build — nothing is
//       written, exit 1, the offending input is named.
//
// Determinism: two runs on identical inputs produce byte-identical CSVs and
// the same build_id (sha256 over the two CSVs' bytes). The wall clock appears
// only as built_at in build.json, outside the hashed bytes.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCSVWithHeader } from '../lib/csv.mjs';
import { BASE_COLUMNS, DERIVED_COLUMNS, rowProblems, toCSV } from './rows.mjs';
import { graphDirOf } from '../reader/reader.mjs';
import { computeCensus } from './census.mjs';
import { derive } from '../rules/standing.mjs';

function arg(name, dflt) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? resolve(process.argv[i + 1]) : dflt;
}
const root = arg('--root', resolve(dirname(fileURLToPath(import.meta.url)), '..', '..'));

function fail(msg) {
  console.error(`build: ${msg}`);
  process.exit(1);
}
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

// ---------------------------------------------------------------- inputs
const vocabPath = join(root, 'engine', 'generated', 'vocab.json');
if (!existsSync(vocabPath)) fail('engine/generated/vocab.json missing — run codegen first (R2)');
const vocabBytes = readFileSync(vocabPath);
const vocab = JSON.parse(vocabBytes.toString('utf8'));
const states = (vocab.facet_values?.['FACET-EPISTEMIC-STATE'] ?? []).map((s) => String(s).toLowerCase());
if (states.length === 0) fail('generated vocabulary carries no epistemic states');

const versionPath = join(root, 'engine', 'seed', 'platform', 'VERSION');
if (!existsSync(versionPath)) fail('engine/seed/platform/VERSION missing');
const seedVersion = readFileSync(versionPath, 'utf8').trim();

const srcDir = join(root, 'data', 'sources');
const sources = {};
if (existsSync(srcDir)) {
  for (const f of readdirSync(srcDir).sort()) {
    if (!f.endsWith('.json') || f === 'MANIFEST.json') continue;
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(join(srcDir, f), 'utf8'));
    } catch (e) {
      fail(`data/sources/${f}: ${e.message}`);
    }
    if (!parsed.source_id) fail(`data/sources/${f}: no source_id`);
    if (sources[parsed.source_id]) fail(`duplicate source_id "${parsed.source_id}" in data/sources`);
    sources[parsed.source_id] = parsed;
  }
}
const ADAPTERS = {
  registry: fromRegistry,
  untc: fromUntc,
  'btr-listing': fromBtr,
  'ndc-docs': fromNdcDocs,
};
for (const id of Object.keys(sources)) {
  if (!ADAPTERS[id]) {
    fail(`data/sources carries source_id "${id}" this builder does not represent — refusing to publish a graph that silently omits an input (R5)`);
  }
}
for (const id of Object.keys(ADAPTERS)) {
  if (!sources[id]) fail(`required source snapshot "${id}" missing from data/sources`);
}

// ---------------------------------------------------------------- identity
// Party identity comes from data only: the registry snapshot's code column,
// plus the alias seed for spellings the other sources use. A spelling that
// resolves nowhere becomes its own subject with a party.identity.* row in
// state unknown — never dropped, never guessed.
const normName = (s) => {
  let t = String(s).replace(/_/g, ' ').normalize('NFKD').replace(/[̀-ͯ]/g, '');
  t = t.toLowerCase().replace(/’/g, "'");
  t = t.replace(/\s*\(\*+\)\s*$/, ''); // footnote marker suffix
  t = t.replace(/\s*\(the\)\s*$/, ''); // trailing article
  t = t.replace(/^the\s+/, '');
  t = t.replace(/\bst\.\s*/g, 'saint ');
  return t.replace(/\s+/g, ' ').trim();
};
const slug = (s) => normName(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const codeByName = new Map();
for (const p of sources.registry.parties ?? []) codeByName.set(normName(p.party), p.code);
const aliasPath = join(root, 'engine', 'seed', 'platform', 'aliases', 'party_aliases.csv');
const aliasByName = new Map();
if (existsSync(aliasPath)) {
  for (const r of parseCSVWithHeader(readFileSync(aliasPath, 'utf8')).rows) {
    aliasByName.set(normName(r.alias), r.iso3);
  }
}
const unresolved = new Map(); // subject slug -> { raw, sightings: Map(source -> anchor) }
function subjectOf(rawName, sighting) {
  const n = normName(rawName);
  const code = codeByName.get(n) ?? aliasByName.get(n);
  if (code) return code;
  const s = slug(rawName) || 'unnamed';
  if (!unresolved.has(s)) unresolved.set(s, { raw: rawName, sightings: new Map() });
  const u = unresolved.get(s);
  if (!u.sightings.has(sighting.source)) u.sightings.set(sighting.source, sighting);
  return s;
}

// ---------------------------------------------------------------- assembly
const base = [];
const push = (row) => base.push(row);
const stamps = {}; // per-source input stamps for build.json

// Keys that distinct raw inputs can legitimately collide on (two folder
// spellings that slug alike) get a deterministic ~2 suffix in input order.
// ponytail: counter suffix, not content hashes — upgrade if variants multiply.
function uniquer() {
  const seen = new Set();
  return (subject, key) => {
    let k = key;
    let i = 1;
    while (seen.has(`${subject}\u0000${k}`)) k = `${key}~${++i}`;
    seen.add(`${subject}\u0000${k}`);
    return k;
  };
}

function fromRegistry(d) {
  stamps.registry = { snapshot_sha256: d.snapshot_sha256 ?? '', retrieved_at: d.retrieved_at ?? '' };
  for (const p of d.parties ?? []) {
    const anchor = {
      anchor_kind: 'dataset',
      anchor_source_id: 'registry',
      anchor_sha256: d.snapshot_sha256 ?? '',
      anchor_locator: `row code=${p.code}`,
      retrieved_at: d.retrieved_at ?? '',
    };
    push({ iso3: p.code, record_key: 'ndc.registry.listed', value: p.party, state: 'observed', reason: '', ...anchor });
    if (p.latest) {
      const at = { ...anchor, anchor_locator: `row code=${p.code} latest` };
      push({ iso3: p.code, record_key: 'ndc.registry.latest.title', value: p.latest.title ?? '', state: 'observed', reason: '', ...at });
      push({ iso3: p.code, record_key: 'ndc.registry.latest.date', value: p.latest.submission_date ?? '', state: 'observed', reason: '', ...at });
    }
  }
}

function fromUntc(d) {
  stamps.untc = {};
  for (const doc of d.documents ?? []) {
    const t = doc.treaty;
    stamps.untc[doc.key] = { snapshot_sha256: doc.snapshot_sha256 ?? '', retrieved_at: doc.retrieved_at ?? '' };
    const src = { anchor_source_id: 'untc', anchor_sha256: doc.snapshot_sha256 ?? '', retrieved_at: doc.retrieved_at ?? '' };
    const headerAnchor = {
      anchor_kind: 'sentence',
      ...src,
      anchor_locator: `status list header: signatories=${doc.signatories_header}, parties=${doc.parties_header}`,
    };
    push({ iso3: doc.key, record_key: `treaty.${t}.signatories.header`, value: String(doc.signatories_header ?? ''), state: 'observed', reason: '', ...headerAnchor });
    push({ iso3: doc.key, record_key: `treaty.${t}.parties.header`, value: String(doc.parties_header ?? ''), state: 'observed', reason: '', ...headerAnchor });
    for (const par of doc.participants ?? []) {
      const sig = par.signature;
      const act = par.action;
      const cell = (v, bracketed) => (v ? `${v}${bracketed ? ' [bracketed]' : ''}` : '(empty cell)');
      const rowText =
        `${par.participant} | signature ${cell(sig?.date, sig?.bracketed)}` +
        ` | action ${act ? cell(`${act.date ?? ''}${act.kind ? ' ' + act.kind : ''}`.trim(), act.bracketed) : '(empty cell)'}`;
      const anchor = { anchor_kind: 'cell', ...src, anchor_locator: `page ${par.page}, row: ${rowText}` };
      const subject = subjectOf(par.participant, { source: 'untc', raw: par.participant, ...anchor });
      // A bracketed entry is printed by the depositary but excluded from its
      // own totals — recorded here as unknown with the date kept, never as a
      // plain observation, so the census reconciles with the printed totals.
      const BRACKETED = 'the entry is bracketed in the depositary status list and excluded from its printed totals';
      if (sig?.date) {
        const st = sig.bracketed ? { state: 'unknown', reason: BRACKETED } : { state: 'observed', reason: '' };
        push({ iso3: subject, record_key: `treaty.${t}.signature.date`, value: sig.date, ...st, ...anchor });
      } else {
        push({
          iso3: subject,
          record_key: `treaty.${t}.signature.date`,
          value: '',
          state: 'absent',
          reason: 'the depositary status list shows this participant with an empty signature cell',
          ...anchor,
        });
      }
      if (act?.date) {
        const st = act.bracketed ? { state: 'unknown', reason: BRACKETED } : { state: 'observed', reason: '' };
        push({ iso3: subject, record_key: `treaty.${t}.action.date`, value: act.date, ...st, ...anchor });
        if (act.kind) {
          push({ iso3: subject, record_key: `treaty.${t}.action.kind`, value: act.kind, ...st, ...anchor });
        }
      } else {
        push({
          iso3: subject,
          record_key: `treaty.${t}.action.date`,
          value: '',
          state: 'absent',
          reason: 'the depositary status list shows this participant with an empty action cell',
          ...anchor,
        });
      }
    }
  }
}

function fromBtr(d) {
  stamps['btr-listing'] = { snapshot_sha256: d.snapshot_sha256 ?? '', retrieved_at: d.retrieved_at ?? '' };
  const unique = uniquer();
  for (const p of d.parties ?? []) {
    const name = p.party_folder;
    const anchor = {
      anchor_kind: 'listing',
      anchor_source_id: 'btr-listing',
      anchor_sha256: d.snapshot_sha256 ?? '',
      anchor_locator: `folder "${name}"`,
      retrieved_at: d.retrieved_at ?? '',
    };
    const subject = subjectOf(name, { source: 'btr-listing', raw: name, ...anchor });
    const folder = unique(subject, slug(name) || 'folder');
    push({ iso3: subject, record_key: `btr.folder.${folder}.listed`, value: name, state: 'observed', reason: '', ...anchor });
    if (!p.btr) {
      push({
        iso3: subject,
        record_key: `btr.folder.${folder}.reports`,
        value: '',
        state: 'unknown',
        reason: 'the listing snapshot shows no report subfolder under this party folder; submission state is unknown, never asserted false',
        ...anchor,
      });
      continue;
    }
    for (const k of Object.keys(p.btr).sort()) {
      const v = p.btr[k];
      const sub = { ...anchor, anchor_locator: `folder "${name}/${k}"` };
      if (v && v.submitted === true) {
        push({ iso3: subject, record_key: `btr.folder.${folder}.${slug(k)}.submitted`, value: 'true', state: 'observed', reason: '', ...sub });
      } else {
        push({
          iso3: subject,
          record_key: `btr.folder.${folder}.${slug(k)}.submitted`,
          value: '',
          state: 'unknown',
          reason: 'the report folder is listed but the listing does not mark it submitted; unknown, never false',
          ...sub,
        });
      }
    }
  }
}

function fromNdcDocs(d) {
  stamps['ndc-docs'] = { index_sha256: d.index_sha256 ?? '', index_retrieved_at: d.index_retrieved_at ?? '' };
  const unique = uniquer();
  for (const o of d.outcomes ?? []) {
    const subject = o.code;
    const key = `ndc.document.${unique(subject, slug(o.original_filename || o.key || '') || 'document')}`;
    if (o.outcome === 'ok' && o.sha256) {
      push({
        iso3: subject,
        record_key: key,
        value: o.sha256,
        state: 'observed',
        reason: '',
        anchor_kind: 'file',
        anchor_source_id: 'ndc-docs',
        anchor_sha256: o.sha256,
        anchor_locator: o.url ?? o.key ?? '',
        retrieved_at: o.retrieved_at ?? '',
      });
    } else {
      const why = [o.outcome, o.reason, o.mirror_reason].filter(Boolean).join('; ');
      push({
        iso3: subject,
        record_key: key,
        value: '',
        state: 'unknown',
        reason: `document is indexed but its bytes are not held: ${why}`,
        anchor_kind: 'dataset',
        anchor_source_id: 'ndc-docs',
        anchor_sha256: d.index_sha256 ?? '',
        anchor_locator: `index row key=${o.key}`,
        retrieved_at: d.index_retrieved_at ?? '',
      });
    }
  }
}

for (const id of Object.keys(ADAPTERS).sort()) ADAPTERS[id](sources[id]);

// Country seed ledgers — discovered by directory enumeration, never named in
// code (R1). A seed directory enriches its own subject and nothing else.
const countriesDir = join(root, 'engine', 'seed', 'countries');
const countrySeeds = {};
if (existsSync(countriesDir)) {
  for (const e of readdirSync(countriesDir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (!e.isDirectory()) continue;
    const p = join(countriesDir, e.name, 'documents.csv');
    if (!existsSync(p)) continue;
    const bytes = readFileSync(p);
    countrySeeds[e.name] = sha256(bytes);
    let rows;
    try {
      rows = parseCSVWithHeader(bytes.toString('utf8')).rows;
    } catch (err) {
      fail(`country seed ${e.name}/documents.csv: ${err.message}`);
    }
    for (const r of rows) {
      const hasSha = /^[0-9a-f]{64}$/.test(r.sha256 ?? '');
      push({
        iso3: e.name,
        record_key: `ledger.${r.doc_id}`,
        value: r.title ?? '',
        state: r.state ?? '',
        reason: r.state_reason ?? '',
        anchor_kind: hasSha ? 'file' : '',
        anchor_source_id: hasSha ? 'country-seed' : '',
        anchor_sha256: hasSha ? r.sha256 : '',
        anchor_locator: hasSha ? `${e.name}/documents.csv doc_id=${r.doc_id}; url=${r.source_url ?? ''}` : '',
        retrieved_at: '',
      });
      // The rest of the ledger row, field by field, so the whole seed flows
      // builder → reader → view without any consumer re-opening the seed.
      // Each field is observed in the ledger file itself, whose own hash is
      // the anchor (the verifier records seed-file hashes as held inputs).
      for (const col of ['doc_type', 'date', 'source_url', 'sha256', 'size_bytes', 'pages', 'official_english', 'note']) {
        if (!r[col]) continue;
        push({
          iso3: e.name,
          record_key: `ledger-field.${r.doc_id}.${col}`,
          value: r[col],
          state: 'observed',
          reason: '',
          anchor_kind: 'dataset',
          anchor_source_id: 'country-seed',
          anchor_sha256: countrySeeds[e.name],
          anchor_locator: `${e.name}/documents.csv doc_id=${r.doc_id} field=${col}`,
          retrieved_at: '',
        });
      }
    }
  }
}

// Unresolved spellings: an honest record, not a silent drop.
for (const [s, info] of [...unresolved].sort(([a], [b]) => (a < b ? -1 : 1))) {
  for (const [src, g] of [...info.sightings].sort(([a], [b]) => (a < b ? -1 : 1))) {
    push({
      iso3: s,
      record_key: `party.identity.${src}`,
      value: g.raw,
      state: 'unknown',
      reason: `spelling "${g.raw}" in source "${src}" matches no registry party name and no alias; the subject is keyed by its normalized spelling`,
      anchor_kind: g.anchor_kind,
      anchor_source_id: g.anchor_source_id,
      anchor_sha256: g.anchor_sha256,
      anchor_locator: g.anchor_locator,
      retrieved_at: g.retrieved_at,
    });
  }
}

// ---------------------------------------------------------------- derive, check, block
const derived = derive(base, vocab);

const cmp = (a, b) =>
  a.iso3 < b.iso3 ? -1 : a.iso3 > b.iso3 ? 1 : a.record_key < b.record_key ? -1 : a.record_key > b.record_key ? 1 : a.anchor_locator < b.anchor_locator ? -1 : a.anchor_locator > b.anchor_locator ? 1 : 0;
base.sort(cmp);
derived.sort(cmp);

const problems = [];
for (const [label, rows] of [['base', base], ['derived', derived]]) {
  let prev = null;
  for (const r of rows) {
    for (const p of rowProblems(r, states)) {
      problems.push(`${label} ${r.iso3} ${r.record_key} [source ${r.anchor_source_id || 'none'}]: ${p}`);
    }
    if (prev && prev.iso3 === r.iso3 && prev.record_key === r.record_key) {
      problems.push(`${label} ${r.iso3} ${r.record_key}: duplicate (subject, record_key)`);
    }
    prev = r;
  }
}
if (problems.length > 0) {
  for (const p of problems.slice(0, 50)) console.error(`build: R5 ${p}`);
  if (problems.length > 50) console.error(`build: R5 … and ${problems.length - 50} more`);
  fail(`${problems.length} unresolved row(s) — publish blocked, nothing written (R5)`);
}

// ---------------------------------------------------------------- write
const sortDeep = (v) =>
  Array.isArray(v)
    ? v.map(sortDeep)
    : v && typeof v === 'object'
      ? Object.fromEntries(
          Object.entries(v)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([k, w]) => [k, sortDeep(w)]),
        )
      : v;

const baseCSV = toCSV(BASE_COLUMNS, base);
const derivedCSV = toCSV(DERIVED_COLUMNS, derived);
const buildId = sha256(Buffer.concat([Buffer.from(baseCSV), Buffer.from(derivedCSV)]));
const census = computeCensus(base, derived, states);
const buildMeta = {
  build_id: buildId,
  built_at: new Date().toISOString(),
  inputs: sortDeep({
    platform_seed_version: seedVersion,
    vocab_sha256: sha256(vocabBytes),
    country_seeds: countrySeeds,
    sources: stamps,
  }),
  counts: { base_rows: base.length, derived_rows: derived.length },
};

const outDir = graphDirOf(root);
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'base.csv'), baseCSV);
writeFileSync(join(outDir, 'derived.csv'), derivedCSV);
writeFileSync(join(outDir, 'census.json'), JSON.stringify(census, null, 2) + '\n');
writeFileSync(join(outDir, 'build.json'), JSON.stringify(buildMeta, null, 2) + '\n');
console.log(
  `graph: ${base.length} base + ${derived.length} derived rows, ${census.entities_with_record} subjects ` +
    `(${census.countries_with_record} with a party code), build ${buildId}`,
);
