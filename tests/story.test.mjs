// The scroll story (the front door) and the ported scene modules.
// Dist arms skip without a build and are armed in CI, where the build runs
// first — same convention as the other dist tests. No country is ever named
// here (R1): the walked country and the bead roster are discovered from the
// views, exactly as the pages derive them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sourceFamilies } from '../app/src/lib/derive.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(repo, 'app', 'dist');
const story = join(dist, 'index.html');
const storyReady = existsSync(story);
const skip = !storyReady && 'no app/dist — CI builds before tests run';

const engineViewsDir = join(repo, 'data', 'views', 'countries');
const viewsDir = existsSync(engineViewsDir) ? engineViewsDir : join(repo, 'app', 'fixtures', 'views');
const viewFiles = readdirSync(viewsDir).filter((f) => f.endsWith('.json'));
const censusPath = existsSync(engineViewsDir)
  ? join(repo, 'data', 'views', 'census.json')
  : join(repo, 'app', 'fixtures', 'census.json');
const census = JSON.parse(readFileSync(censusPath, 'utf8'));

test('story page: every data-census figure renders the census value it links', { skip }, () => {
  const html = readFileSync(story, 'utf8');
  const indexPath = join(repo, 'data', 'views', 'index.json');
  const byIso = existsSync(indexPath)
    ? new Map(JSON.parse(readFileSync(indexPath, 'utf8')).countries.map((c) => [c.iso3.toLowerCase(), c.counts]))
    : null;
  const figs = [...html.matchAll(/<a[^>]*data-census="([^"]+)"[^>]*href="([^"]+)"[^>]*>\s*([\d,]+)\s*</g)];
  assert.ok(figs.length >= 8, `story carries census-linked figures (found ${figs.length})`);
  for (const [, key, href, shown] of figs) {
    // A figure links either the world census (/ledger/ or the ledger file) or
    // one country's census row; each must render exactly the linked value.
    const country = href.match(/^\/country\/([a-z]{3})\//);
    const value = country
      ? byIso?.get(country[1])?.[key]
      : census.counts[key] ?? census.graph?.[key];
    if (country && !byIso) continue; // fixture build: no engine index to compare
    assert.notEqual(value, undefined, `data-census key "${key}" (${href}) exists in its census`);
    assert.equal(shown.replace(/,/g, ''), String(value), `figure for "${key}" equals the linked census value`);
  }
});

test('story page: the evidence chain is on the page — receipt links, a hash, the verbatim refusal', { skip }, () => {
  const html = readFileSync(story, 'utf8');
  // the walked country: at least one country page link and its receipt links
  assert.match(html, /href="\/country\/[a-z]{3}\/"/, 'story links a country page');
  assert.match(html, /href="\/receipt\/[a-z]{3}\/[^"]+\/#sha256"/, 'story links a receipt hash anchor');
  // the SHA-256 settles inside the hash block, as a link to its receipt
  assert.match(html, /class="hash"[^>]*><a[^>]*href="\/receipt\/[^"]+#sha256"[^>]*>[0-9a-f]{64}</, 'the full hash renders inside the hash block as a receipt link');
  // the refusal sentence is first-class content inside its allowed container
  const refusals = [];
  for (const f of viewFiles) {
    const v = JSON.parse(readFileSync(join(viewsDir, f), 'utf8'));
    for (const r of v.rows) if (r.refusal) refusals.push(r.refusal);
  }
  if (refusals.length > 0) {
    const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    assert.ok(
      refusals.some((r) => html.includes(r) || html.includes(esc(r))),
      'a refusal on record appears verbatim on the story page',
    );
    assert.match(html, /class="refusal"/, 'the refusal sits in its first-class container');
  }
  // the close lands on the ledger
  assert.match(html, /href="\/ledger\/"/, 'story links the world ledger');
});

test('story page: bead and cell counts equal the view count — derived, not hardcoded', { skip }, () => {
  const html = readFileSync(story, 'utf8');
  const beads = [...html.matchAll(/data-bead="/g)].length;
  const cells = [...html.matchAll(/data-cell="/g)].length;
  assert.equal(beads, viewFiles.length, 'one bead per country view');
  assert.equal(cells, viewFiles.length, 'one column cell per country view');
  assert.ok(cells >= 100, 'the keyed cell pool holds at least 100 rects');
});

// ── The record stage: one country's documents, morphed stage by stage ──────
// The country is discovered from the views, never named here (R1).
const anyCountry = viewFiles.length > 0
  ? JSON.parse(readFileSync(join(viewsDir, viewFiles[0]), 'utf8'))
  : null;
const countryPage = anyCountry && join(dist, 'country', anyCountry.country.iso3.toLowerCase(), 'index.html');
const countrySkip = skip || (!countryPage || !existsSync(countryPage)) ? 'no built country page' : false;

test('record stage: one keyed mark per document, and every stamp is a receipt link', { skip: countrySkip }, () => {
  const html = readFileSync(countryPage, 'utf8');
  const n = anyCountry.rows.length;
  for (const pool of ['data-stamp', 'data-rcell', 'data-rbead']) {
    assert.equal([...html.matchAll(new RegExp(`${pool}="`, 'g'))].length, n, `one ${pool} per document row`);
  }
  // every stamp sits inside a link to that row's receipt — the marks ARE the
  // evidence chain, not a decoration of it
  for (const row of anyCountry.rows) {
    const re = new RegExp(`href="/receipt/[a-z]{3}/${row.doc_id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/"[^>]*>\\s*<g data-stamp="`);
    assert.match(html, re, `the stamp for ${row.doc_id} links its receipt`);
  }
});

test('record stage: the stage rests on a complete step with JavaScript off', { skip: countrySkip }, () => {
  const html = readFileSync(countryPage, 'utf8');
  // the server-rendered resting class is a real step, not "nothing yet"
  assert.match(html, /class="rstage is-dial"/, 'the stage rests on its last step');
  // one viewport-tall track per step card, so no screen of scroll has no step
  const tracks = [...html.matchAll(/data-rstep="/g)].length;
  const cards = [...html.matchAll(/data-rcard="/g)].length;
  assert.equal(tracks, cards, 'one track per step card');
  assert.ok(tracks >= 6, `the record morph carries its stages (found ${tracks})`);
});

test('the dial draws one countable barrel per document on record — no sweep, no gauge', { skip: countrySkip }, () => {
  const html = readFileSync(countryPage, 'utf8');
  // The barrel ring replaced the arc-segment ring (the predecessor's forty
  // barrels, Main.dc.html). The honesty contract is unchanged and stricter:
  // the marks are still COUNTABLE and still one per document, and now each
  // one also carries the receipt of the document it stands for.
  const dial = html.slice(html.indexOf('class="d-barrels"'));
  const ring = dial.slice(0, dial.indexOf('</g>'));
  const onRecord = anyCountry.rows.length;
  const barrels = [...ring.matchAll(/class="d-barrel /g)].length;
  assert.equal(barrels, onRecord, 'one barrel per document on record');
  // live = the bytes are held and hashed. Never more, never fewer.
  const live = [...ring.matchAll(/class="d-barrel live"/g)].length;
  const held = anyCountry.rows.filter((r) => r.sha256).length;
  assert.equal(live, held, 'a lit barrel is a document whose bytes are held and hashed');
  const voids = [...ring.matchAll(/class="d-barrel void"/g)].length;
  assert.equal(voids, onRecord - held, 'every other barrel is an explicit machined void');
  // every barrel is its document's receipt (R6: the mark IS the link)
  for (const row of anyCountry.rows) {
    const re = new RegExp(
      `href="/receipt/[a-z]{3}/${row.doc_id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/"[^>]*>` +
        `[\\s\\S]{0,260}?class="d-barrel `,
    );
    assert.match(ring, re, `the barrel for ${row.doc_id} links its receipt`);
  }
  // the centre readout is two census figures, each inside its link (R6)
  assert.match(html, /<a href="#census-documents_with_bytes">\s*<text[^>]*class="d-read"[^>]*>\s*\d+\s*<\/text>\s*<\/a>/);
  // No percentage is ever DISPLAYED on the dial. The old form of this check
  // scanned the first 4000 characters of the markup for a "%", which the
  // gradient coordinates in <defs> now trip; it is replaced by the exact
  // rule — every rendered string on the instrument, checked, all of them.
  const svg = html.slice(html.indexOf('class="static-dial"'));
  const drawn = [...svg.slice(0, svg.indexOf('</svg>')).matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)]
    .map((m) => m[1].replace(/<[^>]*>/g, ''));
  assert.ok(drawn.length > 0, 'the dial is engraved with something');
  for (const t of drawn) assert.ok(!t.includes('%'), `no percentage on the dial: ${t.trim()}`);
});

test('the dial carries the comps\' devices, and each one carries real data', { skip: countrySkip }, () => {
  const html = readFileSync(countryPage, 'utf8');
  const dial = html.slice(html.indexOf('class="static-dial"'));
  const svg = dial.slice(0, dial.indexOf('</svg>'));
  // the engraved tick bezel: one bold tick per document on record
  const bold = svg.slice(svg.indexOf('class="d-bold"'));
  const ticks = [...bold.slice(0, bold.indexOf('</g>')).matchAll(/<line /g)].length;
  assert.equal(ticks, anyCountry.rows.length, 'one bold bezel tick per document on record');
  // the cotes mainplate, the escapement and the pledge ghost ring are present
  assert.match(svg, /patternTransform="rotate\(112\)"/, 'the mainplate is cut in 112-degree cotes');
  assert.match(svg, /class="d-escape"/, 'the escapement is on the plate');
  assert.match(svg, /class="d-ghost"/, 'the unread pledge path is a ghost ring');
  // PULSE: one amber flow path per LIVE barrel, and never one more. The flow
  // animates evidence moving; it is not allowed to become a reading.
  const sparks = [...svg.matchAll(/class="d-spark"/g)].length;
  const held = anyCountry.rows.filter((r) => r.sha256).length;
  assert.equal(sparks, held, 'one flow path per document whose bytes are held');
  // the satellite only exists when a real orphan row does, and it is a link
  const orphan = anyCountry.rows.find((r) => !r.sha256);
  if (orphan) {
    assert.match(svg, /class="d-satellite"/, 'a document on record with no bytes held is tethered, unengaged');
    assert.match(svg, /class="d-tether"/, 'the satellite hangs on a dashed tether');
  } else {
    assert.doesNotMatch(svg, /class="d-satellite"/, 'no orphan row, no satellite — never an illustration');
  }
});

// ── THE HERO MOVEMENT (the ported Main.dc.html instrument) ────────────────
// The walked record is derived exactly as the page derives it (richestView):
// no country is named here either (R1).
const allViews = viewFiles.map((f) => JSON.parse(readFileSync(join(viewsDir, f), 'utf8')));
const byName = [...allViews].sort((a, b) =>
  a.country.name_en < b.country.name_en ? -1
  : a.country.name_en > b.country.name_en ? 1
  : a.country.iso3 < b.country.iso3 ? -1 : 1,
);
const held = (v) => v.rows.filter((r) => r.sha256).length;
const quoted = byName.filter((v) => v.rows.some((r) => r.quote && r.sha256));
const walked = quoted.length > 0 ? quoted.reduce((a, b) => (held(b) > held(a) ? b : a)) : null;
const heroSkip = skip || (!walked && 'no view carries a quoted, hashed row');
const heroOf = (html) => {
  const at = html.indexOf('class="vc-wrap"');
  return at === -1 ? '' : html.slice(at, html.indexOf('</section>', at));
};
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('hero movement: one barrel per document on record, lit where the bytes are held', { skip: heroSkip }, () => {
  const hero = heroOf(readFileSync(story, 'utf8'));
  assert.ok(hero.length > 0, 'the hero instrument is server-rendered into the page');
  const barrels = [...hero.matchAll(/class="vc-barrel vc-/g)].length;
  assert.equal(barrels, walked.rows.length, 'one barrel per document on record');
  const lit = [...hero.matchAll(/class="vc-barrel vc-live"/g)].length;
  assert.equal(lit, held(walked), 'a lit barrel is a document whose bytes are held and hashed');
  // and every barrel IS the link to its own receipt — the mark is the evidence
  for (const row of walked.rows) {
    assert.match(
      hero,
      new RegExp(`<a class="vc-barrel vc-[a-z]+"[^>]*href="/receipt/[a-z]{3}/${esc(row.doc_id)}/"`),
      `the barrel for ${row.doc_id} links its receipt`,
    );
  }
  // PULSE: one flow path per lit barrel and never one more
  assert.equal([...hero.matchAll(/class="vc-flow-spark"/g)].length, held(walked), 'one flow path per lit barrel');
});

test('hero movement: one wheel per source family, teeth = that family\'s documents', { skip: heroSkip }, () => {
  const hero = heroOf(readFileSync(story, 'utf8'));
  // the family universe is every document type the runtime holds anywhere
  const universe = new Set(allViews.flatMap((v) => v.rows.map((r) => r.doc_type)));
  const wheels = [...hero.matchAll(/<a class="vc-wheel([^"]*)"[^>]*href="([^"]+)"[^>]*data-wheel="([^"]+)" data-teeth="(\d+)"/g)];
  assert.equal(wheels.length, universe.size, 'one wheel per source family the runtime reads');
  const seen = new Set();
  for (const [, cls, href, key, teeth] of wheels) {
    assert.ok(universe.has(key), `wheel "${key}" is a source family the runtime holds`);
    seen.add(key);
    const n = walked.rows.filter((r) => r.doc_type === key).length;
    assert.equal(Number(teeth), n, `the ${key} wheel cuts one tooth per document on record from it`);
    // the wheel is a link, and it renders its own count inside that link (R6)
    assert.match(href, /^\/(country|ledger)\//, `the ${key} wheel links into the record`);
    // ghost iff zero: no teeth means outline only, with its reason — never dropped
    assert.equal(/\bvc-ghost\b/.test(cls), n === 0, `the ${key} wheel is a ghost exactly when it has nothing on record`);
  }
  assert.equal(seen.size, universe.size, 'no family is drawn twice and none is omitted');
  // the ghost reason is on the page whenever a ghost wheel is
  const ghosts = wheels.filter(([, cls]) => /\bvc-ghost\b/.test(cls)).length;
  assert.equal([...hero.matchAll(/class="vc-wheel-reason"/g)].length, ghosts, 'every ghost wheel states why it is empty');
});

test('source families: a family with nothing on this record keeps its wheel, with zero teeth', () => {
  // the universe is every type the runtime holds; the teeth are one record's
  const all = [{ doc_type: 'alpha' }, { doc_type: 'alpha' }, { doc_type: 'beta' }, { doc_type: 'gamma' }];
  const fams = sourceFamilies(all, [{ doc_type: 'alpha' }, { doc_type: 'gamma' }]);
  assert.deepEqual(fams.map((f) => f.key), ['alpha', 'beta', 'gamma'], 'ordered by how much of the record each family carries, then by name');
  assert.deepEqual(fams.map((f) => f.n), [1, 0, 1], 'teeth are counted from THIS record, not from the universe');
  assert.equal(fams[1].first, null, 'a family with nothing on record has no row to point at — a ghost wheel, never a dropped one');
  assert.equal(fams[0].first.doc_type, 'alpha', 'a family with documents points at its first one');
  // the label is the family's own word, never a name invented for it
  assert.deepEqual(sourceFamilies([{ doc_type: 'treaty-status_list' }], []).map((f) => f.label), ['treaty status list']);
});

test('hero movement: the comp is ported, not re-approximated, and its loops are stoppable', () => {
  const css = readFileSync(join(repo, 'app', 'src', 'styles', 'movement.css'), 'utf8');
  // the provenance of a lifted design is part of the deliverable
  assert.match(css, /references\/Main\/Main\.dc\.html/, 'the ported sheet names the comp it came from');
  // the comp's own declarations, spot-checked where an approximation would show
  assert.match(css, /radial-gradient\(120% 90% at 78% 8%, #1E242A 0%, #12161A 42%, #0A0C0E 100%\)/, 'the ground is the comp\'s own');
  assert.match(css, /repeating-linear-gradient\(112deg/, 'the mainplate is cut in the comp\'s 112-degree cotes');
  assert.match(css, /repeating-conic-gradient\(from 0deg, rgba\(190, 202, 210, \.55\) 0deg 0\.28deg/, 'the engraved tick bezel is the comp\'s');
  assert.match(css, /radial-gradient\(circle at 34% 28%, #FFD3AA 0%, #FF9B52 42%, #A85B22 100%\)/, 'the lit barrel is the comp\'s sphere');
  // the keyframes are renamed, because scene.css already owns vc-flow/vc-tick
  // globally and a second definition would re-point the SVG dial's animation
  assert.match(css, /@keyframes vcm-(flow|tick|breathe)/, 'the ported keyframes carry their own names');
  const code = css.replace(/\/\*[\s\S]*?\*\//g, ''); // the note explains the rename; the rule is about the code
  assert.doesNotMatch(code, /@keyframes vc-(flow|tick)\b/, 'the ported sheet never redefines the dial\'s keyframes');
  // every loop it adds is infinite, so the reduce block's iteration count —
  // not its duration — is what stops them
  for (const loop of [/\.vc-flow-spark[^}]*animation: vcm-flow[^}]*infinite/, /\.vc-esc-teeth[^}]*animation: vcm-tick[^}]*infinite/, /\.vc-pulse[^}]*animation: vcm-breathe[^}]*infinite/]) {
    assert.match(css, loop, `the hero's loop ${loop.source.slice(0, 18)} is declared infinite`);
  }
  const site = readFileSync(join(repo, 'app', 'src', 'styles', 'site.css'), 'utf8');
  const block = site.slice(site.indexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(block, /\*, \*::before, \*::after/, 'the reduce block reaches every element, the hero included');
});

test('the tray gives every record the same case and counts the inside', { skip }, () => {
  const ledgerPath = join(dist, 'ledger', 'index.html');
  if (!existsSync(ledgerPath)) return;
  const html = readFileSync(ledgerPath, 'utf8');
  const indexPath = join(repo, 'data', 'views', 'index.json');
  const entries = existsSync(indexPath)
    ? JSON.parse(readFileSync(indexPath, 'utf8')).countries
    : viewFiles.map((f) => JSON.parse(readFileSync(join(viewsDir, f), 'utf8'))).map((v) => ({
        iso3: v.country.iso3,
        counts: { documents_on_record: v.rows.length, documents_with_bytes: v.rows.filter((r) => r.sha256).length },
      }));
  const cases = [...html.matchAll(/class="t-case"/g)].length;
  const held = [...html.matchAll(/class="t-pip t-held"/g)].length;
  const listed = [...html.matchAll(/class="t-pip t-listed"/g)].length;
  assert.equal(cases, entries.length, 'one identical case per record');
  const total = entries.reduce((n, e) => n + e.counts.documents_on_record, 0);
  const bytes = entries.reduce((n, e) => n + e.counts.documents_with_bytes, 0);
  assert.equal(held + listed, total, 'one pip per document on record');
  assert.equal(held, bytes, 'a filled pip is a document whose bytes are held — the census count, exactly');
});

test('the case-back carries source, run time and checksum, and is complete without JavaScript', { skip }, () => {
  const html = readFileSync(story, 'utf8');
  assert.match(html, /class="caseback" data-caseback/, 'the story page has a case-back plate');
  const back = html.slice(html.indexOf('cb-back'), html.indexOf('cb-back') + 1400);
  for (const label of ['source', 'run time', 'checksum']) {
    assert.match(back, new RegExp(`<dt[^>]*>${label}</dt>`), `the case-back is engraved with ${label}`);
  }
  assert.match(back, /[0-9a-f]{64}/, 'the checksum on the back is the full hash');
  // no data-flip-ready in the built HTML: both faces are plain blocks until
  // the enhancement script runs, so JS off loses no fact
  assert.doesNotMatch(html, /data-flip-ready/, 'the flip is added at runtime, never baked in');
});

test('the instrument world is declared once, with its faces and its AA math', () => {
  const css = readFileSync(join(repo, 'app', 'src', 'styles', 'site.css'), 'utf8');
  const root = css.slice(css.indexOf(':root'), css.indexOf('* { box-sizing'));
  // the dark ground and the one amber, in the tokens the whole product reads
  assert.match(root, /--bg:\s*#0B0D0F/i, 'the ground is the near-black of the comps');
  assert.match(root, /--acc:\s*#FF8A3D/i, 'the accent is the comps\' amber');
  assert.match(root, /color-scheme:\s*dark/, 'the page declares its scheme');
  // Archivo is pinned AND falls back to a face this repo actually ships
  assert.match(root, /--f-d:\s*"Archivo"[^;]*"Hanken Grotesk"/, 'the display stack falls back to a shipped grotesque');
  assert.match(root, /--f-m:\s*"IBM Plex Mono"/, 'figures stay in the mono');
  const base = readFileSync(join(repo, 'app', 'src', 'layouts', 'Base.astro'), 'utf8');
  assert.match(base, /family=Archivo:wght@400;500;600;800/, 'the family is pinned to its four weights');
  // a new face is a new licence row, or the build is lying about its deps
  const licenses = readFileSync(join(repo, 'data', 'licenses.csv'), 'utf8');
  assert.match(licenses, /^archivo-google-fonts,/m, 'Archivo has a row in the licence register');
  assert.match(licenses, /Open Font License 1\.1[\s\S]{0,400}Archivo|Archivo[\s\S]{0,400}Open Font License 1\.1/,
    'the row states the licence');
  assert.match(readFileSync(join(repo, 'docs', 'LICENSES.md'), 'utf8'), /## Archivo \(Google Fonts\)/,
    'and the register prose carries it too');
  // the AA numbers are stated, not assumed
  assert.match(css, /17\.28:1/, 'the body ink contrast on the ground is written down');
  assert.match(css, /8\.31:1/, 'the accent contrast on the ground is written down');
});

test('reduced motion stops the instrument\'s permanent loops, not just their speed', () => {
  const css = readFileSync(join(repo, 'app', 'src', 'styles', 'site.css'), 'utf8');
  const block = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(block, /animation-iteration-count:\s*1\s*!important/,
    'an infinite loop needs its iteration count cut, not only its duration');
  // and the loops that need it are the ones the comps allow: PULSE and TICK
  const scene = readFileSync(join(repo, 'app', 'src', 'styles', 'scene.css'), 'utf8');
  assert.match(scene, /\.d-spark[^}]*animation:\s*vc-flow[^}]*infinite/, 'PULSE runs the flow paths');
  assert.match(scene, /\.d-escape\s*\{[^}]*animation:\s*vc-tick[^}]*infinite/, 'TICK runs the escapement');
});

test('reduced motion kills the delays, not only the durations', () => {
  const css = readFileSync(join(repo, 'app', 'src', 'styles', 'site.css'), 'utf8');
  const block = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(block, /transition-delay:\s*0s\s*!important/, 'transition delays are zeroed');
  assert.match(block, /animation-delay:\s*0s\s*!important/, 'animation delays are zeroed');
  // the stages' whole choreography lives in a delay, so a duration-only rule
  // suppresses nothing on them
  const stage = readFileSync(join(repo, 'app', 'src', 'styles', 'stage.css'), 'utf8');
  assert.match(stage, /transition-delay: var\(--d, 0ms\)/, 'the stages stagger through --d');
});

test('scene modules: zero country literals (codes or display names)', () => {
  const sceneDir = join(repo, 'app', 'src', 'lib', 'scene');
  const names = new Set();
  const codes = new Set();
  for (const f of viewFiles) {
    const v = JSON.parse(readFileSync(join(viewsDir, f), 'utf8'));
    if (v.country?.iso3) codes.add(v.country.iso3);
    if (v.country?.name_en?.length >= 3) names.add(v.country.name_en.toLowerCase());
  }
  const STR_RE = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g;
  // Whole-word match: "normalize" must not trip a four-letter country name.
  const nameRes = [...names].map((n) => new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`));
  for (const file of readdirSync(sceneDir).filter((f) => f.endsWith('.mjs'))) {
    const text = readFileSync(join(sceneDir, file), 'utf8');
    for (const m of text.matchAll(STR_RE)) {
      const inner = m[0].slice(1, -1);
      assert.ok(!codes.has(inner), `scene/${file}: country code literal "${inner}"`);
      const low = inner.toLowerCase();
      for (const re of nameRes) {
        assert.ok(!re.test(low), `scene/${file}: country name (${re.source}) in a string literal`);
      }
    }
  }
});

test('ported layout module ships with its license text beside it', () => {
  const lic = join(repo, 'app', 'src', 'lib', 'scene', 'HUMAN-ATLAS-LICENSE');
  assert.ok(existsSync(lic), 'HUMAN-ATLAS-LICENSE sits beside explosion-layout.mjs');
  assert.match(readFileSync(lic, 'utf8'), /MIT License/);
  assert.match(
    readFileSync(join(repo, 'app', 'src', 'lib', 'scene', 'explosion-layout.mjs'), 'utf8'),
    /human-atlas \(MIT\)/,
  );
});
