// R9: stale is never a stored flag — it is the structural diff of two builds.
// This module takes two graph snapshots (directories holding base.csv,
// derived.csv, build.json, optionally census.json and views/) and recomputes,
// from nothing but those bytes:
//
//   - added / removed / substantively changed rows (value, state, reason),
//   - every changed anchor (a source document whose sha256 changed, a registry
//     row that moved locator, a treaty event re-anchored) and, for each, the
//     full list of SHAKEN claims: every graph row that rested on that anchor,
//   - every view field (reader-produced view JSON) that rested on a shaken
//     anchor, with its receipt deep link,
//   - per-claim staleness flags (AD-12): a shaken claim whose evidence is
//     older than its source contract's staleness budget is marked past-budget.
//     "Now" is the to-snapshot's built_at, never the wall clock, so the same
//     two snapshots always produce byte-identical reports.
//
// Output: data/diff/<from12>__<to12>.json plus a markdown digest whose body is
// R13 lines — one line per change, "YYYY-MM-DD | <source> | <what shook>" —
// ready for WP-10 to route to the ops ledger. No delivery is implemented here.
// Nothing is stored between runs: queue depth and longest wait are recomputed
// every time (that IS R9; the r9-no-stored-queue gate bans the alternative).
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { graphDirOf, readSnapshotCSVs } from '../reader/reader.mjs';
import { walk } from '../gates/_lib.mjs';

const SUBSTANTIVE = ['value', 'state', 'reason'];
const ANCHOR_FIELDS = ['anchor_kind', 'anchor_source_id', 'anchor_sha256', 'anchor_locator'];
const SHA_RE = /^[0-9a-f]{64}$/;
const DAY_MS = 86400000;
const KEY_SEP = '\u0000';

const keyOf = (r) => `${r.iso3}${KEY_SEP}${r.record_key}`;
const s12 = (sha) => (sha ? sha.slice(0, 12) : '');
const ledgerUrl = (iso3) => `/country/${iso3.toLowerCase()}/`;

// ---------------------------------------------------------------- snapshots

export function loadSnapshot(dir, root) {
  const need = (f) => {
    const p = join(dir, f);
    if (!existsSync(p)) throw new Error(`snapshot ${dir} is missing ${f}`);
    return p;
  };
  const build = JSON.parse(readFileSync(need('build.json'), 'utf8'));
  need('base.csv');
  need('derived.csv');
  const { base, derived } = readSnapshotCSVs(dir);

  // Views belong to a snapshot: <dir>/views, plus — only when the snapshot IS
  // the live graph — the live reader output next to it (data/views).
  const viewDirs = [join(dir, 'views')];
  if (root && resolve(dir) === resolve(graphDirOf(root))) {
    viewDirs.push(resolve(root, 'data', 'views'));
  }
  const views = [];
  for (const vd of viewDirs) {
    for (const p of walk(vd)) {
      if (!p.endsWith('.json')) continue;
      let v;
      try {
        v = JSON.parse(readFileSync(p, 'utf8'));
      } catch {
        continue; // reader index/census or non-view JSON — not a country view
      }
      if (v && typeof v === 'object' && v.country && Array.isArray(v.rows)) {
        views.push({ file: basename(p), view: v });
      }
    }
  }
  views.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  return { dir, build, base, derived, views };
}

export function resolveSnapshot(arg, root) {
  if (existsSync(arg) && statSync(arg).isDirectory()) return arg;
  const candidates = [graphDirOf(root)];
  const snaps = join(root, 'data', 'snapshots');
  if (existsSync(snaps)) {
    for (const e of readdirSync(snaps, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.isDirectory()) candidates.push(join(snaps, e.name));
    }
  }
  for (const c of candidates) {
    const bj = join(c, 'build.json');
    if (!existsSync(bj)) continue;
    const id = JSON.parse(readFileSync(bj, 'utf8')).build_id ?? '';
    if (id === arg || (arg.length >= 8 && id.startsWith(arg))) return c;
  }
  throw new Error(`"${arg}" is neither a snapshot directory nor a known build_id prefix`);
}

// Flatten build.json inputs to (path → sha256) leaves, whatever the nesting.
function inputLeaves(build) {
  const out = new Map();
  (function rec(node, path) {
    if (typeof node === 'string') {
      if (SHA_RE.test(node)) out.set(path, node);
      return;
    }
    if (node && typeof node === 'object') {
      for (const k of Object.keys(node).sort()) rec(node[k], path ? `${path}.${k}` : k);
    }
  })(build.inputs ?? {}, '');
  return out;
}

// ---------------------------------------------------------------- contracts

function loadBudgets(root) {
  const budgets = new Map(); // source_id → staleness_budget_days
  const dir = join(root, 'engine', 'sources', 'contracts');
  if (!existsSync(dir)) return budgets;
  for (const f of readdirSync(dir).sort()) {
    if (!f.endsWith('.json')) continue;
    try {
      const c = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      if (c.source_id && Number.isFinite(c.staleness_budget_days)) {
        budgets.set(c.source_id, c.staleness_budget_days);
      }
    } catch {
      // a malformed contract is the r14 gate's finding, not this report's
    }
  }
  return budgets;
}

// ---------------------------------------------------------------- diff core

function diffRowFile(file, fromRows, toRows, shakenFromShas) {
  const fromMap = new Map(fromRows.map((r) => [keyOf(r), r]));
  const toMap = new Map(toRows.map((r) => [keyOf(r), r]));
  const fields = file === 'derived' ? [...SUBSTANTIVE, 'derived_rule'] : SUBSTANTIVE;

  const added = [];
  const removed = [];
  const changed = [];
  let refetchedOnly = 0;
  const anchorChangedKeys = new Map(); // key → sorted changed anchor fields

  const allKeys = [...new Set([...fromMap.keys(), ...toMap.keys()])].sort();
  for (const k of allKeys) {
    const f = fromMap.get(k);
    const t = toMap.get(k);
    if (!f) {
      added.push({ iso3: t.iso3, record_key: t.record_key, state: t.state, anchor_source_id: t.anchor_source_id });
      continue;
    }
    if (!t) {
      removed.push({ iso3: f.iso3, record_key: f.record_key, state: f.state, anchor_source_id: f.anchor_source_id });
      continue;
    }
    const sub = {};
    for (const c of fields) if (f[c] !== t[c]) sub[c] = { from: f[c], to: t[c] };
    if (Object.keys(sub).length > 0) {
      changed.push({
        iso3: f.iso3,
        record_key: f.record_key,
        anchor_source_id: t.anchor_source_id || f.anchor_source_id,
        changed_fields: sub,
        ledger_url: ledgerUrl(f.iso3),
      });
    }
    const anch = ANCHOR_FIELDS.filter((c) => f[c] !== t[c]).sort();
    if (anch.length > 0) {
      anchorChangedKeys.set(k, anch);
      if (f.anchor_sha256) shakenFromShas.add(f.anchor_sha256);
    } else if (Object.keys(sub).length === 0 && f.retrieved_at !== t.retrieved_at) {
      refetchedOnly++;
    }
  }
  return {
    fromMap,
    toMap,
    anchorChangedKeys,
    summary: {
      counts: { from: fromRows.length, to: toRows.length },
      added,
      removed,
      changed,
      refetched_only: refetchedOnly,
    },
  };
}

function shakenViewFields(views, shakenFromShas) {
  const fields = [];
  for (const { file, view } of views) {
    const iso3 = String(view.country.iso3 ?? '').toLowerCase();
    const shakenDocIds = new Set();
    for (const row of view.rows) {
      if (row && row.sha256 && shakenFromShas.has(row.sha256)) {
        shakenDocIds.add(row.doc_id);
        fields.push({
          view: file,
          path: `rows[doc_id=${row.doc_id}]`,
          doc_id: row.doc_id,
          receipt_url: `/receipt/${iso3}/${row.doc_id}/`,
        });
      }
    }
    // Any field elsewhere in the view that cites a shaken receipt rests on the
    // same anchor — generic walk, no view-schema knowledge beyond "receipt".
    (function rec(node, path) {
      if (Array.isArray(node)) {
        node.forEach((v, i) => rec(v, `${path}[${i}]`));
        return;
      }
      if (node && typeof node === 'object') {
        for (const k of Object.keys(node).sort()) {
          if (k === 'receipt' && typeof node[k] === 'string' && shakenDocIds.has(node[k])) {
            fields.push({
              view: file,
              path: `${path ? path + '.' : ''}receipt`,
              doc_id: node[k],
              receipt_url: `/receipt/${iso3}/${node[k]}/`,
            });
          } else {
            rec(node[k], path ? `${path}.${k}` : k);
          }
        }
      }
    })(view, '');
  }
  fields.sort((a, b) => (a.view + a.path < b.view + b.path ? -1 : 1));
  return fields;
}

export function diffSnapshots(from, to, root) {
  const budgets = loadBudgets(root);
  const asOfMs = Date.parse(to.build.built_at);

  // Changed build inputs (document-level anchors).
  const fromLeaves = inputLeaves(from.build);
  const toLeaves = inputLeaves(to.build);
  const inputsChanged = [];
  const leafByFromSha = new Map();
  for (const p of [...new Set([...fromLeaves.keys(), ...toLeaves.keys()])].sort()) {
    const a = fromLeaves.get(p) ?? null;
    const b = toLeaves.get(p) ?? null;
    if (a !== b) inputsChanged.push({ path: p, from: a, to: b });
    if (a && a !== b) leafByFromSha.set(a, p);
  }

  // Row-level diff, collecting from-side shas of every changed anchor.
  const shakenFromShas = new Set();
  for (const { from: a } of inputsChanged.filter((c) => c.from && c.to)) shakenFromShas.add(a);
  const base = diffRowFile('base', from.base, to.base, shakenFromShas);
  const derived = diffRowFile('derived', from.derived, to.derived, shakenFromShas);

  // Shaken claims: every FROM row resting on a changed anchor.
  const claims = [];
  for (const [file, d, fromRows] of [
    ['base', base, from.base],
    ['derived', derived, from.derived],
  ]) {
    for (const r of fromRows) {
      if (!r.anchor_sha256 || !shakenFromShas.has(r.anchor_sha256)) continue;
      const k = keyOf(r);
      const t = d.toMap.get(k);
      const evidence = t ?? r; // age of what the claim now rests on, else what it rested on
      const budget = budgets.has(r.anchor_source_id) ? budgets.get(r.anchor_source_id) : null;
      const ageDays = evidence.retrieved_at ? Math.floor((asOfMs - Date.parse(evidence.retrieved_at)) / DAY_MS) : null;
      claims.push({
        file,
        iso3: r.iso3,
        record_key: r.record_key,
        anchor_source_id: r.anchor_source_id,
        from_sha256: r.anchor_sha256,
        to_sha256: t ? t.anchor_sha256 || null : null,
        survives: Boolean(t),
        anchor_fields_changed: d.anchorChangedKeys.get(k) ?? [],
        age_days: ageDays,
        budget_days: budget,
        over_sla: budget !== null && ageDays !== null ? ageDays > budget : null,
        ledger_url: ledgerUrl(r.iso3),
      });
    }
  }
  claims.sort((a, b) => {
    const ka = `${a.file}${KEY_SEP}${a.iso3}${KEY_SEP}${a.record_key}`;
    const kb = `${b.file}${KEY_SEP}${b.iso3}${KEY_SEP}${b.record_key}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

  // Group per changed anchor.
  const groups = new Map();
  for (const c of claims) {
    const gk = `${c.anchor_source_id}${KEY_SEP}${c.from_sha256}`;
    if (!groups.has(gk)) {
      groups.set(gk, {
        source_id: c.anchor_source_id,
        from_sha256: c.from_sha256,
        to_sha256s: new Set(),
        input_path: leafByFromSha.get(c.from_sha256) ?? null,
        claims: 0,
        over_sla: 0,
      });
    }
    const g = groups.get(gk);
    g.claims++;
    if (c.over_sla === true) g.over_sla++;
    if (c.to_sha256 && c.to_sha256 !== c.from_sha256) g.to_sha256s.add(c.to_sha256);
  }
  const changedAnchors = [...groups.values()]
    .map((g) => ({ ...g, to_sha256s: [...g.to_sha256s].sort() }))
    .sort((a, b) => (a.source_id + a.from_sha256 < b.source_id + b.from_sha256 ? -1 : 1));

  const viewFields = shakenViewFields(from.views, shakenFromShas);
  const viewsAvailable = from.views.length > 0;

  const overSla = claims.filter((c) => c.over_sla === true).length;
  const ages = claims.map((c) => c.age_days).filter((a) => a !== null);

  return {
    report: 'graph-diff',
    r9: 'recomputed from two snapshots on every run; this file stores no state and no queue',
    from: { build_id: from.build.build_id, built_at: from.build.built_at },
    to: { build_id: to.build.build_id, built_at: to.build.built_at },
    base: base.summary,
    derived: derived.summary,
    inputs_changed: inputsChanged,
    changed_anchors: changedAnchors,
    shaken_claims: claims,
    views: viewsAvailable
      ? { available: true, scanned: from.views.length, shaken_fields: viewFields }
      : {
          available: false,
          scanned: 0,
          reason: 'the from-snapshot carries no reader-produced views (WP-06 output not present) — view-field fan-out not computed',
          shaken_fields: [],
        },
    sla: {
      as_of: to.build.built_at,
      note: 'ages measured against the to-build timestamp, never the wall clock; budgets from engine/sources/contracts (AD-12)',
      queue_depth: claims.length,
      over_sla: overSla,
      longest_wait_days: ages.length > 0 ? Math.max(...ages) : null,
    },
  };
}

// ---------------------------------------------------------------- digest

const clip = (s, n = 48) => {
  const v = String(s ?? '');
  return v.length > n ? v.slice(0, n - 1) + '…' : v;
};

export function digestLines(report) {
  const d = report.to.built_at.slice(0, 10);
  const lines = [];
  for (const g of report.changed_anchors) {
    const to = g.to_sha256s.length > 0 ? g.to_sha256s.map(s12).join(',') : '(gone)';
    const where = g.input_path ? ` (${g.input_path})` : '';
    lines.push(
      `${d} | ${g.source_id} | anchor sha256 ${s12(g.from_sha256)}→${to}${where}: ${g.claims} claims shaken, ${g.over_sla} past staleness budget`,
    );
  }
  for (const file of ['base', 'derived']) {
    for (const c of report[file].changed) {
      const parts = Object.entries(c.changed_fields)
        .map(([f, v]) => `${f} "${clip(v.from)}"→"${clip(v.to)}"`)
        .join(', ');
      lines.push(`${d} | ${c.anchor_source_id || file} | ${c.iso3} ${c.record_key}: ${parts} (${c.ledger_url})`);
    }
    for (const r of report[file].added) {
      lines.push(`${d} | ${r.anchor_source_id || file} | + ${r.iso3} ${r.record_key} [${r.state}] (${ledgerUrl(r.iso3)})`);
    }
    for (const r of report[file].removed) {
      lines.push(`${d} | ${r.anchor_source_id || file} | - ${r.iso3} ${r.record_key} [${r.state}] (${ledgerUrl(r.iso3)})`);
    }
  }
  for (const f of report.views.shaken_fields) {
    lines.push(`${d} | views | ${f.view} ${f.path} rested on a changed anchor (${f.receipt_url})`);
  }
  return lines;
}

export function digestMarkdown(report) {
  const lines = digestLines(report);
  const head = [
    `# Living-record diff — ${s12(report.from.build_id)} → ${s12(report.to.build_id)}`,
    '',
    `From build ${report.from.build_id} (built ${report.from.built_at})`,
    `to build ${report.to.build_id} (built ${report.to.built_at}).`,
    'R9: recomputed from the two snapshots on every run; this digest stores no state.',
    !report.views.available ? `Views: ${report.views.reason}` : null,
    '',
  ].filter((l) => l !== null);
  const body = lines.length > 0 ? lines : ['No structural change between the two builds.'];
  return [...head, ...body, ''].join('\n');
}

// ---------------------------------------------------------------- run

export function runDiff(fromArg, toArg, { root, outDir } = {}) {
  root = root ?? resolve(process.cwd());
  const from = loadSnapshot(resolveSnapshot(fromArg, root), root);
  const to = loadSnapshot(resolveSnapshot(toArg, root), root);
  const report = diffSnapshots(from, to, root);
  const dir = outDir ?? join(root, 'data', 'diff');
  mkdirSync(dir, { recursive: true });
  const stem = `${s12(report.from.build_id)}__${s12(report.to.build_id)}`;
  const jsonPath = join(dir, `${stem}.json`);
  const mdPath = join(dir, `${stem}.md`);
  writeFileSync(jsonPath, JSON.stringify(report, null, 2) + '\n');
  const digest = digestMarkdown(report);
  writeFileSync(mdPath, digest);
  return { report, digest, jsonPath, mdPath };
}

function cliArg(argv, flag) {
  const i = argv.indexOf(flag);
  return i !== -1 ? argv[i + 1] : undefined;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const positional = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && all[i - 1] !== '--root' && all[i - 1] !== '--out');
  if (positional.length !== 2) {
    console.error('usage: node engine/diff/diff.mjs <from-dir|build_id> <to-dir|build_id> [--root DIR] [--out DIR]');
    process.exit(1);
  }
  const root = cliArg(process.argv, '--root') ? resolve(cliArg(process.argv, '--root')) : resolve(process.cwd());
  try {
    const { report, digest, jsonPath, mdPath } = runDiff(positional[0], positional[1], {
      root,
      outDir: cliArg(process.argv, '--out'),
    });
    process.stdout.write(digest);
    console.log(
      `shaken ${report.sla.queue_depth} claim(s), ${report.sla.over_sla} past budget, ` +
        `longest wait ${report.sla.longest_wait_days ?? '(none)'} day(s)`,
    );
    console.log(`wrote ${jsonPath}`);
    console.log(`wrote ${mdPath}`);
  } catch (e) {
    console.error(`diff failed: ${e.message}`);
    process.exit(1);
  }
}
