# Gaia Visual Climate Ontology

The National Climate Record Runtime: a build pipeline that turns source snapshots and
seed CSVs into an anchored, verifiable national climate record. Every vocabulary term,
rule, and published value is machine-checked; nothing ships on trust.

**Status: pilot.** The engine core runs end to end: committed source snapshots
(UNFCCC NDC registry, UN Treaty Collection status lists, transparency-report
listings, NDC document bytes) are assembled into a global graph — one record row
per claim, each carrying an epistemic state (`observed | pledged | unknown |
absent`) and either a full anchor (source id + SHA-256 + locator) or a reason.
A single reader produces one view JSON per country plus a world index, and the
static site builds every country page from those views alone. What the runtime
has not read is recorded as `unknown`/`absent` with its reason — never guessed,
never ranked, never scored. The authoring path (docx in → deterministic
judgement → docx annotations out, WP-08) and the national legal layer are not
built yet; the legal layer stays `manual · as-of dated` until a named source
and cadence exist (AD-13).

## Pipeline

```
npm ci
npm run codegen       # engine/seed/platform/ → engine/generated/ (R2: vocabulary single source)
npm run graph         # data/sources/ + seeds → data/graph/ (R3/R5; blocks on any unresolved row)
npm run verify        # every anchor_sha256 traced to a held input; cached bytes re-hashed
npm run build:views   # data/graph/ → data/views/ via the one reader (R11)
npm run build         # static site from the views alone
npm test              # mutation harness: every gate must catch its planted violation
npm run gates         # all machine gates against this repository
node engine/diff/diff.mjs <from> <to>   # structural diff of two builds (R9: stale is never stored)
```

Builds are deterministic: the same inputs produce byte-identical CSVs, views and
build id (SHA-256 over the graph bytes). The wall clock appears only as
`built_at`, outside the hashed bytes.

- Gates live in `engine/gates/`, one file per rule; `engine/gates/run.mjs` runs them
  all and prints a one-line-per-failure digest.
- Source adapter contract shape: `docs/CONTRACTS.md`. Source licenses: `docs/LICENSES.md`.
- Authoring verification (citation grammar, verdicts, .docx CLI): `docs/AUTHORING.md`.
- Operational requirements (not claims): `docs/OPERATIONS.md`.
- Golden files, once they exist, change only via `tools/update-golden.mjs --reason "<text>"`.

Publishing is a CI-only path (R8/AD-11); this repository documents no manual
deploy command on purpose.
