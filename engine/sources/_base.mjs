// Shared source-adapter plumbing (WP-03). Zero dependencies — Node 22 built-ins.
//
// R14: fetch success is judged by BYTES (hash + size floor + format), never by
// HTTP status — the predecessor accepted a 200 that was a 212-byte bot-check
// page. R12: raw bytes live only under data/cache/ (gitignored); what gets
// committed are manifests (data/manifests/) and parsed canon (data/sources/).
// R1: no instance literals here — every URL, prefix and pattern comes from the
// source contract under engine/sources/contracts/.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { parseCSVWithHeader } from '../lib/csv.mjs';

export const USER_AGENT =
  'gaia-visual-climate-ontology-record-runtime (+https://github.com/HarimJung/Gaia-Visual-Climate-Ontology)';

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

// SHA-1 in RFC 4648 base32 — the digest format of the Wayback CDX index
// (160 bits = exactly 32 characters, no padding).
export function sha1Base32(buf) {
  const digest = createHash('sha1').update(buf).digest();
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of digest) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return out;
}

export function hasFlag(name, argv = process.argv) {
  return argv.includes(name);
}

export function argValue(name, fallback, argv = process.argv) {
  const i = argv.indexOf(name);
  if (i === -1 || argv[i + 1] === undefined) return fallback;
  const n = Number(argv[i + 1]);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${name} needs a non-negative integer`);
  return n;
}

export function loadContract(root, sourceId) {
  const rel = `engine/sources/contracts/${sourceId}.json`;
  const p = join(root, ...rel.split('/'));
  if (!existsSync(p)) throw new Error(`no source contract at ${rel}`);
  const c = JSON.parse(readFileSync(p, 'utf8'));
  if (c.source_id !== sourceId) throw new Error(`${rel}: source_id "${c.source_id}" does not match filename`);
  return c;
}

// ---------------------------------------------------------------- licensing
// Every adapter refuses to fetch a source that the license register does not
// clear. The register is data/licenses.csv, written by the license work
// package; this code only reads it.
export const LICENSE_REGISTER = 'data/licenses.csv';
const LICENSE_ALLOWED = new Set(['yes', 'yes-no-redistribution']);

export function assertLicensed(root, sourceId) {
  const p = join(root, ...LICENSE_REGISTER.split('/'));
  if (!existsSync(p)) {
    throw new Error(
      `${LICENSE_REGISTER} not found — refusing to fetch source "${sourceId}". ` +
        'The license register is written by the license work package; no register, no fetch.',
    );
  }
  const { rows } = parseCSVWithHeader(readFileSync(p, 'utf8'));
  const row = rows.find((r) => r.source_id === sourceId);
  if (!row) {
    throw new Error(
      `source "${sourceId}" has no row in ${LICENSE_REGISTER} — refusing to fetch an unregistered source`,
    );
  }
  if (!LICENSE_ALLOWED.has(row.use_allowed)) {
    throw new Error(
      `source "${sourceId}" is not cleared for use (use_allowed="${row.use_allowed}").\n` +
        `register row: ${JSON.stringify(row)}`,
    );
  }
  return row;
}

// ---------------------------------------------------------------- byte checks
// Returns null when the bytes satisfy the contract, else the reason they fail.
// An HTTP 200 whose body fails these checks is a FAILED fetch.
export function checkBytes(buf, criteria) {
  if (!criteria || typeof criteria.min_bytes !== 'number' || !criteria.format) {
    return 'contract carries no byte success criteria (min_bytes + format)';
  }
  if (buf.length < criteria.min_bytes) {
    return `${buf.length} bytes is under the min_bytes floor of ${criteria.min_bytes}`;
  }
  if (criteria.format === 'pdf') {
    if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') return 'not a pdf: bytes do not start with %PDF-';
    if (!buf.includes('%%EOF')) return 'not a pdf: no %%EOF trailer in the bytes';
    return null;
  }
  if (criteria.format === 'docx') {
    if (buf.subarray(0, 4).toString('latin1') !== 'PK\x03\x04') {
      return 'not a docx: bytes do not start with the zip magic PK\\x03\\x04';
    }
    return null;
  }
  if (criteria.format === 'json') {
    try {
      JSON.parse(buf.toString('utf8'));
      return null;
    } catch (e) {
      return `not json: ${e.message}`;
    }
  }
  if (criteria.format === 'csv') {
    const text = buf.toString('utf8');
    const first = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).split(/\r?\n/, 1)[0].trim();
    if (criteria.csv_header !== undefined) {
      if (first !== criteria.csv_header) {
        return `csv header mismatch — expected "${criteria.csv_header}", got "${first.slice(0, 160)}"`;
      }
    } else if (!first.includes(',')) {
      return 'csv first line has no field separator';
    }
    return null;
  }
  return `contract names unknown format "${criteria.format}"`;
}

// ---------------------------------------------------------------- fetching
// Politeness: at least gapMs between hits on the same host. Transient failures
// (network error, 429, 5xx) retry on the backoff ladder; everything else
// returns its bytes for the byte check to judge.
const lastHit = new Map();

export async function politeFetch(url, opts = {}) {
  const { fetchImpl = fetch, backoffMs = [2000, 10000, 30000], gapMs = 1000 } = opts;
  const host = new URL(url).host;
  for (let attempt = 0; ; attempt++) {
    // Reserve the next polite start slot atomically (before any await), so
    // concurrent callers still start ≥gapMs apart on the same host.
    const now = Date.now();
    const slot = Math.max(now, (lastHit.get(host) ?? 0) + gapMs);
    lastHit.set(host, slot);
    if (slot > now) await sleep(slot - now);
    let res = null;
    let err = null;
    try {
      res = await fetchImpl(url, { headers: { 'user-agent': USER_AGENT }, redirect: 'follow' });
    } catch (e) {
      err = e;
    }
    const transient = err !== null || res.status === 429 || res.status >= 500;
    if (!transient) {
      return { bytes: Buffer.from(await res.arrayBuffer()), status: res.status };
    }
    if (attempt >= backoffMs.length) {
      throw new Error(`fetch ${url}: ${err ? err.message : `status ${res.status}`} after ${attempt + 1} attempts`);
    }
    await sleep(backoffMs[attempt]);
  }
}

// gh api <path> — used for GitHub API sources (higher rate limits than
// anonymous fetch). Returns the response body as a Buffer.
export function ghApiBytes(apiPath) {
  const r = spawnSync('gh', ['api', apiPath], { maxBuffer: 512 * 1024 * 1024 });
  if (r.error) throw new Error(`gh api ${apiPath}: ${r.error.message}`);
  if (r.status !== 0) {
    throw new Error(`gh api ${apiPath}: exit ${r.status}: ${r.stderr.toString('utf8').slice(0, 300)}`);
  }
  return r.stdout;
}

// ---------------------------------------------------------------- snapshots
export function cachePaths(root, sourceId, filename) {
  const dir = join(root, 'data', 'cache', sourceId);
  return { dir, file: join(dir, filename), meta: join(dir, filename + '.meta.json') };
}

// A cached file is valid only when its bytes hash to the sidecar's sha256.
export function readSidecar(paths) {
  if (!existsSync(paths.file) || !existsSync(paths.meta)) return null;
  try {
    const meta = JSON.parse(readFileSync(paths.meta, 'utf8'));
    const bytes = readFileSync(paths.file);
    if (sha256(bytes) !== meta.sha256) return null;
    return { meta, bytes };
  } catch {
    return null;
  }
}

// snapshot(root, url, sourceId, filename, criteria, opts)
//   → { meta, bytes, path, reused, stale }
// - resumable: an existing cache file whose sha256 matches its sidecar is
//   reused without refetching, unless opts.force.
// - success is judged by bytes: min_bytes floor + format check. A 200 whose
//   body fails the check is a failure.
// - on a refresh failure the previous snapshot is kept and marked stale with
//   the reason; with no previous snapshot the failure throws.
export async function snapshot(root, url, sourceId, filename, criteria, opts = {}) {
  const paths = cachePaths(root, sourceId, filename);
  const prev = readSidecar(paths);
  if (prev && !opts.force) {
    return { ...prev, path: paths.file, reused: true, stale: Boolean(prev.meta.stale_reason) };
  }
  let bytes = null;
  let failure = null;
  try {
    let status = null;
    if (opts.getBytes) {
      bytes = await opts.getBytes();
    } else {
      ({ bytes, status } = await politeFetch(url, opts));
    }
    const bad = checkBytes(bytes, criteria);
    if (bad !== null) {
      failure = `byte check failed: ${bad}${status !== null ? ` (http status was ${status} — status never means success)` : ''}`;
      bytes = null;
    }
  } catch (e) {
    failure = e.message;
  }
  if (bytes !== null) {
    mkdirSync(paths.dir, { recursive: true });
    const meta = {
      url,
      sha256: sha256(bytes),
      retrieved_at: new Date().toISOString(),
      size_bytes: bytes.length,
    };
    writeFileSync(paths.file, bytes);
    writeFileSync(paths.meta, JSON.stringify(meta, null, 2) + '\n');
    return { meta, bytes, path: paths.file, reused: false, stale: false };
  }
  if (prev) {
    prev.meta.stale_reason = failure;
    prev.meta.stale_marked_at = new Date().toISOString();
    writeFileSync(paths.meta, JSON.stringify(prev.meta, null, 2) + '\n');
    return { ...prev, path: paths.file, reused: true, stale: true };
  }
  throw new Error(`snapshot ${sourceId}/${filename}: ${failure}`);
}

// ---------------------------------------------------------------- outputs
export function writeCanon(root, name, obj) {
  const dir = join(root, 'data', 'sources');
  mkdirSync(dir, { recursive: true });
  const p = join(dir, `${name}.json`);
  writeFileSync(p, JSON.stringify(obj, null, 2) + '\n');
  return p;
}

// The committed manifest for a source = every sidecar in its cache directory.
export function writeManifest(root, sourceId) {
  const dir = join(root, 'data', 'cache', sourceId);
  const entries = [];
  if (existsSync(dir)) {
    for (const f of readdirSync(dir).sort()) {
      if (!f.endsWith('.meta.json')) continue;
      try {
        entries.push({ filename: f.replace(/\.meta\.json$/, ''), ...JSON.parse(readFileSync(join(dir, f), 'utf8')) });
      } catch {
        // an unreadable sidecar means its file is not a valid snapshot; skip
      }
    }
  }
  const out = join(root, 'data', 'manifests');
  mkdirSync(out, { recursive: true });
  const p = join(out, `${sourceId}.json`);
  writeFileSync(p, JSON.stringify({ source_id: sourceId, entries }, null, 2) + '\n');
  return p;
}
