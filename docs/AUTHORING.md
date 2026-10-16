# Authoring verification (WP-08)

A practitioner writes a report sentence, cites a receipt, and learns **before
submission** whether that citation is anchored, outdated, or unsupported by
the current build. Input is a `.docx` (or plain text); output is the same
document with the verdicts as a Word comment layer — the practitioner never
leaves Word (AD-2).

Two hard rules shape everything here:

- **AD-1 — explicit citations only.** The only sentences that receive
  verdicts are those citing a receipt token (grammar below). There is no
  free-text claim extraction, no NLP, and no model anywhere in the judgment
  path (R10, machine-enforced by the `r10-author-deterministic` gate: no
  network, model/SDK, wall-clock, or randomness code may exist under
  `engine/author/`).
- **R4 — these are lookup statuses, not judgments.** ANCHORED / OUTDATED /
  UNSUPPORTED state what the record mechanically shows about a citation.
  They never assert that a sentence is *true* — only whether the receipt it
  cites exists, holds evidence, and is current.

## Citation grammar

A citation token names one receipt, exactly as the published views name it:

```
⟦iso3:doc_id⟧            e.g.  ⟦khm:untc-paris-agreement⟧
⟦iso3:doc_id#pN⟧         e.g.  ⟦khm:khm-ndc-2020#p12⟧   (page claim)
```

Because practitioners cannot type `⟦⟧` on a plain keyboard, a fallback
spelling is accepted with **identical semantics**:

```
[[anchor:iso3:doc_id]]
[[anchor:iso3:doc_id#pN]]
```

- `iso3` — the three-letter country code, written lowercase (any case is
  accepted and normalized to lowercase).
- `doc_id` — the receipt id exactly as the country's view publishes it
  (letters, digits, `.`, `_`, `-`; case-normalized to lowercase). Receipts
  are country-namespaced: the same `doc_id` can exist under several
  countries, so the country code is always required.
- `#pN` — an optional page claim. When present, the page must be one the
  receipt actually records; otherwise the citation is UNSUPPORTED with the
  mismatch named.

Tokens are regex-parsed and deterministic. Anything that is not exactly one
of the two forms above is **not** a citation — it is ordinary sentence text.

## Verdicts (deterministic lookup, in this order)

Verdict vocabulary comes from the generated vocabulary
(`FACET-AUTHOR-VERDICT`), never from hand-written code (R2). For a token
`iso3:doc_id[#pN]`, resolved against the current build's views:

1. **UNSUPPORTED — unknown country.** No view exists for `iso3`. The nearest
   miss is named mechanically (string match, not semantics): countries that
   do hold this `doc_id`, if any.
2. **UNSUPPORTED — unknown receipt.** The country exists but records no such
   `doc_id`. Nearest miss: the same `doc_id` under other countries; failing
   that, ids in the same country that contain (or are contained by) the
   cited id.
3. **OUTDATED — state degraded.** The receipt exists but its recorded state
   has degraded to `unknown`; the reason repeats the record's own
   state_reason.
4. **OUTDATED — superseded.** The record holds a newer document of the same
   `doc_type` for that country: both dates non-empty, the newer date
   strictly greater (a tie is not supersession), and the newer document's
   own state `observed`. The reason names the superseding receipt.
5. **UNSUPPORTED — no evidence held.** The receipt exists, is not outdated,
   but holds neither a file hash (sha256) nor a quoted page anchor — for
   example a registry assertion with no bytes behind it.
6. **UNSUPPORTED — page mismatch.** A `#pN` claim where `N` is neither the
   receipt's quoted page nor within its recorded page count. The reason
   names what the receipt does record.
7. **ANCHORED.** The receipt exists, holds evidence (state `observed` with a
   sha256 and/or a quoted anchor), is not superseded, and any page claim
   matches the record.

Every verdict on an existing receipt carries that receipt's deep link
(`/receipt/<iso3>/<doc_id>/`); nearest misses carry theirs.

## Sentences without citations

- **UNANCHORED** — a sentence citing nothing. This is useful output, not an
  error: it shows the reviewer exactly which sentences rest on nothing.
- **UNANCHORED-NUMERIC** — an UNANCHORED sentence that contains a figure
  (any digit; digits inside citation tokens do not count). This is the
  blocking-candidate class: a number with no receipt.

### Sentence segmentation — simple, deterministic, and honest about it

Within a paragraph, a sentence ends at `.`, `!` or `?` followed by
whitespace or the paragraph end. Positions inside citation tokens never end
a sentence (doc_ids may contain dots). Known limits, accepted deliberately:

- Abbreviations split: `e.g. this` reads as two sentences.
- Decimal numbers do **not** split (`1.5` — the dot is not followed by
  whitespace), nor do dotted doc_ids inside tokens.
- A quotation ending `…?"` splits at the `?` only if whitespace follows the
  closing quote character — i.e. usually not. Such a sentence merges with
  the next one.
- In `.docx`, only `w:t` run text is read; tabs and line breaks (`w:tab`,
  `w:br`) read as nothing, so text separated only by a tab concatenates.

A mis-split sentence can only change **which span a flag attaches to**,
never a citation's verdict: tokens are found independently of segmentation.

## AD-12 guard — no verification against a stale graph

Before issuing any verdict, the checker computes the build's stale fraction:
ledger rows carrying an anchor whose evidence age — `built_at` minus the
row's `retrieved_at`, both from the build, never the wall clock — exceeds
the source's `staleness_budget_days` from its contract
(`engine/sources/contracts/`). Sources without a contract are manual-tier
(AD-13) and are never auto-stale.

If stale rows exceed **ten percent** of anchored rows, the whole check
returns `verification-unavailable` with the numbers, writes no comments, and
exits 2: it refuses to approve drafts against a graph it knows is outdated.

## CLI

```
node engine/author/check.mjs --in draft.docx --out annotated.docx --json report.json
node engine/author/check.mjs --text draft.txt --json report.json
```

- `--in/--out` — `.docx` round trip: the same document comes back with a
  Word comment layer. Comment text:
  `VERDICT — reason — receipt URL — build_id`. Comment author is
  `Record Runtime` (initials `RR`); `w:date` is the build's as-of date, so
  output is byte-deterministic: the same draft against the same build
  produces byte-identical files (R10 — proven in tests by running twice and
  comparing bytes). Byte-identity holds within one Node.js/zlib version:
  replaced zip parts are re-deflated, and a different zlib may emit
  different — equally valid — compressed bytes.
- `--text` — plain-text mode for the demo path; each line is a paragraph.
- `--json` — the full report: per-sentence verdicts and flags, counts,
  `build_id`, and the stale fraction.
- `--root` — repo root (defaults to the checkout the script lives in).

Exit codes: `0` check ran (verdicts, whatever they are, are the product),
`2` verification-unavailable (AD-12), `1` usage or input error.

### The .docx round trip, honestly

The reader/writer is hand-rolled on `node:zlib` (R15: zero new
dependencies). It reads the zip central directory, inflates
`word/document.xml`, and takes paragraph text as the concatenation of `w:t`
runs in document order, formatting ignored. Annotation adds
`word/comments.xml`, a `commentRangeStart`/`commentRangeEnd` pair plus a
`commentReference` around each flagged sentence, and the content-type
override and relationship entry if absent. Untouched zip entries keep their
original compressed bytes; the document's own runs are never rewritten, so
extracted text is byte-identical before and after.

Limits, stated plainly:

- Comment ranges anchor at **run granularity**: the range opens before the
  first run the sentence touches and closes after the last. When Word has
  merged a sentence boundary into one run, the highlight may extend a few
  characters into a neighboring sentence. The comment text always quotes the
  exact verdict and receipt.
- No zip64 (drafts are nowhere near 4 GiB), no encrypted or exotic
  compression methods — such a file fails loudly, it is never guessed at.
- Comments that already exist in the draft are preserved; new comment ids
  continue after the highest existing id.
- Text boxes: paragraphs nested inside `w:txbxContent` can misalign the
  paragraph index, so in a draft that uses text boxes a comment may attach
  to the wrong range. The output stays well-formed XML either way.
- Validation of the output is machine-only — zip CRCs, XML well-formedness,
  and structural comparison of the comment layer. No test, person or
  procedure has yet opened an annotated file in Microsoft Word itself; the
  launch checklist (`docs/LAUNCH.md`) carries that confirmation as a human
  check, with the Word-only risks listed there.

## What this is not

- No upload UI. The site is static with no server runtime; checking runs
  locally via the CLI above.
- No suggestions. A model may someday *propose* anchors in a separate
  advisory report (AD-1 allows that much), but nothing a model produces can
  enter the verdict path — the gate fails CI if such code appears.
