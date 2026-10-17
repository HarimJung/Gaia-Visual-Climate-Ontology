// Codegen (R2): engine/seed/platform/ CSVs → engine/generated/vocab.ts + vocab.json,
// and engine/seed/platform/design/ CSVs → engine/generated/design-tokens.css,
// design-tokens.json, textures.svg.
// The seed is the single vocabulary and design canon; this output is
// deterministic (stable order).
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
if (!existsSync(join(seedDir, 'design'))) {
  console.error('no design seed');
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

function readSeedCSVs(dirName, prefix, header) {
  const dir = join(seedDir, dirName);
  if (!existsSync(dir)) return [];
  const rows = [];
  const files = readdirSync(dir).filter((f) => f.startsWith(prefix) && f.endsWith('.csv')).sort();
  for (const f of files) {
    let parsed;
    try {
      parsed = parseCSVWithHeader(readFileSync(join(dir, f), 'utf8'));
    } catch (e) {
      die(`${dirName}/${f}: ${e.message}`);
    }
    if (parsed.header.join(',') !== header) {
      die(`${dirName}/${f}: header must be exactly "${header}"`);
    }
    rows.push(...parsed.rows);
  }
  return rows;
}

function readFamily(name) {
  const { prefix, header } = FAMILIES[name];
  return readSeedCSVs(name, prefix, header);
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

// ---------------------------------------------------------------- design canon
// One axis, one channel (docs/DESIGN.md). The seed carries the tokens, the
// axis→channel map, the entity→token bindings and the texture patterns; the
// three generated files below are the only shape the app is allowed to read.
const DESIGN = {
  tokens: { prefix: 'tokens_', header: 'token,value,group,note,border_token' },
  channels: { prefix: 'channels_', header: 'axis,channel,token_prefix,note' },
  encodings: { prefix: 'encodings_', header: 'axis,entity,token,note' },
  textures: { prefix: 'textures_', header: 'texture,kind,angle,stroke,note' },
};
const design = Object.fromEntries(
  Object.entries(DESIGN).map(([k, { prefix, header }]) => [k, readSeedCSVs('design', prefix, header)]),
);

// Custom-property names are derived from the token id, never chosen: these
// groups spend their prefix on the id's meaning only, so the prefix is dropped
// (colour.paper -> --paper, ease.out -> --out); every other prefix is kept with
// the dot turned into a dash (dial.face -> --dial-face, dur.quick -> --dur-quick).
const DROP_PREFIX = new Set(['colour', 'meaning', 'neutral', 'quant', 'size', 'space', 'ease']);
function cssVar(id) {
  const dot = id.indexOf('.');
  const body = dot !== -1 && DROP_PREFIX.has(id.slice(0, dot)) ? id.slice(dot + 1) : id;
  return `--${body.replace(/\./g, '-')}`;
}

const tokens = {};
const cssVars = {};
for (const r of design.tokens) {
  if (!r.token) die('design/tokens row with an empty token id');
  if (tokens[r.token]) die(`duplicate design token "${r.token}"`);
  if (!r.value) die(`design token "${r.token}" has no value`);
  if (!/^[a-z0-9-]+$/.test(r.group)) die(`design token "${r.token}" group "${r.group}" is not a lower-case slug`);
  const v = cssVar(r.token);
  if (cssVars[v] !== undefined) die(`design tokens collide on custom property "${v}" ("${r.token}")`);
  // border_token: the border a light fill must carry on paper. Whether it is
  // required, present and dark enough is the design-canon gate's job
  // (bounded-light-fill); codegen only carries it through.
  tokens[r.token] = { value: r.value, group: r.group, note: r.note, css_var: v, border_token: r.border_token };
  cssVars[v] = r.value;
}
const tokenValue = (id) => {
  if (!tokens[id]) die(`design seed references token "${id}" which tokens_record.csv does not carry`);
  return tokens[id].value;
};

const channels = {};
for (const r of design.channels) {
  if (!r.axis || !r.channel) die('design/channels row missing axis or channel');
  if (channels[r.axis]) die(`duplicate axis "${r.axis}" in design/channels`);
  channels[r.axis] = { channel: r.channel, token_prefix: r.token_prefix, note: r.note };
}

const encodings = {};
for (const r of design.encodings) {
  if (!r.axis || !r.entity) die('design/encodings row missing axis or entity');
  if (!channels[r.axis]) die(`design/encodings names axis "${r.axis}" which design/channels does not carry`);
  encodings[r.axis] ??= {};
  if (encodings[r.axis][r.entity]) die(`duplicate binding ${r.axis}/${r.entity} in design/encodings`);
  encodings[r.axis][r.entity] = { tokens: r.token.split('+').filter(Boolean), note: r.note };
}
// Whether every binding names a token that exists is the design-canon gate's
// job (encoding-orphan), not codegen's: codegen emits, the gate validates.

// Every texture is one 5×5 tile. Direction is the line's own angle from the
// horizontal, so the path is chosen by angle and never rotated at use time;
// corner-to-corner and mid-tile lines both tile seamlessly.
const TILE = 5;
const MID = TILE / 2;
const HATCH_PATH = {
  0: `M0,${MID} H${TILE}`,
  45: `M0,${TILE} L${TILE},0`,
  90: `M${MID},0 V${TILE}`,
  135: `M0,0 L${TILE},${TILE}`,
};
const TEXTURE_FILL = 'colour.paper-sunken';
const TEXTURE_INK = 'colour.ink-4';

const textures = {};
const patterns = [];
for (const r of design.textures) {
  if (!r.texture) die('design/textures row with an empty texture id');
  if (textures[r.texture]) die(`duplicate texture "${r.texture}"`);
  const fill = tokenValue(TEXTURE_FILL);
  const ink = tokenValue(TEXTURE_INK);
  const angles = r.angle.split('+').filter(Boolean);
  const body = [`      <rect width="${TILE}" height="${TILE}" fill="${fill}"/>`];
  if (r.kind === 'dots') {
    if (angles.length > 0) die(`texture "${r.texture}" is a dot field and carries no angle`);
    body.push(`      <circle cx="${MID}" cy="${MID}" r="${r.stroke}" fill="${ink}"/>`);
  } else if (r.kind === 'hatch' || r.kind === 'cross') {
    if (r.kind === 'hatch' ? angles.length !== 1 : angles.length < 2) {
      die(`texture "${r.texture}" (${r.kind}) carries the wrong number of angles: "${r.angle}"`);
    }
    for (const a of angles) {
      if (!HATCH_PATH[a]) die(`texture "${r.texture}" names angle "${a}" — only 0, 45, 90 and 135 are drawn`);
      body.push(
        `      <path d="${HATCH_PATH[a]}" stroke="${ink}" stroke-width="${r.stroke}" fill="none"/>`,
      );
    }
  } else {
    die(`texture "${r.texture}" has unknown kind "${r.kind}"`);
  }
  textures[r.texture] = {
    kind: r.kind,
    angles,
    stroke: r.stroke,
    tile: TILE,
    fill_token: TEXTURE_FILL,
    fill,
    ink_token: TEXTURE_INK,
    ink,
    note: r.note,
  };
  patterns.push(
    `    <pattern id="t-${r.texture}" width="${TILE}" height="${TILE}" patternUnits="userSpaceOnUse">`,
    ...body,
    '    </pattern>',
  );
}

const BANNER = [
  'GENERATED — do not edit.',
  'Design canon is the seed: engine/seed/platform/design/tokens_record.csv,',
  'channels_record.csv, encodings_record.csv, textures_record.csv.',
  'Regenerate with: node engine/tools/codegen.mjs',
];

const cssLines = ['/* ' + BANNER.join('\n   ') + ' */', ':root {'];
let group = null;
for (const t of Object.values(tokens)) {
  if (t.group !== group) {
    if (group !== null) cssLines.push('');
    cssLines.push(`  /* ${t.group} */`);
    group = t.group;
  }
  cssLines.push(`  ${t.css_var}: ${t.value};`);
}
cssLines.push('}', '');

const designJson =
  JSON.stringify(
    {
      tokens,
      css_vars: cssVars,
      channels,
      encodings,
      textures,
    },
    null,
    2,
  ) + '\n';

const svg = [
  `<!-- ${BANNER.join('\n     ')} -->`,
  '<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" aria-hidden="true" focusable="false">',
  '  <defs>',
  ...patterns,
  '  </defs>',
  '</svg>',
  '',
].join('\n');

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'vocab.ts'), lines.join('\n'));
writeFileSync(join(outDir, 'vocab.json'), json);
writeFileSync(join(outDir, 'design-tokens.css'), cssLines.join('\n'));
writeFileSync(join(outDir, 'design-tokens.json'), designJson);
writeFileSync(join(outDir, 'textures.svg'), svg);
console.log(
  `vocab: ${classCodes.length} classes, ${relationCodes.length} relations, ` +
    `${attributeCodes.length} attributes, ${unitCodes.length} units, ` +
    `${Object.keys(facetValues).length} facets -> ${outDir}`,
);
console.log(
  `design: ${Object.keys(tokens).length} tokens, ${Object.keys(channels).length} channels, ` +
    `${Object.values(encodings).reduce((n, a) => n + Object.keys(a).length, 0)} bindings, ` +
    `${Object.keys(textures).length} textures -> ${outDir}`,
);
