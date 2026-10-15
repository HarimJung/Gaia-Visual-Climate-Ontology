# L1 key selection — KHM (first country)

Keys are adopted by counting, not asserting. Two count sets below: the predecessor pipeline's built data (read-only), and this repo's KHM ledger.

## Candidate keys and predecessor-side counts (measured 2026-10-15)

| candidate | count | verdict |
|---|---|---|
| ISO3 | 218 built country files: `iso3` unique **218/218**, filename == iso3 **218/218**; parties list 218 rows, `iso3` unique **218/218** | **adopted** country key |
| country name (English) | `name_en` unique 218/218 in the country files — but the predecessor needed hand-written name→ISO3 alias tables for both the treaty status list and the BTR listing (sources spell names differently) | display only, never a key |
| document URL | NDC latest-sources table: 146 rows, **146/146 distinct `document_url`**. Caveat: the `iso3` column there is an *array* — one row (the EU joint NDC) covers 27 member ISO3s | **adopted** document key; country↔document is many-to-one, so documents are keyed by URL + content sha256, never by country |
| file name / label | the KHM 2020 NDC bytes carry two labels ("First NDC" in the mirror filename, "Updated NDC" in the hand-read record) and three recorded URLs | not a key; the sha256 is the one stable identity of the bytes |

## Counts over this ledger (`engine/seed/countries/KHM/documents.csv`, counted 2026-10-15)

- rows: **7**
- `doc_id`: **7 distinct / 7 rows**
- `source_url`: **6 non-empty, 6 distinct** (1 empty: `khm-cait-2016` — no URL ever recorded; identified only by a cache CSV row)
- `sha256` non-empty: **5, 5 distinct** (empty: `khm-btr1` — no bytes held, listing-only; `khm-cait-2016` — no per-document hash)

Rows without a URL or without bytes stay in the ledger with `state = unknown` and a reason; they are listed, not citable as anchors.

## Adopted L1 keys

| entity | key |
|---|---|
| country | ISO3 |
| document | registry URL (`source_url`) |
| bytes | SHA-256 of the fetched file |
| build | run id + timestamp |

One document identity may be reachable through several URLs (the 2020 NDC has registry-era, current-registry and mirror URLs); the current registry URL is the key, the others live in `note`, and the sha256 ties them to one set of bytes.
