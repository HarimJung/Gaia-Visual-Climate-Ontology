# Definitions — National Climate Record Runtime

Canonical public definitions for the record runtime's vocabulary. Each concept
gets one quotable sentence under a stable `##` heading. Seed CSVs cite this
file as `record-runtime docs/DEFINITIONS.md` with the clause `§ <heading>`.
Headings are stable identifiers: do not rename them; add new ones instead.

Epistemic states — every published value carries exactly one of four states.

## observed

An observed value is read from bytes we hold, with the file, the fetch time and the SHA-256 hash recorded.

## pledged

A pledged value is a stated intention read from a submitted document, not a measurement.

## unknown

An unknown value is one the runtime looked for and could not establish, and it always carries the reason in writing.

## absent

An absent value marks a socket the evidence says is genuinely empty, and it always carries the reason in writing.

## refusal

A refusal is a value left in state unknown or absent together with the written reason the runtime declined to fill it.

The evidence chain — how a published value or sentence reaches bytes.

## receipt

A receipt is the recorded ingest event for one fetch: which source answered, when, and the SHA-256 hash and size of the bytes received.

## anchor

An anchor is a pointer into bytes we hold: a specific file copy plus the exact place inside it that a value or claim rests on.

## claim

A claim is an authored sentence that cites one or more anchors by explicit anchor id.

## verdict

A verdict is a human judgment recorded on one claim, and no machine ever produces one.

## census key

A census key is a named counter computed at build time, and every number a published document or screen shows must link to one.

Document types — the kinds of filing a country record holds.

## treaty-status-list

A treaty status list is the authoritative publication that records each country's standing under a legal instrument.

## ndc

An NDC is a nationally determined contribution submitted under the Paris Agreement.

## btr

A BTR is a biennial transparency report submitted under the Paris Agreement.

## legislation

Legislation is a national law or decree taken in as a filing and maintained by hand with its as-of date shown.

## institution-register

An institution register is a filing that lists the national bodies relevant to a country's climate record.

## regulatory-parameter

A regulatory parameter filing states a setting fixed by a legal instrument, such as a rate or a threshold.

## dataset

A dataset filing is a machine-readable data publication captured as a hashed snapshot with its fetch time.

## assessment

An assessment is a third-party evaluation document taken in as a filing.

Freshness tiers — how a source is kept current.

## auto

An auto tier source is refreshed on a schedule and its staleness budget is enforced by the build.

## manual

A manual tier source is updated by hand on a declared review cycle, and screens show that tier with its as-of date.

Author verdicts — the three values a human verdict on a claim can take.

## anchored

Anchored means every cited anchor resolves in the current build and supports the sentence as written.

## outdated

Outdated means a cited anchor resolves to bytes that a newer build has since superseded.

## unsupported

Unsupported means the sentence cites no anchor that resolves in the current build.

Party standings — the standings a treaty status list can record for a country.

## party

Party means the treaty status list records the country as a party to the instrument.

## signed-not-ratified

Signed-not-ratified means the country signed the instrument but the list records no ratification.

## withdrawn

Withdrawn means the list records that the country left the instrument after having been a party.

## not-listed

Not-listed means the treaty status list does not carry the country in its own right.
