// WP-08 authoring verification (AD-1): deterministic resolution of explicit
// citation tokens against the current build. The ONLY sentences that receive
// verdicts are those citing an anchor token; everything else is flagged
// unanchored. No free-text claim extraction, no NLP, no model anywhere in
// this path (R10 — enforced by the r10-author-deterministic gate).
//
// Data discipline: graph rows arrive through engine/reader/reader.mjs (the
// single door, AD-8) and receipts through the generated views under
// data/views/ — this module never parses graph CSVs itself. Verdict
// vocabulary comes from engine/generated/vocab.json (R2); the three values
// are deterministic LOOKUP statuses, never evidentiary judgment (R4).
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { readGraph } from '../reader/reader.mjs';

// AD-12: above this stale fraction the whole check refuses to run.
export const STALE_THRESHOLD = 0.1;

const MS_PER_DAY = 86400000;
const SHA_RE = /^[0-9a-f]{64}$/;

// ---------------------------------------------------------------- grammar
// Citation token (documented in docs/AUTHORING.md). Two spellings, identical
// semantics: the corner-bracket form and the plain-keyboard fallback.
//   ⟦iso3:doc_id⟧        [[anchor:iso3:doc_id]]
//   ⟦iso3:doc_id#pN⟧     [[anchor:iso3:doc_id#pN]]
// iso3 and doc_id are case-normalized to lowercase; doc_id is the id the
// views publish (receipts are country-namespaced because doc_ids collide
// across countries). Regex-parsed, deterministic.
const TOKEN_BODY = '([A-Za-z]{3}):([A-Za-z0-9][A-Za-z0-9._-]*?)(?:#p(\\d+))?';
const CORNER_RE = new RegExp(`\\u27e6${TOKEN_BODY}\\u27e7`, 'g');
const PLAIN_RE = new RegExp(`\\[\\[anchor:${TOKEN_BODY}\\]\\]`, 'g');

export function extractCitations(text) {
  const found = [];
  for (const re of [CORNER_RE, PLAIN_RE]) {
    for (const m of text.matchAll(re)) {
      found.push({
        raw: m[0],
        iso3: m[1].toLowerCase(),
        doc_id: m[2].toLowerCase(),
        page: m[3] === undefined ? null : Number(m[3]),
        start: m.index,
        end: m.index + m[0].length,
      });
    }
  }
  return found.sort((a, b) => a.start - b.start);
}

// ---------------------------------------------------------------- sentences
// Simple deterministic segmentation (AD-1): within a paragraph, a sentence
// ends at . ! or ? followed by whitespace or the paragraph end. Positions
// inside citation tokens never end a sentence (doc_ids may carry dots).
// Limits are documented honestly in docs/AUTHORING.md.
export function segmentSentences(text, citations = extractCitations(text)) {
  const out = [];
  const push = (a, b) => {
    let s = a;
    let e = b;
    while (s < e && /\s/.test(text[s])) s++;
    while (e > s && /\s/.test(text[e - 1])) e--;
    if (e > s) out.push({ text: text.slice(s, e), start: s, end: e });
  };
  const inToken = (i) => citations.some((c) => i >= c.start && i < c.end);
  let from = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if ((ch === '.' || ch === '!' || ch === '?') && !inToken(i)) {
      const next = text[i + 1];
      if (next === undefined || /\s/.test(next)) {
        push(from, i + 1);
        from = i + 1;
      }
    }
  }
  push(from, text.length);
  return out;
}

// ---------------------------------------------------------------- runtime
// Loads everything one check needs, once: verdict vocabulary, the published
// views, and the AD-12 stale fraction computed from the graph via the reader.
export function loadRuntime(root) {
  const vocab = JSON.parse(readFileSync(join(root, 'engine', 'generated', 'vocab.json'), 'utf8'));
  const verdictValues = vocab.facet_values?.['FACET-AUTHOR-VERDICT'] ?? [];
  const V = Object.fromEntries(verdictValues.map((v) => [v, v]));
  for (const needed of ['ANCHORED', 'OUTDATED', 'UNSUPPORTED']) {
    if (!V[needed]) throw new Error(`generated vocabulary carries no author verdict "${needed}" (R2)`);
  }

  const g = readGraph(root);
  if (g === null || g.build === null) {
    throw new Error('no published graph with build.json — author-check verifies against a build, never against nothing');
  }
  const buildId = String(g.build.build_id ?? '');
  const builtAtMs = Date.parse(g.build.built_at ?? '');
  if (!Number.isFinite(builtAtMs)) throw new Error('build.json carries no parseable built_at');
  const asOf = String(g.build.built_at).slice(0, 10);

  // Source staleness budgets (R14 contracts). A source without a contract is
  // manual-tier (AD-13) and is never auto-stale.
  const budgets = new Map();
  const contractsDir = join(root, 'engine', 'sources', 'contracts');
  if (existsSync(contractsDir)) {
    for (const f of readdirSync(contractsDir).sort()) {
      if (!f.endsWith('.json')) continue;
      const c = JSON.parse(readFileSync(join(contractsDir, f), 'utf8'));
      if (c.source_id && Number.isFinite(c.staleness_budget_days)) {
        budgets.set(c.source_id, c.staleness_budget_days);
      }
    }
  }

  // AD-12 stale fraction: base ledger rows that carry an anchor (source +
  // parseable retrieval time); stale when the evidence age at built_at
  // exceeds the source's budget. Deterministic: no wall clock anywhere.
  const anchored = g.base.filter(
    (r) => r.anchor_source_id && Number.isFinite(Date.parse(r.retrieved_at)),
  );
  const stale = anchored.filter((r) => {
    const budget = budgets.get(r.anchor_source_id);
    if (budget === undefined) return false;
    return (builtAtMs - Date.parse(r.retrieved_at)) / MS_PER_DAY > budget;
  });
  const staleness = {
    anchored_rows: anchored.length,
    stale_rows: stale.length,
    stale_fraction: anchored.length === 0 ? 0 : stale.length / anchored.length,
    threshold: STALE_THRESHOLD,
  };

  // Receipts: the generated views, keyed by iso3. The views are the reader's
  // product (R11); their build must be the graph's build or the check would
  // verify against a torn pair.
  const countriesDir = join(root, 'data', 'views', 'countries');
  if (!existsSync(countriesDir)) {
    throw new Error('data/views/countries is missing — generate views first; author-check resolves receipts from views only');
  }
  const views = new Map();
  for (const f of readdirSync(countriesDir).sort()) {
    if (!f.endsWith('.json')) continue;
    const view = JSON.parse(readFileSync(join(countriesDir, f), 'utf8'));
    if (view.build_id !== buildId) {
      throw new Error(`view ${f} was generated from build ${String(view.build_id).slice(0, 12)} but the graph is build ${buildId.slice(0, 12)} — regenerate views`);
    }
    views.set(view.country.iso3.toLowerCase(), view);
  }
  // Mechanical nearest-miss index: doc_id -> the countries that hold it.
  const docIndex = new Map();
  for (const [iso3, view] of views) {
    for (const row of view.rows) {
      if (!docIndex.has(row.doc_id)) docIndex.set(row.doc_id, []);
      docIndex.get(row.doc_id).push(iso3);
    }
  }
  return { root, build_id: buildId, as_of: asOf, verdicts: V, staleness, views, docIndex };
}

// ---------------------------------------------------------------- verdicts
const receiptUrl = (iso3, docId) => `/receipt/${iso3}/${docId}/`;

// One token -> one verdict. Deterministic lookups only; every reason names
// what the record shows, and every resolvable verdict carries the receipt
// deep link. Rule order: existence -> degraded -> superseded -> evidence ->
// page -> anchored.
export function resolveToken(cite, runtime) {
  const V = runtime.verdicts;
  const { iso3, doc_id, page } = cite;
  const view = runtime.views.get(iso3);
  if (!view) {
    const elsewhere = (runtime.docIndex.get(doc_id) ?? []).slice().sort();
    const near = elsewhere.length > 0 ? `; nearest miss: receipt "${doc_id}" exists under ${elsewhere.join(', ')}` : '';
    return {
      verdict: V.UNSUPPORTED,
      reason: `no country "${iso3}" in this build${near}`,
      receipt_url: null,
      nearest_miss: elsewhere.length > 0 ? receiptUrl(elsewhere[0], doc_id) : null,
    };
  }
  const row = view.rows.find((r) => r.doc_id === doc_id);
  if (!row) {
    const elsewhere = (runtime.docIndex.get(doc_id) ?? []).filter((c) => c !== iso3).sort();
    let near = '';
    let nearUrl = null;
    if (elsewhere.length > 0) {
      near = `; nearest miss: the same doc_id exists under ${elsewhere.join(', ')}`;
      nearUrl = receiptUrl(elsewhere[0], doc_id);
    } else {
      // string containment, not semantics: ids of this country that contain
      // or are contained by the cited id.
      const close = view.rows
        .map((r) => r.doc_id)
        .filter((d) => d.includes(doc_id) || doc_id.includes(d))
        .sort();
      if (close.length > 0) {
        near = `; nearest miss: this country records "${close[0]}"`;
        nearUrl = receiptUrl(iso3, close[0]);
      }
    }
    return {
      verdict: V.UNSUPPORTED,
      reason: `no receipt "${doc_id}" under country "${iso3}" in this build${near}`,
      receipt_url: null,
      nearest_miss: nearUrl,
    };
  }

  const url = receiptUrl(iso3, doc_id);
  // OUTDATED (a): the receipt's own state has degraded to unknown.
  if (row.state === 'unknown') {
    return {
      verdict: V.OUTDATED,
      reason: `the receipt's recorded state has degraded to unknown: ${row.state_reason || 'no reason recorded'}`,
      receipt_url: url,
      nearest_miss: null,
    };
  }
  // OUTDATED (b): superseded — the record holds a newer observed document of
  // the same doc_type for this country (dates compared as ISO strings; both
  // must be non-empty; ties are not supersession).
  if (row.date) {
    const newer = view.rows
      .filter((r) => r.doc_id !== row.doc_id && r.doc_type === row.doc_type && r.state === 'observed' && r.date && r.date > row.date)
      .sort((a, b) => (a.date === b.date ? (a.doc_id < b.doc_id ? -1 : 1) : a.date < b.date ? 1 : -1))[0];
    if (newer) {
      return {
        verdict: V.OUTDATED,
        reason: `superseded on the record: "${newer.doc_id}" (${newer.doc_type}, dated ${newer.date}) is newer than this receipt (dated ${row.date})`,
        receipt_url: url,
        nearest_miss: receiptUrl(iso3, newer.doc_id),
      };
    }
  }
  // ANCHORED requires evidence actually held: state observed with a file
  // hash or a quoted anchor on record.
  const hasSha = SHA_RE.test(row.sha256);
  const hasQuote = row.quote !== null && row.quote !== undefined;
  if (row.state !== 'observed' || (!hasSha && !hasQuote)) {
    return {
      verdict: V.UNSUPPORTED,
      reason: `the receipt exists but holds no evidence (state "${row.state}", no file hash, no quoted anchor on record)`,
      receipt_url: url,
      nearest_miss: null,
    };
  }
  // Page suffix, when given, must match a page the receipt actually records.
  if (page !== null) {
    const inQuote = hasQuote && row.quote.page === page;
    const inRange = Number.isInteger(row.pages) && page >= 1 && page <= row.pages;
    if (!inQuote && !inRange) {
      const recorded = Number.isInteger(row.pages)
        ? `pages 1-${row.pages}`
        : hasQuote
          ? `a page-${row.quote.page} quote only`
          : 'no page information';
      return {
        verdict: V.UNSUPPORTED,
        reason: `page ${page} cited but the receipt records ${recorded}`,
        receipt_url: url,
        nearest_miss: null,
      };
    }
  }
  const evidence = [hasSha ? 'sha256' : null, hasQuote ? `page-${row.quote.page} quote` : null].filter(Boolean).join(' + ');
  return {
    verdict: V.ANCHORED,
    reason: `receipt on record; evidence held (${evidence})${page !== null ? `; page ${page} matches the record` : ''}`,
    receipt_url: url,
    nearest_miss: null,
  };
}

// ---------------------------------------------------------------- check
// paragraphs: array of plain-text paragraph strings. Returns the full report.
// AD-12 guard runs FIRST: a graph it knows is stale yields status
// "verification-unavailable" with the numbers, and no verdicts at all.
export function checkParagraphs(paragraphs, runtime) {
  const head = {
    tool: 'author-check',
    build_id: runtime.build_id,
    as_of: runtime.as_of,
    staleness: runtime.staleness,
  };
  if (runtime.staleness.stale_fraction > STALE_THRESHOLD) {
    const pct = (runtime.staleness.stale_fraction * 100).toFixed(1);
    return {
      ...head,
      status: 'verification-unavailable',
      reason:
        `${runtime.staleness.stale_rows} of ${runtime.staleness.anchored_rows} anchored rows exceed their ` +
        `staleness budget (${pct}% > ${STALE_THRESHOLD * 100}%) — this check refuses to approve drafts against a graph it knows is outdated (AD-12)`,
    };
  }
  const V = runtime.verdicts;
  const sentences = [];
  const counts = { sentences: 0, cited: 0, anchored: 0, outdated: 0, unsupported: 0, unanchored: 0, unanchored_numeric: 0 };
  paragraphs.forEach((ptext, pi) => {
    const cites = extractCitations(ptext);
    for (const s of segmentSentences(ptext, cites)) {
      counts.sentences++;
      const inSentence = cites.filter((c) => c.start >= s.start && c.end <= s.end);
      const flags = [];
      let citations = [];
      if (inSentence.length === 0) {
        // AD-1: no citation -> unanchored, a flag, not an error. Lock (6): a
        // figure (any digit) with no citation is the blocking candidate class.
        flags.push('UNANCHORED');
        counts.unanchored++;
        if (/[0-9]/.test(s.text)) {
          flags.push('UNANCHORED-NUMERIC');
          counts.unanchored_numeric++;
        }
      } else {
        citations = inSentence.map((c) => {
          const r = resolveToken(c, runtime);
          counts.cited++;
          if (r.verdict === V.ANCHORED) counts.anchored++;
          else if (r.verdict === V.OUTDATED) counts.outdated++;
          else counts.unsupported++;
          return { token: c.raw, iso3: c.iso3, doc_id: c.doc_id, page: c.page, ...r };
        });
      }
      sentences.push({ paragraph: pi, start: s.start, end: s.end, text: s.text, flags, citations });
    }
  });
  return { ...head, status: 'ok', counts, sentences };
}

// The Word comment layer derived from a report (AD-2): one comment per
// citation verdict, plus one per UNANCHORED-NUMERIC sentence (the blocking
// candidate class; plain UNANCHORED stays in the JSON report only).
// Comment text: "VERDICT — reason — receipt URL — build_id".
export function commentsFromReport(report) {
  if (report.status !== 'ok') return [];
  const out = [];
  for (const s of report.sentences) {
    for (const c of s.citations) {
      out.push({
        paragraph: s.paragraph,
        start: s.start,
        end: s.end,
        text: `${c.verdict} — ${c.reason} — ${c.receipt_url ?? 'no receipt'} — build ${report.build_id}`,
      });
    }
    if (s.flags.includes('UNANCHORED-NUMERIC')) {
      out.push({
        paragraph: s.paragraph,
        start: s.start,
        end: s.end,
        text: `UNANCHORED-NUMERIC — this sentence carries a figure but cites no receipt — no receipt — build ${report.build_id}`,
      });
    }
  }
  return out;
}
