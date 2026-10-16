# Known failures — accepted, monitored defects

The R13 doctrine (see `docs/OPERATIONS.md`): a red check that cannot be fixed
without breaking an iron rule is recorded here as an accepted defect with its
monitoring condition — never silenced, never masked. One entry per defect; the
digest line uses the R13 shape `YYYY-MM-DD | <check> | <message>`.

## 2026-10-15 | npm-audit | 3 vulnerabilities (1 low, 1 high, 1 critical) in the astro 5.18.2 tree

**What `npm audit` reports.** Advisories against astro ≤ 7.2.7 (reflected XSS
via view-transition properties and slot names, host-header SSRF in prerendered
error-page fetch, RCE through AVIF image optimization, base-path authorization
bypass) plus vulnerable transitive `esbuild` (dev-server file read on Windows)
and `sharp` (libvips/libheif/librsvg CVEs). The fix npm offers is
`astro@7.4.0`, a breaking major.

**Why it is accepted, not fixed.** R15 forbids prerelease dependencies with no
exceptions. Every astro 6.x and 7.x release — including 7.4.0 — depends on
`get-tsconfig@5.0.0-beta.x`, and get-tsconfig has published **no stable 5.x at
all**, so no R15-compliant astro line carries the fixes. astro 5.18.2
(published 2026-05-26) is the newest release whose dependency tree is fully
stable. Masking the audit with `overrides`, or weakening the r15 gate, is the
forbidden move; recording the red result here is the honest one.

**Why exposure is near nil in this repo.** The build output is fully static
with zero client JavaScript; there is no dev server in CI or production, no
view transitions, no slots fed from user input, no image service (the AVIF/
sharp paths are never invoked), no server rendering (no SSRF surface), and
every byte of page content comes from repo-committed fixtures, not user input.

**Monitor / exit condition.** Re-run `npm audit` on every dependency change
and read its result in CI logs. Upgrade astro the moment a fixed line exists
whose whole tree is prerelease-free (watch get-tsconfig for a stable 5.x).
This entry is closed by that upgrade, not by silencing the audit.
