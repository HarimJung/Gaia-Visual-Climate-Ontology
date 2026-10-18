// R18: no motion on figures. A number here is a quoted record with a receipt
// behind it, never an effect — a count-up, a tweened readout or a sweeping
// gauge stages a quantity the record never claimed. The two mechanisms that
// produce one fail CI:
//   1. a formatted number written into the page inside an animation loop
//      (a requestAnimationFrame or setInterval callback)
//   2. a CSS @property typed <number>/<integer> — the animatable-counter trick
// Scope is app/src, the code we author. Build-time arithmetic in a style
// attribute is layout, not motion, and is left alone; so is a count that
// changes because the reader filtered the table.
import { readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { rootArg, walk, violation, note, lineOf } from './_lib.mjs';

const root = rootArg();
const LOOP = /\b(?:requestAnimationFrame|setInterval)\s*\(/g;
const WRITE = /\.(?:textContent|innerText|innerHTML)\s*=/;
const FORMAT = /\b(?:toFixed|toLocaleString|Math\.round|Number\s*\()/;
const CSS_NUMBER_PROPERTY = /@property[^{]*\{[^}]*syntax\s*:\s*['"]\s*<(?:number|integer)>/g;

// ponytail: paren counting ignores strings and regex literals. Worst case the
// body over-reads and the gate complains loudly — it never goes quiet.
function callBody(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')' && --depth === 0) return text.slice(open, i);
  }
  return text.slice(open);
}

let scanned = 0;
let loops = 0;
for (const file of walk(join(root, 'app', 'src'))) {
  if (!/\.(astro|mjs|js|ts|css)$/.test(file)) continue;
  const rel = relative(root, file).split(sep).join('/');
  const text = readFileSync(file, 'utf8');
  scanned++;
  for (const m of text.matchAll(LOOP)) {
    loops++;
    const body = callBody(text, m.index + m[0].length - 1);
    if (WRITE.test(body) && FORMAT.test(body)) {
      violation(
        `R18: ${rel}:${lineOf(text, m.index)} formats a number into the page inside an animation loop — ` +
          'figures are quoted from the record, never animated',
      );
    }
  }
  for (const m of text.matchAll(CSS_NUMBER_PROPERTY)) {
    violation(
      `R18: ${rel}:${lineOf(text, m.index)} declares an animatable <number> custom property — ` +
        'the CSS count-up trick; figures are quoted from the record, never animated',
    );
  }
}
note(`${scanned} front file(s) and ${loops} animation loop(s) scanned`);
