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
