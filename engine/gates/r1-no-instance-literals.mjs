// R1: no instance hardcoding. Engine code carries no ISO3 / country-name /
// document-id literals; country-specific behaviour lives in seed data.
// The recurrence to kill: the predecessor's `iso3 === <3-letter code>` branch.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { rootArg, walk, violation, lineOf } from './_lib.mjs';
import { parseCSVWithHeader } from '../lib/csv.mjs';

const root = rootArg();
const CODE_EXT = /\.(ts|js|mjs|astro)$/;
const STR_RE = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g;
const TLA_RE = /^[A-Z]{3}$/;

// Allow list: engine/gates/allow-tla.csv (token,reason).
const allow = new Set();
const allowPath = join(root, 'engine', 'gates', 'allow-tla.csv');
if (existsSync(allowPath)) {
  try {
    for (const row of parseCSVWithHeader(readFileSync(allowPath, 'utf8')).rows) {
      if (row.token) allow.add(row.token);
    }
  } catch (e) {
    violation(`R1: cannot read engine/gates/allow-tla.csv: ${e.message}`);
  }
}

// Country display names from the country seed: directory names plus the
// title/name data inside each country directory.
const needles = new Set();
const countriesDir = join(root, 'engine', 'seed', 'countries');
if (existsSync(countriesDir)) {
  for (const e of readdirSync(countriesDir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    needles.add(e.name.toLowerCase());
    const cdir = join(countriesDir, e.name);
    const metaJson = join(cdir, 'country.json');
    if (existsSync(metaJson)) {
      try {
        const o = JSON.parse(readFileSync(metaJson, 'utf8'));
        for (const k of ['name', 'name_en', 'name_ko', 'title']) {
          if (typeof o[k] === 'string' && o[k].length >= 3) needles.add(o[k].toLowerCase());
        }
      } catch {
        // malformed country metadata is owned by the seed work packages
      }
    }
    for (const csvName of ['country.csv', 'documents.csv']) {
      const p = join(cdir, csvName);
      if (!existsSync(p)) continue;
      try {
        for (const row of parseCSVWithHeader(readFileSync(p, 'utf8')).rows) {
          for (const k of ['name', 'name_en', 'name_ko', 'title']) {
            if (row[k] && row[k].length >= 3) needles.add(row[k].toLowerCase());
          }
        }
      } catch {
        // ledger validity is the ledger-keys gate's job
      }
    }
  }
}

// In this repo the seed directory carries only the ISO3 code; the display name
// lives in the front fixtures' view JSON (country block). Derive needles from
// there too, or a planted display name in app code would pass undetected.
const viewsDir = join(root, 'app', 'fixtures', 'views');
if (existsSync(viewsDir)) {
  for (const f of readdirSync(viewsDir)) {
    if (!f.endsWith('.json')) continue;
    try {
      const view = JSON.parse(readFileSync(join(viewsDir, f), 'utf8'));
      const country = view && typeof view.country === 'object' && view.country !== null ? view.country : {};
      for (const k of ['iso3', 'name', 'name_en', 'name_ko']) {
        if (typeof country[k] === 'string' && country[k].length >= 3) needles.add(country[k].toLowerCase());
      }
    } catch {
      // fixture validity is the fixture tests' job
    }
  }
}

const files = [...walk(join(root, 'engine')), ...walk(join(root, 'app'))]
  .filter((p) => CODE_EXT.test(p))
  .filter((p) => {
    const rel = relative(root, p).split(sep).join('/');
    // app/dist is build output generated from scanned sources plus fixture
    // data (which legitimately carries country identity) — excluded like
    // engine/generated. Sources under app/ are scanned in full.
    return (
      !rel.startsWith('engine/generated/') &&
      !rel.startsWith('engine/seed/') &&
      !rel.startsWith('app/dist/') &&
      !rel.startsWith('app/.astro/')
    );
  });

for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const rel = relative(root, file);
  // .astro files carry display text outside string literals, so the country
  // needle scan runs over the whole file, not only quoted strings.
  if (file.endsWith('.astro')) {
    const low = text.toLowerCase();
    for (const n of needles) {
      const idx = low.indexOf(n);
      if (idx !== -1) {
        violation(
          `R1: ${rel}:${lineOf(text, idx)} file contains country seed name "${n}" — ` +
            'display names come from seed/fixture data, not code',
        );
      }
    }
  }
  for (const m of text.matchAll(STR_RE)) {
    const inner = m[0].slice(1, -1);
    if (TLA_RE.test(inner) && !allow.has(inner)) {
      violation(
        `R1: ${rel}:${lineOf(text, m.index)} instance literal "${inner}" — ` +
          'country/instance codes live in seed data, not code (or add to engine/gates/allow-tla.csv with a reason)',
      );
    }
    const low = inner.toLowerCase();
    for (const n of needles) {
      if (low.includes(n)) {
        violation(
          `R1: ${rel}:${lineOf(text, m.index)} string contains country seed name "${n}" — ` +
            'display names come from seed data, not code',
        );
      }
    }
  }
}
