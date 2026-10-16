// WP-03 source adapters: parser units on small committed fixtures (no live
// network anywhere in here), plus mutation-style checks — the byte-success
// check must reject a 200 whose body is a 212-byte bot-check page, and the
// license gate must refuse a blocked source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertLicensed, checkBytes, sha1Base32, sha256, snapshot } from '../engine/sources/_base.mjs';
import { parseRegistry } from '../engine/sources/ds-registry.mjs';
import { parseBtrTree } from '../engine/sources/ds-btr.mjs';
import { parseUntcBbox, reconcileUntc } from '../engine/sources/ds-untc.mjs';
import { indexPlans, matchPlan, urlBasename } from '../engine/sources/ds-ndc-docs.mjs';
import { captureFormat, parseCdx } from '../engine/sources/ds-ndc-wayback.mjs';

const fixturesDir = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'sources');
const fixture = (name) => readFileSync(join(fixturesDir, name));

const tmp = [];
process.on('exit', () => {
  for (const d of tmp) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      // best effort
    }
  }
});
function tmpRoot(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'wp03-'));
  tmp.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
  return dir;
}

// ---------------------------------------------------------------- registry

test('registry parser groups every row by party and picks the latest by date', () => {
  const parsed = parseRegistry(fixture('registry.csv').toString('utf8'));
  assert.equal(parsed.row_count, 3);
  assert.deepEqual(parsed.parties.map((p) => p.code), ['AAA', 'BBB']);
  const [a, b] = parsed.parties;
  assert.equal(a.documents.length, 2);
  assert.equal(a.latest.title, 'Alphaland Second NDC, revised');
  assert.equal(a.latest.submission_date, '2021-05-10');
  assert.equal(a.latest.version, '2');
  assert.equal(b.documents.length, 1);
  assert.equal(b.documents[0].file_type, 'Translation');
  assert.equal(b.latest.submission_date, '2020-01-02');
});

test('registry parser refuses a csv missing a required column', () => {
  assert.throws(() => parseRegistry('code,party\nAAA,Alphaland\n'), /missing the "title" column/);
});

// ---------------------------------------------------------------- btr tree

const TREE_OPTS = { tree_prefix: 'downloaded_data/UNFCCC/', folder_pattern: '^btr[0-9]+$' };

test('btr parser lists per-party submission folders, presence only', () => {
  const parties = parseBtrTree(JSON.parse(fixture('tree.json').toString('utf8')), TREE_OPTS);
  assert.deepEqual(parties.map((p) => p.party_folder), ['Alphaland', 'Betaland', 'Gammaland']);
  const a = parties[0];
  assert.deepEqual(Object.keys(a.btr), ['BTR1']);
  assert.equal(a.btr.BTR1.submitted, true);
  assert.deepEqual(a.btr.BTR1.files, ['Alphaland-BTR1-Status_name_Final.pdf', 'annex/CRT-Alphaland.xlsx']);
  // case-insensitive folder pattern from the contract
  assert.equal(parties[2].btr.btr2.submitted, true);
});

test('btr parser emits null for absence, never false', () => {
  const parties = parseBtrTree(JSON.parse(fixture('tree.json').toString('utf8')), TREE_OPTS);
  const b = parties.find((p) => p.party_folder === 'Betaland');
  assert.equal(b.btr, null);
  assert.ok(!JSON.stringify(parties).includes('"submitted":false'));
});

test('btr parser refuses a truncated tree listing', () => {
  assert.throws(() => parseBtrTree({ truncated: true, tree: [] }, TREE_OPTS), /truncated/);
});

// ---------------------------------------------------------------- untc bbox

test('untc parser reads rows, merged leaders, detached years, markers and the legend', () => {
  const parsed = parseUntcBbox(fixture('untc-bbox.xml').toString('utf8'));
  assert.equal(parsed.signatories_header, 2);
  assert.equal(parsed.parties_header, 3);
  assert.deepEqual(parsed.marker_legend, { AA: 'approval', A: 'acceptance', a: 'accession', d: 'succession' });
  assert.equal(parsed.participants.length, 4);
  const [alpha, beta, united, delta] = parsed.participants;

  assert.equal(alpha.participant, 'Alphaland');
  assert.deepEqual(alpha.signature, { date: '1992-06-12', bracketed: false });
  assert.equal(alpha.action.date, '1994-09-19');
  assert.equal(alpha.action.kind, 'ratification');
  assert.equal(alpha.action.marker, null);

  // superscript footnote ref dropped; day merged into the dot leader
  assert.equal(beta.participant, 'Betaland');
  assert.equal(beta.signature, null);
  assert.deepEqual(beta.action, { date: '1995-12-18', bracketed: false, marker: 'a', kind: 'accession' });

  // wrapped name assembled from adjacent fragment lines
  assert.equal(united.participant, 'United Provinces of the South');
  assert.equal(united.action.kind, 'acceptance');

  // bracketed dates parse but are flagged (the depositary's own exclusion)
  assert.equal(delta.participant, "Deltaria's Republic");
  assert.deepEqual(delta.signature, { date: '2016-04-22', bracketed: true });
  assert.equal(delta.action.date, '2017-01-20');
  assert.equal(delta.action.bracketed, true);
});

test('untc parser ignores off-origin secondary tables and reconciles with the printed counts', () => {
  const parsed = parseUntcBbox(fixture('untc-bbox.xml').toString('utf8'));
  assert.equal(parsed.ignored_off_origin, 2); // secondary header line + its row
  assert.ok(!parsed.participants.some((p) => p.participant.includes('Epsilonia')));
  const rec = reconcileUntc(parsed);
  assert.equal(rec.signature_count, 2); // bracketed signature excluded
  assert.equal(rec.action_count, 3); // bracketed action excluded
  assert.deepEqual(rec.problems, []);
});

test('untc parser records a refused row with its reason and reconcile reports it', () => {
  const parsed = parseUntcBbox(fixture('untc-bbox-badrow.xml').toString('utf8'));
  assert.equal(parsed.participants.length, 1);
  assert.equal(parsed.refused.length, 1);
  assert.equal(parsed.refused[0].participant, 'Betaland');
  assert.match(parsed.refused[0].reason, /Xyz/);
  const rec = reconcileUntc(parsed);
  assert.equal(rec.problems.length, 1);
  assert.match(rec.problems[0], /refused row/);
});

// ---------------------------------------------------------------- byte checks

const goodPdf = () => Buffer.from('%PDF-1.7\n' + 'x'.repeat(1200) + '\n%%EOF\n');

test('byte check rejects the 212-byte bot-check page under every format', () => {
  const bot = fixture('bot-check.html');
  assert.equal(bot.length, 212);
  assert.match(checkBytes(bot, { min_bytes: 1000, format: 'pdf' }), /min_bytes floor/);
  assert.match(checkBytes(bot, { min_bytes: 100, format: 'pdf' }), /not a pdf/);
  assert.match(checkBytes(bot, { min_bytes: 100, format: 'json' }), /not json/);
  assert.match(checkBytes(bot, { min_bytes: 100, format: 'csv', csv_header: 'code,party' }), /header mismatch/);
});

test('byte check passes bytes that satisfy the contract', () => {
  assert.equal(checkBytes(goodPdf(), { min_bytes: 1000, format: 'pdf' }), null);
  assert.equal(checkBytes(Buffer.from('{"a":1}'), { min_bytes: 2, format: 'json' }), null);
  assert.equal(checkBytes(Buffer.from('a,b\n1,2\n'), { min_bytes: 2, format: 'csv', csv_header: 'a,b' }), null);
  assert.match(checkBytes(Buffer.from('x'), { min_bytes: 1 }) ?? '', /no byte success criteria/);
});

// ---------------------------------------------------------------- license gate

const LICENSES_HEADER = 'source_id,name,url,terms_url,license_or_terms,verified_date,summary,use_allowed';
const licenseCsv = (rows) => [LICENSES_HEADER, ...rows].join('\n') + '\n';

test('license gate refuses a blocked source and prints the register row', () => {
  const root = tmpRoot({
    'data/licenses.csv': licenseCsv([
      'blocked-src,Blocked,https://example.org,https://example.org/terms,all rights reserved,2026-10-15,no reuse,no',
      'open-src,Open,https://example.org,https://example.org/terms,CC-BY,2026-10-15,fine,yes',
      'cond-src,Conditional,https://example.org,https://example.org/terms,view only,2026-10-15,no redistribution,yes-no-redistribution',
    ]),
  });
  assert.throws(() => assertLicensed(root, 'blocked-src'), (e) => {
    assert.match(e.message, /not cleared for use/);
    assert.match(e.message, /"use_allowed":"no"/);
    return true;
  });
  assert.equal(assertLicensed(root, 'open-src').use_allowed, 'yes');
  assert.equal(assertLicensed(root, 'cond-src').use_allowed, 'yes-no-redistribution');
});

test('license gate refuses when the register or the row is missing', () => {
  assert.throws(() => assertLicensed(tmpRoot(), 'any-src'), /licenses\.csv not found/);
  const root = tmpRoot({ 'data/licenses.csv': licenseCsv([]) });
  assert.throws(() => assertLicensed(root, 'any-src'), /no row/);
});

// ---------------------------------------------------------------- snapshot (fetch injected — no network)

const CRIT = { min_bytes: 1000, format: 'pdf' };
const respond = (bytes, status = 200) => async () => new Response(bytes, { status });

test('snapshot judges success by bytes: a 200 bot-check page is a failure', async () => {
  const root = tmpRoot();
  await assert.rejects(
    snapshot(root, 'https://example.org/f.pdf', 'src', 'f.pdf', CRIT, {
      fetchImpl: respond(fixture('bot-check.html')),
      gapMs: 0,
    }),
    /byte check failed/,
  );
});

test('snapshot keeps the previous snapshot and marks it stale when a refresh fails', async () => {
  const root = tmpRoot();
  const good = goodPdf();
  const first = await snapshot(root, 'https://example.org/f.pdf', 'src', 'f.pdf', CRIT, {
    fetchImpl: respond(good),
    gapMs: 0,
  });
  assert.equal(first.reused, false);
  assert.equal(first.meta.sha256, sha256(good));
  assert.equal(first.meta.size_bytes, good.length);

  const second = await snapshot(root, 'https://example.org/f.pdf', 'src', 'f.pdf', CRIT, {
    force: true,
    fetchImpl: respond(fixture('bot-check.html')),
    gapMs: 0,
  });
  assert.equal(second.reused, true);
  assert.equal(second.stale, true);
  assert.match(second.meta.stale_reason, /byte check failed/);
  assert.equal(sha256(second.bytes), sha256(good));
  const sidecar = JSON.parse(readFileSync(join(root, 'data', 'cache', 'src', 'f.pdf.meta.json'), 'utf8'));
  assert.match(sidecar.stale_reason, /byte check failed/);
});

test('snapshot reuses a cache file whose sha256 matches its sidecar without refetching', async () => {
  const root = tmpRoot();
  await snapshot(root, 'https://example.org/f.pdf', 'src', 'f.pdf', CRIT, { fetchImpl: respond(goodPdf()), gapMs: 0 });
  let fetched = false;
  const again = await snapshot(root, 'https://example.org/f.pdf', 'src', 'f.pdf', CRIT, {
    fetchImpl: async () => {
      fetched = true;
      throw new Error('must not fetch');
    },
    backoffMs: [],
    gapMs: 0,
  });
  assert.equal(fetched, false);
  assert.equal(again.reused, true);
  assert.equal(again.stale, false);
});

test('snapshot retries transient failures on the backoff ladder', async () => {
  const root = tmpRoot();
  let calls = 0;
  const result = await snapshot(root, 'https://example.org/g.pdf', 'src', 'g.pdf', CRIT, {
    fetchImpl: async () => new Response(calls++ === 0 ? 'oops' : goodPdf(), { status: calls === 1 ? 500 : 200 }),
    backoffMs: [1, 1],
    gapMs: 0,
  });
  assert.equal(calls, 2);
  assert.equal(result.reused, false);
  assert.equal(result.meta.sha256, sha256(goodPdf()));
});

// ---------------------------------------------------------------- ndc-docs matching

test('urlBasename decodes and lowercases the url tail', () => {
  assert.equal(urlBasename('https://example.org/a%20b/First%20NDC%20Final.pdf'), 'first ndc final.pdf');
  assert.equal(urlBasename('plain.PDF'), 'plain.pdf');
  assert.equal(urlBasename(null), '');
});

test('ndc-docs matches registry rows to mirror rows by code plus basename', () => {
  const plans = [
    { Code: 'AAA', Filename: 'AAA_Alphaland_First_NDC_English.pdf', EncodedAbsUrl: 'https://mirror.example/old%20path/AAA_first.pdf' },
    { Code: 'BBB', Filename: 'BBB_Betaland_First_NDC_French.pdf', EncodedAbsUrl: 'https://mirror.example/BBB_first_fr.pdf' },
  ];
  const idx = indexPlans(plans);
  // match via the registry document url basename
  const hit = matchPlan('AAA', { url: 'https://unfccc.example/files/AAA_first.pdf', original_filename: 'x.pdf' }, idx);
  assert.equal(hit.Filename, 'AAA_Alphaland_First_NDC_English.pdf');
  // match via original filename against the mirror filename
  const byName = matchPlan('BBB', { url: 'https://unfccc.example/other.pdf', original_filename: 'BBB_Betaland_First_NDC_French.pdf' }, idx);
  assert.equal(byName.Code, 'BBB');
  // the same basename under a different party code never matches
  assert.equal(matchPlan('CCC', { url: 'https://unfccc.example/files/AAA_first.pdf', original_filename: '' }, idx), null);
});

// ---------------------------------------------------------------- ndc-wayback

test('sha1Base32 matches the cdx digest encoding (RFC 4648, 32 chars)', () => {
  // sha1("abc") = a9993e364706816aba3e25717850c26c9cd0d89d → base32 of those bytes
  assert.equal(sha1Base32(Buffer.from('abc')), 'VGMT4NSHA2AWVOR6EVYXQUGCNSONBWE5');
  assert.match(sha1Base32(Buffer.from('')), /^[A-Z2-7]{32}$/);
});

test('parseCdx keeps only 200 captures, newest first, keyed by the header row', () => {
  const body = JSON.stringify([
    ['urlkey', 'timestamp', 'original', 'mimetype', 'statuscode', 'digest', 'length'],
    ['k', '20200101000000', 'https://x.example/a.pdf', 'application/pdf', '200', 'A'.repeat(32), '10'],
    ['k', '20230101000000', 'https://x.example/a.pdf', 'application/pdf', '200', 'B'.repeat(32), '10'],
    ['k', '20240101000000', 'https://x.example/a.pdf', 'text/html', '404', 'C'.repeat(32), '10'],
  ]);
  const captures = parseCdx(body);
  assert.equal(captures.length, 2);
  assert.equal(captures[0].timestamp, '20230101000000');
  assert.equal(captures[0].digest, 'B'.repeat(32));
  assert.deepEqual(parseCdx('[]'), []);
  // an archive outage interstitial is html, not json — the caller treats the
  // throw as transient, never as "no capture"
  assert.throws(() => parseCdx('<html>Temporarily Offline</html>'));
});

test('captureFormat: url extension first, capture mimetype second, else null', () => {
  const contract = JSON.parse(
    readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', 'engine', 'sources', 'contracts', 'ndc-wayback.json'), 'utf8'),
  );
  assert.equal(captureFormat('Some Plan.PDF', { mimetype: 'text/html' }, contract), 'pdf');
  assert.equal(captureFormat('Plan.docx', { mimetype: 'application/pdf' }, contract), 'docx');
  // no extension: fall back to the capture's recorded mimetype
  assert.equal(captureFormat('Bare Document', { mimetype: 'application/pdf' }, contract), 'pdf');
  assert.equal(captureFormat('Bare Document', { mimetype: 'text/html' }, contract), null);
});

test('byte check accepts a zip-magic docx and rejects a renamed html body', () => {
  const docx = Buffer.concat([Buffer.from('PK\x03\x04', 'latin1'), Buffer.alloc(2000, 1)]);
  assert.equal(checkBytes(docx, { min_bytes: 1024, format: 'docx' }), null);
  const html = Buffer.alloc(2000, '<html>');
  assert.match(checkBytes(html, { min_bytes: 1024, format: 'docx' }), /not a docx/);
});
