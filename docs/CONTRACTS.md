# Source contracts (R14)

Every source adapter ships a contract at `engine/sources/contracts/<source_id>.json`.
The `r14-source-contracts` gate validates every contract file on every run.

Required shape:

```json
{
  "source_id": "unfccc-ndc-registry",
  "url": "https://example.org/registry",
  "staleness_budget_days": 35,
  "success_criteria": {
    "min_bytes": 50000,
    "format": "html"
  }
}
```

- `staleness_budget_days` — the maximum allowed age of the latest successful
  snapshot. A source past budget is surfaced as first-class state on records and
  public screens ("this source unreachable for N weeks"), not hidden in logs.
- `success_criteria` — fetch success is judged by **bytes** (size floor plus
  format), never by HTTP status. The predecessor accepted a 200 response that was
  a 212-byte bot-check page; under this contract that fetch is a failure.

No contract files exist yet; WP-03 adds them together with the first source
adapters. Zero contracts is a pass-with-note in the gate, so the rule is armed
from day one.
