// R11: screens read only view JSON — this module is the single door to it.
// R1: no country identity in code; the views directory is enumerated at build
// time, so countries, routes and display names all arrive as data.
const viewModules = import.meta.glob('../../fixtures/views/*.json', {
  eager: true,
  import: 'default',
});

export const views = Object.keys(viewModules)
  .sort()
  .map((k) => viewModules[k]);

export { default as census } from '../../fixtures/census.json';

// Public source of the ledger the census is counted from (repo is public).
export const REPO_BLOB = 'https://github.com/HarimJung/Gaia-Visual-Climate-Ontology/blob/main/';

// Thousands separator without locale machinery; deterministic output.
export const fmt = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
