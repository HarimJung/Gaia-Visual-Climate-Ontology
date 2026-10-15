# Gaia Visual Climate Ontology

The National Climate Record Runtime: a build pipeline that turns source snapshots and
seed CSVs into an anchored, verifiable national climate record. Every vocabulary term,
rule, and published value is machine-checked; nothing ships on trust.

**Status: S0 — design stage, nothing running.** This repository currently holds the
codegen pipeline, the machine gates, and the mutation harness that proves each gate
catches what it claims to catch. No app, no pipeline runs.

## Running the checks

```
npm ci
npm test          # mutation harness: every gate must detect its planted violation
npm run gates     # run all gates against this repository
npm run codegen   # regenerate engine/generated/ from engine/seed/platform/
```

- Gates live in `engine/gates/`, one file per rule; `engine/gates/run.mjs` runs them
  all and prints a one-line-per-failure digest.
- Source adapter contract shape: `docs/CONTRACTS.md`.
- Operational requirements (not claims): `docs/OPERATIONS.md`.
- Golden files, once they exist, change only via `tools/update-golden.mjs --reason "<text>"`.
