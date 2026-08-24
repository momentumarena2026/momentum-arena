---
name: session-handoff-2026-08-05
description: "21-item list shipped + all five follow-up actions closed; what's on development vs main as of 2026-08-05"
metadata: 
  node_type: memory
  type: project
  originSessionId: 5ab2a2c4-5e6a-4f62-9239-19e35bd79d9b
  modified: 2026-08-05T08:24:27.308Z
---

The 21-item feedback list is **complete**, and so are the five follow-up
actions that were owed back to the user.

**All promoted to main 2026-08-05** (merge `ae33ae8`; gate showed only the
expected fingerprint/version drift, no `prisma/**` changes so no db push):
- **#5** — the app's tournament screens were missing *data*, not styling. The
  shared `/api/tournaments/[slug]/public` route never returned `description`,
  `rules`, `prizes`, `endDate`, `membersPerTeamMax` or `thirdPlaceMatch`, so
  the app *could not* have shown them. Route widened, then rendered. Also
  added the Bracket tab the app never had.
- **#8** — `rotateScorer`, `archiveTeam`, `deleteTeam` added to
  `/api/mobile/admin/tournaments/action`. Still web-only: the
  create/update tournament **wizard**.
- **#10** — capability was already at full parity (all 12 pass-admin ops
  wired both sides); only the tab layout differed.
- **Camps master switch** — `get/setCampsEnabled` + a module toggle on
  `/admin/camps`. Web only: there is **no mobile camps admin screen** at all.
- **OTA rollout ladder** — replaced type-a-number-and-Save with one-tap
  20/40/60/80/100 buttons plus Pause (0%), on web *and* app.

**Analytics trap — four surfaces, not one.** Tournament/camp money must be
merged into ALL of `getRevenueOverTime`, `getKPIStats`,
`getDailyEarningsForMonth` and `getMonthlyEarningsForYear`. The cash-basis
work wired only the first, so the Sports Analytics page — which renders the
other three — showed nothing even after `paidAt` was backfilled. Verified on
staging with a temporary camp fixture: all four report the same figure. If you
touch revenue attribution again, check all four.

**The OTA publish default is already 0%** — `OtaRelease.rolloutPercent` is
`@default(0)` and nothing auto-publishes at 100. The old "100" was purely a
UI pre-fill in the percent input, now gone. Note `rollbackOtaRelease`
deliberately re-publishes the *previous* build at 100% — that is correct, do
not "fix" it. Live production canaries were left at 20% by the user's choice.

**Production DB is only reachable from GitHub Actions** via
`secrets.PRODUCTION_DB_URL`; there is no local path. `.github/workflows/
backfill-paid-at.yml` (on **main**, `6a0c1f3`) is the pattern for any future
production data script: `workflow_dispatch`, dry-run by default, `apply`
checkbox to write. Ran it 2026-08-05 — stamped 2 tournament teams, **₹5,600
into Aug 2026**, 0 camp registrations; a follow-up dry run returned 0 rows,
confirming it landed.

Also settled: iOS 1.0.1 is live on the App Store, and UPI intent tap-to-pay
(long-standing task #68) is confirmed working.

Mobile typecheck baseline is **15 pre-existing errors** — that number is the
pass mark, not zero. See [[deployment_runbook]], [[tournament_engine_2026_07]],
[[ota_self_hosted]], [[feedback_no_auto_main]].
