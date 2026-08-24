---
name: passes-ui-info-bar-2026-07-31
description: "Passes UI (sport filter + day/night hour chips) + admin-configurable Information Bar — shipped to development 2026-07-31, NOT on main"
metadata: 
  node_type: memory
  type: project
  originSessionId: 5ab2a2c4-5e6a-4f62-9239-19e35bd79d9b
  modified: 2026-07-30T19:27:04.472Z
---

Two features on `development` (commits 41d5404 passes-ui, 02ab7ec info-bar), **not promoted to main**:

1. **Passes UI (web + app)**: sport filter chip row on /passes + app Passes store; per-card hour chips ("☀ Weekdays 5am–5pm" sky blue / "☾ ... " dark grey, night = band starts ≥4pm) derived in `lib/pass-time-chips.ts` from pricing bands × TimeClassification rows; `getActivePassPlans` appends `timeChips` (feeds web + `/api/mobile/passes/plans`).
2. **Information Bar (web + app)**: ArenaSettings.infoBarEnabled/infoBarText (schema pushed to staging DB); admin at `/admin/config/info-bar` (+ app AdminInfoBarScreen via `/api/mobile/admin/pricing` action `info-bar`, perm MANAGE_PRICING); public `GET /api/info-bar` (revalidate 300 — direct DB writes take up to 5 min to appear; the admin action revalidates immediately); replaces the hardcoded ₹100 strip on both home pages, empty text = default new-user offer.

Verified: web save→DB→home-strip→clear round-trip in browser; native Android app rendered custom text live from development.momentumarena.com. NOT visually verified: app Passes chips/filter + AdminInfoBarScreen (need in-app sign-in; payload + rendering verified web-side, code typechecks).

**Debugging lesson (cost ~1 session): a Claude-browser-pane tab can wedge** — frozen screenshot frame that no longer matches the DOM, input events dropped, read_page returns empty, and the page's React Suspense stream stuck (content parked in hidden `div#S:0`, `<main>` empty, boundary `template#B:0` never completed). This mimics a hydration bug in YOUR code. Fix: `tabs_create` a fresh tab first — if the page hydrates there, the code was never broken. Also: `computer` click coordinates are screenshot-pixel space (screenshot is 0.625× the 1280×720 viewport) — compute targets as `cssPx * 0.625`, or use read_page refs.

Mobile debug builds resolve API base from GIT_BRANCH at bundle time ([apps/mobile/src/config/env.ts](apps/mobile/src/config/env.ts)): anything ≠ main → https://development.momentumarena.com — an emulator debug app tests against the DEPLOYED dev env, not localhost.

Related: [[app-coupons-first-app-booking]], [[admin-mobile-parity]], [[deployment-runbook]]

**Pass cheapest-hour pitch (final shape, dev c70e1b8, NOT main beyond ddb204a):** slot-selection banner "Save More with Arena Passes / Book from just ₹X/hour* / …guaranteed savings… / View Passes →" (web + both app slot screens via public /api/mobile/pass-pitch). ONE anchor per interchangeable court group (`PassPlan.isCheapestHourAnchor` + plain "Cheapest pass" checkbox in both admins; ticking replaces the group's holder; legacy multi-anchor resolves to cheapest). Evolution: checkout strip → slot-page banner (user: no distractions at payment); peak/off-peak buckets built then REMOVED (user simplified to one pass per court type). Never re-add buckets without asking. main still has the intermediate bucket model from promotion ddb204a.
