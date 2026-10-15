// R14: every source carries a contract with a staleness budget and byte-based
// success criteria. Success is judged by bytes, never by HTTP status (the
// predecessor accepted a 200 that was a 212-byte bot-check page).
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { rootArg, violation, note } from './_lib.mjs';

const root = rootArg();
const dir = join(root, 'engine', 'sources', 'contracts');
const files = existsSync(dir)
  ? readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
  : [];

if (files.length === 0) {
  note('note: no source contracts yet — WP-03 adds them (shape: docs/CONTRACTS.md)');
} else {
  for (const f of files) {
    const rel = `engine/sources/contracts/${f}`;
    let c;
    try {
      c = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    } catch (e) {
      violation(`R14: ${rel} is not valid JSON: ${e.message}`);
      continue;
    }
    if (typeof c.source_id !== 'string' || !c.source_id) violation(`R14: ${rel} missing source_id (string)`);
    if (typeof c.url !== 'string' || !c.url) violation(`R14: ${rel} missing url (string)`);
    if (typeof c.staleness_budget_days !== 'number') {
      violation(`R14: ${rel} missing staleness_budget_days (number)`);
    }
    const s = c.success_criteria;
    if (!s || typeof s !== 'object') {
      violation(`R14: ${rel} missing success_criteria`);
    } else {
      if (typeof s.min_bytes !== 'number') {
        violation(`R14: ${rel} success_criteria.min_bytes must be a number — success is judged by bytes, not HTTP status`);
      }
      if (typeof s.format !== 'string' || !s.format) {
        violation(`R14: ${rel} success_criteria.format missing (string)`);
      }
    }
  }
  note(`${files.length} source contract(s) checked`);
}
