// ds-ndc-wayback: second byte source for registry documents the mirror could
// not serve — EXISTING Internet Archive Wayback captures only. Per failed row
// in data/sources/ndc-docs.json: one CDX index lookup on the document's
// original URL, then the id_ raw-byte replay of an already-archived capture.
// NEVER Save Page Now, never a live proxy of unfccc.int.
//
// Success is byte-judged (R14): format magic + min_bytes floor, plus the
// fetched bytes' SHA-1 (base32) checked against the CDX digest where one is
// recorded. A row with no existing 200-capture ends failed with reason
// "no-archive-capture" — honest data, not an embarrassment.
//
// Run from the repo root (requires data/sources/ndc-docs.json from
// ds-ndc-docs first):
//   node engine/sources/ds-ndc-wayback.mjs [--limit N]
// Resumable: rows that reached a final wayback outcome carry
// wayback_checked_at and are not retried; transient archive outages leave the
// row unmarked (retried next run) up to the contract's transient_cap, after
// which the row fails as cdx-unreachable. Outcomes merge back into
// data/sources/ndc-docs.json; the canon is rewritten every few rows so a
// killed run loses almost nothing.
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { rootArg } from '../gates/_lib.mjs';
import {
  argValue,
  assertLicensed,
  loadContract,
  politeFetch,
  sha1Base32,
  snapshot,
  writeCanon,
  writeManifest,
} from './_base.mjs';

// CDX json output: first row is the header, the rest are captures. Returns
// the 200-status captures newest first, as objects keyed by the header.
export function parseCdx(text) {
  const rows = JSON.parse(text);
  if (!Array.isArray(rows)) throw new Error('cdx response is json but not an array');
  if (rows.length === 0) return [];
  const header = rows[0];
  return rows
    .slice(1)
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])))
    .filter((c) => c.statuscode === '200')
    .sort((a, b) => (a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0));
}

// The byte-format a capture must satisfy: the document URL's extension first,
// the capture's recorded mimetype second, else null (unsupported — honest
// failure, never a formatless "success").
export function captureFormat(filename, capture, contract) {
  const dot = filename.lastIndexOf('.');
  const ext = dot === -1 ? '' : filename.slice(dot + 1).toLowerCase();
  return (
    contract.extension_formats[ext] ??
    contract.mimetype_formats[(capture.mimetype ?? '').toLowerCase()] ??
    null
  );
}

const safeName = (s) => s.replace(/[^\w.-]+/g, '_').slice(0, 140);

async function main() {
  const root = rootArg();
  const id = 'ndc-wayback';
  const contract = loadContract(root, id);
  assertLicensed(root, contract.license_id);
  assertLicensed(root, contract.content_license_id);
  const limit = argValue('--limit', 150);

  const canonPath = join(root, 'data', 'sources', 'ndc-docs.json');
  if (!existsSync(canonPath)) {
    throw new Error('data/sources/ndc-docs.json not found — run engine/sources/ds-ndc-docs.mjs first');
  }
  const canon = JSON.parse(readFileSync(canonPath, 'utf8'));
  const outcomes = new Map(canon.outcomes.map((o) => [o.key, o]));

  const todo = canon.outcomes
    .filter((o) => o.outcome === 'failed' && !o.wayback_checked_at)
    .slice(0, limit);

  const writeBack = () => {
    const all = [...outcomes.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    const ok = all.filter((o) => o.outcome === 'ok').length;
    const failed = all.filter((o) => o.outcome === 'failed').length;
    writeCanon(root, 'ndc-docs', {
      ...canon,
      totals: {
        ...canon.totals,
        attempted: all.length,
        ok,
        failed,
        pending: (canon.totals.registry_documents ?? all.length) - all.length,
      },
      outcomes: all,
    });
    return { ok, failed };
  };

  let rescued = 0;
  let noCapture = 0;
  let transient = 0;
  let processed = 0;
  const processRow = async (row) => {
    const base = {
      key: row.key,
      code: row.code,
      url: row.url,
      original_filename: row.original_filename,
      mirror_reason: row.mirror_reason ?? row.reason,
    };
    let next = null;
    let captures = null;
    try {
      const cdxUrl = contract.cdx_template.replace('{{url}}', encodeURIComponent(row.url));
      const { bytes } = await politeFetch(cdxUrl);
      captures = parseCdx(bytes.toString('utf8'));
    } catch (e) {
      // archive outage or a non-json interstitial: transient — the row stays
      // unmarked and is retried next run, up to the contract's cap.
      const n = (row.wayback_transients ?? 0) + 1;
      if (n >= contract.transient_cap) {
        next = {
          ...base,
          outcome: 'failed',
          reason: `cdx-unreachable (${n} transient attempts): ${e.message.slice(0, 160)}`,
          wayback_checked_at: new Date().toISOString(),
        };
      } else {
        next = { ...row, wayback_transients: n };
        transient++;
      }
    }
    if (captures !== null) {
      if (captures.length === 0) {
        next = { ...base, outcome: 'failed', reason: 'no-archive-capture', wayback_checked_at: new Date().toISOString() };
        noCapture++;
      } else {
        let lastReason = 'no candidate capture carried a supported byte format';
        for (const capture of captures.slice(0, contract.candidate_captures)) {
          const format = captureFormat(row.original_filename || row.url, capture, contract);
          if (format === null) {
            lastReason = `unsupported format (mimetype ${capture.mimetype ?? 'unknown'})`;
            continue;
          }
          const fetchUrl = contract.fetch_template
            .replace('{{timestamp}}', capture.timestamp)
            .replace('{{url}}', capture.original);
          const filename = `${row.code}_${capture.timestamp}_${safeName(row.original_filename || 'document')}`;
          try {
            const snap = await snapshot(root, fetchUrl, id, filename, contract.document_criteria_by_format[format]);
            if (snap.stale) {
              lastReason = `refresh failed, previous snapshot kept: ${snap.meta.stale_reason}`;
              continue;
            }
            const digest = capture.digest ?? '';
            if (/^[A-Z2-7]{32}$/.test(digest) && sha1Base32(snap.bytes) !== digest) {
              lastReason = `capture ${capture.timestamp}: fetched bytes' sha1 does not match the cdx digest`;
              continue;
            }
            next = {
              ...base,
              outcome: 'ok',
              via: 'wayback',
              wayback_timestamp: capture.timestamp,
              wayback_url: fetchUrl,
              sha256: snap.meta.sha256,
              size_bytes: snap.meta.size_bytes,
              retrieved_at: snap.meta.retrieved_at,
              wayback_checked_at: new Date().toISOString(),
            };
            rescued++;
            break;
          } catch (e) {
            lastReason = `capture ${capture.timestamp}: ${e.message.slice(0, 200)}`;
          }
        }
        if (next === null) {
          next = { ...base, outcome: 'failed', reason: `wayback: ${lastReason}`, wayback_checked_at: new Date().toISOString() };
        }
      }
    }
    outcomes.set(row.key, next);
    processed++;
    if (processed % 10 === 0) writeBack();
  };

  // Modest concurrency: downloads overlap, while politeFetch's per-host slot
  // reservation keeps request starts ≥1s apart on web.archive.org.
  const queue = [...todo];
  const width = contract.concurrency ?? 1;
  await Promise.all(
    Array.from({ length: Math.min(width, queue.length) }, async () => {
      for (let row = queue.shift(); row !== undefined; row = queue.shift()) {
        await processRow(row);
      }
    }),
  );

  const { ok, failed } = writeBack();
  writeManifest(root, id);
  const remaining = [...outcomes.values()].filter((o) => o.outcome === 'failed' && !o.wayback_checked_at).length;
  console.log(
    `${id}: processed ${processed} rows this run — ${rescued} rescued, ${noCapture} no-archive-capture, ` +
      `${transient} transient (retry next run) — canon now ${ok} ok / ${failed} failed, ${remaining} failed rows not yet wayback-final`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
