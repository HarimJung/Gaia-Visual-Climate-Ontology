// R10: authoring verdicts come from deterministic parsing only — the model
// never enters the judgment path. Enforced as a static scan of engine/author/:
// no network clients, no model/SDK imports, no randomness, no wall clock.
// Same input, same build, same verdict — the reproducibility tests hold the
// behavioral half; this gate holds the import/door half.
// Known limit: the scan reads literal import/require specifiers only — a
// dynamic import(expr) with a computed specifier is invisible to it. The
// behavioral determinism tests carry that half.
import { existsSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { rootArg, walk, violation, note, lineOf } from './_lib.mjs';

const root = rootArg();
const dir = join(root, 'engine', 'author');
if (!existsSync(dir)) {
  note('no engine/author — nothing to scan');
  process.exit(0);
}

// import x from '…' · import '…' · import('…') · require('…')
const IMPORT_RE = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)(['"])([^'"\n]+)\1/g;
const BANNED_SPEC =
  /^(node:)?(http|https|http2|net|tls|dns|dgram|child_process|worker_threads)$|undici|axios|node-fetch|got|openai|anthropic|langchain|llama|ollama|cohere|mistral|gemini|bedrock|vertexai/i;
const PATTERNS = [
  [/\bfetch\s*\(/, 'network call (fetch)'],
  [/\bXMLHttpRequest\b|\bWebSocket\b|\bEventSource\b/, 'network client'],
  [/\bMath\.random\b/, 'nondeterministic randomness'],
  [/\bDate\.now\s*\(/, 'wall clock'],
  [/\bnew\s+Date\s*\(\s*\)/, 'wall clock (zero-argument Date)'],
  [/\bprocess\.hrtime\b|\bperformance\.now\b/, 'wall clock'],
];

let scanned = 0;
for (const file of walk(dir)) {
  if (!/\.(ts|js|mjs)$/.test(file)) continue;
  scanned++;
  const text = readFileSync(file, 'utf8');
  const rel = relative(root, file).split(sep).join('/');
  for (const m of text.matchAll(IMPORT_RE)) {
    if (BANNED_SPEC.test(m[2])) {
      violation(
        `R10: ${rel}:${lineOf(text, m.index)} imports "${m[2]}" — ` +
          'no network, process or model/SDK imports in the judgment path; verdicts are deterministic lookups only',
      );
    }
  }
  for (const [re, what] of PATTERNS) {
    const m = re.exec(text);
    if (m) {
      violation(
        `R10: ${rel}:${lineOf(text, m.index)} ${what} — ` +
          'same input must yield the same verdict; time, randomness and the network are banned here',
      );
    }
  }
}
if (process.exitCode !== 1) {
  note(`${scanned} author file(s) hold R10: deterministic parsing only, model and network quarantined`);
}
