# Legislation access — Cambodian climate-relevant law in English

As of 2026-10-15. The predecessor pipeline holds **zero legislation** for KHM: its record contract has no legislation or institution block, and the only institution string anywhere in its KHM data is `"UNFCCC / RGC-NCSD"` in a sources index. This memo resolves whether, and how, Cambodian climate-relevant law can enter the record in English.

## The baseline fact

**Cambodia publishes no official English translations of its statutes.** Laws and government notices are published in Khmer in the official journal (the Royal Gazette, *Rājkicc*); legal research guides are explicit that English translations of Cambodian laws are not official (treaty texts excepted) ([Law Library of Congress](https://blogs.loc.gov/law/2014/07/cambodian-law-global-legal-collection-highlights/), [University of Akron guide](https://libguides.uakron.edu/cambodianlaw/legislation), [Loyola Chicago guide](https://lawlibguides.luc.edu/foreignlegalresearch/cambodia)). The Khmer original is the sole authoritative text of any Cambodian law.

## Candidate sources, surveyed

| source | URL | what it actually holds for Cambodia | language(s) | official English? | update cadence |
|---|---|---|---|---|---|
| Royal Gazette (Council of Ministers) | no official portal found; third-party index: https://kamnotra.io/en/gazetteer/ | the authoritative enacted texts, published monthly as non-searchable scanned PDFs, with roughly a six-month lag after signing | Khmer only | no English at all | monthly, ~6-month lag |
| Ministry of Environment / NCSD | https://ncsd.moe.gov.kh | government-published English *policy and reporting* documents: Updated NDC 2020 (EN, 158 pp), BUR1 (EN, 207 pp), CPER 2022, KAP studies. **Not a statute database** — no gazette texts | Khmer + English (its own publications) | yes, for its own publications — these are the only government-issued English climate texts found | ad hoc; not knowable |
| UNEP LEAP / InforMEA | https://leap.unep.org/en/countries/kh/national-legislation · https://www.informea.org/en/countries/KH/legislation | ~414 national legislation entries, incl. the [Environment and Natural Resources Code (NS/RKM/0623/007, 2023, 865 arts.)](https://leap.unep.org/en/countries/kh/national-legislation/code-environment-and-natural-resources), the [sub-decree creating the national climate change committee](https://leap.unep.org/en/countries/kh/national-legislation/sub-decree-no-35-creation-national-committee-managing-climate), the NCSD establishment decision | English metadata; full texts vary | no — LEAP lists English as "source language" for the Code but names no translator or certification; treat as unofficial | continuous aggregation; per-country lag not knowable |
| FAOLEX | https://www.fao.org/faolex (Cambodia profile) | legislation + policy records; 2025 Cambodia entries include NDC 3.0, National Action Plan on Drought Management 2025–2030, Climate Resilient IWRM Action Plan 2026–2030 | English metadata; full texts per record are English, Khmer/English, or Khmer-only (the "Full text" field states which) | no — full-text English where present is unofficial | continuous; per-country lag not knowable |
| ECOLEX | https://www.ecolex.org | Cambodian legislation records largely sourced from FAOLEX (LEX-FAOC ids); same holdings, same language pattern | as FAOLEX | no | follows FAOLEX |
| LSE Grantham / Sabin — Climate Change Laws of the World | https://climate-laws.org | [Code of Environment and Natural Resources (2023)](https://climate-laws.org/document/code-of-environment-and-natural-resources_8c8c) with a researcher-written summary, plus Cambodia's UNFCCC submissions (BTR1, BUR1) and CBD NR7. Entries carry an explicit accuracy caveat | English (summaries) | no — third-party summaries, not texts of law | maintained database; per-entry update dates shown (Code entry last updated 2023-06-13) |
| Open Development Cambodia / Mekong | https://data.opendevelopmentcambodia.net/dataset/royal-kram-no-0623-007-on-environment-and-natural-resources-code | Khmer original **and an English resource** of Royal Kram No. 0623/007 (English record dated 2024-07-15, "License not specified"); also the older draft Code and the 1996 UNFCCC-approval law | Khmer + English | no — translator and provenance unstated; unofficial until confirmed | ad hoc NGO aggregation |

## Honest limits

- The central climate-relevant statute — the Environment and Natural Resources Code 2023 — circulates in English only through third parties (ODC, LEAP), with unstated translation provenance and unspecified license. No government English text of any statute was found.
- English availability is per-record luck, not a regime: some sub-decrees have English full text in FAOLEX, others are Khmer-only.
- The gazette itself is scanned Khmer PDFs; any OCR/segmentation of Khmer is non-deterministic (AD-3), and no Khmer extractor exists in this stack (AD-13 rationale, O-F5).

## Conclusion (per AD-13)

Legislation enters the record at the **manual · as-of dated · quarterly review** tier, and the screen shows that tier as-is. Concretely:

1. **Steward checklist (quarterly):** UNEP LEAP / InforMEA Cambodia listing, FAOLEX Cambodia profile, and the NCSD publications page for new climate instruments; the Royal Gazette (via the kamnotra.io index as a finding aid, never as authority) to verify enactment dates.
2. **Anchoring:** a statute node anchors to the Khmer original's file SHA-256 (the authoritative bytes); English texts are recorded as unofficial translations with named provenance, summaries only. Where the government itself published English (NCSD policy documents), that English text is a citable official document — but no statute qualifies today.
3. **License gate:** LSE/CPR Climate Change Laws of the World, Open Development Cambodia, or any other third-party asset **may not be ingested before a license-register entry exists for it** — terms verified first; summaries only; no verbatim clause storage.
4. Every legislation row carries an explicit `as_of` date; nothing in this layer is promised as auto-updating.
