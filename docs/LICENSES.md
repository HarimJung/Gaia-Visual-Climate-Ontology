# License register

No external asset is used before its row exists in `data/licenses.csv`. The
register holds our own summaries only — never verbatim clause text. A source
whose terms cannot be read, or are ambiguous, is recorded that way
(`blocked-pending` or `yes-no-redistribution`), never guessed.

`use_allowed` values:

- `yes` — ingest and public mirror in release assets both permitted.
- `yes-no-redistribution` — ingest permitted (snapshot + hash + parse); the
  bytes stay in `data/cache/` (uncommitted) plus committed SHA-256 manifests
  and durable private storage. **No public mirror in release assets.**
- `blocked-pending` — not used at all until terms are verified.
- `no` — not used.

All verifications below were done live on 2026-10-15 (GitHub API via `gh`,
terms pages via direct fetch), except where a row says the page could not be
reached.

## openclimatedata/ndcs — `yes-no-redistribution`

Verified 2026-10-15 via the GitHub API: the repo has **no LICENSE file**
(license endpoint 404, repo metadata `license: null`). The README's License
section covers only the Python files in `scripts/` (CC0-1.0). The data files
(`data/ndcs.csv`, `data/ndcs.json`) carry no stated license;
`datapackage.json` has no `licenses` field and names the UNFCCC NDC Registry
as its source.

What it is: a daily-updated index of the UNFCCC NDC registry — party codes,
document titles, submission dates, original document URLs. Factual metadata.

Our use: snapshot + hash + parse of the index to drive country/document
discovery. **Redistribution of the index bytes in a GitHub release is not
permitted** by anything we could verify (the data is unlicensed), so the
bytes stay in cache + manifests only.

## openclimatedata/national-climate-plans — `yes-no-redistribution`

Verified 2026-10-15 via the GitHub API: **ARCHIVED** — the README opens with
"this repository is no longer updated" and points to `openclimatedata/ndcs`.
No LICENSE file; the README licenses only `scripts/` (CC0-1.0). The `pdfs/`
corpus mirrors one main NDC/INDC document per party (English where
available); these are government documents submitted to the UNFCCC, and the
repo asserts no license over them.

Our use: a byte mirror for document fetches (snapshot + hash + parse). The
archived status is a standing staleness caveat: it can prove old bytes, never
current registry state. **No public mirror in release assets** — the PDFs'
reuse terms belong to their submitting governments/UNFCCC, not this repo.

## JGuetschow/UNFCCC_non-AnnexI_data — `yes`

Verified 2026-10-15 via the GitHub API license endpoint: **Apache-2.0**
(LICENSE file at repo root, SPDX `Apache-2.0`). The expectation held, and was
verified rather than assumed.

What it is: code plus processed datasets bringing non-AnnexI GHG submissions
into machine-readable form. The underlying numbers are Party submissions to
the UNFCCC.

Our use: snapshot + hash + parse of its processed data. **Redistributing
repo-derived files in a GitHub release is permitted** under Apache-2.0,
provided we keep attribution and the license text alongside the mirrored
files.

## UN Treaty Collection (treaties.un.org) — `yes-no-redistribution`

Verified 2026-10-15: treaties.un.org's own Terms page contains no terms — it
links to the UN main-site Terms of Use and Copyright pages, both of which we
fetched live. In our words: the general terms permit downloading and copying
materials for personal, non-commercial use; resale, redistribution and
derivative works require written permission; the copyright page states the
UN reserves all rights.

Our use: fetch the MTDSG status PDFs (depositary's own `.en.pdf` status
lists), hash them, and extract non-copyrightable facts — signature,
ratification, accession dates per party. **No public mirror of the PDFs in
release assets**; bytes stay in cache + committed manifests + durable private
storage as anchor evidence.

## UNFCCC (unfccc.int) — `yes-no-redistribution`

**The live terms page could not be read.** Two direct fetch attempts on
2026-10-15 (`unfccc.int/this-site/terms-of-use`, `www.unfccc.int/terms-of-use`)
returned empty bodies — consistent with the site's WAF, which we do not work
around. What we know of the terms comes from search-engine extracts only: the
main site describes personal, non-commercial use with reproduction otherwise
requiring written permission; separate COP-platform pages describe official
texts and documents as public domain with attribution and no alteration, but
we could not verify that statement applies to the main site or to registry
documents.

The NDC/BTR documents themselves are Party submissions published for public
access; our bytes come via the proven public mirrors registered above, never
by working around the WAF.

Our use: snapshot + hash + parse. Because the governing terms were not
readable live, the honest setting is `yes-no-redistribution`: **no public
mirror of document bytes in release assets**; cache + manifests + durable
private storage only. If the terms page becomes readable and permits more,
update the row with a new `verified_date`.

## Internet Archive Wayback Machine (web.archive.org) — `yes-no-redistribution`

Verified 2026-10-15. The live terms page (`archive.org/about/terms.php`)
serves only a JavaScript application shell to a plain fetcher, so the terms
text was read from an **existing Wayback capture of that same URL**
(timestamp `20241128004511`) — the same read-only pattern the runtime uses.
In our words: the Terms of Use (dated 31 Dec 2014) grant access to the
Collections for scholarship and research purposes; use must be limited to
noninfringing or fair use under copyright law; rights in archived content
remain with its original publishers.

Our use: **read-only access to existing public captures** as a second byte
source for registry documents the openclimatedata mirror cannot serve — a
CDX index lookup per document URL, then the `id_` raw-byte replay of an
already-archived capture. We never trigger Save Page Now and never use the
archive as a live proxy of unfccc.int or any other origin. The replayed
bytes are UNFCCC Party submissions, so the `unfccc` row above also governs
them: cache + committed SHA-256 manifests + durable private storage only,
**no public mirror in release assets**.

## OECD — `blocked-pending` (NOT INGESTED)

Not used by the runtime. The terms URL
(`oecd.org/en/about/terms-conditions.html`) returned HTTP 403 to our fetcher
on 2026-10-15, so nothing is verified. No OECD content is fetched, parsed or
stored until the terms are verified and the row is updated.

## Climate Policy Radar / LSE climate-laws.org — `blocked-pending` (NOT INGESTED)

Not used by the runtime. The terms URL served only a cookie-consent notice on
2026-10-15; the full terms were not retrieved. No climate-laws.org or Climate
Policy Radar content is fetched, parsed or stored until the terms are
verified and the row is updated.

## House-kit webfonts (Bricolage Grotesque, Hanken Grotesk, IBM Plex Mono) — `yes`

The product screens (`app/`) serve three font families as woff2, copied from
the Visual Climate house kit together with their SIL Open Font License 1.1
texts (`app/public/fonts/OFL*.txt`, one per foundry). OFL 1.1 permits
bundling and redistribution as long as the fonts are not sold on their own
and the license text travels with them; it does, in the same directory the
pages load them from.

## Natural Earth 1:110m base map — `yes`

Verified 2026-10-16: Natural Earth's terms-of-use page dedicates all versions
of its vector and raster map data to the **public domain** — no permission
needed for any use, commercial or otherwise.

Our use: the admin-0 country shapes, projected to Equal Earth at the frozen
predecessor's build time and ported here as `app/public/data/basemap.json`
(the attribution string is embedded in the file itself). It is a base map,
not a measurement: no figure on any screen is derived from it.

## ashemag/human-atlas — `yes` (MIT)

Verified 2026-10-16: MIT license. The desk-spread packing layout is adapted
into `app/src/lib/scene/explosion-layout.mjs` for the instrument's laid-flat
chapter, and the MIT license text ships verbatim beside the adapted module as
`app/src/lib/scene/HUMAN-ATLAS-LICENSE`, satisfying the notice-preservation
condition.
