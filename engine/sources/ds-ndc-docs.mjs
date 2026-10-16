// ds-ndc-docs: document bytes for every registry row, fetched from the
// openclimatedata/national-climate-plans mirror — NEVER from unfccc.int (WAF).
// Registry rows are matched to mirror rows by party code + URL/filename
// basename. Every fetched file is hashed with a sidecar; every row gets an
// outcome {ok|failed, reason} in data/sources/ndc-docs.json. Run from the
// repo root (requires data/sources/registry.json from ds-registry first):
//   node engine/sources/ds-ndc-docs.mjs [--limit N] [--offset N] [--force]
// Resumable: outcomes merge across invocations; a doc already fetched (cache
// sha256 matches its sidecar) is reused without refetching; without --offset
// each run continues with the docs that are not yet ok.
import { pathToFileURL } from 'node:url';
import { basename, join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { rootArg } from '../gates/_lib.mjs';
import { parseCSVWithHeader } from '../lib/csv.mjs';
import { argValue, assertLicensed, hasFlag, loadContract, snapshot, writeCanon, writeManifest } from './_base.mjs';

export function urlBasename(u) {
  let tail = String(u ?? '').split('/').pop() ?? '';
  try {
    tail = decodeURIComponent(tail);
  } catch {
    // a malformed escape keeps the raw tail
  }
  // NFC: the two URL eras disagree on composed vs decomposed accents
  return tail.normalize('NFC').toLowerCase();
}

// Mirror index keyed by party code + decoded url basename, and by party code
// + mirror filename (two eras of registry URLs share basenames with the
// mirror's EncodedAbsUrl).
export function indexPlans(rows) {
  const map = new Map();
  const put = (code, key, row) => {
    if (!key) return;
    const k = `${code}|${key}`;
    if (!map.has(k)) map.set(k, row);
  };
  for (const r of rows) {
    put(r.Code, urlBasename(r.EncodedAbsUrl), r);
    put(r.Code, (r.Filename ?? '').toLowerCase(), r);
  }
  return map;
}

export function matchPlan(code, doc, planIndex) {
  for (const key of [urlBasename(doc.url), (doc.original_filename ?? '').toLowerCase()]) {
    const hit = key && planIndex.get(`${code}|${key}`);
    if (hit) return hit;
  }
  return null;
}

async function main() {
  const root = rootArg();
  const id = 'ndc-docs';
  const contract = loadContract(root, id);
  assertLicensed(root, contract.license_id ?? id);
  const force = hasFlag('--force');
  const limit = argValue('--limit', 200);
  const offset = argValue('--offset', null);

  const indexSnap = await snapshot(
    root,
    contract.url,
    id,
    basename(new URL(contract.url).pathname),
    contract.success_criteria,
    { force },
  );
  const plans = parseCSVWithHeader(indexSnap.bytes.toString('utf8')).rows;
  const planIndex = indexPlans(plans);

  const registryPath = join(root, 'data', 'sources', 'registry.json');
  if (!existsSync(registryPath)) {
    throw new Error('data/sources/registry.json not found — run engine/sources/ds-registry.mjs first');
  }
  const registry = JSON.parse(readFileSync(registryPath, 'utf8'));
  const docs = [];
  const seenKeys = new Set();
  let registryRows = 0;
  for (const party of registry.parties) {
    for (const doc of party.documents) {
      registryRows++;
      const key = `${party.code}|${urlBasename(doc.url) || doc.original_filename.toLowerCase()}`;
      // The registry index carries occasional literal duplicate rows (same
      // party, same URL, twice). One URL is one document: one outcome.
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      docs.push({ key, code: party.code, doc });
    }
  }

  const canonPath = join(root, 'data', 'sources', `${id}.json`);
  const outcomes = new Map(
    existsSync(canonPath)
      ? JSON.parse(readFileSync(canonPath, 'utf8')).outcomes.map((o) => [o.key, o])
      : [],
  );

  const todo =
    offset !== null
      ? docs.slice(offset, offset + limit)
      : docs.filter((d) => !force && outcomes.get(d.key)?.outcome !== 'ok').slice(0, limit);

  let fetched = 0;
  for (const { key, code, doc } of todo) {
    const plan = matchPlan(code, doc, planIndex);
    let outcome;
    if (plan === null) {
      outcome = { outcome: 'failed', reason: `no mirror row matches ${urlBasename(doc.url) || doc.original_filename}` };
    } else {
      try {
        const snap = await snapshot(
          root,
          contract.pdf_base_url + encodeURIComponent(plan.Filename),
          id,
          plan.Filename,
          contract.document_criteria,
          { force },
        );
        if (snap.stale) {
          outcome = { outcome: 'failed', reason: `refresh failed, previous snapshot kept: ${snap.meta.stale_reason}` };
        } else {
          outcome = {
            outcome: 'ok',
            mirror_filename: plan.Filename,
            sha256: snap.meta.sha256,
            size_bytes: snap.meta.size_bytes,
            retrieved_at: snap.meta.retrieved_at,
          };
          fetched++;
        }
      } catch (e) {
        outcome = { outcome: 'failed', reason: e.message };
      }
    }
    outcomes.set(key, { key, code, url: doc.url, original_filename: doc.original_filename, ...outcome });
  }

  const all = [...outcomes.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const ok = all.filter((o) => o.outcome === 'ok').length;
  const failed = all.filter((o) => o.outcome === 'failed').length;
  writeCanon(root, id, {
    source_id: id,
    index_sha256: indexSnap.meta.sha256,
    index_retrieved_at: indexSnap.meta.retrieved_at,
    totals: { registry_rows: registryRows, registry_documents: docs.length, attempted: all.length, ok, failed, pending: docs.length - all.length },
    outcomes: all,
  });
  writeManifest(root, id);
  console.log(
    `${id}: processed ${todo.length} docs this run (${fetched} fetched) — ` +
      `${ok} ok / ${failed} failed / ${docs.length - all.length} pending of ${docs.length} registry documents`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
