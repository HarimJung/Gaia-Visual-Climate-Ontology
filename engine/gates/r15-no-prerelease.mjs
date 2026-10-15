// R15: no prerelease dependencies (alpha/beta/rc/next). Installs are
// lockfile-exact; a dependency you cannot pin stable is a defect.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { rootArg, violation, note } from './_lib.mjs';

const root = rootArg();
const PRE = /-(alpha|beta|rc)(\b|[.\d])/i;
const bad = (v) => typeof v === 'string' && (PRE.test(v) || v.trim() === 'next');

function checkDepMaps(obj, file, where) {
  for (const key of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    const d = obj?.[key];
    if (!d || typeof d !== 'object') continue;
    for (const [name, spec] of Object.entries(d)) {
      if (typeof spec === 'string') {
        if (bad(spec)) violation(`R15: ${file}: prerelease specifier ${name}@${spec} (${where}${key})`);
      } else if (spec && typeof spec === 'object') {
        walkNode(spec, file, `${where}${key}.${name}.`);
      }
    }
  }
}

function walkNode(node, file, where) {
  if (!node || typeof node !== 'object') return;
  if (bad(node.version)) violation(`R15: ${file}: prerelease version ${node.version} (${where || 'root'})`);
  checkDepMaps(node, file, where);
  if (node.packages && typeof node.packages === 'object') {
    for (const [name, entry] of Object.entries(node.packages)) {
      walkNode(entry, file, `packages[${name || 'root'}].`);
    }
  }
}

for (const f of ['package.json', 'package-lock.json']) {
  const p = join(root, f);
  if (!existsSync(p)) {
    note(`note: no ${f} at this root`);
    continue;
  }
  let j;
  try {
    j = JSON.parse(readFileSync(p, 'utf8'));
  } catch (e) {
    violation(`R15: ${f} unreadable: ${e.message}`);
    continue;
  }
  walkNode(j, f, '');
}
