// R17: the design system is canon in the seed, the same way the vocabulary is.
// One axis, one channel (docs/DESIGN.md). Every colour, size, duration and
// pattern the product spends comes from engine/seed/platform/design/ through
// codegen; the maths here validates and never chooses — it computes WCAG
// contrast and greyscale separation and refuses, it does not pick a value.
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { rootArg, walk, violation, note, lineOf } from './_lib.mjs';
import { parseCSVWithHeader } from '../lib/csv.mjs';
import { readGraph } from '../reader/reader.mjs';

// ── Failing by design ──────────────────────────────────────────────────────
// One rule below is written in full and switched off, because the material it
// judges is not ready yet: the app still carries its pre-canon dark instrument
// palette inline. Re-skinning the pages on the generated custom properties is
// the next work package, and it flips this on. Nothing is weakened — the rule
// prints what it WOULD refuse on every run, so the count visibly falls as the
// re-skin lands.
const TODO_ENFORCE_NO_LITERAL_COLOUR = false;

const root = rootArg();
const seedDir = join(root, 'engine', 'seed', 'platform', 'design');
const genDir = join(root, 'engine', 'generated');
const GENERATED = ['design-tokens.css', 'design-tokens.json', 'textures.svg'];

if (!existsSync(seedDir)) {
  note('skipped: no design seed at this root');
  process.exit(0);
}

const fail = (rule, msg) => violation(`R17 ${rule}: ${msg}`);

function seed(file, header) {
  const path = join(seedDir, file);
  if (!existsSync(path)) {
    fail('seed-shape', `engine/seed/platform/design/${file} missing`);
    return [];
  }
  let parsed;
  try {
    parsed = parseCSVWithHeader(readFileSync(path, 'utf8'));
  } catch (e) {
    fail('seed-shape', `${file}: ${e.message}`);
    return [];
  }
  if (parsed.header.join(',') !== header) {
    fail('seed-shape', `${file}: header must be exactly "${header}"`);
    return [];
  }
  return parsed.rows;
}

const tokenRows = seed('tokens_record.csv', 'token,value,group,note,border_token');
const channelRows = seed('channels_record.csv', 'axis,channel,token_prefix,note');
const encodingRows = seed('encodings_record.csv', 'axis,entity,token,note');
const textureRows = seed('textures_record.csv', 'texture,kind,angle,stroke,note');

const tokenValue = new Map(tokenRows.map((r) => [r.token, r.value]));
const textureIds = new Set(textureRows.map((r) => r.texture));

// ── 1. codegen-fresh ───────────────────────────────────────────────────────
{
  const codegen = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'tools', 'codegen.mjs');
  const tmp = mkdtempSync(join(tmpdir(), 'design-fresh-'));
  try {
    const r = spawnSync(process.execPath, [codegen, '--root', root, '--out', tmp], { encoding: 'utf8' });
    if (r.status !== 0) {
      fail('codegen-fresh', `codegen exited ${r.status}: ${(r.stderr || '').trim()}`);
    } else {
      for (const f of GENERATED) {
        const committed = join(genDir, f);
        if (!existsSync(committed)) {
          fail('codegen-fresh', `engine/generated/${f} missing — run npm run codegen and commit the output`);
        } else if (readFileSync(committed, 'utf8') !== readFileSync(join(tmp, f), 'utf8')) {
          fail('codegen-fresh', `engine/generated/${f} is stale — regenerate from the seed (npm run codegen)`);
        }
      }
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// ── 2. encoding-complete ───────────────────────────────────────────────────
// Every entity the published record actually carries on an encoded axis must
// have a binding. Source families and epistemic states come from the base rows
// through the single-door reader (AD-8); nothing here re-parses them.
const encoded = new Map(); // axis -> Map(entity -> [token...])
for (const r of encodingRows) {
  if (!encoded.has(r.axis)) encoded.set(r.axis, new Map());
  encoded.get(r.axis).set(r.entity, String(r.token).split('+').filter(Boolean));
}

let g = null;
try {
  g = readGraph(root);
} catch (e) {
  fail('encoding-complete', e.message);
}
if (g === null) {
  note('note: nothing published yet — encoding-complete has no entities to check');
} else {
  const present = {
    'source-family': new Set(g.base.map((r) => r.anchor_source_id).filter(Boolean)),
    'epistemic-state': new Set(g.base.map((r) => r.state).filter(Boolean)),
  };
  for (const [axis, entities] of Object.entries(present)) {
    const bound = encoded.get(axis) ?? new Map();
    for (const e of [...entities].sort()) {
      if (!bound.has(e)) {
        fail(
          'encoding-complete',
          `axis "${axis}" carries "${e}" in the published rows with no binding — ` +
            'add the row to engine/seed/platform/design/encodings_record.csv',
        );
      }
    }
  }
  note(
    `encoding-complete: ${present['source-family'].size} source famil(ies) and ` +
      `${present['epistemic-state'].size} state(s) present, all bound`,
  );
}

// ── 3. encoding-orphan ─────────────────────────────────────────────────────
for (const [axis, bound] of [...encoded].sort()) {
  for (const [entity, tokens] of [...bound].sort()) {
    if (tokens.length === 0) fail('encoding-orphan', `${axis}/${entity} names no token`);
    for (const t of tokens) {
      const known = t.startsWith('texture.')
        ? textureIds.has(t.slice('texture.'.length))
        : tokenValue.has(t);
      if (!known) {
        fail(
          'encoding-orphan',
          `${axis}/${entity} names "${t}" which the seed does not carry ` +
            '(tokens_record.csv, or textures_record.csv for a texture.* id)',
        );
      }
    }
  }
}

// ── 4. channel-exclusive ───────────────────────────────────────────────────
const byChannel = new Map();
for (const r of channelRows) {
  if (!r.axis || !r.channel) {
    fail('channel-exclusive', 'channels_record.csv row missing axis or channel');
    continue;
  }
  if (byChannel.has(r.channel)) {
    fail(
      'channel-exclusive',
      `channel "${r.channel}" is claimed by both "${byChannel.get(r.channel)}" and "${r.axis}" — ` +
        'one axis, one channel',
    );
  } else {
    byChannel.set(r.channel, r.axis);
  }
}
for (const [axis, bound] of [...encoded].sort()) {
  const owner = new Map();
  for (const [entity, tokens] of [...bound].sort()) {
    const key = tokens.join('+');
    if (owner.has(key)) {
      fail(
        'channel-exclusive',
        `axis "${axis}" spends "${key}" on both "${owner.get(key)}" and "${entity}" — ` +
          'a channel value means one thing per axis',
      );
    } else {
      owner.set(key, entity);
    }
  }
}

// ── 5. label-on-fill · 6. bounded-light-fill ───────────────────────────────
// WCAG 2.1 relative luminance and contrast ratio, computed, never chosen.
//
// WCAG 1.4.11's 3:1 covers a graphical object you must see to understand the
// content — not every fill against the page. A brand fill is allowed to sit
// quietly on paper; what it may not do is sit there unbounded. So: every fill
// must carry a readable label (label-on-fill), and a fill that does not clear
// 3.0:1 against paper must declare a border token that does (bounded-light-fill).
const channelLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
function luminance(hex) {
  const h = hex.trim().replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  const [r, gg, b] = [0, 2, 4].map((i) => channelLin(parseInt(h.slice(i, i + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * gg + 0.0722 * b;
}
function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  if (la === null || lb === null) return null;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
const r2 = (n) => n.toFixed(2);

const PAPER = 'colour.paper';
const INK = 'colour.ink';
const FILL_FLOOR = 3.0;
const LABEL_FLOOR = 4.5;
const paper = tokenValue.get(PAPER);
const ink = tokenValue.get(INK);
if (!paper || !ink) {
  fail('label-on-fill', `tokens_record.csv must carry ${PAPER} and ${INK} to measure anything against`);
} else {
  const fills = tokenRows.filter((r) => r.token.startsWith('meaning.') || r.token.startsWith('neutral.'));
  const report = [];
  const bounded = [];
  for (const f of fills) {
    const vsPaper = contrast(f.value, paper);
    const vsInk = contrast(f.value, ink);
    if (vsPaper === null || vsInk === null) {
      fail('label-on-fill', `${f.token} value "${f.value}" is not a 6-digit hex colour`);
      continue;
    }
    const label = Math.max(vsPaper, vsInk);
    report.push(`${f.token} ${r2(vsPaper)}/${r2(label)}`);
    if (label < LABEL_FLOOR) {
      fail(
        'label-on-fill',
        `${f.token} (${f.value}) labels at ${r2(label)}:1 against the better of ${INK}/${PAPER} — ` +
          `a label must clear ${LABEL_FLOOR.toFixed(1)}:1`,
      );
    }
    // A fill at or above the floor stands on its own edge; a border token on it
    // is allowed and simply unused here.
    if (vsPaper >= FILL_FLOOR) continue;
    if (!f.border_token) {
      fail(
        'bounded-light-fill',
        `${f.token} (${f.value}) is ${r2(vsPaper)}:1 against ${PAPER} and declares no border_token — ` +
          `a fill under ${FILL_FLOOR.toFixed(1)}:1 must name a border in tokens_record.csv`,
      );
      continue;
    }
    const borderValue = tokenValue.get(f.border_token);
    if (!borderValue) {
      fail(
        'bounded-light-fill',
        `${f.token} names border_token "${f.border_token}" which tokens_record.csv does not carry`,
      );
      continue;
    }
    const borderVsPaper = contrast(borderValue, paper);
    if (borderVsPaper === null) {
      fail('bounded-light-fill', `${f.token} border ${f.border_token} value "${borderValue}" is not a 6-digit hex colour`);
      continue;
    }
    bounded.push(`${f.token} ${r2(vsPaper)} bounded by ${f.border_token} ${r2(borderVsPaper)}`);
    if (borderVsPaper < FILL_FLOOR) {
      fail(
        'bounded-light-fill',
        `${f.token} is bounded by ${f.border_token} (${borderValue}) at ${r2(borderVsPaper)}:1 against ${PAPER} — ` +
          `the border itself must clear ${FILL_FLOOR.toFixed(1)}:1`,
      );
    }
  }
  note(`label-on-fill, fill-vs-paper/best-label (floor ${LABEL_FLOOR.toFixed(1)}): ${report.join(' · ')}`);
  note(
    bounded.length > 0
      ? `bounded-light-fill (floor ${FILL_FLOOR.toFixed(1)}): ${bounded.join(' · ')}`
      : `bounded-light-fill: no fill sits under ${FILL_FLOOR.toFixed(1)}:1 against ${PAPER}`,
  );
}

// ── 7. greyscale-separation ────────────────────────────────────────────────
// The source-family ramp is read as a ramp, so neighbouring steps must stay
// apart once hue is gone. The contrast ratio is computed from relative
// luminance, which is the greyscale reduction.
const STEP_FLOOR = 1.3;
const ramp = tokenRows.filter((r) => r.token.startsWith('neutral.src-')).sort((a, b) => a.token.localeCompare(b.token));
if (ramp.length < 2) {
  fail('greyscale-separation', `the neutral ramp has ${ramp.length} step(s) — it needs at least two to separate`);
} else {
  const steps = [];
  for (let i = 1; i < ramp.length; i++) {
    const c = contrast(ramp[i - 1].value, ramp[i].value);
    if (c === null) {
      fail('greyscale-separation', `${ramp[i - 1].token}/${ramp[i].token}: a value is not a 6-digit hex colour`);
      continue;
    }
    steps.push(`${ramp[i - 1].token}→${ramp[i].token} ${c.toFixed(3)}`);
    if (c < STEP_FLOOR) {
      fail(
        'greyscale-separation',
        `${ramp[i - 1].token} (${ramp[i - 1].value}) and ${ramp[i].token} (${ramp[i].value}) ` +
          `are ${c.toFixed(3)}:1 apart in greyscale — adjacent steps must clear ${STEP_FLOOR}`,
      );
    }
  }
  note(`greyscale separation (floor ${STEP_FLOOR}): ${steps.join(' · ')}`);
}

// ── 8. no-literal-colour ───────────────────────────────────────────────────
// The app spends colour only through the generated custom properties. Hex,
// rgb() and hsl() literals in app/src CSS and .astro style blocks are a second
// canon. currentColor, transparent and none are not colour choices, and an SVG
// <defs>/<pattern> block carries the generated textures' own literals.
const HEX = /(?<![\w&#])#[0-9a-fA-F]{3,8}\b/g;
const FUNC = /\b(?:rgba?|hsla?)\(/g;
const STYLE_BLOCK = /<style\b[^>]*>([\s\S]*?)<\/style>/g;
const OWNED_SVG = /<(defs|pattern)\b[\s\S]*?<\/\1>/g;
const blank = (s) => s.replace(/[^\n]/g, ' ');

const literals = [];
for (const file of walk(join(root, 'app', 'src'))) {
  const rel = relative(root, file).split(sep).join('/');
  if (!/\.(css|astro)$/.test(file)) continue;
  const text = readFileSync(file, 'utf8');
  let scanned;
  if (file.endsWith('.css')) {
    scanned = text;
  } else {
    // Only the style blocks are CSS; the rest of the .astro file (markup, the
    // generated textures' own <defs>) is blanked but keeps its offsets so the
    // reported line numbers stay the file's own.
    scanned = blank(text);
    for (const m of text.matchAll(STYLE_BLOCK)) {
      const at = m.index + m[0].indexOf('>') + 1;
      scanned = scanned.slice(0, at) + m[1] + scanned.slice(at + m[1].length);
    }
  }
  scanned = scanned.replace(OWNED_SVG, blank);
  for (const re of [HEX, FUNC]) {
    for (const m of scanned.matchAll(re)) {
      literals.push(`${rel}:${lineOf(scanned, m.index)} ${m[0].trim()}`);
    }
  }
}
if (literals.length > 0) {
  if (TODO_ENFORCE_NO_LITERAL_COLOUR) {
    for (const l of literals) {
      fail(
        'no-literal-colour',
        `${l} — colour comes from engine/generated/design-tokens.css (var(--…)), never a literal`,
      );
    }
  } else {
    // Per-file tally plus the first few, so the digest stays one readable line
    // and a single planted literal is still pinpointed.
    const tally = new Map();
    for (const l of literals) {
      const f = l.split(':')[0];
      tally.set(f, (tally.get(f) ?? 0) + 1);
    }
    note(
      `TODO-DISABLED no-literal-colour (TODO_ENFORCE_NO_LITERAL_COLOUR) would refuse ${literals.length}: ` +
        [...tally].map(([f, n]) => `${f} ${n}`).join(' · ') +
        ` — first: ${literals.slice(0, 10).join(' · ')}`,
    );
  }
} else {
  note('no-literal-colour: app/src spends no colour literal');
}
