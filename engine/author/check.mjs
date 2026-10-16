// WP-08 CLI — authoring verification against the current build.
//
//   node engine/author/check.mjs --in draft.docx --out annotated.docx [--json report.json] [--root DIR]
//   node engine/author/check.mjs --text draft.txt [--json report.json] [--root DIR]
//
// .docx mode writes the same document back with the verdicts as a Word
// comment layer (AD-2). --text is the demo path for plain text (paragraph =
// line). Exit codes: 0 = check ran (verdicts, whatever they are, are the
// product, not an error) · 2 = verification-unavailable (AD-12: the graph is
// too stale to approve drafts against) · 1 = usage or input error.
// Deterministic: same input, same build -> byte-identical outputs (R10).
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRuntime, checkParagraphs, commentsFromReport } from './resolve.mjs';
import { readDocx, annotate } from './docx.mjs';

function arg(name) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : undefined;
}
const usage = () => {
  console.error(
    'usage: node engine/author/check.mjs --in draft.docx --out annotated.docx [--json report.json] [--root DIR]\n' +
      '       node engine/author/check.mjs --text draft.txt [--json report.json] [--root DIR]',
  );
  process.exit(1);
};

const root = resolve(arg('--root') ?? resolve(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const inPath = arg('--in');
const outPath = arg('--out');
const textPath = arg('--text');
const jsonPath = arg('--json');
if ((inPath && textPath) || (!inPath && !textPath) || (inPath && !outPath)) usage();

let runtime;
try {
  runtime = loadRuntime(root);
} catch (e) {
  console.error(`author-check: ${e.message}`);
  process.exit(1);
}

let paragraphs;
let docxBytes = null;
if (textPath) {
  paragraphs = readFileSync(textPath, 'utf8').split(/\r?\n/);
} else {
  docxBytes = readFileSync(inPath);
  paragraphs = readDocx(docxBytes).paragraphs.map((p) => p.text);
}

const report = checkParagraphs(paragraphs, runtime);
if (jsonPath) writeFileSync(jsonPath, JSON.stringify(report, null, 2) + '\n');

if (report.status !== 'ok') {
  // AD-12: refuse to annotate; the numbers are the answer.
  console.error(`author-check: ${report.status} — ${report.reason}`);
  process.exit(2);
}

if (docxBytes !== null) {
  writeFileSync(outPath, annotate(docxBytes, commentsFromReport(report), { asOf: report.as_of }));
}

const c = report.counts;
console.log(
  `author-check: build ${report.build_id.slice(0, 12)} · ${c.sentences} sentence(s), ${c.cited} citation(s): ` +
    `${c.anchored} anchored, ${c.outdated} outdated, ${c.unsupported} unsupported · ` +
    `${c.unanchored} unanchored (${c.unanchored_numeric} with figures)`,
);
for (const s of report.sentences) {
  for (const cit of s.citations) {
    console.log(`  ${cit.verdict}  ${cit.token} — ${cit.reason}${cit.receipt_url ? ` — ${cit.receipt_url}` : ''}`);
  }
  if (s.flags.length > 0) {
    console.log(`  ${s.flags.join('+')}  "${s.text.length > 60 ? s.text.slice(0, 57) + '…' : s.text}"`);
  }
}
