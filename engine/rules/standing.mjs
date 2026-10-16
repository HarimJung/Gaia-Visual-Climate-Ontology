// Derivation rules (R3): general rules only — no instance logic (R1), no
// machine verdicts (R4). Derived rows never enter base.csv; the builder writes
// them to derived.csv with the rule name in derived_rule.
//
// standing-v1: a treaty action observed in the depositary status list makes
// the subject a party to that treaty; a signature observed without an action
// leaves it signed-not-ratified. The standing values come from the generated
// vocabulary facet (R2); the anchor is inherited from the row that decided.

export const RULE = 'standing-v1';

export function derive(base, vocab) {
  const standings = (vocab.facet_values?.['FACET-PARTY-STANDING'] ?? []).map((v) => String(v).toLowerCase());
  const want = (v) => {
    if (!standings.includes(v)) throw new Error(`rule ${RULE} needs standing "${v}" in the generated vocabulary`);
    return v;
  };
  const re = /^treaty\.([^.]+)\.(action|signature)\.date$/;
  const groups = new Map(); // iso3 + treaty -> decisive rows
  for (const r of base) {
    const m = re.exec(r.record_key);
    if (!m) continue;
    const k = `${r.iso3}\u0000${m[1]}`;
    if (!groups.has(k)) groups.set(k, { iso3: r.iso3, treaty: m[1] });
    if (r.state === 'observed' && r.value) groups.get(k)[m[2]] = r;
  }
  const out = [];
  for (const g of groups.values()) {
    const basis = g.action ?? g.signature;
    if (!basis) continue;
    out.push({
      iso3: g.iso3,
      record_key: `treaty.${g.treaty}.standing`,
      value: g.action ? want('party') : want('signed-not-ratified'),
      state: 'observed',
      reason: '',
      anchor_kind: basis.anchor_kind,
      anchor_source_id: basis.anchor_source_id,
      anchor_sha256: basis.anchor_sha256,
      anchor_locator: basis.anchor_locator,
      retrieved_at: basis.retrieved_at,
      derived_rule: RULE,
    });
  }
  return out;
}
