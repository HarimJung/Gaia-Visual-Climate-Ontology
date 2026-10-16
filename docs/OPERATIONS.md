# Operations requirements

Requirements, not claims: nothing here is running yet (S0). Each item names the
work package that implements it. What is already enforceable is enforced by
`engine/gates/`.

## R13 — failure digest (requirement — implemented by WP-09)

Every failed check emits exactly one line:

```
YYYY-MM-DD | <check> | <message>
```

`engine/gates/run.mjs` already prints this shape. Destination: the operator's
daily ops digest file — the file opened first in every working session. Email
does not count as a destination. A check that stays red for more than 7 days is
demoted from "alert" to "accepted defect" and moved to the known-failure list
(`docs/KNOWN-FAILURES.md`); only new failures make noise.

## R14 — staleness budgets (requirement — implemented by WP-03)

Every source carries a contract with a staleness budget and byte-based success
criteria (see `docs/CONTRACTS.md`). A source past its budget is shown as
first-class state on records and public screens. The contract gate is live now.

## R16 — dead-man switch and as-of display (requirement — implemented by WP-03 and WP-10)

Every scheduled job pings an external heartbeat service; a missed ping raises a
signal through a channel that does not depend on the operator reading anything.
Every public screen permanently displays its record as-of date, so a stalled
pipeline is visible to readers before it is visible to the operator. The design
assumes scheduled jobs are auto-disabled after 60 days of repository inactivity
and must survive that.

## AD-11 — no-human-merge publish path (requirement — implemented by WP-10)

A rebuild that passes all gates (R1–R16) merges and publishes automatically
from CI. Humans review only the changes the gates have blocked. Publish
credentials exist only as CI secrets, so a manual publish is physically
impossible. The public footer prints the build commit hash, and a daily check
compares that hash with main HEAD — a mismatch is an incident.

## AD-12 — queue SLA with automatic consequences (requirement — implemented by WP-09)

Items awaiting diff judgement carry a 14-day SLA. Past SLA, a public banner —
"this record is N days behind" — is posted automatically at the top of the
public screen. Queue depth and longest wait are the first two internal
monitoring numbers. If stale claims exceed 10% of the graph, author-check
switches to "cannot verify": drafts are never approved against an outdated
graph.
