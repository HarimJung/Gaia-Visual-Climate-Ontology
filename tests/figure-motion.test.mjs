// Mutation harness for R18 (no motion on figures). Each banned mechanism must
// be detected in a planted fixture, and honest neighbours — build-time
// arithmetic, a reader-driven count, a non-numeric label swap in a loop —
// must pass. An undetected mutation means the TEST is wrong, never the rule.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GATE = join(repo, 'engine', 'gates', 'r18-no-figure-motion.mjs');

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

function run(files) {
  const dir = mkdtempSync(join(tmpdir(), 'figure-motion-'));
  roots.push(dir);
  mkdirSync(join(dir, 'app', 'src'), { recursive: true });
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, 'app', 'src', name), body);
  return spawnSync(process.execPath, [GATE, '--root', dir], { encoding: 'utf8' });
}

const CLEAN = {
  'layout.astro': 'const x = (k * 100 / n).toFixed(2);\n<div style={`top:${x}%`} />\n',
  'filter.mjs': 'input.addEventListener("input", () => { count.textContent = `${matched} rows`; });\n',
  'labels.mjs': 'requestAnimationFrame(function () { label.textContent = spec.label; });\n',
  'site.css': '@property --sweep { syntax: "<angle>"; inherits: false; initial-value: 0deg; }\n',
};

test('clean front code passes', () => {
  const r = run(CLEAN);
  assert.equal(r.status, 0, r.stderr);
});

test('count-up inside requestAnimationFrame fails', () => {
  const r = run({
    ...CLEAN,
    'countup.mjs':
      'requestAnimationFrame(function step(t) {\n' +
      '  readout.textContent = (target * ease(t)).toFixed(0);\n' +
      '  requestAnimationFrame(step);\n});\n',
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /R18: app\/src\/countup\.mjs:1 formats a number/);
});

test('ticking readout inside setInterval fails', () => {
  const r = run({
    ...CLEAN,
    'tick.mjs': 'setInterval(() => { el.innerHTML = Math.round(value * k) + " parties"; }, 40);\n',
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /R18: app\/src\/tick\.mjs:1 formats a number/);
});

test('animatable <number> custom property fails', () => {
  const r = run({
    ...CLEAN,
    'counter.css': '@property --n {\n  syntax: "<integer>";\n  inherits: false;\n  initial-value: 0;\n}\n',
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /R18: app\/src\/counter\.css:1 declares an animatable <number>/);
});
