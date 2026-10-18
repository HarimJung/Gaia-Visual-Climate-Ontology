# Launch checklist

Checklist only. Deployment and publication are the owner's act (R8 / AD-11),
the hosting choice is an open owner decision, and nothing in this file
executes anything. When a host is chosen, work down the list in order. Every
item names what to check, how, and the pass criterion. The read-only checks
in sections 4–8 are automated by the live probe (section 9); sections 1–3
are one-time setup, and section 10 a human check, that the probe cannot do
for you.

## 1. Domain — apex and www both answer

**What:** The bare apex domain and the `www.` subdomain both serve the site
(one redirecting to the other is fine; pick one as canonical).

**How:** After DNS is set, open `https://<domain>/` and `https://www.<domain>/`
in a browser, and once more from a device off your own network.

**Pass:** Both URLs land on the world ledger with a valid certificate. A known
failure class of predecessor systems: the `www` host serves the site while the
bare apex returns a 404, so every shared link that drops the `www` dies. The
apex answering is the pass criterion, not an optional extra.

## 2. Single CI deploy path — no publish credential exists

**What:** Publishing happens through exactly one path: the `deploy` job in
`.github/workflows/ci.yml`, which builds the site on GitHub Pages' own
runner and publishes it through the workflow's identity. There is no deploy
token, so there is nothing to leak and nothing to run by hand. No publish
command is written down anywhere in this repository (the r8 gate scans for
one), and no local path to publish exists.

**How (the owner's enabling act, two settings, both in this repository):**
(1) Settings → Pages → Source: GitHub Actions. (2) Settings → Secrets and
variables → Actions → Variables: add `DEPLOY_PAGES` = `true`. Until that
variable exists the deploy job is skipped, so CI stays green and nothing
publishes by accident. The next push to `main` then publishes, but only if
the checks job is green first: the deploy job rebuilds the whole pipeline,
runs the tests and runs every gate against the artifact it is about to ship.

**Address:** by default the project path,
`https://<owner>.github.io/<repo>/`. The build is authored root-relative and
`npm run build:pages` moves every URL under `SITE_BASE` after the build, so
the base path lives in one step rather than in sixty links; R19 then checks
that every internal link resolves under that base before anything ships. To
move to a custom domain later, set the repository variables `SITE_ORIGIN`
(e.g. `https://record.visualclimate.org`) and `SITE_BASE` (`/`), add the
domain under Settings → Pages, and point the DNS record at Pages. §1 of this
document is the check that both forms of the address answer.

## 3. Dead-man heartbeat on every scheduled job

**What:** Every scheduled job (the daily watchdog of section 6, and any future
refresh job) pings an external heartbeat service on success, and the heartbeat
service — not the job — raises the alarm when a ping stops arriving (R16).
This is the only signal that survives the job itself dying.

**How:** Register one check per scheduled job at a heartbeat service
(healthchecks.io or equivalent), with a grace period just over the job's
schedule interval. Put each ping URL in a CI secret; the job's last step
requests it. Route the service's alarm to a channel read daily.

**Pass:** Temporarily disable one scheduled job; the heartbeat service raises
its alarm within one grace period, in the channel it was routed to. Design
assumption to verify against, not around: GitHub disables scheduled workflows
after 60 days of repository inactivity, silently. The heartbeat's missing-ping
alarm is the alarm for that event too — confirm the grace period is short
enough that a silent auto-disable is noticed within days, not months.

## 4. 404 page

**What:** A request for a path that does not exist returns HTTP status 404
with the site's own not-found page (`app/src/pages/404.astro`, built to
`404.html`), never a 200 with the homepage (a soft 404 poisons link checkers
and search indexes, and hides broken deep links).

**How:** Request `https://<domain>/no-such-page/` and read the status code
(browser dev-tools network tab, or the probe in section 9).

**Pass:** Status is 404 and the body is the runtime's not-found page with its
footer (as-of and build hash) intact. If the host serves a 200 instead, the
host is treating the site as a single-page app — turn that fallback off.

## 5. 3G throttle pass

**What:** The site is readable on a slow connection with JavaScript off. The
build is static HTML with zero client JavaScript, so this is a size check,
not a functionality check.

**How:** In browser dev tools, set network throttling to "Slow 3G" and disable
JavaScript. Load the world ledger, one country page, and one receipt page.

**Pass:** Each page's full content (ledger rows, census table, receipt hash
block, footer) is visible without scripts, and no single document response
exceeds 512 KB raw — the probe (section 9) enforces that ceiling, which keeps
worst-case document transfer under roughly ten seconds on a slow-3G profile.

## 6. as-of visible on every page

**What:** Every public page permanently shows its record as-of date in the
footer (`data-meta="as_of"`), so a stalled pipeline is visible to readers
before it is visible to the operator (R16).

**How:** Spot-check the world ledger, a country page, a receipt page, and the
404 page; the probe (section 9) checks the fetched set on every run.

**Pass:** The as-of date is present on every checked page, identical across
pages from the same build, and no older than the newest committed view build.

## 7. Footer build hash vs main HEAD — daily watchdog

**What:** The footer prints the commit the live site was built from
(`data-meta="build_commit"`). A daily scheduled job compares that hash against
the repository's `main` HEAD; a mismatch means the publish path has stalled or
been bypassed, and is an incident, not a warning (AD-11).

**How:** Add a small scheduled workflow (daily) that fetches the live world
ledger, extracts the footer hash, and compares it with `main` HEAD at run
time. It fails loudly on mismatch and pings its heartbeat (section 3) on
every completed run, pass or fail.

**Pass:** On a day with no pushes, the watchdog run is green. After a push to
`main`, the next run is green again — confirming the deploy actually shipped.
A deliberately broken rehearsal (compare against a wrong hash) turns the run
red and the failure lands in the channel from section 3.

## 8. Readers before operators

**What:** The ordering principle behind sections 6–7: every signal about the
site being stale or down must reach readers (as-of on the page) and an
external service (heartbeat) before it depends on an operator opening
anything. No check in this list may have an operator's attention as its only
consumer.

**How:** For each signal set up above, name its non-operator consumer: as-of →
every reader, build-hash mismatch → watchdog failure + heartbeat channel,
dead job → heartbeat service alarm.

**Pass:** Every row has a consumer that is not "the operator remembers to
look". Any signal without one is not yet set up — go back to its section.

## 9. Live probe

**What:** `scripts/check-live.mjs` runs the read-only checks above against the
deployed site: status and byte floor on the world ledger, a country page and a
receipt page (success is bytes, not status codes — R14), as-of present
everywhere, footer build hash present and identical across pages, the 404
route returning 404, core content present in raw HTML (no JavaScript needed),
and every response under the 3G size ceiling.

**How:** `node scripts/check-live.mjs --url https://<domain>` — the probe
refuses to run without an explicit `--url` and never probes any default host.
It fetches pages and reads them; it changes nothing.

**Pass:** Every line reports `ok` and the exit code is 0. Run it after first
deploy, after any DNS change, and whenever section 7's watchdog goes red.
One scope note: for the 404 route the probe checks the status code only —
section 4's body criterion (the runtime's own not-found page with its footer
intact) stays a human check.

## 10. Word opens the annotated draft — human check

**What:** The authoring checker's `.docx` output (`docs/AUTHORING.md`) is
validated by machine only: zip CRCs, XML well-formedness, and structural
comparison of the comment layer. No test, person or procedure has yet opened
an annotated file in Microsoft Word itself, so that confirmation is a human
launch step that no gate can do for you.

**How:** Run the checker on one real draft
(`node engine/author/check.mjs --in draft.docx --out annotated.docx`) and open
the output in Word. Risks that only a real Word open can rule out:

- **Tracked changes:** a draft containing `w:ins`/`w:del` can receive a
  comment range start at a position strict OOXML validators reject (Word is
  usually lenient — confirm, do not assume).
- **Text boxes:** paragraphs nested in `w:txbxContent` can misalign the
  paragraph index, attaching a comment to the wrong range; the XML stays
  well-formed, so only eyes catch it.
- **Modern comment parts:** the writer emits `comments.xml` only, not the
  Word 2013+ companion parts (`commentsExtended.xml`, `commentsIds.xml`,
  `people.xml`) — usually harmless, but only an actual open confirms it.
- **Comment reference style:** the reference run carries no
  `CommentReference` character style — a display-polish question, not a
  validity one.

**Pass:** Word opens the file without a repair prompt, every comment is
visible and attached to its flagged sentence, and the draft's own text is
unchanged. Repeat once with a tracked-changes draft and once with a text-box
draft before telling practitioners those draft types are supported.
