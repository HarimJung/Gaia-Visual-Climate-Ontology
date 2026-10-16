// WP-08 harness — grammar, sentence rules, verdict resolution, AD-12 guard,
// and the r10-author-deterministic gate. Doctrine unchanged: every verdict
// rule has a mutation pair (flip the rule and a named test here fails), and
// an undetected mutation means the TEST is wrong, never the rule.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  extractCitations,
  segmentSentences,
  loadRuntime,
  resolveToken,
  checkParagraphs,
  commentsFromReport,
  STALE_THRESHOLD,
} from '../engine/author/resolve.mjs';
import { repo, BID, baseRow, vrow, makeRoot, makeViewRoot } from './_author-fixtures.mjs';

const cleanup = [];
process.on('exit', () => {
  for (const d of cleanup) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      // best effort
    }
  }
});

// ---------------------------------------------------------------- grammar
test('grammar: corner-bracket token parses and case-normalizes', () => {
  const [c] = extractCitations('As filed ⟦ZZA:Doc-One⟧ last year.');
  assert.equal(c.iso3, 'zza');
  assert.equal(c.doc_id, 'doc-one');
  assert.equal(c.page, null);
});

test('grammar: plain-keyboard fallback has identical semantics', () => {
  const [c] = extractCitations('As filed [[anchor:zza:doc-one#p4]] last year.');
  assert.equal(c.iso3, 'zza');
  assert.equal(c.doc_id, 'doc-one');
  assert.equal(c.page, 4);
});

test('grammar: page suffix and dotted doc_ids parse', () => {
  const [c] = extractCitations('See ⟦zza:plan-3.0#p12⟧.');
  assert.equal(c.doc_id, 'plan-3.0');
  assert.equal(c.page, 12);
});

test('grammar: malformed tokens are not citations (no free-text extraction)', () => {
  assert.equal(extractCitations('bare zza:doc-one mention').length, 0);
  assert.equal(extractCitations('⟦too:long:id⟧ and ⟦zz:doc⟧').length, 0);
  assert.equal(extractCitations('[[anchor:zza]]').length, 0);
});

// ---------------------------------------------------------------- sentences
test('sentences: splits on . ! ? followed by whitespace or end', () => {
  const s = segmentSentences('One here. Two there! Three now? Four');
  assert.deepEqual(
    s.map((x) => x.text),
    ['One here.', 'Two there!', 'Three now?', 'Four'],
  );
});

test('sentences: decimals and dotted ids inside citation tokens never split', () => {
  assert.equal(segmentSentences('The share rose by 1.5 points overall.').length, 1);
  assert.equal(segmentSentences('Cited ⟦zza:plan-3.0⟧ in full.').length, 1);
});

// ---------------------------------------------------------------- verdicts
// One synthetic country pair; every rule below has its flip-detecting pair.
const RULE_VIEWS = {
  ZZA: [
    vrow({ doc_id: 'plan-old', doc_type: 'ndc', date: '2020-01-01', sha256: 'a'.repeat(64) }),
    vrow({ doc_id: 'plan-new', doc_type: 'ndc', date: '2021-06-01', sha256: 'b'.repeat(64) }),
    vrow({ doc_id: 'tie-one', doc_type: 'btr', date: '2022-01-01', sha256: 'c'.repeat(64) }),
    vrow({ doc_id: 'tie-two', doc_type: 'btr', date: '2022-01-01', sha256: 'd'.repeat(64) }),
    vrow({ doc_id: 'gone-dark', doc_type: 'legislation', state: 'unknown', state_reason: 'source vanished from the register' }),
    vrow({ doc_id: 'claims-only', doc_type: 'ndc' }), // observed, no sha, no quote
    vrow({ doc_id: 'quoted', doc_type: 'treaty-status-list', quote: { page: 3, text: 'row text', reading: 'reading' } }),
    vrow({ doc_id: 'paged', doc_type: 'assessment', date: '2019-01-01', sha256: 'f'.repeat(64), pages: 10 }),
    vrow({ doc_id: 'paged-sequel', doc_type: 'assessment', date: '2022-05-05', state: 'unknown', state_reason: 'bytes lost' }),
  ],
  ZZB: [vrow({ doc_id: 'plan-old', doc_type: 'ndc', date: '2020-01-01', sha256: 'a'.repeat(64) })],
};
const ruleRuntime = () => loadRuntime(makeViewRoot(RULE_VIEWS, cleanup));
const cite = (iso3, doc_id, page = null) => ({ iso3, doc_id, page });

test('ANCHORED requires held evidence — sha256 or quoted anchor (mutation pair)', () => {
  const rt = ruleRuntime();
  assert.equal(resolveToken(cite('zza', 'plan-new'), rt).verdict, 'ANCHORED');
  assert.equal(resolveToken(cite('zza', 'quoted'), rt).verdict, 'ANCHORED');
  const bare = resolveToken(cite('zza', 'claims-only'), rt);
  assert.equal(bare.verdict, 'UNSUPPORTED');
  assert.match(bare.reason, /holds no evidence/);
  assert.equal(bare.receipt_url, '/receipt/zza/claims-only/');
});

test('every resolvable verdict carries the receipt deep link', () => {
  const rt = ruleRuntime();
  assert.equal(resolveToken(cite('zza', 'plan-new'), rt).receipt_url, '/receipt/zza/plan-new/');
  assert.equal(resolveToken(cite('zza', 'gone-dark'), rt).receipt_url, '/receipt/zza/gone-dark/');
});

test('OUTDATED: superseded by a newer observed document of the same doc_type (mutation pair)', () => {
  const rt = ruleRuntime();
  const old = resolveToken(cite('zza', 'plan-old'), rt);
  assert.equal(old.verdict, 'OUTDATED');
  assert.match(old.reason, /superseded on the record: "plan-new"/);
  assert.equal(old.nearest_miss, '/receipt/zza/plan-new/');
  // flip side: the newest document of the type is NOT outdated
  assert.equal(resolveToken(cite('zza', 'plan-new'), rt).verdict, 'ANCHORED');
});

test('OUTDATED: a date tie is not supersession (mutation pair for strict >)', () => {
  const rt = ruleRuntime();
  assert.equal(resolveToken(cite('zza', 'tie-one'), rt).verdict, 'ANCHORED');
  assert.equal(resolveToken(cite('zza', 'tie-two'), rt).verdict, 'ANCHORED');
});

test('OUTDATED: a newer document whose own state is unknown does not supersede', () => {
  const rt = ruleRuntime();
  // paged-sequel (2022, unknown) must not outdate paged (2019, observed)
  assert.equal(resolveToken(cite('zza', 'paged'), rt).verdict, 'ANCHORED');
});

test('OUTDATED: state degraded to unknown, reason says which (mutation pair)', () => {
  const rt = ruleRuntime();
  const r = resolveToken(cite('zza', 'gone-dark'), rt);
  assert.equal(r.verdict, 'OUTDATED');
  assert.match(r.reason, /degraded to unknown: source vanished from the register/);
});

test('page suffix must match the record: quote page or recorded page range (mutation pairs)', () => {
  const rt = ruleRuntime();
  assert.equal(resolveToken(cite('zza', 'quoted', 3), rt).verdict, 'ANCHORED');
  const wrongQuote = resolveToken(cite('zza', 'quoted', 4), rt);
  assert.equal(wrongQuote.verdict, 'UNSUPPORTED');
  assert.match(wrongQuote.reason, /page 4 cited but the receipt records a page-3 quote only/);
  assert.equal(resolveToken(cite('zza', 'paged', 10), rt).verdict, 'ANCHORED');
  assert.equal(resolveToken(cite('zza', 'paged', 11), rt).verdict, 'UNSUPPORTED');
  assert.equal(resolveToken(cite('zza', 'paged', 0), rt).verdict, 'UNSUPPORTED');
});

test('UNSUPPORTED: unknown country, nearest miss named mechanically (mutation pair)', () => {
  const rt = ruleRuntime();
  const r = resolveToken(cite('qqz', 'plan-old'), rt);
  assert.equal(r.verdict, 'UNSUPPORTED');
  assert.match(r.reason, /no country "qqz"/);
  assert.match(r.reason, /exists under zza, zzb/);
  assert.equal(r.nearest_miss, '/receipt/zza/plan-old/');
  assert.equal(r.receipt_url, null);
});

test('UNSUPPORTED: unknown doc_id — same id in another country, else string containment', () => {
  const rt = ruleRuntime();
  const other = resolveToken(cite('zzb', 'gone-dark'), rt);
  assert.equal(other.verdict, 'UNSUPPORTED');
  assert.match(other.reason, /same doc_id exists under zza/);
  const close = resolveToken(cite('zza', 'plan'), rt);
  assert.equal(close.verdict, 'UNSUPPORTED');
  assert.match(close.reason, /this country records "plan-new"/);
  const nothing = resolveToken(cite('zza', 'totally-absent'), rt);
  assert.equal(nothing.verdict, 'UNSUPPORTED');
  assert.doesNotMatch(nothing.reason, /nearest miss/);
});

// ------------------------------------------------------------- sentence rules
test('sentence rules: no citation -> UNANCHORED; figure without citation -> UNANCHORED-NUMERIC (lock 6 mutation pairs)', () => {
  const rt = ruleRuntime();
  const rep = checkParagraphs(
    ['Nothing cited here.', 'The target is 42 percent.', 'Cited with figure 42 ⟦zza:plan-new⟧.'],
    rt,
  );
  assert.equal(rep.status, 'ok');
  assert.deepEqual(rep.sentences[0].flags, ['UNANCHORED']);
  assert.deepEqual(rep.sentences[1].flags, ['UNANCHORED', 'UNANCHORED-NUMERIC']);
  assert.deepEqual(rep.sentences[2].flags, []); // a cited sentence is never flagged
  assert.equal(rep.sentences[2].citations[0].verdict, 'ANCHORED');
  assert.equal(rep.counts.unanchored, 2);
  assert.equal(rep.counts.unanchored_numeric, 1);
});

test('determinism (R10): same input twice gives identical reports', () => {
  const rt = ruleRuntime();
  const paras = ['Old plan ⟦zza:plan-old⟧. New 42 figures here.', 'Tail ⟦zzb:plan-old#p2⟧'];
  const a = checkParagraphs(paras, rt);
  const b = checkParagraphs(paras, rt);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

// ---------------------------------------------------------------- AD-12
const STALE_AT = '2025-12-01T00:00:00.000Z'; // 61 days before builtAt, budget 30
const FRESH_AT = '2026-01-30T00:00:00.000Z';
const staleRoot = (nStale, nFresh) =>
  makeRoot({
    cleanup,
    baseRows: [
      ...Array.from({ length: nStale }, (_, i) => baseRow({ record_key: `k.stale${i}`, retrieved_at: STALE_AT })),
      ...Array.from({ length: nFresh }, (_, i) => baseRow({ record_key: `k.fresh${i}`, retrieved_at: FRESH_AT })),
    ],
    views: { ZZA: [vrow({ doc_id: 'plan-new', sha256: 'b'.repeat(64) })] },
  });

test('AD-12: stale fraction above the threshold refuses verification, with the numbers', () => {
  const rt = loadRuntime(staleRoot(2, 8)); // 20% > 10%
  assert.equal(rt.staleness.anchored_rows, 10);
  assert.equal(rt.staleness.stale_rows, 2);
  const rep = checkParagraphs(['Anything ⟦zza:plan-new⟧.'], rt);
  assert.equal(rep.status, 'verification-unavailable');
  assert.match(rep.reason, /2 of 10 anchored rows/);
  assert.equal(rep.sentences, undefined); // no verdicts against a stale graph
  assert.deepEqual(commentsFromReport(rep), []);
});

test('AD-12: exactly at the threshold still verifies (strictly-greater mutation pair)', () => {
  const rt = loadRuntime(staleRoot(1, 9)); // exactly 10%
  assert.equal(rt.staleness.stale_fraction, STALE_THRESHOLD);
  const rep = checkParagraphs(['Anything ⟦zza:plan-new⟧.'], rt);
  assert.equal(rep.status, 'ok');
  assert.equal(rep.sentences[0].citations[0].verdict, 'ANCHORED');
});

test('AD-12: a source without a contract is manual-tier and never auto-stale (AD-13)', () => {
  const dir = makeRoot({
    cleanup,
    baseRows: [
      baseRow({ record_key: 'k.manual', anchor_source_id: 'hand-ledger', retrieved_at: STALE_AT }),
      baseRow({ record_key: 'k.fresh', retrieved_at: FRESH_AT }),
    ],
    views: { ZZA: [vrow({ doc_id: 'plan-new', sha256: 'b'.repeat(64) })] },
  });
  const rt = loadRuntime(dir);
  assert.equal(rt.staleness.stale_rows, 0);
  assert.equal(rt.staleness.anchored_rows, 2);
});

test('AD-12: age is measured against built_at, not the wall clock', () => {
  // built long after retrieval: the same rows that were fresh at build time
  // in 2026 would read stale from a 2027 build — proven synthetically.
  const dir = makeRoot({
    cleanup,
    builtAt: '2027-01-31T00:00:00.000Z',
    baseRows: [baseRow({ record_key: 'k.once-fresh', retrieved_at: FRESH_AT })],
    views: { ZZA: [vrow({ doc_id: 'plan-new', sha256: 'b'.repeat(64) })] },
  });
  assert.equal(loadRuntime(dir).staleness.stale_rows, 1);
});

// ------------------------------------------------------------- runtime doors
test('loadRuntime refuses views generated from a different build', () => {
  const dir = makeRoot({
    cleanup,
    baseRows: [baseRow({ record_key: 'k.fresh', retrieved_at: FRESH_AT })],
    views: { ZZA: [vrow({ doc_id: 'plan-new' })] },
    viewBuildId: 'cd'.repeat(32),
  });
  assert.throws(() => loadRuntime(dir), /regenerate views/);
});

test('loadRuntime refuses a root without generated views', () => {
  const dir = makeRoot({ cleanup, baseRows: [baseRow({ record_key: 'k.fresh', retrieved_at: FRESH_AT })] });
  assert.throws(() => loadRuntime(dir), /data\/views\/countries is missing/);
});

// ------------------------------------------------- live build (CI generates)
const liveReady = existsSync(join(repo, 'data', 'views', 'countries'));
const skipLive = !liveReady && 'data/views not generated — run npm run build:views first (CI does)';

test('live: a real receipt token resolves ANCHORED with its deep link', { skip: skipLive }, () => {
  const rt = loadRuntime(repo);
  // pick a receipt the same way the demo page does: quoted and hashed
  let picked = null;
  for (const [iso3, view] of [...rt.views.entries()].sort()) {
    const row = view.rows.find((r) => r.quote && r.sha256);
    if (row) {
      picked = { iso3, doc_id: row.doc_id };
      break;
    }
  }
  assert.ok(picked, 'the live build holds at least one quoted, hashed receipt');
  const r = resolveToken(cite(picked.iso3, picked.doc_id), rt);
  assert.equal(r.verdict, 'ANCHORED');
  assert.equal(r.receipt_url, `/receipt/${picked.iso3}/${picked.doc_id}/`);
});

test('live: a pointing-nowhere token is UNSUPPORTED', { skip: skipLive }, () => {
  const rt = loadRuntime(repo);
  const r = resolveToken(cite('qqz', 'no-such-receipt'), rt);
  assert.equal(rt.views.has('qqz'), false, 'qqz must stay an unassigned code');
  assert.equal(r.verdict, 'UNSUPPORTED');
  assert.equal(r.receipt_url, null);
});

test('live: the registry data yields a real superseded OUTDATED case', { skip: skipLive }, () => {
  const rt = loadRuntime(repo);
  // find a country with an older observed doc and a newer observed doc of the
  // same type (dates from the record, not from this test)
  let hit = null;
  for (const [iso3, view] of [...rt.views.entries()].sort()) {
    for (const row of view.rows) {
      if (row.state !== 'observed' || !row.date || !(row.sha256 || row.quote)) continue;
      const newer = view.rows.some(
        (r) => r.doc_id !== row.doc_id && r.doc_type === row.doc_type && r.state === 'observed' && r.date && r.date > row.date,
      );
      if (newer) {
        hit = { iso3, doc_id: row.doc_id };
        break;
      }
    }
    if (hit) break;
  }
  assert.ok(hit, 'the live registry data holds a superseded document');
  const r = resolveToken(cite(hit.iso3, hit.doc_id), rt);
  assert.equal(r.verdict, 'OUTDATED');
  assert.match(r.reason, /superseded on the record/);
});

test('live: current stale fraction is published in every report', { skip: skipLive }, () => {
  const rt = loadRuntime(repo);
  const rep = checkParagraphs(['Plain sentence.'], rt);
  assert.ok(rep.staleness.anchored_rows > 0);
  assert.equal(typeof rep.staleness.stale_fraction, 'number');
  assert.equal(rep.staleness.threshold, STALE_THRESHOLD);
});

// ----------------------------------------------- r10 gate (h) + mutations
const gatePath = join(repo, 'engine', 'gates', 'r10-author-deterministic.mjs');
function gateOn(files) {
  const dir = makeRoot({ cleanup, views: { ZZA: [vrow({ doc_id: 'x' })] } });
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
  return spawnSync(process.execPath, [gatePath, '--root', dir], { encoding: 'utf8' });
}
const detected = (r) => assert.notEqual(r.status, 0, `mutation NOT detected.\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
const clean = (r) => assert.equal(r.status, 0, `expected a pass.\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);

test('r10 gate detects a network call in the author path', () => {
  const r = gateOn({ 'engine/author/bad.mjs': 'export const go = async (u) => (await fetch(u)).json();\n' });
  detected(r);
  // On a violation the gate stays silent on stdout — no success note next to
  // the violation line to mislead a CI-log reader.
  assert.doesNotMatch(r.stdout, /hold R10/);
});

test('r10 gate detects network and model imports', () => {
  detected(gateOn({ 'engine/author/bad.mjs': "import https from 'node:https';\n" }));
  detected(gateOn({ 'engine/author/bad.mjs': "import OpenAI from 'openai';\n" }));
  detected(gateOn({ 'engine/author/bad.mjs': "const { request } = require('http');\n" }));
});

test('r10 gate detects wall clock and randomness in the judgment path', () => {
  detected(gateOn({ 'engine/author/bad.mjs': 'export const t = () => Date.now();\n' }));
  detected(gateOn({ 'engine/author/bad.mjs': 'export const t = () => new Date().toISOString();\n' }));
  detected(gateOn({ 'engine/author/bad.mjs': 'export const r = () => Math.random();\n' }));
});

test('r10 gate passes deterministic author code and fixed-date parsing', () => {
  clean(
    gateOn({
      'engine/author/ok.mjs':
        "import { readFileSync } from 'node:fs';\nexport const age = (a, b) => Date.parse(a) - Date.parse(b);\n",
    }),
  );
});

test('r10 gate passes with a note when engine/author is absent', () => {
  const dir = makeRoot({ cleanup, views: { ZZA: [vrow({ doc_id: 'x' })] } });
  const r = spawnSync(process.execPath, [gatePath, '--root', dir], { encoding: 'utf8' });
  clean(r);
  assert.match(r.stdout, /no engine\/author/);
});

test('r10 gate passes the real engine/author directory', () => {
  const r = spawnSync(process.execPath, [gatePath, '--root', repo], { encoding: 'utf8' });
  clean(r);
  assert.match(r.stdout, /author file\(s\) hold R10/);
});
