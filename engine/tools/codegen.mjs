// Codegen (R2): engine/seed/platform/ CSVs → engine/generated/vocab.ts + vocab.json.
// The seed is the single vocabulary canon; this output is deterministic (stable order).
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCSVWithHeader } from '../lib/csv.mjs';

function arg(name, dflt) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? resolve(process.argv[i + 1]) : dflt;
}
const root = arg('--root', resolve(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const outDir = arg('--out', join(root, 'engine', 'generated'));
const seedDir = join(root, 'engine', 'seed', 'platform');

if (!existsSync(seedDir)) {
  console.error('no platform seed');
  process.exit(2);
}

function die(msg) {
  console.error(`codegen: ${msg}`);
  process.exit(1);
}

const FAMILIES = {
  taxonomy: {
    prefix: 'taxonomy_',
    header: 'id,parent_id,class_code,name_en,name_ko,description_en,description_ko',
  },
  relations: {
    prefix: 'relation_types_',
    header: 'id,relation_code,name_en,name_ko,description_en,description_ko,domain_class_hint,range_class_hint',
  },
  facets: {
    prefix: 'facets_',
    header: 'facet_code,facet_name_ko,applicable_class_codes,cardinality,value_code,label_ko,sort_order,source_standard,source_clause_ref',
  },
  attributes: {
    prefix: 'attributes_',
    header: 'attribute_code,name_ko,name_en,datatype,unit_code,description_ko',
  },
  units: {
    prefix: 'units_',
    header: 'unit_code,symbol_canonical,symbol_variants,quantity_kind,factor_to_si,external_ref',
  },
};

function readFamily(name) {
  const { prefix, header } = FAMILIES[name];
  const dir = join(seedDir, name);
  if (!existsSync(dir)) return [];
  const rows = [];
  const files = readdirSync(dir).filter((f) => f.startsWith(prefix) && f.endsWith('.csv')).sort();
  for (const f of files) {
    let parsed;
    try {
      parsed = parseCSVWithHeader(readFileSync(join(dir, f), 'utf8'));
    } catch (e) {
      die(`${name}/${f}: ${e.message}`);
    }
    if (parsed.header.join(',') !== header) {
      die(`${name}/${f}: header must be exactly "${header}"`);
    }
    rows.push(...parsed.rows);
  }
  return rows;
}

function codes(rows, col, kind) {
  const seen = new Set();
  for (const r of rows) {
    const c = r[col];
    if (!c) die(`empty ${col} in ${kind}`);
    if (seen.has(c)) die(`duplicate ${col} "${c}" in ${kind}`);
    seen.add(c);
  }
  return [...seen].sort();
}

const classCodes = codes(readFamily('taxonomy'), 'class_code', 'taxonomy');
const relationCodes = codes(readFamily('relations'), 'relation_code', 'relations');
const attributeCodes = codes(readFamily('attributes'), 'attribute_code', 'attributes');
const unitCodes = codes(readFamily('units'), 'unit_code', 'units');

const byFacet = new Map();
for (const r of readFamily('facets')) {
  if (!r.facet_code || !r.value_code) die('facets row missing facet_code or value_code');
  if (!byFacet.has(r.facet_code)) byFacet.set(r.facet_code, []);
  byFacet.get(r.facet_code).push({ value: r.value_code, sort: Number(r.sort_order) || 0 });
}
const facetValues = {};
for (const code of [...byFacet.keys()].sort()) {
  const vals = byFacet
    .get(code)
    .sort((a, b) => a.sort - b.sort || a.value.localeCompare(b.value))
    .map((v) => v.value);
  const seen = new Set();
  for (const v of vals) {
    if (seen.has(v)) die(`duplicate value_code "${v}" in facet "${code}"`);
    seen.add(v);
  }
  facetValues[code] = vals;
}

const pascal = (s) =>
  s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join('');
const constName = (s) => {
  const n = s.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return /^\d/.test(n) ? `F_${n}` : n;
};
const tsArray = (vals) => `[${vals.map((v) => JSON.stringify(v)).join(', ')}] as const`;

const lines = [
  '// GENERATED — do not edit.',
  '// Single vocabulary canon is the seed (R2): engine/seed/platform/*.csv.',
  '// Regenerate with: node engine/tools/codegen.mjs',
  '',
  `export const CLASS_CODES = ${tsArray(classCodes)};`,
  'export type ClassCode = (typeof CLASS_CODES)[number];',
  '',
  `export const RELATION_CODES = ${tsArray(relationCodes)};`,
  'export type RelationCode = (typeof RELATION_CODES)[number];',
  '',
  `export const ATTRIBUTE_CODES = ${tsArray(attributeCodes)};`,
  'export type AttributeCode = (typeof ATTRIBUTE_CODES)[number];',
  '',
  `export const UNIT_CODES = ${tsArray(unitCodes)};`,
  'export type UnitCode = (typeof UNIT_CODES)[number];',
  '',
];
for (const code of Object.keys(facetValues)) {
  lines.push(`export const ${constName(code)} = ${tsArray(facetValues[code])};`);
  lines.push(`export type ${pascal(code)} = (typeof ${constName(code)})[number];`);
  lines.push('');
}
lines.push('export const FACET_VALUES = {');
for (const code of Object.keys(facetValues)) {
  lines.push(`  ${JSON.stringify(code)}: ${constName(code)},`);
}
lines.push('} as const;');
lines.push('');

const json =
  JSON.stringify(
    {
      class_codes: classCodes,
      relation_codes: relationCodes,
      attribute_codes: attributeCodes,
      unit_codes: unitCodes,
      facet_values: facetValues,
    },
    null,
    2,
  ) + '\n';

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'vocab.ts'), lines.join('\n'));
writeFileSync(join(outDir, 'vocab.json'), json);
console.log(
  `vocab: ${classCodes.length} classes, ${relationCodes.length} relations, ` +
    `${attributeCodes.length} attributes, ${unitCodes.length} units, ` +
    `${Object.keys(facetValues).length} facets -> ${outDir}`,
);
