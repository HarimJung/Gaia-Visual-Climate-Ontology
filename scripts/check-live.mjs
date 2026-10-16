// Read-only launch probe (docs/LAUNCH.md §9). Run by the owner, after they
// deploy, against a URL they name:
//
//   node scripts/check-live.mjs --url https://example.org
//
// It refuses to run without an explicit --url and never probes any default
// host. It only GETs pages and reads them; nothing is changed anywhere.
//
// The checkers are pure functions over { status, bytes, html } so the unit
// tests (tests/check-live.test.mjs) run them against local app/dist files
// with no network. Only main() touches the network.
//
// Doctrine carried from the repo rules:
//   R14 — success is bytes, not status codes: a 200 with a near-empty body
//         (the bot-interstitial class) is a failure, hence the byte floor.
//   R16 — the as-of date must be on every page.
//   AD-11 — the footer build hash must be present and identical across pages.
//   R1  — no country literals here: the country and receipt pages to probe
//         are discovered from links in the fetched HTML, never hardcoded.

import { pathToFileURL } from 'node:url';

export const BYTE_FLOOR = 1024; // well above the ~212-byte bot-check bodies
export const BYTE_CEILING = 512 * 1024; // ~10 s worst case on a slow-3G profile

export function asOf(html) {
  const m = html.match(/data-meta="as_of"[^>]*>\s*as of (\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

export function buildCommit(html) {
  // The live footer must carry a real commit hash; the local placeholder
  // ("no-commit-env") deliberately does not match.
  const m = html.match(/data-meta="build_commit"[^>]*>\s*build ([0-9a-f]{7,40})\b/);
  return m ? m[1] : null;
}

// First same-site link strictly under the given path prefix; a fragment is
// cut (a receipt link with "#sha256" still counts), and a bare prefix link
// ("/country/#top") is not a page and is skipped.
export function findLink(html, prefix) {
  for (const m of html.matchAll(/href="([^"#]+)(?:#[^"]*)?"/g)) {
    if (m[1].startsWith(prefix) && m[1].length > prefix.length) return m[1];
  }
  return null;
}

// Core checks for one fetched content page. Returns problem strings, [] = ok.
export function checkPage(name, { status, bytes, html }) {
  const problems = [];
  if (status !== 200) problems.push(`${name}: status ${status}, expected 200`);
  if (bytes < BYTE_FLOOR) {
    problems.push(
      `${name}: body is ${bytes} bytes, under the ${BYTE_FLOOR}-byte floor — ` +
        'success is bytes, not status (R14)',
    );
  }
  if (bytes > BYTE_CEILING) {
    problems.push(`${name}: body is ${bytes} bytes, over the ${BYTE_CEILING}-byte 3G ceiling`);
  }
  if (!/<main[\s>]/.test(html) || !/<h1[\s>]/.test(html)) {
    problems.push(`${name}: core content missing from raw HTML — pages must render without JavaScript`);
  }
  if (!asOf(html)) problems.push(`${name}: no as-of date in the footer (R16)`);
  if (!buildCommit(html)) problems.push(`${name}: no build commit hash in the footer (AD-11)`);
  return problems;
}

export function checkNotFound(name, { status }) {
  return status === 404
    ? []
    : [`${name}: status ${status}, expected 404 — a soft 404 hides every broken deep link`];
}

// All footer hashes equal across pages; pages without one are reported by
// checkPage, not here.
export function checkSameCommit(pages) {
  const seen = new Map(); // commit -> first page name
  for (const [name, html] of pages) {
    const c = buildCommit(html);
    if (c && !seen.has(c)) seen.set(c, name);
  }
  if (seen.size <= 1) return [];
  const list = [...seen.entries()].map(([c, n]) => `${n}=${c}`).join(', ');
  return [`footer build hash differs across pages (${list}) — mixed deploy (AD-11)`];
}

async function fetchPage(base, path) {
  const res = await fetch(base + path, {
    redirect: 'follow',
    headers: { 'user-agent': 'check-live read-only launch probe' },
  });
  const html = await res.text();
  return { status: res.status, bytes: Buffer.byteLength(html), html };
}

async function main() {
  const i = process.argv.indexOf('--url');
  const url = i !== -1 ? (process.argv[i + 1] || '').replace(/\/+$/, '') : '';
  if (!/^https?:\/\//.test(url)) {
    console.error('usage: node scripts/check-live.mjs --url https://<the-host-you-deployed>');
    console.error('Refusing to probe anything by default: name the deployed URL explicitly.');
    process.exit(2);
  }

  const today = new Date().toISOString().slice(0, 10);
  const problems = [];
  const fetched = []; // [name, html] for the cross-page hash check

  const home = await fetchPage(url, '/');
  problems.push(...checkPage('world ledger /', home));
  fetched.push(['world ledger', home.html]);

  const countryPath = findLink(home.html, '/country/');
  if (!countryPath) {
    problems.push('world ledger: no /country/ link found — cannot probe a country page');
  } else {
    const country = await fetchPage(url, countryPath);
    problems.push(...checkPage(`country ${countryPath}`, country));
    fetched.push([`country ${countryPath}`, country.html]);

    const receiptPath = findLink(country.html, '/receipt/');
    if (!receiptPath) {
      problems.push(`country ${countryPath}: no /receipt/ link found — cannot probe a receipt`);
    } else {
      const receipt = await fetchPage(url, receiptPath);
      problems.push(...checkPage(`receipt ${receiptPath}`, receipt));
      fetched.push([`receipt ${receiptPath}`, receipt.html]);
    }
  }

  problems.push(...checkSameCommit(fetched));
  problems.push(...checkNotFound('404 route', await fetchPage(url, `/no-such-page-${Date.now()}/`)));

  if (problems.length === 0) {
    console.log(`ok   check-live — ${fetched.length} page(s) + 404 route verified at ${url}`);
    return;
  }
  for (const p of problems) console.log(`${today} | check-live | ${p}`); // R13 digest shape
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
