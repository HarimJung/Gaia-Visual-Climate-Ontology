// Mutation harness for the design canon (R17). Every rule in
// engine/gates/r17-design-canon.mjs must detect its planted violation and pass
// a clean fixture. Doctrine: an undetected mutation means the TEST is wrong,
// never the rule.
//
// Fixtures are a copy of engine/ so the gate under test runs against the real
// seed, the real codegen and the real generated output, with one value moved.
// Two rules ship switched off behind a TODO constant (the material they judge
// is not ready): those tests flip the constant in the copied gate, which both
// exercises the rule and proves the flip.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GATE = 'engine/gates/r17-design-canon.mjs';
const SEED = 'engine/seed/platform/design';
const GENERATED = ['design-tokens.css', 'design-tokens.json', 'textures.svg'];

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

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'design-fixture-'));
  roots.push(dir);
  cpSync(join(repo, 'engine'), join(dir, 'engine'), { recursive: true });
  return dir;
}

function write(root, rel, text) {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
}

const read = (root, rel) => readFileSync(join(root, rel), 'utf8');

function edit(root, rel, from, to) {
  const before = read(root, rel);
  assert.ok(before.includes(from), `fixture cannot plant the mutation: "${from}" not in ${rel}`);
  write(root, rel, before.replace(from, to));
}

function gate(root) {
  return spawnSync(process.execPath, [join(root, GATE), '--root', root], { encoding: 'utf8' });
}

// For a mutation that is meant to be legal, the generated files have to move
// with the seed or codegen-fresh fires instead of the rule under test.
function regen(root) {
  clean(spawnSync(process.execPath, [join(root, 'engine', 'tools', 'codegen.mjs'), '--root', root], { encoding: 'utf8' }));
}

function detected(r, rule) {
  assert.notEqual(
    r.status,
    0,
    `mutation NOT detected — the test or the rule is wrong.\nstdout: ${r.stdout}\nstderr: ${r.stderr}`,
  );
  assert.match(r.stderr, new RegExp(`R17 ${rule}:`), `the failure must name the rule it broke: ${rule}`);
}

function clean(r) {
  assert.equal(r.status, 0, `expected a pass.\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
}

// A published pair the reader accepts (both halves, exact column contract), so
// encoding-complete has entities to check.
const BASE_HEADER =
  'iso3,record_key,value,state,reason,anchor_kind,anchor_source_id,anchor_sha256,anchor_locator,retrieved_at';
const row = (source, state) =>
  `ZZZ,a.record.key,,${state},,listing,${source},deadbeef,"folder",2026-10-17T00:00:00.000Z`;
function publish(root, rows) {
  write(root, 'data/graph/base.csv', `${BASE_HEADER}\n${rows.join('\n')}\n`);
  write(root, 'data/graph/derived.csv', `${BASE_HEADER},derived_rule\n`);
}

// ---------------------------------------------------------------- clean

test('the committed design canon passes every rule', () => {
  clean(gate(repo));
});

test('a copied engine with no publish and no app still passes', () => {
  clean(gate(fixture()));
});

// ---------------------------------------------------------------- encoding-orphan

test('encoding-orphan: a token removed from the seed leaves a binding pointing at nothing', () => {
  const root = fixture();
  edit(root, `${SEED}/tokens_record.csv`, 'neutral.src-a,#4d6477,neutral,source-family ramp step 1 of 3,\n', '');
  detected(gate(root), 'encoding-orphan');
  assert.match(gate(root).stderr, /neutral\.src-a/);
});

test('encoding-orphan: a binding naming a texture the seed does not carry', () => {
  const root = fixture();
  edit(root, `${SEED}/encodings_record.csv`, 'texture.cross', 'texture.herringbone');
  detected(gate(root), 'encoding-orphan');
});

// ---------------------------------------------------------------- encoding-complete

test('encoding-complete: a source family in the published rows with no binding', () => {
  const root = fixture();
  publish(root, [row('untc', 'observed'), row('a-new-source', 'observed')]);
  const r = gate(root);
  detected(r, 'encoding-complete');
  assert.match(r.stderr, /a-new-source/);
});

test('encoding-complete: a state in the published rows with no binding', () => {
  const root = fixture();
  publish(root, [row('untc', 'withdrawn')]);
  detected(gate(root), 'encoding-complete');
});

test('encoding-complete: every entity the published rows carry is bound', () => {
  const root = fixture();
  publish(root, [row('untc', 'observed'), row('registry', 'unknown'), row('btr-listing', 'absent')]);
  clean(gate(root));
});

// ---------------------------------------------------------------- channel-exclusive

test('channel-exclusive: two axes claiming one channel', () => {
  const root = fixture();
  edit(root, `${SEED}/channels_record.csv`, 'quantity,sequential,', 'quantity,texture,');
  const r = gate(root);
  detected(r, 'channel-exclusive');
  assert.match(r.stderr, /texture/);
});

test('channel-exclusive: one token spending twice on the same axis', () => {
  const root = fixture();
  edit(root, `${SEED}/encodings_record.csv`, 'source-family,registry,neutral.src-c,', 'source-family,registry,neutral.src-b,');
  detected(gate(root), 'channel-exclusive');
});

// ---------------------------------------------------------------- label-on-fill

test('label-on-fill: a fill moved to a mid tone labels against neither ink nor paper', () => {
  const root = fixture();
  edit(root, `${SEED}/tokens_record.csv`, 'meaning.un,#009edb,', 'meaning.un,#767676,');
  const r = gate(root);
  detected(r, 'label-on-fill');
  assert.match(r.stderr, /must clear 4\.5:1/);
});

test('label-on-fill: a value that is not a hex colour is refused, never guessed', () => {
  const root = fixture();
  edit(root, `${SEED}/tokens_record.csv`, 'meaning.warn,#b23a26,', 'meaning.warn,firebrick,');
  detected(gate(root), 'label-on-fill');
});

test('label-on-fill: every committed fill prints its two computed numbers', () => {
  const r = gate(repo);
  clean(r);
  assert.match(
    r.stdout,
    /label-on-fill, fill-vs-paper\/best-label \(floor 4\.5\): meaning\.un 2\.93\/6\.08 .* neutral\.src-c 1\.55\/11\.54/,
  );
});

// ---------------------------------------------------------------- bounded-light-fill
// WCAG 1.4.11's 3:1 covers graphical objects you must see to understand the
// content, not every brand fill against the page: a light fill is allowed, an
// unbounded one is not.

test('bounded-light-fill: a light fill with no border token fails', () => {
  const root = fixture();
  edit(root, `${SEED}/tokens_record.csv`, 'neutral.src-c,#c2ced8,neutral,source-family ramp step 3 of 3,neutral.src-a', 'neutral.src-c,#c2ced8,neutral,source-family ramp step 3 of 3,');
  const r = gate(root);
  detected(r, 'bounded-light-fill');
  assert.match(r.stderr, /declares no border_token/);
});

test('bounded-light-fill: a border token that is itself too light fails', () => {
  const root = fixture();
  edit(root, `${SEED}/tokens_record.csv`, 'neutral.src-b,#8fa3b3,neutral,source-family ramp step 2 of 3,neutral.src-a', 'neutral.src-b,#8fa3b3,neutral,source-family ramp step 2 of 3,neutral.src-c');
  const r = gate(root);
  detected(r, 'bounded-light-fill');
  assert.match(r.stderr, /the border itself must clear 3\.0:1/);
});

test('bounded-light-fill: a border token the seed does not carry fails', () => {
  const root = fixture();
  edit(root, `${SEED}/tokens_record.csv`, 'meaning.fin,#bf8b2e,meaning,finance,meaning.fin-ink', 'meaning.fin,#bf8b2e,meaning,finance,meaning.fin-edge');
  detected(gate(root), 'bounded-light-fill');
});

test('bounded-light-fill: a dark fill needs no border token', () => {
  const root = fixture();
  // meaning.warn (#b23a26) is 5.75:1 against paper and declares no border;
  // darkening a bounded fill past the floor drops the requirement with it.
  edit(root, `${SEED}/tokens_record.csv`, 'neutral.src-c,#c2ced8,neutral,source-family ramp step 3 of 3,neutral.src-a', 'neutral.src-c,#3a4752,neutral,source-family ramp step 3 of 3,');
  regen(root);
  const r = gate(root);
  clean(r);
  const boundedLine = r.stdout.split('\n').find((l) => l.startsWith('bounded-light-fill'));
  assert.match(boundedLine, /^bounded-light-fill \(floor 3\.0\): meaning\.un 2\.93 bounded by meaning\.un-ink 5\.85/);
  assert.doesNotMatch(boundedLine, /neutral\.src-c/, 'a dark fill is not asked for a border');
});

test('bounded-light-fill: the committed canon bounds all four light fills, and prints each border', () => {
  const r = gate(repo);
  clean(r);
  assert.match(
    r.stdout,
    /bounded-light-fill \(floor 3\.0\): meaning\.un 2\.93 bounded by meaning\.un-ink 5\.85 · meaning\.fin 2\.92 bounded by meaning\.fin-ink 5\.29 · neutral\.src-b 2\.52 bounded by neutral\.src-a 5\.96 · neutral\.src-c 1\.55 bounded by neutral\.src-a 5\.96/,
  );
});

// ---------------------------------------------------------------- greyscale-separation

test('greyscale-separation: two ramp steps moved together collapse the ramp', () => {
  const root = fixture();
  edit(root, `${SEED}/tokens_record.csv`, 'neutral.src-b,#8fa3b3,', 'neutral.src-b,#b8c4ce,');
  const r = gate(root);
  detected(r, 'greyscale-separation');
  assert.match(r.stderr, /apart in greyscale/);
});

test('greyscale-separation: the committed ramp prints its computed steps', () => {
  const r = gate(repo);
  clean(r);
  assert.match(r.stdout, /greyscale separation \(floor 1\.3\): neutral\.src-a→neutral\.src-b 2\.367 · neutral\.src-b→neutral\.src-c 1\.627/);
});

// ---------------------------------------------------------------- no-literal-colour

test('no-literal-colour: a planted hex in app CSS is refused', () => {
  const root = fixture();
  write(root, 'app/src/styles/planted.css', '.a { color: #ff00aa; }\n');
  const r = gate(root);
  detected(r, 'no-literal-colour');
  assert.match(r.stderr, /app\/src\/styles\/planted\.css:1 #ff00aa/);
});

test('no-literal-colour: a planted rgb() in an .astro style block is refused', () => {
  const root = fixture();
  write(root, 'app/src/pages/planted.astro', '<p>x</p>\n<style>\n.a { color: rgb(1,2,3); }\n</style>\n');
  detected(gate(root), 'no-literal-colour');
});

// The rule reaches the markup too, not only the <style> block: an SVG
// presentation attribute is exactly where the pre-canon palette hid.
test('no-literal-colour: a planted hex in .astro MARKUP is refused', () => {
  const root = fixture();
  write(root, 'app/src/pages/planted.astro', '<svg><circle fill="#c0ffee" /></svg>\n');
  const r = gate(root);
  detected(r, 'no-literal-colour');
  assert.match(r.stderr, /app\/src\/pages\/planted\.astro:1 #c0ffee/);
});

test('no-literal-colour: var() markup and an owned <defs> block pass', () => {
  const root = fixture();
  write(root, 'app/src/styles/clean.css', '.a { color: var(--ink); border-color: currentColor; background: none; }\n');
  write(
    root,
    'app/src/pages/clean.astro',
    '<svg><defs><pattern id="t-x"><rect fill="#f1f1ee"/></pattern></defs></svg>\n' +
      '<style>\n.b { fill: var(--un); }\n</style>\n',
  );
  const r = gate(root);
  clean(r);
  assert.match(r.stdout, /no-literal-colour: app\/src spends no colour literal/);
});

// The rule is live and the product is at zero: this is the assertion that
// stops the dark pre-canon palette, or any successor to it, coming back.
test('no-literal-colour: the committed app spends no colour literal at all', () => {
  const r = gate(repo);
  clean(r);
  assert.match(r.stdout, /no-literal-colour: app\/src spends no colour literal across \d+ file\(s\)/);
  assert.doesNotMatch(r.stdout, /TODO/);
  assert.doesNotMatch(readFileSync(join(repo, GATE), 'utf8'), /TODO_ENFORCE_NO_LITERAL_COLOUR/);
});

// ------------------------------------------------------- the surface tokens
// The shipped product's own surface vocabulary — the sheen over the sheet,
// the paper's tooth, the bevel a raised part is turned with and the inner
// shadow a socket is cut with — is seed, at that product's own values, and
// reaches the app through codegen like every other token. Without these the
// re-skin has no depth to spend and reaches zero literals by deleting it.
test('surface tokens: the seed carries the shipped product’s own values', () => {
  const seed = read(repo, `${SEED}/tokens_record.csv`);
  for (const [token, value] of [
    ['colour.sheen', '#fffefa'],
    ['colour.sheen-fade', '#f4f2ec00'],
    ['colour.wash', '#e9ecf7'],
    ['colour.map-ground', '#f4f9fc'],
    ['dial.bevel-hi', '#fdfdfb'],
    ['dial.bevel-lo', '#a8b0b4'],
    ['grain.blend', 'multiply'],
    ['grain.opacity', '.1'],
  ]) {
    assert.match(seed, new RegExp(`^${token.replace('.', '\\.')},${value.replace(/[.#]/g, '\\$&')},`, 'm'),
      `${token} is seeded at the shipped product's value ${value}`);
  }
  assert.match(seed, /^shadow\.well,"inset 1px 1px 2px #0e1a1f80",shadow,/m, 'the sunken socket’s inner shadow is a token');
  assert.match(seed, /^dur,200ms,dur,/m, 'the standard duration is the shipped product’s 200ms');
});

test('surface tokens: codegen emits every one of them as a custom property', () => {
  const css = read(repo, 'engine/generated/design-tokens.css');
  for (const [v, value] of [
    ['--sheen', '#fffefa'],
    ['--sheen-fade', '#f4f2ec00'],
    ['--wash', '#e9ecf7'],
    ['--map-ground', '#f4f9fc'],
    ['--dial-bevel-hi', '#fdfdfb'],
    ['--dial-bevel-lo', '#a8b0b4'],
    ['--grain-blend', 'multiply'],
    ['--grain-opacity', '.1'],
    ['--shadow-well', 'inset 1px 1px 2px #0e1a1f80'],
  ]) {
    assert.ok(css.includes(`${v}: ${value};`), `${v} reaches the app as ${value}`);
  }
});

test('surface tokens: the app spends them, so the depth is not decoration', () => {
  const site = read(repo, 'app/src/styles/site.css');
  assert.match(site, /var\(--sheen\)/, 'the sheet carries its sheen');
  assert.match(site, /var\(--grain-opacity\)/, 'and its tooth');
  assert.match(site, /--bevel:\s*linear-gradient\(140deg, var\(--dial-bevel-hi\), var\(--dial-bevel-lo\)\)/,
    'a raised part is turned with the bevel');
  assert.match(site, /var\(--shadow-well\)/, 'a sunken one sits in its well');
  // and a mark that means something is FILLED in that meaning, never outlined
  assert.match(site, /\.seg-observed \{ background: var\(--un\); \}/, 'an established reading is a fill');
});

// ---------------------------------------------------------------- codegen

test('codegen: the design output is byte-identical across two runs', () => {
  const root = fixture();
  const codegen = join(root, 'engine', 'tools', 'codegen.mjs');
  const run = () => spawnSync(process.execPath, [codegen, '--root', root], { encoding: 'utf8' });
  clean(run());
  const first = GENERATED.map((f) => read(root, `engine/generated/${f}`));
  clean(run());
  assert.deepEqual(GENERATED.map((f) => read(root, `engine/generated/${f}`)), first);
});

test('codegen: a missing design seed exits 2, the no-seed convention', () => {
  const root = fixture();
  rmSync(join(root, SEED), { recursive: true, force: true });
  const r = spawnSync(process.execPath, [join(root, 'engine', 'tools', 'codegen.mjs'), '--root', root], {
    encoding: 'utf8',
  });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /no design seed/);
});

test('codegen-fresh: edited generated output is drift', () => {
  const root = fixture();
  write(root, 'engine/generated/design-tokens.css', `${read(root, 'engine/generated/design-tokens.css')}\n`);
  detected(gate(root), 'codegen-fresh');
});

test('codegen: custom property names are derived from the token id, never chosen', () => {
  const css = read(repo, 'engine/generated/design-tokens.css');
  for (const [token, prop] of [
    ['colour.paper', '--paper: #fbfbfa;'],
    ['meaning.un', '--un: #009edb;'],
    ['neutral.src-a', '--src-a: #4d6477;'],
    ['quant.q1', '--q1: #a1dafc;'],
    ['dial.face', '--dial-face: #f1f1ee;'],
    ['size.t4', '--t4: 17px;'],
    ['space.s5', '--s5: 24px;'],
    ['dur.quick', '--dur-quick: .18s;'],
    ['ease.out', '--out: cubic-bezier(.16,1,.3,1);'],
  ]) {
    assert.ok(css.includes(prop), `${token} must emit "${prop}"`);
  }
});

test('codegen: textures.svg carries one pattern per seeded texture, in token hexes', () => {
  const svg = read(repo, 'engine/generated/textures.svg');
  const seeded = read(repo, `${SEED}/textures_record.csv`)
    .trim()
    .split('\n')
    .slice(1)
    .map((l) => l.split(',')[0]);
  assert.equal(seeded.length, 6);
  for (const t of seeded) assert.ok(svg.includes(`<pattern id="t-${t}"`), `textures.svg must define t-${t}`);
  assert.ok(svg.includes('fill="#f1f1ee"'), 'the tile fill is colour.paper-sunken');
  assert.ok(svg.includes('stroke="#6c737a"'), 'the texture ink is colour.ink-4');
});

// ---------------------------------------------------------------- provenance

test('provenance: docs/DESIGN.md records where the tokens were read from', () => {
  const doc = read(repo, 'docs/DESIGN.md');
  assert.match(doc, /visual-climate\.visualclimate\.workers\.dev/, 'the doc must name the running product');
  assert.match(doc, /2026-10-17/, 'the doc must date the reading');
  assert.match(doc, /engine\/seed\/platform\/design/, 'the doc must name the seed that is canon');
  for (const f of GENERATED) assert.ok(doc.includes(f), `the doc must name the generated file ${f}`);
});
