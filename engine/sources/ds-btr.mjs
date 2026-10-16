// ds-btr: BTR submission PRESENCE from the git tree of the
// JGuetschow/UNFCCC_non-AnnexI_data mirror (via gh api for rate limits).
// Doctrine (predecessor's): presence only — a folder in the mirror proves a
// submission exists (submitted: true); absence proves nothing (null), NEVER
// false; filename status words carry no evidence. Run from the repo root:
//   node engine/sources/ds-btr.mjs [--force]
import { pathToFileURL } from 'node:url';
import { rootArg } from '../gates/_lib.mjs';
import { assertLicensed, ghApiBytes, hasFlag, loadContract, snapshot, writeCanon, writeManifest } from './_base.mjs';

export function parseBtrTree(tree, { tree_prefix, folder_pattern }) {
  if (tree.truncated) {
    throw new Error('git tree response is truncated — the listing is incomplete, refusing to parse');
  }
  if (!Array.isArray(tree.tree)) throw new Error('git tree response has no "tree" array');
  const folderRe = new RegExp(folder_pattern, 'i');
  const parties = new Map();
  for (const e of tree.tree) {
    if (e.type !== 'blob' || typeof e.path !== 'string' || !e.path.startsWith(tree_prefix)) continue;
    const parts = e.path.slice(tree_prefix.length).split('/');
    if (parts.length < 3) continue; // need <party folder>/<submission folder>/<file>
    const [folder, submission, ...rest] = parts;
    if (!parties.has(folder)) parties.set(folder, new Map());
    if (!folderRe.test(submission)) continue;
    const subs = parties.get(folder);
    if (!subs.has(submission)) subs.set(submission, []);
    subs.get(submission).push(rest.join('/'));
  }
  return [...parties.keys()].sort().map((folder) => {
    const subs = parties.get(folder);
    const names = [...subs.keys()].sort();
    return {
      party_folder: folder,
      btr:
        names.length === 0
          ? null
          : Object.fromEntries(names.map((n) => [n, { submitted: true, files: subs.get(n).sort() }])),
    };
  });
}

async function main() {
  const root = rootArg();
  const id = 'btr-listing';
  const contract = loadContract(root, id);
  assertLicensed(root, contract.license_id ?? id);
  const snap = await snapshot(root, contract.url, id, 'tree.json', contract.success_criteria, {
    force: hasFlag('--force'),
    getBytes: () => ghApiBytes(contract.gh_api_path),
  });
  const parties = parseBtrTree(JSON.parse(snap.bytes.toString('utf8')), contract);
  const withBtr = parties.filter((p) => p.btr !== null).length;
  writeCanon(root, id, {
    source_id: id,
    snapshot_sha256: snap.meta.sha256,
    retrieved_at: snap.meta.retrieved_at,
    stale: snap.stale ? { reason: snap.meta.stale_reason, marked_at: snap.meta.stale_marked_at } : null,
    party_folder_count: parties.length,
    with_btr_count: withBtr,
    parties,
  });
  writeManifest(root, id);
  console.log(
    `${id}: ${parties.length} party folders, ${withBtr} with a submission folder present` +
      `${snap.reused ? ' (snapshot reused)' : ''}${snap.stale ? ` STALE: ${snap.meta.stale_reason}` : ''}`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
