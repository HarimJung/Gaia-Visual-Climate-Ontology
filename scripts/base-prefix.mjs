// Prefix every root-relative URL in the built site with the deploy's base
// path. GitHub project Pages serve from /<repo>/, and this site is authored
// root-relative, so the prefix is applied once over the built output instead
// of threaded through sixty link sites where one miss is a dead page.
// No SITE_BASE in the environment → nothing to do, and the local build and
// the root-domain deploy are byte-identical to what they were.
//
// What counts as a URL to prefix is read from the built output itself: the
// top-level names in app/dist. That way a new section cannot be missed, and
// nothing that merely looks like a path (a quoted sentence, a hash) is moved.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootArg = process.argv.indexOf('--root');
const root = rootArg !== -1 && process.argv[rootArg + 1]
  ? resolve(process.argv[rootArg + 1])
  : resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'app', 'dist');
const base = (process.env.SITE_BASE || '').replace(/\/+$/, '');

if (!base) {
  console.log('base-prefix: no SITE_BASE — output left root-relative');
  process.exit(0);
}
if (!base.startsWith('/')) {
  console.error(`base-prefix: SITE_BASE must start with "/" (got ${JSON.stringify(process.env.SITE_BASE)})`);
  process.exit(1);
}
if (!existsSync(dist)) {
  console.error('base-prefix: app/dist is missing — build first');
  process.exit(1);
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const tops = readdirSync(dist).map((n) => esc(n)).join('|');
// "/section…" inside an attribute, a CSS url() or an island's JSON value.
const PATH = new RegExp(`(["'(])/(${tops})(?=[/"'?#)])`, 'g');
// the home link, which is just "/"
const HOME = /(["'])\/(["'])/g;

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(html|css|js|mjs|json)$/.test(e.name)) out.push(p);
  }
  return out;
}

let files = 0;
let hits = 0;
for (const file of walk(dist)) {
  const text = readFileSync(file, 'utf8');
  let n = 0;
  const out = text
    .replace(PATH, (_, q, seg) => { n++; return `${q}${base}/${seg}`; })
    .replace(HOME, (_, a, b) => { n++; return `${a}${base}/${b}`; });
  if (n > 0) {
    writeFileSync(file, out);
    files++;
    hits += n;
  }
}
console.log(`base-prefix: ${hits} url(s) moved under ${base}/ across ${files} file(s)`);
