// R11: screens read only reader-produced view JSON — this module is the single
// door to it. R1: no country identity in code; view directories are enumerated
// at build time, so countries, routes and display names all arrive as data.
//
// Door order: data/views/ (the WP-06 reader's output: countries/*.json plus
// index.json and census.json) whenever it holds country views, else the
// hand-built stand-ins under app/fixtures/ — so the repo builds before the
// reader lands, and the integrator flips by generating data/views/.
import { countsFromRows } from './derive.mjs';
import fixtureCensus from '../../fixtures/census.json';

const readerViews = import.meta.glob('../../../data/views/countries/*.json', {
  eager: true,
  import: 'default',
});
const fixtureViews = import.meta.glob('../../fixtures/views/*.json', {
  eager: true,
  import: 'default',
});
const readerMeta = import.meta.glob('../../../data/views/*.json', {
  eager: true,
  import: 'default',
});

export const engineViews = Object.keys(readerViews).length > 0;

const mods = engineViews ? readerViews : fixtureViews;
// Filename order first for stability, then the world order: country name.
export const views = Object.keys(mods)
  .sort()
  .map((k) => mods[k])
  .sort((a, b) =>
    a.country.name_en < b.country.name_en
      ? -1
      : a.country.name_en > b.country.name_en
        ? 1
        : a.country.iso3 < b.country.iso3
          ? -1
          : 1,
  );

function readerFile(name) {
  const key = Object.keys(readerMeta).find((k) => k.endsWith(`/${name}`));
  if (!key) {
    // R5 publish blocking: a reader output without its census/index is
    // unresolved — figures could not be linked, so the build fails here.
    throw new Error(
      `data/views/${name} is missing while data/views/countries/ holds views — refusing to build (R5/R6)`,
    );
  }
  return readerMeta[key];
}

export const census = engineViews ? readerFile('census.json') : fixtureCensus;

export const index = engineViews
  ? readerFile('index.json')
  : {
      as_of: fixtureCensus.as_of,
      build_id: 'fixtures',
      countries: views.map((v) => ({
        iso3: v.country.iso3,
        name_en: v.country.name_en,
        ledger: fixtureCensus.ledger,
        counts: countsFromRows(v.rows, Object.keys(fixtureCensus.counts)),
      })),
    };

export function countryEntry(iso3) {
  const e = index.countries.find((c) => c.iso3 === iso3);
  if (!e) {
    // R6: without its index entry a country page would render unlinked
    // figures; failing the build is the honest outcome (R5).
    throw new Error(`no index entry for country ${iso3} — refusing to build`);
  }
  return e;
}

// The richest record in the data: most rows with bytes held, among countries
// whose view carries a page quote. The story and the demo path walk the same
// country because they call this same derivation; nothing is named (R1).
export function richestView() {
  const withQuote = views.filter((v) => v.rows.some((r) => r.quote && r.sha256));
  if (withQuote.length === 0) {
    // R5: a walked step without its receipt would have to invent one — refuse.
    throw new Error('no view carries a quoted, hashed row — the walked path cannot be built honestly');
  }
  const bytes = (v) => v.rows.filter((r) => r.sha256).length;
  // views arrive name-sorted, so ties resolve to the first by name: deterministic.
  return withQuote.reduce((a, b) => (bytes(b) > bytes(a) ? b : a));
}

// Public source of the ledgers the census is counted from (repo is public).
export const REPO_BLOB = 'https://github.com/HarimJung/Gaia-Visual-Climate-Ontology/blob/main/';

// Thousands separator without locale machinery; deterministic output.
export const fmt = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
