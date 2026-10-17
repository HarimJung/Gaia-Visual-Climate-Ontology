// Mutation harness: every gate must detect its planted violation and pass a
// clean fixture. Doctrine: an undetected mutation means the TEST is wrong,
// never the rule.
//
// Note on self-reference: this file is itself scanned by the r7 gate, so the
// banned golden-overwrite phrases are assembled at runtime (GOLD / IF below)
// and never appear verbatim in this source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const gatesDir = join(repo, 'engine', 'gates');
const codegen = join(repo, 'engine', 'tools', 'codegen.mjs');
const updateGolden = join(repo, 'tools', 'update-golden.mjs');

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

function fixture(files) {
  const dir = mkdtempSync(join(tmpdir(), 'wp01-fixture-'));
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

function gate(name, root) {
  return run([join(gatesDir, name), '--root', root]);
}

function detected(r) {
  assert.notEqual(r.status, 0, `mutation NOT detected — the test or gate is wrong.\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
}

function clean(r) {
  assert.equal(r.status, 0, `expected a pass.\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
}

// ---------------------------------------------------------------- r1

test('r1 detects a 3-letter uppercase instance literal', () => {
  const dir = fixture({
    'engine/build/compose.mjs': "export const hit = (iso3) => iso3 === 'KHM';\n",
  });
  const r = gate('r1-no-instance-literals.mjs', dir);
  detected(r);
  assert.match(r.stderr, /KHM/);
});

test('r1 detects a country display name from the seed in code strings', () => {
  const dir = fixture({
    'engine/seed/countries/cambodia/README.md': '# country seed placeholder\n',
    'engine/render.mjs': 'export const label = "Cambodia national record";\n',
  });
  detected(gate('r1-no-instance-literals.mjs', dir));
});

test('r1 allows tokens listed in allow-tla.csv', () => {
  const dir = fixture({
    'engine/gates/allow-tla.csv': 'token,reason\nGET,http verb\n',
    'engine/net.mjs': "export const method = 'GET';\n",
  });
  clean(gate('r1-no-instance-literals.mjs', dir));
});

test('r1 ignores engine/generated and engine/seed', () => {
  const dir = fixture({
    'engine/generated/vocab.ts': "export const LEGACY = 'KHM';\n",
    'engine/seed/notes.mjs': "export const code = 'KHM';\n",
    'engine/clean.mjs': 'export const ok = 1;\n',
  });
  clean(gate('r1-no-instance-literals.mjs', dir));
});

test('r1 detects a 3-letter instance literal in an .astro frontmatter string', () => {
  const dir = fixture({
    'app/src/pages/index.astro': "---\nconst code = 'KHM';\n---\n<p>{code}</p>\n",
  });
  const r = gate('r1-no-instance-literals.mjs', dir);
  detected(r);
  assert.match(r.stderr, /KHM/);
});

// These two mirror the real repo's shape: the seed directory carries only the
// ISO3 code and the display name lives only in the view fixture's country
// block — the gate must derive its needle from the view data.
test('r1 detects a view-data country name in .astro markup text, outside any string literal', () => {
  const dir = fixture({
    'engine/seed/countries/ZZZ/documents.csv': 'doc_id,title\n',
    'app/fixtures/views/zzz.json': JSON.stringify({ country: { iso3: 'ZZZ', name_en: 'Zephyria' } }),
    'app/src/pages/index.astro': '<h1>Zephyria national ledger</h1>\n',
  });
  detected(gate('r1-no-instance-literals.mjs', dir));
});

test('r1 detects a view-data country name in a code string', () => {
  const dir = fixture({
    'engine/seed/countries/ZZZ/documents.csv': 'doc_id,title\n',
    'app/fixtures/views/zzz.json': JSON.stringify({ country: { iso3: 'ZZZ', name_en: 'Zephyria' } }),
    'app/src/lib/data.mjs': "export const planted = 'Zephyria ledger';\n",
  });
  detected(gate('r1-no-instance-literals.mjs', dir));
});

test('r1 ignores app/dist build output but still scans app sources', () => {
  const dir = fixture({
    'app/dist/receipt/x/bundle.js': "export const c = 'KHM';\n",
    'app/src/lib/ok.mjs': 'export const ok = 1;\n',
  });
  clean(gate('r1-no-instance-literals.mjs', dir));
});

// ---------------------------------------------------------------- r11

test('r11 detects an app source importing engine internals', () => {
  const dir = fixture({
    'app/src/lib/bad.mjs': "import vocab from '../../../engine/generated/vocab.json';\n",
  });
  const r = gate('r11-front-imports.mjs', dir);
  detected(r);
  assert.match(r.stderr, /engine\/generated/);
});

test('r11 detects an engine-reaching import.meta.glob in app code', () => {
  const dir = fixture({
    'app/src/lib/bad.mjs': "const seeds = import.meta.glob('../../../engine/seed/**/*.csv');\n",
  });
  detected(gate('r11-front-imports.mjs', dir));
});

test('r11 passes the fixtures-only door', () => {
  const dir = fixture({
    'app/src/lib/data.mjs':
      "const views = import.meta.glob('../../fixtures/views/*.json');\nexport default views;\n",
  });
  clean(gate('r11-front-imports.mjs', dir));
});

// ------------------------------------------- r6 (reversed: unlinked figures)

test('r6 detects a bare numeral rendered outside a link in built HTML', () => {
  const dir = fixture({
    'app/dist/index.html': '<html><body><main><p>7 documents</p></main></body></html>\n',
  });
  const r = gate('r6-figures-linked.mjs', dir);
  detected(r);
  assert.match(r.stderr, /"7"/);
});

test('r6 passes figures inside links, verbatim-record blocks and marked metadata', () => {
  const dir = fixture({
    'app/dist/index.html':
      '<html><body><main><p><a href="/receipt/x/">7</a> documents</p>' +
      '<div class="refusal">states 16%, 24%</div>' +
      '<p class="reason">dated 2020-12-31 by hand</p></main>' +
      '<footer><span data-meta="as_of">as of 2026-10-15</span></footer></body></html>\n',
  });
  clean(gate('r6-figures-linked.mjs', dir));
});

test('r6 passes with a note when there is no build output', () => {
  const dir = fixture({});
  const r = gate('r6-figures-linked.mjs', dir);
  clean(r);
  assert.match(r.stdout, /no app\/dist/);
});

// ---------------------------------------------------------------- r2 vocab canon

test('r2-vocab-canon detects a hand-written TS vocabulary declaration', () => {
  const dir = fixture({ 'engine/types.ts': 'export enum DocState { Observed }\n' });
  detected(gate('r2-vocab-canon.mjs', dir));
});

test('r2-vocab-canon detects z.enum', () => {
  const dir = fixture({ 'engine/schema.mjs': 'const s = z.enum(["a", "b"]);\n' });
  detected(gate('r2-vocab-canon.mjs', dir));
});

test('r2-vocab-canon passes clean code and ignores engine/generated', () => {
  const dir = fixture({
    'engine/ok.ts': 'export type DocState = string;\n',
    'engine/generated/vocab.ts': 'export enum Legacy { A }\n',
  });
  clean(gate('r2-vocab-canon.mjs', dir));
});

// ---------------------------------------------------------------- codegen + r2 freshness

function platformSeed() {
  return {
    'engine/seed/platform/taxonomy/taxonomy_core.csv':
      'id,parent_id,class_code,name_en,name_ko,description_en,description_ko\n' +
      'tx1,,actor,Actor,actor-ko,"An actor, institutional or individual",desc-ko\n' +
      'tx2,tx1,institution,Institution,inst-ko,A public institution,desc-ko\n',
    'engine/seed/platform/relations/relation_types_core.csv':
      'id,relation_code,name_en,name_ko,description_en,description_ko,domain_class_hint,range_class_hint\n' +
      'rl1,administers,Administers,admin-ko,runs a thing,desc-ko,institution,actor\n',
    'engine/seed/platform/facets/facets_core.csv':
      'facet_code,facet_name_ko,applicable_class_codes,cardinality,value_code,label_ko,sort_order,source_standard,source_clause_ref\n' +
      'epistemic_state,state-ko,actor institution,one,observed,observed-ko,1,,\n' +
      'epistemic_state,state-ko,actor institution,one,unknown,unknown-ko,2,,\n',
    'engine/seed/platform/attributes/attributes_core.csv':
      'attribute_code,name_ko,name_en,datatype,unit_code,description_ko\n' +
      'share_pct,share-ko,Share,number,pct,desc-ko\n',
    'engine/seed/platform/units/units_core.csv':
      'unit_code,symbol_canonical,symbol_variants,quantity_kind,factor_to_si,external_ref\n' +
      'pct,%,,dimensionless,0.01,\n',
    // The platform seed carries five layers since 0.3.0; design is one of
    // them, so codegen refuses a seed without it (exit 2). Mutations of the
    // design layer itself live in tests/design.test.mjs.
    'engine/seed/platform/design/tokens_record.csv':
      'token,value,group,note,border_token\n' +
      'colour.paper,#fbfbfa,colour,page ground,\n' +
      'colour.ink,#111417,colour,primary text,\n' +
      'colour.paper-sunken,#f1f1ee,colour,texture fill,\n' +
      'colour.ink-4,#6c737a,colour,texture ink,\n' +
      'neutral.src-a,#4d6477,neutral,ramp step 1 of 2,\n' +
      'neutral.src-b,#8fa3b3,neutral,ramp step 2 of 2,neutral.src-a\n',
    'engine/seed/platform/design/channels_record.csv':
      'axis,channel,token_prefix,note\n' +
      'source-family,neutral-ramp,neutral.,two separable steps\n',
    'engine/seed/platform/design/encodings_record.csv':
      'axis,entity,token,note\n' +
      'source-family,alpha,neutral.src-a,\n',
    'engine/seed/platform/design/textures_record.csv':
      'texture,kind,angle,stroke,note\n' +
      'hatch-45,hatch,45,1.4,diagonal rising\n',
  };
}

test('codegen exits 2 with "no platform seed" when the seed is missing', () => {
  const dir = fixture({});
  const r = run([codegen, '--root', dir]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /no platform seed/);
});

test('codegen is deterministic and parses quoted CSV fields with commas', () => {
  const dir = fixture(platformSeed());
  clean(run([codegen, '--root', dir]));
  const ts1 = readFileSync(join(dir, 'engine/generated/vocab.ts'), 'utf8');
  const json1 = readFileSync(join(dir, 'engine/generated/vocab.json'), 'utf8');
  clean(run([codegen, '--root', dir]));
  assert.equal(readFileSync(join(dir, 'engine/generated/vocab.ts'), 'utf8'), ts1);
  assert.equal(readFileSync(join(dir, 'engine/generated/vocab.json'), 'utf8'), json1);
  const vocab = JSON.parse(json1);
  assert.deepEqual(vocab.class_codes, ['actor', 'institution']);
  assert.deepEqual(vocab.facet_values.epistemic_state, ['observed', 'unknown']);
  assert.match(ts1, /GENERATED — do not edit/);
  assert.match(ts1, /EPISTEMIC_STATE/);
});

test('r2-codegen-fresh skips with a note when there is no seed', () => {
  const dir = fixture({});
  const r = gate('r2-codegen-fresh.mjs', dir);
  clean(r);
  assert.match(r.stdout, /no platform seed/);
});

test('r2-codegen-fresh passes when generated output matches the seed', () => {
  const dir = fixture(platformSeed());
  clean(run([codegen, '--root', dir]));
  clean(gate('r2-codegen-fresh.mjs', dir));
});

test('r2-codegen-fresh detects drift in committed generated output', () => {
  const dir = fixture(platformSeed());
  clean(run([codegen, '--root', dir]));
  appendFileSync(join(dir, 'engine/generated/vocab.json'), '\n');
  detected(gate('r2-codegen-fresh.mjs', dir));
});

// ---------------------------------------------------------------- r7

const GOLD = 'g' + 'olden';
const IF = 'If';

test('r7 detects a copy-command hint in an error message', () => {
  const dir = fixture({
    'engine/check.mjs': `console.error("to update: cp out/actual.json tests/${GOLD}/expected.json");\n`,
  });
  detected(gate('r7-golden-hint.mjs', dir));
});

test('r7 detects an overwrite-approval hint', () => {
  const dir = fixture({
    'tests/compare.test.mjs': `throw new Error("${IF} intended: overwrite the expected file");\n`,
  });
  detected(gate('r7-golden-hint.mjs', dir));
});

test('r7 passes clean error messages', () => {
  const dir = fixture({
    'engine/check.mjs': 'console.error("mismatch: run tools/update-golden.mjs with --reason");\n',
  });
  clean(gate('r7-golden-hint.mjs', dir));
});

// ---------------------------------------------------------------- r8

test('r8 detects a manual deploy command in README', () => {
  const dir = fixture({ 'README.md': '## Ship\n\n    wrangler deploy\n' });
  detected(gate('r8-one-deploy-path.mjs', dir));
});

test('r8 detects a manual deploy command in docs', () => {
  const dir = fixture({ 'README.md': '# ok\n', 'docs/notes.md': 'run vercel --prod to ship\n' });
  detected(gate('r8-one-deploy-path.mjs', dir));
});

test('r8 detects the wider manual deploy vocabulary', () => {
  detected(gate('r8-one-deploy-path.mjs', fixture({ 'docs/n.md': 'netlify deploy --prod\n' })));
  detected(gate('r8-one-deploy-path.mjs', fixture({ 'docs/n.md': 'firebase deploy\n' })));
  detected(gate('r8-one-deploy-path.mjs', fixture({ 'docs/n.md': 'aws s3 sync dist/ s3://bucket\n' })));
  detected(gate('r8-one-deploy-path.mjs', fixture({ 'docs/n.md': 'scp -r dist/ user@host:/var/www\n' })));
});

test('r8 passes a README without deploy commands', () => {
  const dir = fixture({ 'README.md': '# project\n\nnpm test\n' });
  clean(gate('r8-one-deploy-path.mjs', dir));
});

// ---------------------------------------------------------------- r9

test('r9 passes a data tree without stored queues (diff reports are fine)', () => {
  const dir = fixture({
    'data/graph/base.csv': 'iso3\n',
    'data/diff/ab12__cd34.json': '{}\n',
    'data/diff/ab12__cd34.md': '# diff\n',
  });
  clean(gate('r9-no-stored-queue.mjs', dir));
});

test('r9 detects a stored queue file appearing under data/', () => {
  const dir = fixture({ 'data/review-queue.json': '[]\n' });
  detected(gate('r9-no-stored-queue.mjs', dir));
});

test('r9 detects a stored stale-flag file under data/', () => {
  const dir = fixture({ 'data/graph/stale-flags.csv': 'iso3,record_key\n' });
  detected(gate('r9-no-stored-queue.mjs', dir));
});

// ---------------------------------------------------------------- r12

const CLEAN_GITIGNORE = 'node_modules/\ndata/cache/\nengine/cache/\n';

test('r12 detects a .gitignore that does not cover the caches', () => {
  const dir = fixture({ '.gitignore': 'node_modules/\n' });
  detected(gate('r12-cache-uncommitted.mjs', dir));
});

test('r12 detects a cache file tracked by git', () => {
  const dir = fixture({ '.gitignore': CLEAN_GITIGNORE, 'data/cache/snap.json': '{}\n' });
  spawnSync('git', ['-C', dir, 'init', '-q']);
  spawnSync('git', ['-C', dir, 'add', '-f', 'data/cache/snap.json']);
  detected(gate('r12-cache-uncommitted.mjs', dir));
});

test('r12 passes when caches are ignored and untracked', () => {
  const dir = fixture({ '.gitignore': CLEAN_GITIGNORE });
  spawnSync('git', ['-C', dir, 'init', '-q']);
  clean(gate('r12-cache-uncommitted.mjs', dir));
});

// ---------------------------------------------------------------- r14

const CONTRACT = {
  source_id: 'unfccc-ndc-registry',
  url: 'https://example.org/registry',
  staleness_budget_days: 35,
  success_criteria: { min_bytes: 50000, format: 'html' },
};

test('r14 detects a contract missing staleness_budget_days', () => {
  const { staleness_budget_days, ...broken } = CONTRACT;
  void staleness_budget_days;
  const dir = fixture({ 'engine/sources/contracts/unfccc.json': JSON.stringify(broken) });
  detected(gate('r14-source-contracts.mjs', dir));
});

test('r14 passes a complete contract', () => {
  const dir = fixture({ 'engine/sources/contracts/unfccc.json': JSON.stringify(CONTRACT) });
  clean(gate('r14-source-contracts.mjs', dir));
});

test('r14 passes with a note when no contracts exist', () => {
  const dir = fixture({});
  const r = gate('r14-source-contracts.mjs', dir);
  clean(r);
  assert.match(r.stdout, /no source contracts/);
});

// ---------------------------------------------------------------- r15

test('r15 detects a prerelease dependency in package.json', () => {
  const dir = fixture({
    'package.json': JSON.stringify({ name: 'x', version: '1.0.0', dependencies: { foo: '1.0.0-beta.1' } }),
  });
  detected(gate('r15-no-prerelease.mjs', dir));
});

test('r15 detects a prerelease version in package-lock.json', () => {
  const dir = fixture({
    'package.json': JSON.stringify({ name: 'x', version: '1.0.0' }),
    'package-lock.json': JSON.stringify({
      name: 'x',
      lockfileVersion: 3,
      packages: { '': { name: 'x', version: '1.0.0' }, 'node_modules/foo': { version: '2.0.0-rc.3' } },
    }),
  });
  detected(gate('r15-no-prerelease.mjs', dir));
});

test('r15 passes stable exact versions', () => {
  const dir = fixture({
    'package.json': JSON.stringify({ name: 'x', version: '1.0.0', dependencies: { foo: '2.1.0' } }),
  });
  clean(gate('r15-no-prerelease.mjs', dir));
});

// ---------------------------------------------------------------- ledger-keys

const LEDGER_HEADER =
  'doc_id,title,doc_type,date,source_url,sha256,size_bytes,pages,official_english,state,state_reason,note';
const sha = (c) => c.repeat(64);
const ledger = (rows) => LEDGER_HEADER + '\n' + rows.join('\n') + '\n';
const OK_ROW_1 = `d1,"Updated NDC, 2020",ndc,2020-12-31,https://example.org/a.pdf,${sha('a')},100,10,yes,observed,,note1`;
const OK_ROW_2 = 'd2,BTR listing,btr,2024-12-31,https://example.org/b,,,,no,unknown,"no bytes held; listing only",note2';

test('ledger-keys passes a valid ledger and prints counts', () => {
  const dir = fixture({ 'engine/seed/countries/AAA/documents.csv': ledger([OK_ROW_1, OK_ROW_2]) });
  const r = gate('ledger-keys.mjs', dir);
  clean(r);
  assert.match(r.stdout, /2 rows/);
  assert.match(r.stdout, /doc_id 2\/2 unique/);
});

test('ledger-keys detects a duplicate doc_id', () => {
  const dup = OK_ROW_2.replace(/^d2/, 'd1');
  const dir = fixture({ 'engine/seed/countries/AAA/documents.csv': ledger([OK_ROW_1, dup]) });
  detected(gate('ledger-keys.mjs', dir));
});

test('ledger-keys detects a duplicate source_url', () => {
  const dup = OK_ROW_2.replace('https://example.org/b', 'https://example.org/a.pdf');
  const dir = fixture({ 'engine/seed/countries/AAA/documents.csv': ledger([OK_ROW_1, dup]) });
  detected(gate('ledger-keys.mjs', dir));
});

test('ledger-keys detects an empty sha256 with state=observed', () => {
  const bad = 'd3,Thing,ndc,2020-01-01,https://example.org/c,,,,yes,observed,,note3';
  const dir = fixture({ 'engine/seed/countries/AAA/documents.csv': ledger([OK_ROW_1, bad]) });
  detected(gate('ledger-keys.mjs', dir));
});

test('ledger-keys detects an empty source_url on an observed row', () => {
  const bad = `d4,Thing,ndc,2020-01-01,,${sha('b')},,,yes,observed,,note4`;
  const dir = fixture({ 'engine/seed/countries/AAA/documents.csv': ledger([OK_ROW_1, bad]) });
  detected(gate('ledger-keys.mjs', dir));
});

test('ledger-keys detects an unknown doc_type', () => {
  const bad = OK_ROW_1.replace(',ndc,', ',report,');
  const dir = fixture({ 'engine/seed/countries/AAA/documents.csv': ledger([bad]) });
  detected(gate('ledger-keys.mjs', dir));
});

test('ledger-keys detects a wrong header', () => {
  const dir = fixture({ 'engine/seed/countries/AAA/documents.csv': 'doc_id,title\nx,y\n' });
  detected(gate('ledger-keys.mjs', dir));
});

test('ledger-keys passes with a note when no country ledgers exist', () => {
  const dir = fixture({});
  const r = gate('ledger-keys.mjs', dir);
  clean(r);
  assert.match(r.stdout, /no country ledgers/);
});

// ---------------------------------------------------------------- update-golden (R7 companion)

test('update-golden refuses to run without --reason', () => {
  const r = run([updateGolden, 'a.txt', 'b.txt']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /--reason/);
});

test('update-golden explains usage when file arguments are missing', () => {
  const r = run([updateGolden, '--reason', 'spec changed']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /usage/);
});

test('update-golden copies with a reason and prints a diff summary', () => {
  const dir = fixture({ 'new.txt': 'a\nb\nc\n', 'old.txt': 'a\nx\n' });
  const r = run([updateGolden, '--reason', 'spec changed', join(dir, 'new.txt'), join(dir, 'old.txt')]);
  clean(r);
  assert.equal(readFileSync(join(dir, 'old.txt'), 'utf8'), 'a\nb\nc\n');
  assert.match(r.stdout, /diff summary/);
  assert.match(r.stdout, /reason: spec changed/);
});
