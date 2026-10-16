// R5: every published value carries a full anchor or a state with a reason.
// Two checks, both machine-enforced:
//   1. static — every committed graph row passes the shared row contract;
//   2. live — the shipped builder, run against a built-in fixture whose only
//      row cannot be anchored, must exit 1 and write nothing (no partial
//      files). A builder that publishes anyway is a dead R5.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { rootArg, violation, note } from './_lib.mjs';
import { rowProblems } from '../build/rows.mjs';
import { readGraph } from '../reader/reader.mjs';

const root = rootArg();
const here = dirname(fileURLToPath(import.meta.url));

// ---- 1. static row contract over the committed graph (read via the single door)
let g = null;
let torn = false;
try {
  g = readGraph(root);
} catch (e) {
  torn = true;
  violation(`R5: ${e.message}`);
}
if (g === null && !torn) {
  note('no data/graph yet — static row check skipped; the live builder check still runs');
} else if (g !== null) {
  const vocabPath = join(root, 'engine', 'generated', 'vocab.json');
  if (!existsSync(vocabPath)) {
    violation('R5: data/graph exists but engine/generated/vocab.json is missing');
  } else {
    const vocab = JSON.parse(readFileSync(vocabPath, 'utf8'));
    const states = (vocab.facet_values?.['FACET-EPISTEMIC-STATE'] ?? []).map((s) => String(s).toLowerCase());
    let checked = 0;
    for (const [f, rows] of [['base.csv', g.base], ['derived.csv', g.derived]]) {
      for (const r of rows) {
        checked++;
        for (const prob of rowProblems(r, states)) {
          violation(`R5: ${f} ${r.iso3} ${r.record_key}: ${prob}`);
        }
      }
    }
    note(`${checked} committed graph row(s) hold the row contract`);
  }
}

// ---- 2. the shipped builder blocks publishing on an unanchorable input
const fx = mkdtempSync(join(tmpdir(), 'r5-fixture-'));
try {
  const put = (rel, content) => {
    mkdirSync(dirname(join(fx, rel)), { recursive: true });
    writeFileSync(join(fx, rel), content);
  };
  const zeros = '0'.repeat(64);
  put(
    'engine/generated/vocab.json',
    JSON.stringify({
      facet_values: {
        'FACET-EPISTEMIC-STATE': ['OBSERVED', 'PLEDGED', 'UNKNOWN', 'ABSENT'],
        'FACET-PARTY-STANDING': ['PARTY', 'SIGNED-NOT-RATIFIED', 'WITHDRAWN', 'NOT-LISTED'],
      },
    }),
  );
  put('engine/seed/platform/VERSION', '0.0.0\n');
  // registry snapshot WITHOUT a snapshot hash: its one observed row cannot be
  // anchored, so the whole build must abort with nothing written.
  put('data/sources/registry.json', JSON.stringify({ source_id: 'registry', parties: [{ code: 'zz9', party: 'Zephyria' }] }));
  put('data/sources/untc.json', JSON.stringify({ source_id: 'untc', documents: [] }));
  put(
    'data/sources/btr-listing.json',
    JSON.stringify({ source_id: 'btr-listing', snapshot_sha256: zeros, retrieved_at: '2026-01-01T00:00:00Z', parties: [] }),
  );
  put(
    'data/sources/ndc-docs.json',
    JSON.stringify({ source_id: 'ndc-docs', index_sha256: zeros, index_retrieved_at: '2026-01-01T00:00:00Z', outcomes: [] }),
  );
  const builder = resolve(here, '..', 'build', 'build.mjs');
  const r = spawnSync(process.execPath, [builder, '--root', fx], { encoding: 'utf8' });
  if (r.status === 0) {
    violation('R5: the builder published a graph from an unanchorable input — publish blocking is dead');
  }
  // Nothing written: the reader must find no graph at all under the fixture
  // (a torn read throwing here is itself partial output, so it also fails).
  let leftover = null;
  try {
    leftover = readGraph(fx);
  } catch (e) {
    leftover = e.message;
  }
  if (leftover !== null) {
    violation('R5: the builder wrote output on an aborted build — publish blocking must leave nothing behind');
  }
  if (r.status !== 0) note('builder abort verified: exit 1, nothing written');
} finally {
  rmSync(fx, { recursive: true, force: true });
}
