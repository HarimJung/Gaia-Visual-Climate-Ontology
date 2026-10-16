// ds-untc: depositary status from the UN Treaty Collection MTDSG status PDFs
// (the depositary's own English .en.pdf lists). pdftotext -bbox (never
// -layout) → every participant row (name, signature / action dates, action
// marker). A row that fails date parsing is recorded refused-with-reason, and
// the parsed totals MUST reconcile with the counts printed in the PDF's own
// header or the adapter fails the run. Run from the repo root:
//   node engine/sources/ds-untc.mjs [--force]
//
// Layout facts this parser rests on (verified against the real PDFs):
// - two columns per page; each column repeats a "Participant … Signature"
//   header line, with the action legend ("Approval(AA), Acceptance(A),
//   Accession(a), Succession(d), Ratification") stacked above the header line
//   at the action column's x origin — the marker meanings are read from that
//   legend, not hardcoded;
// - dot leaders sometimes merge with the action day ("Name……18"), action
//   years detach to the end of the word stream but keep their row's y;
// - wrapped names put the dates on the last line, earlier lines are fragments;
// - footnote references are superscripts (smaller glyph height) and carry no
//   dates; bracketed dates ("[22 Apr 2016]") are the depositary's notation for
//   actions not in effect and are excluded from the printed totals;
// - secondary tables (e.g. article notifications) use a different name-column
//   origin and are ignored by the origin check.
import { pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { rootArg } from '../gates/_lib.mjs';
import { assertLicensed, hasFlag, loadContract, snapshot, writeCanon, writeManifest } from './_base.mjs';

const MONTHS = {
  Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
  Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
};
const FULL_HEIGHT = 8.5; // glyph height below this is a superscript footnote ref
const ORIGIN_SLACK = 2.5; // a row's first line starts at the column origin
const INDENT_MAX = 25; // wrapped-name continuation lines indent this far at most

function decodeEntities(s) {
  return s.replace(/&(amp|lt|gt|quot|apos|#x?[0-9a-fA-F]+);/g, (m, g) => {
    if (g === 'amp') return '&';
    if (g === 'lt') return '<';
    if (g === 'gt') return '>';
    if (g === 'quot') return '"';
    if (g === 'apos') return "'";
    const code = g[1] === 'x' || g[1] === 'X' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : m;
  });
}

export function parseBboxWords(xml) {
  const pages = [];
  const pageRe = /<page[^>]*>([\s\S]*?)<\/page>/g;
  const wordRe = /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([\s\S]*?)<\/word>/g;
  for (const pm of xml.matchAll(pageRe)) {
    const words = [];
    for (const wm of pm[1].matchAll(wordRe)) {
      words.push({
        x: Number(wm[1]),
        y: Number(wm[2]),
        x2: Number(wm[3]),
        y2: Number(wm[4]),
        text: decodeEntities(wm[5]),
      });
    }
    pages.push(words);
  }
  return pages;
}

function headerCount(pages, label) {
  for (const words of pages) {
    const hit = words.find((w) => w.text === label && w.y2 - w.y >= FULL_HEIGHT);
    if (!hit) continue;
    const row = Math.round(hit.y);
    const after = words
      .filter((w) => Math.round(w.y) === row && w.x > hit.x && w.y2 - w.y >= FULL_HEIGHT && /^\d+\.?$/.test(w.text))
      .sort((a, b) => a.x - b.x);
    if (after.length > 0) return Number(after[0].text.replace(/\.$/, ''));
  }
  return null;
}

// Column specs per page: a "Participant" word with a "Signature" word on the
// same line. The action-column origin and the marker legend come from the
// legend words stacked above the header line.
function findColumns(words) {
  const full = words.filter((w) => w.y2 - w.y >= FULL_HEIGHT);
  const legendRe = /^([A-Za-z]+)\(([A-Za-z]+)\),?$/;
  const headers = full
    .filter((w) => w.text === 'Participant')
    .map((p) => {
      const sig = full.find((w) => Math.round(w.y) === Math.round(p.y) && w.x > p.x && w.text === 'Signature');
      return sig ? { x0: p.x, xSig: sig.x, yHeader: p.y } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.x0 - b.x0);
  for (let i = 0; i < headers.length; i++) {
    const col = headers[i];
    col.xEnd = i + 1 < headers.length ? headers[i + 1].x0 - ORIGIN_SLACK : Infinity;
    col.markers = {};
    let xAct = null;
    for (const w of full) {
      if (w.y < col.yHeader - 60 || w.y > col.yHeader + 1) continue;
      if (w.x <= col.xSig + 5 || w.x >= col.xEnd) continue;
      const m = legendRe.exec(w.text);
      if (m) {
        col.markers[m[2]] = m[1].toLowerCase();
        xAct = xAct === null ? w.x : Math.min(xAct, w.x);
      } else if (w.text === 'Ratification') {
        xAct = xAct === null ? w.x : Math.min(xAct, w.x);
      }
    }
    if (xAct === null) throw new Error('participant table header has no action legend — layout changed');
    col.xAct = xAct;
  }
  return headers;
}

function parseDateZone(tokens, markers) {
  if (tokens.length === 0) return null;
  let bracketed = false;
  const parts = [];
  for (const t of tokens) {
    const stripped = t.replace(/[\[\]]/g, '');
    if (stripped !== t) bracketed = true;
    if (stripped !== '') parts.push(stripped);
  }
  if (parts.length === 0) return { date: null, bracketed };
  const [day, mon, year, ...restTokens] = parts;
  if (!/^\d{1,2}$/.test(day) || Number(day) < 1 || Number(day) > 31) {
    throw new Error(`cannot read day "${day}" in [${tokens.join(' ')}]`);
  }
  if (!(mon in MONTHS)) throw new Error(`cannot read month "${mon}" in [${tokens.join(' ')}]`);
  if (!/^\d{4}$/.test(year ?? '')) throw new Error(`cannot read year "${year}" in [${tokens.join(' ')}]`);
  const rest = restTokens.join('');
  let marker = null;
  if (rest !== '') {
    if (markers && rest in markers) marker = rest;
    else throw new Error(`unknown action marker "${rest}" in [${tokens.join(' ')}]`);
  }
  return { date: `${year}-${MONTHS[mon]}-${day.padStart(2, '0')}`, bracketed, marker };
}

export function parseUntcBbox(xml) {
  const pages = parseBboxWords(xml);
  const result = {
    signatories_header: headerCount(pages, 'Signatories:'),
    parties_header: headerCount(pages, 'Parties:'),
    marker_legend: null,
    participants: [],
    refused: [],
    ignored_off_origin: 0,
  };
  // A wrapped-name fragment only belongs to the line directly beneath it
  // (fragment line spacing ~11.5pt vs row spacing ~14.4pt); anything further
  // away is unrelated prose and is dropped.
  let pending = null; // { text, page, colX0, y }
  const adjacent = (p, pageIdx, colX0, y) =>
    p !== null && p.page === pageIdx && p.colX0 === colX0 && y - p.y <= 13;
  pages.forEach((words, pageIdx) => {
    const columns = findColumns(words);
    for (const col of columns) {
      if (result.marker_legend === null) result.marker_legend = col.markers;
      const body = words.filter(
        (w) => w.y > col.yHeader + 5 && w.y2 - w.y >= FULL_HEIGHT && w.x >= col.x0 - ORIGIN_SLACK && w.x < col.xEnd,
      );
      const groups = new Map();
      for (const w of body) {
        const key = Math.round(w.y);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(w);
      }
      for (const key of [...groups.keys()].sort((a, b) => a - b)) {
        const tokens = groups.get(key).sort((a, b) => a.x - b.x);
        let leader = false;
        const names = [];
        const zones = { sig: [], act: [] };
        const zoneOf = (x) => (x < col.xSig - 3 ? null : x < col.xAct - 3 ? 'sig' : 'act');
        for (const t of tokens) {
          const merged = /^(.*?)\.{3,}(\d{0,2})$/.exec(t.text);
          if (merged) {
            leader = true;
            if (merged[1] !== '') names.push({ x: t.x, text: merged[1] });
            // digits merged onto the leader sit at the word's right edge
            if (merged[2] !== '') zones[zoneOf(t.x2 - 11) ?? 'act'].push(merged[2]);
            continue;
          }
          const z = zoneOf(t.x);
          if (z === null) names.push({ x: t.x, text: t.text });
          else zones[z].push(t.text);
        }
        const hasDates = zones.sig.length > 0 || zones.act.length > 0;
        if (names.length === 0 && !leader && !hasDates) continue;
        if (names.length > 0) {
          // rows and fragments both start at the column origin (continuation
          // lines indent a little); anything else is a different table
          const nameX = Math.min(...names.map((n) => n.x));
          if (nameX < col.x0 - ORIGIN_SLACK || nameX > col.x0 + INDENT_MAX) {
            result.ignored_off_origin++;
            continue;
          }
        }
        const nameText = names.map((n) => n.text).join(' ').trim();
        if (!leader) {
          if (hasDates) continue; // prose or footer flowing through the column — no dot leader, no row
          pending = {
            text: adjacent(pending, pageIdx, col.x0, key) ? `${pending.text} ${nameText}` : nameText,
            page: pageIdx,
            colX0: col.x0,
            y: key,
          };
          continue;
        }
        const participant = (adjacent(pending, pageIdx, col.x0, key) ? `${pending.text} ${nameText}` : nameText).trim();
        pending = null;
        if (participant === '') {
          result.refused.push({ page: pageIdx + 1, y: key, reason: `a dot-leader row with no participant name: [${tokens.map((t) => t.text).join(' ')}]` });
          continue;
        }
        try {
          const sig = parseDateZone(zones.sig, null);
          const act = parseDateZone(zones.act, col.markers);
          if ((sig === null || sig.date === null) && (act === null || act.date === null)) {
            throw new Error('row has no parseable dates');
          }
          result.participants.push({
            participant,
            page: pageIdx + 1,
            signature: sig && sig.date !== null ? { date: sig.date, bracketed: sig.bracketed } : null,
            action:
              act && act.date !== null
                ? {
                    date: act.date,
                    bracketed: act.bracketed,
                    marker: act.marker,
                    kind: act.marker !== null ? col.markers[act.marker] : 'ratification',
                  }
                : null,
          });
        } catch (e) {
          result.refused.push({ participant, page: pageIdx + 1, y: key, reason: e.message });
        }
      }
    }
  });
  return result;
}

// The parsed totals must reconcile with the counts the PDF prints about
// itself. Bracketed dates are the depositary's own exclusions.
export function reconcileUntc(parsed) {
  const problems = [];
  const sigCount = parsed.participants.filter((p) => p.signature && !p.signature.bracketed).length;
  const actCount = parsed.participants.filter((p) => p.action && !p.action.bracketed).length;
  if (parsed.parties_header === null) problems.push('the PDF header printed no Parties count');
  else if (actCount !== parsed.parties_header) {
    problems.push(`parsed ${actCount} parties but the PDF header prints ${parsed.parties_header}`);
  }
  if (parsed.signatories_header !== null && sigCount !== parsed.signatories_header) {
    problems.push(`parsed ${sigCount} signatories but the PDF header prints ${parsed.signatories_header}`);
  }
  for (const r of parsed.refused) {
    problems.push(`refused row (${r.participant ?? 'no name'}, page ${r.page}): ${r.reason}`);
  }
  return { signature_count: sigCount, action_count: actCount, problems };
}

export function pdftotextBin() {
  if (process.env.PDFTOTEXT) return process.env.PDFTOTEXT;
  const brew = '/opt/homebrew/bin/pdftotext';
  return existsSync(brew) ? brew : 'pdftotext';
}

function pdfToBboxXml(pdfPath) {
  const r = spawnSync(pdftotextBin(), ['-bbox', pdfPath, '-'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.error) throw new Error(`pdftotext: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`pdftotext exit ${r.status}: ${(r.stderr || '').slice(0, 300)}`);
  return r.stdout;
}

async function main() {
  const root = rootArg();
  const id = 'untc';
  const contract = loadContract(root, id);
  assertLicensed(root, contract.license_id ?? id);
  const out = { source_id: id, documents: [] };
  const failures = [];
  for (const doc of contract.documents) {
    const snap = await snapshot(root, doc.url, id, doc.filename, contract.success_criteria, {
      force: hasFlag('--force'),
    });
    const parsed = parseUntcBbox(pdfToBboxXml(snap.path));
    const rec = reconcileUntc(parsed);
    for (const p of rec.problems) failures.push(`${doc.key}: ${p}`);
    out.documents.push({
      key: doc.key,
      treaty: doc.treaty,
      filename: doc.filename,
      url: doc.url,
      snapshot_sha256: snap.meta.sha256,
      retrieved_at: snap.meta.retrieved_at,
      stale: snap.stale ? { reason: snap.meta.stale_reason, marked_at: snap.meta.stale_marked_at } : null,
      signatories_header: parsed.signatories_header,
      parties_header: parsed.parties_header,
      signature_count: rec.signature_count,
      action_count: rec.action_count,
      marker_legend: parsed.marker_legend,
      ignored_off_origin: parsed.ignored_off_origin,
      refused: parsed.refused,
      participants: parsed.participants,
    });
    console.log(
      `${id}/${doc.key}: ${parsed.participants.length} rows — ` +
        `${rec.action_count}/${parsed.parties_header} parties, ` +
        `${rec.signature_count}/${parsed.signatories_header} signatories, ` +
        `${parsed.refused.length} refused${snap.reused ? ' (snapshot reused)' : ''}`,
    );
  }
  if (failures.length > 0) {
    for (const f of failures) console.error(f);
    console.error(`${id}: parsed totals do not reconcile with the PDFs' own printed counts — nothing written`);
    process.exit(1);
  }
  writeCanon(root, id, out);
  writeManifest(root, id);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
