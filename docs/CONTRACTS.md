# Source contracts (R14)

Every source adapter ships a contract at `engine/sources/contracts/<source_id>.json`.
The `r14-source-contracts` gate validates every contract file on every run.

Required shape:

```json
{
  "source_id": "registry",
  "url": "https://example.org/registry.csv",
  "staleness_budget_days": 30,
  "success_criteria": {
    "min_bytes": 50000,
    "format": "csv"
  }
}
```

- `staleness_budget_days` — the maximum allowed age of the latest successful
  snapshot. A source past budget is surfaced as first-class state on records and
  public screens ("this source unreachable for N weeks"), not hidden in logs.
- `success_criteria` — fetch success is judged by **bytes** (size floor plus
  format), never by HTTP status. The predecessor accepted a 200 response that was
  a 212-byte bot-check page; under this contract that fetch is a failure.
  Formats: `pdf` (starts `%PDF-`, contains `%%EOF`), `json` (parses), `csv`
  (first line equals the optional `csv_header`), `docx` (starts with the zip
  magic `PK\x03\x04`).

Contracts may carry extra source-specific fields the adapter reads (document
lists, API paths, tree prefixes, per-document criteria); the gate checks the
required core.

## The WP-03 contracts

| source_id | what | budget | why |
|---|---|---|---|
| `registry` | NDC registry index (openclimatedata/ndcs mirror, synced from the registry) | 30d | new NDC submissions land continuously; a month-old index misses them |
| `btr-listing` | BTR presence from the UNFCCC_non-AnnexI_data git tree | 60d | research mirror, updated in batches around submission waves |
| `untc` | UN Treaty Collection depositary status PDFs (Chapter XXVII) | 90d | treaty actions are rare events; the depositary list changes a few times a year |
| `ndc-docs` | NDC document bytes (national-climate-plans mirror) | 30d | follows the registry index it serves |
| `ndc-wayback` | NDC document bytes from **existing** Wayback captures (second byte source for rows the mirror cannot serve) | 30d | follows the registry index it backfills; a re-query can only find captures that already exist |

`ndc-wayback` reads existing public captures only — one CDX index lookup per
document URL, then the `id_` raw-byte replay. It never triggers Save Page Now
and never live-proxies unfccc.int. On top of the byte checks, the fetched
bytes' SHA-1 (base32) is verified against the CDX row's digest where one is
recorded. A document with no existing 200-capture ends as an honest
`failed / no-archive-capture` outcome in `data/sources/ndc-docs.json`.

## Adapter invariants (engine/sources/)

- **License gate first**: every adapter reads `data/licenses.csv` and refuses
  to fetch a source whose `use_allowed` is not `yes` /
  `yes-no-redistribution`, printing the register row. No register, no fetch.
  The contract's `license_id` names the register row (register ids are the
  license register's own canon; the contract carries the mapping).
- **Snapshots**: bytes land at `data/cache/<source_id>/<filename>` with a
  sidecar `<filename>.meta.json` `{url, sha256, retrieved_at, size_bytes}`.
  The cache is gitignored (R12); what gets committed are the manifests
  (`data/manifests/<source_id>.json`, built from the sidecars) and the parsed
  canon (`data/sources/<source_id>.json`).
- **Refresh failure keeps the last good snapshot** and marks its sidecar stale
  with the reason; a valid cached file (sha256 matches its sidecar) is reused
  without refetching unless `--force`.
- **Politeness**: ≥1s gap per host, transient retries on a 2s/10s/30s ladder,
  a descriptive User-Agent naming the project and repo.
- unfccc.int sits behind a WAF and is **never** fetched; every byte comes from
  the proven public mirrors (openclimatedata on GitHub, treaties.un.org,
  JGuetschow/UNFCCC_non-AnnexI_data).
