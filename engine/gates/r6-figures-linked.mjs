// R6, reversed check: a bare numeral found on a built screen with no link
// behind it fails CI. Scans every HTML file in app/dist and flags digit-only
// tokens (no ASCII letter: counts, dates, sizes, percentages) in rendered text
// that sit outside every allowed container. Allowed containers:
//   <a>           — the figure links to its evidence (the R6 contract)
//   <h1>          — the page's own title (a receipt page IS the evidence)
//   [data-meta]   — marked page metadata: the as-of date, the build commit
//   .quote .refusal .reason .rowmeta .prov .hash
//                 — verbatim record text and the hash block itself; figures
//                   inside quoted source sentences are the evidence, not claims
// <head>, <script> and <style> content is not rendered text.
// The gate needs a build: without app/dist it passes with a note, and CI runs
// the build before the gates so the rule is armed on every push.
import { existsSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { rootArg, walk, violation, note, lineOf } from './_lib.mjs';

const root = rootArg();
const dist = join(root, 'app', 'dist');
if (!existsSync(dist)) {
  note('no app/dist — build output not present; CI builds before gates so this scan runs there');
  process.exit(0);
}

const ALLOW_TAGS = new Set(['a', 'h1', 'head', 'script', 'style', 'title']);
const ALLOW_CLASSES = new Set(['quote', 'refusal', 'reason', 'rowmeta', 'prov', 'hash']);
const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const TAG_RE = /<\/?([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;

function bareNumeral(text) {
  // Entities carry no rendered digits we care about; alphanumeric tokens
  // (BTR1, SHA-256, doc ids, hashes) are names, not figures.
  for (const tok of text.replace(/&[a-zA-Z#0-9]+;/g, ' ').split(/\s+/)) {
    if (/[0-9]/.test(tok) && !/[a-zA-Z]/.test(tok)) return tok;
  }
  return null;
}

const pages = walk(dist).filter((p) => p.endsWith('.html'));
for (const file of pages) {
  const html = readFileSync(file, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const rel = relative(root, file).split(sep).join('/');
  const stack = []; // { tag, allowed: this element or an ancestor is allowed }
  let last = 0;
  for (const m of html.matchAll(TAG_RE)) {
    const text = html.slice(last, m.index);
    last = m.index + m[0].length;
    const inAllowed = stack.length > 0 && stack[stack.length - 1].allowed;
    if (!inAllowed) {
      const tok = bareNumeral(text);
      if (tok !== null) {
        violation(
          `R6: ${rel}:${lineOf(html, m.index)} bare numeral "${tok}" rendered outside a link — ` +
            'every displayed figure must link to its receipt or census row',
        );
      }
    }
    const tag = m[1].toLowerCase();
    const attrs = m[2] || '';
    if (m[0].startsWith('</')) {
      // pop to the matching open tag; tolerate stray closes
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag === tag) {
          stack.length = i;
          break;
        }
      }
    } else if (!VOID_TAGS.has(tag) && !attrs.trimEnd().endsWith('/')) {
      let allowed = inAllowed || ALLOW_TAGS.has(tag) || /\bdata-meta\b/.test(attrs);
      if (!allowed) {
        const cm = attrs.match(/\bclass\s*=\s*("([^"]*)"|'([^']*)')/);
        const classes = cm ? (cm[2] ?? cm[3]).split(/\s+/) : [];
        allowed = classes.some((c) => ALLOW_CLASSES.has(c));
      }
      stack.push({ tag, allowed });
    }
  }
  const tail = bareNumeral(html.slice(last));
  if (tail !== null) violation(`R6: ${rel} bare numeral "${tail}" rendered outside a link`);
}
note(`${pages.length} built page(s) scanned for unlinked figures`);
