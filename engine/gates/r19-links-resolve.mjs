// R19: every internal link in the built site resolves to something that was
// actually built. A canonical that pointed at a path which does not exist
// shipped on 1,762 pages before anyone looked; a dead link is the same class
// of defect, and the deploy's base path is where it will happen next.
// Scans href/src on every built page, skips external, mail and in-page
// anchors, strips the deploy base, and resolves the rest against app/dist —
// a directory URL resolving to its index.html, as a static host serves it.
// The base is read from the home page's own canonical rather than from the
// environment, so the links and the canonical are checked against each other:
// if a build moves one and not the other, this gate is where it stops.
import { existsSync, statSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { rootArg, walk, violation, note } from './_lib.mjs';

const root = rootArg();
const dist = join(root, 'app', 'dist');
if (!existsSync(dist)) {
  note('no app/dist — build output not present; CI builds before the gates so this scan runs there');
  process.exit(0);
}

const URL_ATTR = /\b(?:href|src)="([^"]+)"/g;

function deployBase() {
  const home = join(dist, 'index.html');
  if (!existsSync(home)) return '';
  const m = /<link rel="canonical" href="([^"]+)"/.exec(readFileSync(home, 'utf8'));
  if (!m) return '';
  try {
    return new URL(m[1]).pathname.replace(/\/+$/, '');
  } catch {
    return '';
  }
}
const base = deployBase();

function resolves(url) {
  const path = url.split('#')[0].split('?')[0];
  if (path === '') return true;
  if (base && !path.startsWith(`${base}/`)) return false;
  const rel = (base ? path.slice(base.length) : path).replace(/^\/+/, '');
  const target = join(dist, rel);
  if (!existsSync(target)) return false;
  return statSync(target).isDirectory() ? existsSync(join(target, 'index.html')) : true;
}

let pages = 0;
let links = 0;
const dead = new Map(); // url → first page it was seen on
for (const file of walk(dist)) {
  if (!file.endsWith('.html')) continue;
  pages++;
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(URL_ATTR)) {
    const url = m[1];
    if (!url.startsWith('/')) continue; // external, mailto, #anchor, relative
    links++;
    if (!resolves(url) && !dead.has(url)) dead.set(url, relative(root, file).split(sep).join('/'));
  }
}

for (const [url, where] of [...dead].slice(0, 20)) {
  violation(`R19: ${where} links to ${url}, which is not in the built site${base ? ` under base ${base}` : ''}`);
}
if (dead.size > 20) violation(`R19: ${dead.size - 20} further dead link target(s) not listed`);
note(`${links} internal link(s) on ${pages} built page(s) resolve${base ? ` under base ${base}` : ''}`);
