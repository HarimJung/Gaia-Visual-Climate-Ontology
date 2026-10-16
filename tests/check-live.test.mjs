// Unit tests for the launch probe's checkers (scripts/check-live.mjs).
// No network anywhere: the checkers are pure, so they run against the local
// app/dist build plus small synthetic bodies. The dist arm mirrors the other
// dist tests — skipped when there is no build, armed in CI where the build
// runs before the tests. Country identity is never named here: the country
// and receipt pages are discovered through links, exactly as the live probe
// discovers them (R1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BYTE_FLOOR,
  BYTE_CEILING,
  asOf,
  buildCommit,
  findLink,
  checkPage,
  checkNotFound,
  checkSameCommit,
} from '../scripts/check-live.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(repo, 'app', 'dist');

const page = (path) => {
  const html = readFileSync(join(dist, path, 'index.html'), 'utf8');
  return { status: 200, bytes: Buffer.byteLength(html), html };
};

// ─ synthetic bodies: the failure classes the probe exists to catch ─────────

const FOOTER =
  '<footer><span class="mono" data-meta="as_of">as of 2026-10-16</span>' +
  '<span class="mono" data-meta="build_commit">build abc1234</span></footer>';
const GOOD = `<html><body><main><h1>t</h1></main>${FOOTER}</body></html>`;

test('a 200 with a tiny bot-check body fails the byte floor (R14)', () => {
  const html = '<html><body>checking your browser</body></html>'; // the ~212-byte class
  const r = checkPage('x', { status: 200, bytes: Buffer.byteLength(html), html });
  assert.ok(r.some((p) => p.includes('floor')), r.join('; '));
});

test('an oversized body fails the 3G ceiling', () => {
  const r = checkPage('x', { status: 200, bytes: BYTE_CEILING + 1, html: GOOD });
  assert.ok(r.some((p) => p.includes('ceiling')), r.join('; '));
});

test('a well-formed page with a real commit hash passes every check', () => {
  const bytes = Math.max(Buffer.byteLength(GOOD), BYTE_FLOOR);
  assert.deepEqual(checkPage('x', { status: 200, bytes, html: GOOD }), []);
});

test('the local no-commit placeholder is not accepted as a build hash', () => {
  assert.equal(buildCommit(FOOTER.replace('abc1234', 'no-commit-env')), null);
  assert.equal(buildCommit(FOOTER), 'abc1234');
});

test('differing footer hashes across pages are reported (AD-11)', () => {
  const other = GOOD.replace('abc1234', 'def5678');
  assert.equal(checkSameCommit([['a', GOOD], ['b', GOOD]]).length, 0);
  assert.equal(checkSameCommit([['a', GOOD], ['b', other]]).length, 1);
});

test('the 404 route must really return 404, not a soft 200', () => {
  assert.equal(checkNotFound('x', { status: 404 }).length, 0);
  assert.equal(checkNotFound('x', { status: 200 }).length, 1);
});

test('findLink takes the first matching href and cuts fragments', () => {
  const html = '<a href="/country/#top">f</a><a href="/country/one/">c</a><a href="/receipt/one/two/#sha256">r</a>';
  assert.equal(findLink(html, '/country/'), '/country/one/');
  assert.equal(findLink(html, '/receipt/'), '/receipt/one/two/');
  assert.equal(findLink(html, '/nope/'), null);
});

// ─ local dist arm: the real build passes the same checkers ──────────────────

const distReady = existsSync(join(dist, 'index.html'));

test('built site: ledger → country → receipt pass the content checks', { skip: !distReady && 'no app/dist — CI builds before tests run' }, () => {
  const home = page('');
  const countryPath = findLink(home.html, '/country/');
  assert.ok(countryPath, 'world ledger links at least one country page');
  const country = page(countryPath);
  const receiptPath = findLink(country.html, '/receipt/');
  assert.ok(receiptPath, 'country page links at least one receipt');
  const receipt = page(receiptPath);

  for (const [name, p] of [['home', home], ['country', country], ['receipt', receipt]]) {
    // Local builds carry the no-commit placeholder, so the only problem the
    // real dist may report is the missing build hash — everything else
    // (status, byte floor, 3G ceiling, no-JS core content, as-of) must pass.
    const rest = checkPage(name, p).filter((x) => !x.includes('AD-11'));
    assert.deepEqual(rest, []);
    assert.match(asOf(p.html), /^\d{4}-\d{2}-\d{2}$/);
  }
});

test('built 404 page exists with footer metadata intact', { skip: !distReady && 'no app/dist — CI builds before tests run' }, () => {
  const p404 = join(dist, '404.html');
  assert.ok(existsSync(p404), 'app build emits 404.html for the host to serve');
  const html = readFileSync(p404, 'utf8');
  assert.ok(/<h1[\s>]/.test(html) && /<main[\s>]/.test(html));
  assert.match(asOf(html), /^\d{4}-\d{2}-\d{2}$/);
});
