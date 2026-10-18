// Mutation harness for R19 (every internal link resolves) and for the base
// prefix that the Pages deploy applies. A dead link, and a build whose links
// and canonical disagree about the deploy base, must both be caught; a clean
// build at the root and the same build under a base must both pass.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GATE = join(repo, 'engine', 'gates', 'r19-links-resolve.mjs');
const PREFIX = join(repo, 'scripts', 'base-prefix.mjs');

const roots = [];
process.on('exit', () => {
  for (const d of roots) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      // best effort
    }
  }
});

const page = (canonical, body, base = '') =>
  `<!doctype html><html><head><link rel="canonical" href="${canonical}">` +
  `<link rel="icon" href="${base}/favicon.svg"></head><body>${body}</body></html>`;

function fixture(base = '') {
  const dir = mkdtempSync(join(tmpdir(), 'links-'));
  roots.push(dir);
  const dist = join(dir, 'app', 'dist');
  mkdirSync(join(dist, 'ledger'), { recursive: true });
  writeFileSync(join(dist, 'favicon.svg'), '<svg/>');
  writeFileSync(join(dist, 'index.html'), page(`https://example.org${base}/`, `<a href="${base}/ledger/">ledger</a>`, base));
  writeFileSync(join(dist, 'ledger', 'index.html'), page(`https://example.org${base}/ledger/`, `<a href="${base}/">home</a>`, base));
  return dir;
}

const gate = (dir) => spawnSync(process.execPath, [GATE, '--root', dir], { encoding: 'utf8' });

test('a built site whose links all resolve passes', () => {
  const r = gate(fixture());
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /internal link\(s\) on 2 built page\(s\) resolve/);
});

test('a link to a page that was never built fails', () => {
  const dir = fixture();
  const home = join(dir, 'app', 'dist', 'index.html');
  writeFileSync(home, readFileSync(home, 'utf8').replace('/ledger/', '/census/'));
  const r = gate(dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /R19: .*links to \/census\//);
});

test('the base prefix moves every url it finds, and nothing else', () => {
  const dir = fixture();
  const p = spawnSync(process.execPath, [PREFIX, '--root', dir], {
    encoding: 'utf8',
    env: { ...process.env, SITE_BASE: '/repo/' },
  });
  assert.equal(p.status, 0, p.stderr);
  const home = readFileSync(join(dir, 'app', 'dist', 'index.html'), 'utf8');
  assert.match(home, /href="\/repo\/ledger\/"/);
  assert.match(home, /href="\/repo\/favicon.svg"/);
  // the canonical is an absolute URL and is not a path to move
  assert.match(home, /href="https:\/\/example.org\//);
  assert.doesNotMatch(home, /\/repo\/repo/);
});

test('the base prefix is a no-op without SITE_BASE', () => {
  const dir = fixture();
  const before = readFileSync(join(dir, 'app', 'dist', 'index.html'), 'utf8');
  const p = spawnSync(process.execPath, [PREFIX, '--root', dir], { encoding: 'utf8', env: { ...process.env, SITE_BASE: '' } });
  assert.equal(p.status, 0, p.stderr);
  assert.equal(readFileSync(join(dir, 'app', 'dist', 'index.html'), 'utf8'), before);
});

test('links under a base, with the canonical left at the root, fail', () => {
  const dir = fixture();
  const home = join(dir, 'app', 'dist', 'index.html');
  // links moved under /repo, canonical not: exactly the drift this gate exists for
  writeFileSync(home, readFileSync(home, 'utf8').replace('href="/ledger/"', 'href="/repo/ledger/"'));
  const r = gate(dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /R19: .*links to \/repo\/ledger\//);
});

test('a build under a base, canonical and links agreeing, passes', () => {
  const r = gate(fixture('/repo'));
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /resolve under base \/repo/);
});
