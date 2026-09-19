# Momentum Arena — Project Context

**This is the living orientation document for the whole codebase.** It is referenced from
`CLAUDE.md`, so any Claude session that opens this repo is pointed here regardless of which
machine or account it runs on.

**If you are a Claude session reading this for the first time:** read it end to end before
touching anything. It carries the rules, the deployment model, and the non-obvious traps
that are expensive to rediscover. Then verify before acting — anything naming a file, flag,
or function was true when written, so confirm it still exists before relying on it.

**Last substantive update:** 2026-09-19 · accurate as of `main` = `48b83d0d` (app 1.0.7).

**New here?** Read `docs/HANDOVER.md` first — it is the entry point for a
session inheriting this project with no conversation history, and points at
`docs/history/` for the reasoning behind older decisions.

> ### Maintaining this file
> Update it as part of the work, not as an afterthought — a stale context doc is worse than
> none, because it is trusted. Update it when any of these change:
> - a rule, branch policy, deployment step, or environment fact (§2, §3)
> - a new trap worth never rediscovering (§4)
> - a module is added, or an architectural decision is made and the *reasoning* matters (§5, §6)
> - what is shipped vs. pending moves (§7)
> - a file listed in the map moves, or a new must-stay-in-sync pair appears (§8)
>
> Keep the "Last substantive update" line and the `main` SHA above current. Record **why**, not
> just what — the diff already records what. Prune anything that has become false; do not let
> this grow into a changelog.

---

## 1. What the product is

**Momentum Arena** — a sports-venue booking platform for a single physical arena in India
(cricket, football, pickleball + a bowling machine). Three surfaces, one backend:

| Surface | Stack | Notes |
|---|---|---|
| Web (customer + admin) | Next.js App Router, TypeScript, Tailwind, Prisma | `app/`, `components/`, `actions/`, `lib/` |
| Mobile app (customer + admin) | React Native + Expo (SDK 56), React Navigation, TanStack Query | `apps/mobile/` |
| Shared backend | Next.js route handlers + server actions, Postgres (Neon) | app calls `/api/mobile/*`; web uses server actions |

Modules in production: **bookings** (hourly courts + 30-min bowling machine), **cafe**,
**shop**, **passes** (multi-pass coverage engine), **coupons/rewards**, **tournaments**
(full engine: registration → pools → fixtures → live scoring → bracket), **camps**
(coaching programmes), **promo banners**, **in-app notifications**, **push (FCM)**, **deep links (Universal Links / App Links)**,
**analytics**, **HR/legal doc generation** (NDA/offer letters), **OTA release management**.

Payments: **Razorpay** (gateway) and **PhonePe DQR** (dynamic UPI QR), plus cash/static-QR
at the venue. Most purchase funnels lead with UPI and keep the gateway as the alternative.

---

## 2. Repo, branches, worktree

- Work happens in **git worktrees** under `.claude/worktrees/<name>`, which
  come and go — do not expect any particular one to exist. (`_tf` is named
  in older notes and was removed.)
- A worktree sits on a **detached HEAD**. Push with an explicit refspec:
  `git push origin HEAD:development`
- A worktree can be reset out from under you by another clone or agent
  sharing the checkout. Nothing is lost if every commit was pushed — that
  is the reason to push each unit rather than batching. Recover with
  `git fetch origin && git checkout --detach origin/development`.
- Branches that matter: **`development`** (default target) and **`main`** (production).

### ⚠️ Standing rule — do not promote to main unless explicitly asked
Default target is `development`. Only merge to `main` when the user says so in that turn.
"We'll promote later" is not authorization.

### Promotion runbook (use verbatim)
```bash
git fetch origin
git checkout -q origin/main
git merge --no-ff origin/development -m "Merge development: <summary>"
git diff --stat origin/development HEAD     # GATE — see below
git push origin HEAD:main
git checkout -q origin/development
```
**The gate:** the diff between `origin/development` and the merge commit must contain
**only** these three CI-owned files:
```
apps/mobile/fingerprints/production.android.fingerprint
apps/mobile/fingerprints/production.ios.fingerprint
apps/mobile/version.json
```
Anything else means main has drifted — stop and investigate, do not push.

> **Note on the gate.** `CLAUDE.md` §"Branch discipline" says the gate prints *nothing*; this
> file used to say it legitimately prints the three CI-owned files. Both are right at
> different times, and the difference matters:
> - It prints **nothing** when no native build has run since the last promotion — the two
>   trees are byte-identical. This was the case on 2026-08-24 (`8204a2c`).
> - It prints **exactly those three files** when CI has written a fingerprint/version commit
>   straight onto `main` in between (verified on the 2026-08-06 promotions `eeb834f`,
>   `af1b75b`).
>
> So: empty = clean. Those three files, **and you can confirm from `git log` that CI authored
> them** = clean. Anything else = drift, stop and investigate. Never wave through a non-empty
> gate on the assumption that it is "just the fingerprints".

### Other git notes
- A pre-push guard restricts pushes to `main` and `development` only.
- Commit messages: avoid backticks in `git commit -m "..."` — the shell evaluates them as
  command substitution and silently eats the text. Use `-F <file>` for long messages.
  (This bit us once; the message had to be amended and force-pushed.)

---

## 3. Environments, database, deployment

- **Hosting:** Vercel. Push to `main` deploys production; push to `development` deploys the
  dev/staging environment.
- **Database:** Neon Postgres, **region `us-east-1`**.
  - Production and staging are *separate* Neon projects.
  - **The production DB is not reachable from a local machine.** The only way to run
    anything against it is a GitHub Actions `workflow_dispatch` job using
    `secrets.PRODUCTION_DB_URL`. Always dry-run first.
  - The local `.env` points at the **staging** DB — safe for read-only inspection and for
    temporary test fixtures (always clean them up).
  - **Never put a DB connection string in a committed file.**
- **Schema changes:** editing `prisma/**` triggers the `seed-production.yml` workflow
  (which runs `prisma db push`). The Vercel build also runs db push, so the workflow often
  reports "already in sync" — that's normal, not a failure.
- Full deployment doc lives in the repo at `docs/DEPLOYMENT.md`.
- `[skip ci]` in a commit message skips CI — there is a rule about when to use it; check
  the deployment doc before relying on it.

### Mobile release mechanics
- **OTA:** self-hosted Expo Updates. There is an **admin rollout dashboard** for publishing
  OTA updates with explicit rollout percentages (0 / 20 / 40 / 60 / 80 / 100).
- `runtimeVersion` is a **manually-managed string** (currently `"2"`). **Never bump it**
  casually — it breaks OTA delivery to existing installs.
- **Fingerprint gate:** adding a **native module** changes the fingerprint, which breaks
  OTA delivery and forces a store build. Pure-JS dependencies are usually fine, but the
  safest move for an OTA-targeted change is to **add no dependency at all** and build on
  what's already installed. (See §6, query-cache persistence, for a worked example.)
- Both iOS and Android are live on the stores (v1.0.x). iOS ships via an App Store Connect
  API-key upload pipeline.
- **`development` auto-dispatches native builds; `main` is manual.** See gotcha 16 and
  `docs/DEPLOYMENT.md` §8/§8c — the two paths differ in track, fastlane lane, OTA endpoint
  and store destination, and that is deliberate.
- **TestFlight upload ≠ App Store draft.** Only the `release` lane calls
  `upload_to_app_store`; `beta` calls `upload_to_testflight` and stops there. A build that
  appears in TestFlight has created no App Store version at all.
- **`expo-image-picker` ships its own `CAMERA` permission** in the library manifest, which
  makes Play imply `uses-feature android.hardware.camera required="true"` and drop every
  camera-less device (427 of them on 1.0.6). `app.json`'s `"cameraPermission": false` does
  NOT prevent this — config plugins only run under `expo prebuild`, and `android/` is
  committed here, so CI goes straight to Gradle. Stripped with `tools:node="remove"` in the
  app manifest, the same way `AD_ID` is.

---

## 4. Hard-won gotchas (these cost real debugging time)

0. **Cricket rules live in exactly ONE file: `lib/cricket-rules.ts`.** Until 2026-09-14
   cricket was scored *twice* — `lib/public-match.ts` for casual matches and
   `lib/tournament-live.ts` for tournaments — sharing no code. They drifted, and the
   expensive part was not the drift itself: a run-out bug reported from a real Cup match
   was diagnosed and fixed in the casual engine, with tests, and shipped, and did nothing,
   because the Cup does not use that engine. **Before fixing any cricket rule, establish
   which engine the reporter was actually using** — tournaments go through `/score/[code]`
   and the app Scorer Console, casual games through `/match/[code]` and the app Match
   Score screen. Both now call `cricket-rules.ts`, so a fix there lands in both; a fix
   anywhere else lands in one.

0b. **A total that reconciles can still be wrong per person.** The capital
   structure was seeded as a flat ₹7,00,000 of equity each. Two of the three
   figures were wrong — one founder was ₹1,42,865 short and another had
   covered him — and nothing ever flagged it, because the only check was
   `equity + loan == capex` and the *sum* was right. Worse, the founder loan
   was DERIVED as "capex minus a flat ₹21L", so every odd amount, including
   ₹31,285 the company paid from its own account, was silently absorbed into
   one person's loan and earned him 12% a year. Capital is a ledger now
   (several dated rows per person, withdrawals negative, `CapitalKind.COMPANY`
   for company-funded capex) and the real record of who paid is
   `Expense.doneBy` — compare against it before trusting any capital figure.
   A drawing is never an expense: booking one would charge the business for
   an owner taking their own money out.

1. **The analytics four-surface trap.** Any new revenue stream (tournaments, camps, …) must
   be merged into **all four** of these or the numbers silently disagree:
   `getRevenueOverTime`, `getKPIStats`, `getDailyEarningsForMonth`, `getMonthlyEarningsForYear`.
   Fixing one and declaring victory is a mistake that has already happened once.
2. **Typecheck baselines.** Web = **0 errors**. Mobile = **15 pre-existing errors**. Treat 15
   as clean on mobile; anything above it is yours. Verify with:
   `cd apps/mobile && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "error TS"`
3. **Prisma interactive transactions default to a 5s timeout** and blow up on pooled Neon if
   the body does per-item round trips. Use `createMany` + explicit
   `{ timeout: 20000, maxWait: 10000 }` for multi-row work.
4. **Mobile theme tokens** — these exist: `emerald400/500`, `emerald500_10`, `emerald500_30`,
   `zinc300`–`zinc900`, `yellow400`, `colors.card`, `colors.foreground`, `colors.background`,
   `colors.inputBackground`. These do **not**: `amber400`, `blue400`, `zinc950`, `zinc200`.
5. **Mobile component API:** `Skeleton` takes `rounded="lg"` (not `radius`). `Text` variants
   are `display | title | heading | body | bodyStrong | small | tiny`.
6. **`StyleSheet.absoluteFillObject` does not typecheck** in this RN version — write the four
   absolute offsets out by hand.
7. **`grep -c` exits 1 when the count is 0**, which breaks `&&` chains. Bitten twice.

7b. **The app NEVER talks to your dev server. Metro serves the JS; the API is
    always a deployed host.** `apps/mobile/src/config/env.ts` picks the base URL
    at bundle time from `build-config.generated.ts`: `GIT_BRANCH === "main"` →
    `https://www.momentumarena.com`, anything else → `https://development.momentumarena.com`.
    There is no localhost branch. So a server change is invisible to the
    simulator until it is **committed, pushed and deployed** — while a client
    change appears instantly through fast refresh. This is a genuinely
    confusing half-state: the screen you just edited is live, the endpoint it
    calls is yesterday's. It cost a debugging session on the challenge home
    card, where the card was correctly hidden because the deployed API had no
    `homeCard` field yet and the card fails closed. **Symptom to recognise:** a
    new field reads as `undefined` in the app while `curl` against localhost
    returns it fine. Check the deploy (`gh api repos/:owner/:repo/commits/<sha>/status`)
    before debugging the client.
8. **Next.js dev mode forces `Cache-Control: no-store`.** Any cache-header work *must* be
   verified against a real `next build` + `next start`, never the dev server.
9. Web pages that render bare against the black background usually mean a **missing
   `layout.tsx`** for that route group (this was the `/camps` bug).
10. **Native release: pin the version, never `bump` both platforms.** Both
    workflows resolve the version through `version.js` and commit it back to
    `main`, so two `bump=patch` dispatches race and ship different numbers.
    Pin, push, then dispatch both with `bump=none`. Full runbook:
    `docs/DEPLOYMENT.md` §8c–8e.
11. **A new iOS entitlement costs two failed builds** unless you pre-empt it:
    the capability must be enabled on the App ID in the Apple portal (CI
    cannot do it), and enabling it invalidates the profile while keeping its
    name, so sigh regenerates a timestamped one. The Fastfile now signs with
    `SharedValues::SIGH_NAME` rather than a constant.
12. `next/image` needs an explicit `remotePatterns` entry — Vercel Blob URLs
    (`**.blob.vercel-storage.com`) had to be added to `next.config.ts`.
13. **Three surfaces report "sports earnings" and they are SUPPOSED to differ.**
    `/admin/bookings` counts bookings only, money booked, lifetime. The
    Analytics KPI counts every sports stream (bookings + passes + tournaments
    + venue hire + camps), money **received**. The Year View counts the same
    streams but money **booked**, keyed on play date. Each now states this on
    screen; do not "fix" one to match another. `scripts/reconcile-sports-earnings.ts`
    (read-only workflow_dispatch) prints the gap component by component.
    *The one real bug it found:* every cash-basis figure filters on
    `Payment.confirmedAt`, so a COMPLETED payment with a null timestamp is
    money collected that no cash report can see. Six such rows existed
    (counter CASH/UPI_QR); backfilled 2026-08-16. If a new gap appears, run
    the reconciliation first — it names the cause.
15. **A stale `node_modules` or Prisma client fakes hundreds of typecheck errors.**
    The generated client is not in git, so after any pull that touched
    `prisma/schema.prisma` — or after a long gap between sessions — `tsc` reports
    errors that describe the *old* schema (`Property 'passRedemption' does not
    exist`, `'platform' does not exist in SlotHoldCreateInput`). On 2026-08-24 a
    cold checkout reported **908** web errors that were entirely phantom: 901
    from a stale client, 7 from packages in `package.json` but missing from disk.
    The real count was 0. Before believing any typecheck result, run:
    ```bash
    npm install && npx prisma generate      # root
    cd apps/mobile && npm install           # and again for the app
    ```
    Regenerate **after** pulling, not before — a `prisma generate` that predates
    the pull is just as stale.

18. **JS date getters read the HOST timezone — never use them on money.**
    `getMonth()`, `getHours()`, `getDay()`, and `new Date("2026-09-01T00:00:00")`
    all resolve against the host: **UTC on Vercel, IST on a dev Mac**. So the
    same analytics function returned different months in production and in
    development, and nothing said so. `actions/admin-cafe-analytics.ts` did this
    everywhere until 2026-09-02. Consequences on real production data (148
    orders): monthly revenue unaffected by luck, but **30% of orders were booked
    to the wrong calendar day and weekday, and 100% to the wrong hour** — the
    peak-hour chart was off by 5½ hours for its whole life, showing a 6pm peak
    when the true peak is **00:00–01:00 IST** (₹7,160, the single best hour;
    45% of all cafe revenue is taken between midnight and 5:30am, because the
    arena runs to 1am). It also meant the Cafe tab and the Overall P&L would
    have reported the same sale in different months the first time a late-night
    order landed on the 1st — the four-surface trap (gotcha 1) in a new guise.
    **Use `lib/ist.ts`** (`istMonthKey`, `istHour`, `istRangeBounds`, …), which
    shifts by +5:30 and reads UTC getters — the same thing the SQL side does
    with `+ interval '330 minutes'`, so TS and SQL agree by construction.
    `tests/ist.test.ts` passes identically under `TZ=UTC`, `TZ=Asia/Kolkata` and
    `TZ=America/Los_Angeles`; that invariance is the actual assertion.

17. **Never export a TYPE from a `"use server"` module.** The build strips a
    server-action file down to its async exports, so a `export type { X }`
    re-export becomes a runtime import of nothing and every page importing it
    500s — while `tsc` reports zero errors, so the usual gate misses it
    entirely. This took down all the admin tournaments pages once already
    (`export type { TournamentWizardInput }`). Put shared types in a plain
    module and import them from both sides: `lib/pnl-math.ts` holds the P&L
    shapes for exactly this reason, and `actions/admin-pnl.ts` exports one
    thing — the async function. `next build` catches it; a typecheck does not.

16. **`development` and `main` native builds are DIFFERENT paths on purpose —
    do not merge them.** `docs/DEPLOYMENT.md` §0/§7/§8 is the spec:
    `development` auto-dispatches on fingerprint drift to the TEST tracks
    (`testflight` / `internal`, fastlane `beta` lane, OTA endpoint
    `development.momentumarena.com`); `main` is a **manual** dispatch to the
    STORE tracks (`appstore` / `production`, fastlane `release` lane, OTA
    endpoint `www.momentumarena.com`), and only the `release` lane calls
    `upload_to_app_store` / `upload_to_play_store(track: production)` — which
    is the only thing that creates a reviewable draft. The `if [ "$CHANNEL" =
    "development" ]` gate in `ota-publish.yml` is what carries that
    distinction; it looks like a mere branch check and is not. Removing it
    while leaving `TRACK=testflight` hardcoded (771b187, 2026-08-31) made main
    run the `beta` lane: both platforms built green, iOS landed in TestFlight
    with no App Store draft, Android in Play internal with no production
    draft, and both binaries were compiled against the development OTA
    endpoint. Reverted 2026-09-01. **A green native build proves nothing about
    which store it reached** — check the log for `Driving the lane 'ios beta'`
    vs `'ios release'`.

14. **Cricket scoring has three rules that look like details and aren't.**
    (a) *Zero overs is not "unlimited", it is broken.* It switches off both the
    innings close and the NRR rule that charges a bowled-out side its full
    quota — which is how three matches in a live pool ended up with wrong net
    run rates. `startLiveMatch` now refuses a cricket match without 1–90 overs.
    (b) *Wickets per side is a tournament setting, not ten.* Momentum's cup
    plays 8; hardcoding 10 silently disabled the same all-out rule.
    (c) *Runs belong to different people.* `batterRunsOf` / `bowlerRunsOf` in
    lib/tournament-live.ts are the only place that decides. Byes and leg byes
    are the keeper's, never charged to the bowler — charging them inflated
    every economy rate on a bye. A no-ball's penalty is nobody's, but what the
    batter hits off it is theirs. Figures are derived on every read, so fixing
    a rule restates past matches correctly rather than needing a backfill.
    (d) *A run-out is not the bowler's wicket.* It must not reach their figures
    or the Most Wickets leaderboard, and it can take the batter at the **other**
    end, so the scorer names who went. `lib/cricket-dismissal.ts` is the single
    place both questions are answered — the fold credits figures and the match
    centre renders the line, and if they disagree the scorer can see it.
    Dismissal labels degrade to the shortest *true* statement (`caught`, not
    `c — b —`) because matches scored before fielder capture have no fielder
    and never will.

---

## 5. Recent work — feature batch (2026-08-06)

Five items requested together and shipped as a batch. All on `main` via merge commit
**`eeb834f`**. Kept here because the *reasoning* behind each is not recoverable from the diff.

### #1 — App startup loader flash (`043467a`)
**Problem:** cold-starting the app showed a loader, then the landing screen snapped in
fully-populated — a jarring layout jump.
**Fix:** `apps/mobile/src/screens/home/HomeScreen.tsx` gained `modulesLoading` and
`dashboardLoading`; the CTA row holds `heroTilePlaceholder` tiles and the bookings section
shows two `<Skeleton height={92} rounded="xl" />` while data loads, so the layout is stable
from the first frame.

### #2 — Camps payment options (`42f869d` server, `3ad3d25` client)
**Problem:** camp registration jumped straight into Razorpay, unlike every other funnel
(booking, cafe, pass, tournament) which lead with a UPI QR.
**Fix:**
- New routes `app/api/phonepe/dqr/camp-initiate/route.ts` and `camp-status/route.ts`,
  mirroring the tournament pair. **The amount is computed server-side** —
  `gross = feeMode === "ADVANCE" ? round(fee * advancePct / 100) : fee`,
  `payable = max(0, gross - paidAmount)`. The client never sends an amount.
- `lib/camps.ts` gained `confirmDqrCamp(transactionId, providerReferenceId, amountPaise)`
  with suffix-match recovery for superseded `DQRC_<tail>_<ms>` transactions.
- `app/api/phonepe/dqr-callback/route.ts` gained a **camp branch before the pass branch**, so
  a payer who closes the tab is still confirmed server-to-server.
- Web: `app/camps/[slug]/page.tsx` computes `dqrAvailable = isDqrConfigured() && !!gatewayCfg?.dqrEnabled`
  and passes it to `register-client.tsx`, which now has a two-way method picker, a QR sheet,
  and a status poll.
- App: `/api/mobile/camps` carries `dqrAvailable`; `apps/mobile/src/lib/camps.ts` gained
  `initiateCampDqr` / `pollCampDqr`; `CampsScreen.tsx` got the picker and a QR overlay.
- `components/payment/dqr-checkout.tsx` gained `surface: "camp"`, and its nested route
  ternaries were replaced with explicit `INITIATE_URL` / `STATUS_URL` maps — the old
  ternaries silently fell through to the booking route for any unnamed surface.

### #3 — Admin couldn't see/apply coupons when creating a booking (`f9a2468`)
**Two independent causes**, both real:
- **Web:** `listAdminSportCoupons` in `actions/admin-coupons.ts` was gated on
  `MANAGE_COUPONS`, but its only caller is the create-booking form. A desk admin holding
  `MANAGE_BOOKINGS` but not `MANAGE_COUPONS` hit the throw, the form's `.catch()` swallowed
  it, and the picker rendered as simply **absent**. Gate is now `MANAGE_BOOKINGS`.
- **App:** the admin create-booking screen had **no coupon UI at all**. The POST route
  already accepted `applyCouponCode`; nothing ever sent it.
**Fix:** the query moved to a shared `lib/admin-coupon-options.ts` so both surfaces list the
same coupons; new endpoint `/api/mobile/admin/bookings/coupon-options`; a coupon chip row
with live discount preview in `AdminCreateBookingScreen.tsx`.
**Also added:** a `restrictedNote` ("First Time only · once per customer") shown on both
surfaces. FLAT100 carries `userGroupFilter: ["FIRST_TIME"]` and `maxUsesPerUser: 1`, so it
can legitimately be rejected at create time — the admin needs to see why before tapping.
Coupon and custom-amount are mutually exclusive (the server rejects both together).

### #4 + #5 — Match scoring: players, full options, local-first pad (`0403b94`)
This is "Score a Match" — the **casual/scratch match** feature under the app's Account
screen. It is completely separate from tournament scoring, which stays behind an
admin-issued rotatable scorer code.

**Layout (#4):** the pad was a 4-up grid of 23%-wide tiles that didn't clear 100% with its
gaps — six run buttons wrapped 4+2 leaving a ragged tail, and team names overflowed the wide
tiles. Rebuilt as a **3-up grid** (`31.5%`) with half/full spans and a fixed overs column so
the two board rows line up.

**Players + scoring options (#4):** rosters, the opening pair, the bowler and per-event
player tagging all ride **inside the existing `PublicMatch.events` JSON log** — chosen
deliberately so **no migration was needed**. `lib/public-match.ts` now defines:
```ts
type ScoreEvent =
  | { t:"SQUAD"; side:"A"|"B"; players:string[] }
  | { t:"OPEN"; striker:string; nonStriker:string; bowler:string }
  | { t:"BOWLER"; name:string }
  | { t:"RUN"; runs:number } | { t:"BYE"; runs:number } | { t:"LEG_BYE"; runs:number }
  | { t:"WIDE"; runs?:number } | { t:"NO_BALL"; runs?:number }
  | { t:"WICKET"; kind?:WicketKind; batter?:string; fielder?:string; newBatter?:string }
  | { t:"RETIRE"; batter?:string; newBatter?:string }
  | { t:"SWAP" } | { t:"END_INNINGS" }
  | { t:"POINT"; side:"A"|"B"; player?:string; assist?:string }
  | { t:"CARD"; side:"A"|"B"; player:string; kind:"YELLOW"|"RED" };
```
`replay(events, sport)` derives everything: batting/bowling cards, extras breakdown, the
this-over strip, automatic strike rotation (odd runs and end-of-over), and a forced
next-bowler prompt when an over closes. Football/pickleball get squads, goal/point scorers
and cards.

**Efficiency (#5) — the researched answer:** the pad used to POST on every tap and wait.
It now applies each tap to an **on-device event log**, re-renders from a **local replay**,
and flushes the queue as **one batched write ~700ms later**. This is the approach real
scoring apps take: *the log is the wire format*, so the server replays exactly what the
phone did and the two cannot drift. Results: an over is 1 request instead of 6, taps
register instantly, a dropped connection queues instead of failing (with an "N to sync"
pill and a retry), and a server rejection **re-seeds from the server** rather than letting
the phone keep scoring on a fork.
- Mirror engine: `apps/mobile/src/lib/match-engine.ts` (must stay in sync with
  `lib/public-match.ts`).
- `scorePublicMatch` accepts a single event **or an array**; `/api/match` accepts `events[]`
  and returns the replayed state from the write itself (no second read). GET now also
  returns the raw `events` so the phone can seed its local log.

**Verified by hand** on a mixed over: 16 team runs, 6 legal balls, bowler charged 15 (byes
correctly not charged), over-end strike rotation, and the incoming batter correctly taking
the fallen batter's end.

---

## 6. Recent work — cold-start performance (2026-08-06)

Shipped to `main` as merge **`af1b75b`** (dev commit `d2b3101`).

**Reported symptom:** "After opening the app after force close it takes too much time by API
to respond and render the landing screen."

**Measured, not guessed.** Production response headers revealed the shape of it:
```
x-vercel-id:    bom1::iad1::...
cache-control:  public, max-age=0, must-revalidate
x-vercel-cache: MISS
```
Three compounding causes:

### (a) Geography, with zero caching
Requests enter at the **Mumbai edge (`bom1`)** but functions execute in **Virginia
(`iad1`)**, next to the Neon primary (`us-east-1`). Every call paid a ~250ms
Mumbai→Virginia→Mumbai round trip *before the handler ran a line*. Nothing was ever cached.
Measured **400–730ms TTFB**, warm, on each landing-screen endpoint — and a cold start fires
five of them.

**Fix:** `lib/api-cache.ts` exports `CACHE.catalog` (`s-maxage=60, swr=300`) and
`CACHE.promo` (`s-maxage=120, swr=600`). Applied to the public GETs — tournaments, camps hub
+ list, promo banners — which are byte-identical for every caller. A hit is served from
Mumbai (~25ms) and the revalidation happens behind the user.

> **Cache-correctness rule, important:** only responses with **no per-user and no
> per-platform variation** may carry these headers. Deliberately excluded:
> - `/api/mobile/camps?mine=1` — per-user.
> - `/api/mobile/sport-promo` — varies by **platform** (an App-only coupon must not leak to
>   the web build); a CDN keyed on URL alone would serve the wrong one.
>
> Both were confirmed to come back with **no** cache header.

### (b) Serialised DB reads
`/api/mobile/tournaments` awaited the module flag, *then* the list, *then* the gateway
config — three separate Virginia round trips for data that never referenced each other.
Camps did two. Both are now `Promise.all`. `sport-promo` was resolving the JWT ahead of the
promo query purely to decorate a log line; that now runs alongside it.

### (c) No warm start — the one that matched the complaint most directly
Force-closing drops the entire TanStack Query cache, so the landing screen had **nothing to
draw** and sat on skeletons until all five requests returned.

**Fix:** `apps/mobile/src/lib/queryPersist.ts` — a hand-rolled disk cache on the **MMKV store
the app already ships**. Deliberately *not* `@tanstack/react-query-persist-client`:
**no new dependency ⇒ no fingerprint change ⇒ this reaches phones over OTA** instead of
needing a store build. `hydrateQueryCache()` runs at module load in `queryClient.ts` (before
first render); entries keep their **original** `dataUpdatedAt` so react-query still treats
them as stale and refetches — the first frame is last-known data, the refresh lands
underneath it. `gcTime` also raised 5min → 30min.

**Safety constraints baked in:**
- Whitelist only: `dashboard`, `tournaments`, `camps-hub`, `promo-banners`, `sport-promo`,
  `my-passes`, `notifications`. **Slot grids and payment/QR state are never restored** — a
  stale availability grid would let someone tap a slot that's already gone.
- 24h max age on restored entries.
- Sign-out calls `queryClient.removeQueries()` + `clearPersistedQueries()` so the next person
  on the phone can't see the previous owner's bookings on the first frame.

**Verification:** headers confirmed against a real `next build` + `next start` (dev mode
forces `no-store`, so the dev server proves nothing). Payloads confirmed unchanged on all
four endpoints. This mattered — `force-dynamic` on the tournaments route could plausibly
have overridden the header. It doesn't.

---

## 6b. Website ↔ app bridge (2026-08-06)

**Deep links.** momentumarena.com links open the app when installed, else the
site. Both halves live here:
- Web: `/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json`,
  served from routes (Apple's must be `application/json` with NO `.json`
  extension). Team ID and both Android fingerprints are constants in
  `lib/app-store-links.ts` — **none of them are secret**, they're published
  inside those world-readable files by design.
- App: `associated-domains` entitlement (iOS), `autoVerify` intent-filter
  (Android), `momentumarena://` scheme, and `apps/mobile/src/navigation/linking.ts`
  mapping URLs → screens.

> Android lists TWO fingerprints. Play App Signing re-signs, so Store installs
> carry the app-signing key, not the upload key. Listing only the upload key
> makes links work on test builds and fail **silently** in production.

**Get-the-app prompts** — sticky strip under the mobile header, store icon in
the header, footer download row. All three gated by one flag,
`ArenaSettings.downloadAppBannerEnabled`, **default OFF**, toggled at
`/admin/config/download-app-banner`. Gated inside `StoreBadges` so no caller
can forget it; the footer row and the strip gate separately too, because
hiding only the badges left a heading above empty space.

**App SEO** — `apple-itunes-app` (Smart App Banner), `google-play-app`, `al:*`
App Links tags, two `MobileApplication` JSON-LD entries, `metadataBase`, a real
1200×630 OG card, and a PWA manifest. These are deliberately NOT gated by the
banner switch: they describe the app to crawlers rather than prompting a
visitor.

**Push templates** — `lib/push-templates.ts` now covers passes, tournaments,
camps and shop alongside bookings/cafe/rewards. Adding a module means adding
its templates here, or it ships with no push voice at all.

---

## 7. Current state

### Owed to the next NATIVE build

- **The photo-permission string.** `NSPhotoLibraryUsageDescription` still says "so you can
  set a logo for your tournament team" — written when tournament logos were the only thing
  that needed the library, and now the first thing a staff member reads before photographing
  a page of the cafe register in Admin → Cafe → From register.
  The fix is a one-line change in **both** `apps/mobile/app.json` (`photosPermission`) and
  `apps/mobile/ios/MomentumArena/Info.plist` — they diverge, and only one reaches the device
  depending on the build path. Suggested wording: *"Momentum Arena uses your photos to set a
  team logo, and for staff to upload a page of the cafe register."*
  It was written once (53b00b5) and **reverted on purpose** (2026-09-07): native config
  changes the Expo fingerprint, so it blocked the production OTA for every JS change promoted
  alongside it — the bookings payment-status pill and the whole register screen included. A
  cosmetic string is not worth holding a release hostage; re-apply it with the next store
  build, when the fingerprint is changing anyway.

  **The general rule this is an instance of:** anything touching `app.json`, `ios/` or
  `android/` blocks the OTA for everything promoted with it. Batch native-config edits with a
  planned store release rather than letting one ride along with JS work.


- **`main` = `8204a2c`** (2026-08-24). `development` is level with it — the promotion gate
  prints nothing, the two trees are byte-identical. (`development` had drifted 52 commits
  *behind* `main` while staying content-identical, because every promotion is a `--no-ff`
  merge of dev into main and nothing ever fast-forwarded dev back. Realigned 2026-08-24.)
- **A verification gate now exists.** `.github/workflows/ci.yml` runs the web typecheck, the
  test suite, and the mobile typecheck against its 15-error baseline on every push and PR to
  `main`/`development`. Before this, *every* workflow in the repo was deploy/seed/cron and
  nothing ever typechecked — a broken build was found by Vercel or by a customer. Run the
  same checks locally with `npm run typecheck && npm test`.
- **Web/API changes are live** once Vercel finishes deploying. The edge caching and route
  parallelisation benefit the app immediately too, since the app calls the same endpoints —
  no app update needed for that half.
- First request to each newly-cached endpoint after deploy is still a MISS; the edge fills on
  first use. Confirm with (run twice — second should say `HIT`):
  ```bash
  curl -sI https://www.momentumarena.com/api/mobile/tournaments | grep -i "cache-control\|x-vercel-cache"
  ```

### Known open items
- **OTA rollout status is UNVERIFIED.** The 2026-08-06 entry here said the query-cache
  persistence, match-scoring rebuild, camps UPI picker and admin coupon picker were sitting
  in the bundle awaiting an OTA rollout. Whether that rollout was ever cut was not confirmed
  when this line was rewritten (2026-08-24) — check the admin rollout dashboard before
  assuming either way, and delete this bullet once you know.
- **Task #68** — UPI *intent* (tap-to-pay) end-to-end test. The admin toggle exists. The user
  has said it is working fine, but it was never formally closed out. Related history: a
  Paytm-intent stuck-payment incident means the **intent toggle** has been handled cautiously.
- Older backlog context lives in the user's memory files (see §9).

---

## 7b. Challenges (team matchmaking) — phase 1, `development` only

**The problem it solves.** A whole-ground booking is ₹2,000, which is nothing
between two full sides and impossible for one person or a half-team. Challenges
let a captain put up a match — sport, how many players they have, up to three
times they could play — and let another captain take it, so two halves of a
booking find each other before either pays.

**Shape.** One API door (`app/api/mobile/challenges/route.ts`): GET returns the
whole viewer-shaped payload (`board`, `mine`, `limits`, `copy`, `homeCard`), POST
is a discriminated union of `post | accept | counter | withdraw | track`. Rules
are pure and separately tested in `lib/challenge-rules.ts`; everything that
touches the database is in `lib/challenges.ts`. **App-only by design** — there is
no public web surface, and every knob is admin-configured at
`/admin/challenges`.

**Why the module logs so heavily.** `ChallengeEvent` records every action that
reaches the server *and every refusal, with the exact sentence the user was
shown*. The reason is that a board with no posts looks identical whether nobody
found the feature, found it and left, or tried to post and was turned away —
and only the refusal reasons tell those three apart. Before rolling this out
the venue asked to see every click, and the refusals are the half of that which
is actually diagnostic. Logging is best-effort (`void logChallengeEvent(...)`),
never awaited into a failure: a board that broke because its telemetry did
would be worse than one nobody can measure.

**Two traps already hit inside the funnel:**

- The Home card reads the same GET endpoint for its copy, so it was logging a
  `BOARD_VIEWED` on every Home render — which made board views a count of Home
  renders and pinned the impression→open step at 100%. The Home read now sends
  `?for=home` and is excluded from that log. **Any new caller of that endpoint
  must decide which side of this line it is on.**
- `HOME_CARD_SHOWN` is the funnel's denominator and is fired once per app
  session from a ref, not per render. Without it a tap count means nothing:
  40 taps is a triumph against 200 impressions and a failure against 20,000.
- Both challenge screens wrapped their calls in
  `.catch(() => "Couldn't reach the arena.")`, and `api.ts` signals a refusal
  by *throwing* — so every deliberate server refusal was reported to the user
  as a network failure while the event log recorded the real reason. The log
  and the user's experience disagreed, which makes a refusal log worse than
  none. `challengeErrorMessage` reads the reason off `ApiError` and keeps the
  reachability sentence for `status === 0`, which is how `api.ts` reports an
  actual unreachable host.
- `expireStaleChallenges` reads the doomed rows before updating them so each
  gets its own `EXPIRED` event. A bulk `updateMany` was cheaper and left the
  feed showing `POSTED` then silence forever, with nothing to separate a
  challenge still waiting from one that died unanswered — the feature's whole
  failure mode.
- `logChallengeEvent` takes Prisma's `ChallengeEventType`, not a hand-copied
  union of the same names: the copy drifts the first time somebody adds a
  type and edits only one of the two lists.

**The home card fails CLOSED** (`!!enabled && !!homeCard?.enabled`), unlike
Quick book which fails open. Quick book hidden in error costs a working booking
route; a challenge card shown in error sends somebody to a board that refuses
them, which is a worse first impression of a feature they have never heard of.

**Screens are registered in BOTH the Home and Account stacks** (the
Notifications precedent), so Back from the Home card returns to Home rather
than stranding the user on a tab they never chose.

**Paying: the first half blocks the court** (venue's decision, 2026-09-18;
`lib/challenge-payments.ts`). No Indian rail can hold a UPI customer's money
pending a stranger's decision — Razorpay auth/capture is card-only, UPI
mandates exclude PhonePe and GPay — so somebody's money is exposed whatever
you do, and the only question is against what. Blocking on the first payment
means that captain's money buys the hour immediately.

Three consequences worth knowing before touching this:

- **A PENDING `Booking` IS the block.** `OCCUPYING_BOOKING_STATUSES` already
  includes PENDING, so creating the booking takes the hour off the board with
  no new hold concept. Do not add one.
- **It is an ordinary booking, which is why analytics needed no changes.**
  Money reaches revenue through the same `Booking`-joined queries as
  everything else, so the module adds no new stream and escapes the
  four-surface trap (gotcha 1) that has caught every previous one.
- **`SLOT_LOST` is now nearly unreachable**, which was the point. The
  alternative — hold nothing until both pay — had a case where both paid and a
  walk-in had taken the hour in between: two refunds, no match. Now losing the
  slot happens before any money moves, so it is a refusal rather than a refund.

The mirror case is deliberately NOT automated: one side pays, the other never
does, and the venue holds a blocked court against half the money. That is
operationally identical to an advance booking whose customer never returned —
chase it, take the balance at the gate, or cancel and refund by hand. The
admin board has a "half paid" panel listing exactly these. **Do not add a
timer that releases the court**: it would drop a slot the venue may already
have sold on the phone, and it would take money for something it then
un-booked.

**Four invariants in `confirmChallengePayment` that testing paid for.** Each
of these was a real defect found by a zero-context agent against staging, and
each is the kind that reads as fine in a diff:

1. **`placedAt`, not `paidAt`, is what counts as paid.** `claimSlot` stamps
   `paidAt` before any money is placed, so counting it let a half whose
   placement died mid-flight write CONFIRMED — and `alreadyDone` then
   short-circuited every retry, permanently. `paidSides()` filters on BOTH,
   and both placement paths stamp `placedAt` inside the same transaction that
   moves the money. Never widen that filter back to `paidAt`. (The
   *withdraw* and *expiry* guards in `lib/challenges.ts` correctly use the
   looser `paidAt` — there a claimed capture is still real money that must
   block the sweep.)
2. **Create-and-attach is one transaction.** As two statements it left a
   window where a PENDING booking occupied the hour while `challenge.bookingId`
   was still null; a second captain paying inside it was told the hour was
   gone and promised a refund on a match that was booked and confirmed. A
   crash in that window also orphaned a booking that held the hour for ever,
   after which every later payment read as `SLOT_LOST`.
3. **Once the court is sold, every number comes off the BOOKING.** The
   second half's charge, the quote the app shows, and the ledger move must be
   one number. Re-quoting live meant an `advancePct` edit between the halves
   charged ₹750 against a ₹500 ledger move (customer pays ₹2250 for a ₹2000
   court) or ₹250 against ₹500 (₹250 of revenue nobody paid).
   `sharesAgainstBooking` in `lib/challenge-rules.ts` holds the invariant and
   is property-tested: the two halves always add to the booking's advance.
4. **The lead-time gate runs at capture, not only at order.** Otherwise a
   captain opens the sheet at T−4h01m and presses pay at T−5m.

**Two rules about the admin screen that testing kept re-teaching.**

1. **GATE ONLY WHAT THIS SAVE TOUCHES.** The form saves one field per blur,
   so any cross-field validation run against the merged settings refuses
   *every* save while one stored pair is inconsistent — including
   `enabled: false`. Twice now that has meant the venue could not switch off
   a wheel because the band describing it was out of range: a kill switch the
   thing it kills can disable is not a kill switch. Every guard in
   `saveChallengeSettings` is now conditioned on `input.<field> !== undefined`.
2. **A worklist must be a server query, and it must count what it means.**
   The half-paid panel tested `!payments.every(paid)` — but `ChallengePayment`
   rows are created LAZILY, one per side, when that side first opens a payment
   sheet. The canonical half-paid state therefore has exactly ONE row,
   `every()` over it is vacuously true, and the panel built for that case was
   the one case it excluded. Count DISTINCT SIDES. And both money panels are
   asked for directly (uncapped) rather than derived from the 200-row list the
   board renders: a list of things the venue owes must not silently truncate.

**Anything the screen tells the venue to do, the screen must be able to do.**
The refunds panel said "mark it refunded on the payment" for weeks while
nothing in the product could write `refundedAt` — so the queue only grew, and
because the take-down guard counted flagged money as still held, those
challenges could not be closed either. `markChallengePaymentRefunded` records
the arena's own act (the refund itself is made by hand in Razorpay or in
cash), and take-down now excludes flagged money.

**The form must re-read the database after a save.** `router.refresh()`
re-renders the server component but cannot re-seed `useState`, so the screen
showed what was TYPED rather than what was STORED — a 238-character board
title displayed in full while the app served it cut at 200, and a saved
custom wheel left the banner insisting the built-in one was live. Every
editor on that page needs its own re-sync effect keyed on the prop, including
each child editor: the page-level rollback cannot reach into them.

**`PART_PAID` is not a challenge "on the board".** It is matched, off the
board, unwithdrawable by rule and never swept, so counting it in the
one-live-challenge-per-person gate locked out the captain who paid FIRST when
their opponent never paid — while telling them to withdraw something no
surface lets them withdraw. The person who did everything right was the one
punished.

**The match's own copy is the venue's too** (`DEFAULT_LIFECYCLE_PUSHES` in
`lib/challenge-push.ts`). A time is agreed, your half is due, match
confirmed, the hour went, a refund is owed — five stored templates with their
own variable set. Deliberately unlike the promo nudges, an empty value is NOT
"off" for these: a captain whose court is held and who is never told has lost
money to silence, so only the words are configurable. Corollary, learned the
hard way twice: **never ship a setting the runtime does not read** —
`pushAudience` and `pushDailyCap` were saved, validated and bounded while no
broadcast existed to consume them, and their help text described behaviour
the product did not have.

**The stamp that says "this half is placed" must be in the SAME COMMIT as
the money.** This bug has now been fixed three times at three different
depths, each fix moving it one function down: first `paidAt` counted as paid,
then `placedAt` was stamped before the ledger transaction in `settleAgainst`.
A crash in that window is the worst state this module can reach, because it is
invisible to *every* recovery path at once — the retry short-circuits, the
repair sweep skips placed rows, the half-paid panel sees two paid sides, the
refunds panel sees no flag, and the customer is told they have already paid.
Both placement paths now use one interactive transaction in which the
conditional stamp is also the serialisation point: whoever stamps, settles.

**`ChallengeOrder` is the ledger that outlives everything.** Every Razorpay
order this module opens is recorded there, with no relation to Challenge or
ChallengePayment — deliberately, so it survives their deletion and
reassignment. It exists because a capture could otherwise vanish entirely:
when a stale payment slot is taken over the row is reassigned and its order id
cleared, and when a challenge row is deleted the payment cascades and even the
audit line fails on its own foreign key. An unmatched capture is now asked one
question — *did we open this order?* — which separates a genuinely stranded
payer (flag, notify, put it on the refunds queue) from somebody replaying an
ordinary booking receipt at the endpoint (log once, claim nothing). Never
collapse those two branches again; one of them is the audit-spam vector.

**Pin the advance at order time (`ChallengePayment.quotedAdvance`).** Reading
`advancePct` when the capture lands meant the booking's advance and the money
charged described different deals whenever the venue edited the percentage
while a sheet was open: at 50→100, a 1:3 split on an "each pays half" feature;
at 50→10, a second half of ₹0, which Razorpay refuses — so that captain could
never pay and the court stayed blocked and unconfirmable for ever.

**Every refusal that carries captured money must dedupe on its own flag.**
`refundOwed` fired unconditionally, so replaying a triple re-notified the payer
and re-stated the debt: four replays read as ₹2,000 owed on one ₹500 capture.
The conditional stamp is the claim — whoever sets it does the telling.

**Captured money that cannot be honoured is flagged, not just narrated.**
`refundOwed` stamps `ChallengePayment.refundOwedAt`/`refundOwedReason` as well
as writing the event, because the admin's stranded-money panel is a query and
a sentence in the activity feed is not. The two *pre-claim* refusals are
deliberately different: a capture that matches no challenge row is somebody
replaying an ordinary booking receipt at this endpoint, so it is logged once
per payment id and claims no refund — without that dedupe the audit trail was
an open write endpoint.

It charges `ChallengeSettings.advancePct` (default 50) of the court, not the
whole court — the rest is collected at the gate like any advance booking. The
retired `holdMinsAfterFirstPayment` knob described the old temporary hold; it
was removed rather than left lying because a settings field that promises
behaviour the system no longer has is worse than no field.

**The prize wheel** (`lib/challenge-spin.ts`, `lib/challenge-push.ts`).
A confirmed challenge earns its POSTER one spin for a discount on an extra
hour, headlined "up to 50%" and weighted so the average lands in the
venue's band. Four things about it are load-bearing:

- **Average, floor and ceiling cannot all be inputs.** They are not
  independent — floor 15 / ceiling 50 / average 25 may have no distribution
  that satisfies it. The admin edits SEGMENTS AND WEIGHTS; the average is
  derived, shown live, and a save outside the band is refused. Do not
  "simplify" this into three number boxes.
- **The draw is honestly weighted and written before the device hears it.**
  50% rarely stops because it rarely WINS, not because an animation is
  steered off a result it already landed on — and the row exists before the
  spin animates, so killing the app mid-spin cannot re-roll.
- **Two offers on two clocks.** ADJACENT is the hour after the match, held
  unsold while the captain asks his side, so its window is minutes.
  FALLBACK is any hour in the next few days when that hour was taken;
  nothing is held, so it can be longer. Both windows, both nudge schedules
  and every word of every push are admin-set — `{minsLeft}`, `{pct}`,
  `{price}`, `{saving}`, `{hour}`, `{date}`, `{court}` are substituted at
  send time. A nudge configured at or above its own window never fires, so
  both the admin UI and `pushScheduleRefusal` reject it.
- **Nudges are "marker reached", not "marker equals".** A cron that skips a
  minute must still send the last call, which is the one that converts;
  each marker is recorded on the offer so an overlapping run cannot
  double-send. `/api/cron/challenge-offers` runs every minute.
- **That cron also repairs money, so it is not optional.** It sweeps
  `ChallengePayment` rows that were claimed and never placed and finishes
  them (`resumeStalledPayments`). A capture is claimed before any booking
  work, and the app verifies once, so without the sweep a request that died
  in between leaves real money holding no court until a human notices.
  GitHub only schedules `on: schedule` workflows from the **default branch**,
  which means `cron-challenge-offers.yml` does nothing on `development` —
  **it must be confirmed running before this module carries real money.**

**ACCEPTING IS PAYING** (2026-09-19). There is no free AGREED state any
more: a stranger buys into a challenge by paying their half, and that
payment settles the window. This creates a race the old flow could not —
two strangers reaching for one unique ACCEPTOR slot — so an unpaid payment
row locks it for `paymentWindowMins` before going stale. Without that lock
the second caller's upsert steals the first's row and the first's capture
lands on a row that is no longer theirs: money taken for nothing.

`minLeadMins` (default 240) blocks posting and accepting close to the slot.
It is deliberately NOT applied to the poster's own half — that is chasing
money for an hour already blocked — nor to the adjacent-hour prize, which
is the same session with staff already there. `slotStart()` converts a
`@db.Date` plus an IST wall-clock hour into a real instant without
host-local getters; doing it the obvious way is gotcha 18 and puts the gate
5½ hours out on production only.

Still not built: push beyond the in-app notification rows, and any automated
refund.

---

## 8. File map — where things live

**Server / shared**
- `lib/ist.ts` — IST calendar arithmetic that does not read the host timezone.
  **Any date bucketing on money must go through this**, never through JS local
  getters — see gotcha 18 for what that cost. Mirrors the SQL side's
  `+ interval '330 minutes'`.
- `lib/pnl-math.ts` + `actions/admin-pnl.ts` — the Overall P&L (`/admin/analytics/overall`,
  superadmin-only). The maths lives in the lib so it can be tested without a DB
  (`tests/pnl-math.test.ts`) and so the `"use server"` file exports only its action —
  see gotcha 17. **The accounting model is written at the top of `admin-pnl.ts`; read it
  before changing a row.** Two things it deliberately does NOT do: subtract
  `CafeItem.costPrice` (cafe stock is already a RUNNING "Inventory" expense — subtracting
  both double-counts it, and `costPrice` rewrites history when an item is re-priced), and
  include `Expense(module=GENERAL)` (that is the ₹50L build-out capex; it belongs in the
  funding/payback block, not in operating profit). Income mirrors
  `getMonthlyEarningsForYear`'s bucketing exactly — bookings by play date, everything else
  by paid time — because reconciling with the Sports tab matters more than internal purity.
  **Pre-July-2026 months carry no expense line and that is correct**, not a data gap: the
  arena was still being built and every cost was capitalised into GENERAL, so revenue earned
  then is operating profit in full (owner's ruling, 2026-09-02). `isExpenseGap()` therefore
  only flags an expense-free month at or after the first RUNNING expense — where it means
  somebody stopped entering, and an unflagged 100% margin would be believed.
- `lib/pass-revenue.ts` — **the only definition of which pass sales count as
  revenue** (`price > 0`, not `CANCELLED`). It was counted in NINE places —
  revenue chart, KPI tiles, sport split, monthly and daily earnings, P&L, CA
  report — none of which filtered on status, so cancelling a pass flipped a
  status and left the money on the books. Cancelling now reverses the sale:
  the price stops counting, and the bookings made on the pass are cancelled
  (which frees the court, unwinds rewards, and returns minutes to any OTHER
  pass that part-covered them). Order matters — `restorePassForBooking` sets
  a pass back to ACTIVE, so bookings must be cancelled BEFORE the pass is
  marked, and `tests/pass-revenue.test.ts` asserts that ordering.
- `lib/phone-match.ts` — matching a typed phone to an account, on the last
  ten digits. Venue registration never linked a team's captain, and the bill
  arrived weeks later as a prize pass with nobody to issue it to. Links only
  on exactly one match; several accounts on a number are left alone.
- `lib/cricket-rules.ts` — **the Laws of Cricket, and the only implementation of them.**
  Who the wicket belongs to, which end the new batter takes after a run out, whether a
  delivery costs a ball, who faced it, whose column each run lands in, what a free hit
  permits, when a bowler is spent. Pure: no state shape, no player model, so the casual
  engine (players as names) and the tournament fold (players as member ids) both use it.
  Mirrored at `apps/mobile/src/lib/cricket-rules.ts` only because Metro roots at
  `apps/mobile` and cannot resolve the web lib; `tests/cricket-rules.test.ts` drives both
  across every kind, delivery, end, run split and over cap (~900 comparisons).
- `lib/tournament-live.ts` — tournament fold (event log → `liveState`). Owns tournament
  concerns — commentary, player stats, partnerships, targets, super overs — and delegates
  every shared rule to `cricket-rules.ts`. Super overs are modelled as MORE INNINGS
  (1–2 the match, 3–4 the first super over, 5–6 the second) so the fold, scorecard and
  over-strip needed no changes; the match score deliberately stays the match score.
- `lib/cricket-dismissal.ts` — adapter, not a rulebook. Tournament events store lowercase
  strings (`"runout"`) and every stored event must keep folding the same, so the wire
  format stays; the questions it used to answer itself are delegated.
- `lib/public-match.ts` — scratch-match event log + `replay()`. **Source of truth**; mirrored
  at `apps/mobile/src/lib/match-engine.ts` — keep the two in sync. **This is now enforced:**
  `tests/match-engine.parity.test.ts` drives both `replay()`s with identical logs (including a
  2000-log deterministic fuzz) and fails CI on any divergence. The mirror exists because the
  phone replays locally for instant taps while the server replays on write — "the log is the
  wire format" — so a drift silently forks the phone from the scoreboard mid-match.
- `lib/api-cache.ts` — `CACHE.catalog` / `CACHE.promo` edge-cache headers. Read the doc
  comment before applying to a new route.
- `lib/admin-coupon-options.ts` — shared coupon prefilter for web + app create-booking.
- `lib/payment-split.ts` — `venueAmountStillDue(totalAmount, payment)`. Nets off
  `remainderCashAmount + remainderUpiAmount` but **not** discount legs (those already reduce
  `Booking.totalAmount`). Mirrored at **`apps/mobile/src/lib/payment-split.ts`** — extracted
  2026-08-24 out of `apps/mobile/src/lib/admin-bookings.ts` (which imports `react-native` and
  so could never be loaded by a test runner); `admin-bookings.ts` re-exports it, so every
  import site is unchanged. `tests/payment-split.parity.test.ts` pins the two together.
  **Known non-identical branch:** the mobile copy short-circuits on `isPartialPayment` and the
  server copy does not. It is unreachable rather than harmless — every writer that sets
  `remainingAmount > 0` also sets `isPartialPayment: true`, and
  `recomputePartialPaymentAmounts` nulls `remainingAmount` when a payment stops being partial.
  The test documents the divergent input explicitly so that if a migration ever makes it
  reachable, the failure names it. Do not "tidy" either copy to match the other without
  re-checking that invariant — it is a money path.
- `lib/tournament-scheduling.ts` — draw generator; hour-granular via
  `slotHourKey(slotId, startHour)`. Clusters teams by availability signature *before* dealing
  pools, which took forced compromises from 3 → 0.
- `lib/camps.ts`, `lib/tournaments.ts`, `lib/sport-theme.ts` (+ mobile twin),
  `lib/tournament-config.ts` (status transitions — `CANCELLED` can return to
  DRAFT/PUBLISHED/REG_OPEN/REG_CLOSED/POOLS_REVEALED/LIVE, added so a mis-clicked cancel is
  recoverable).
- `actions/admin-booking.ts` — `adminCreateBooking`, `markRemainderCollected` (accepts
  **partial** collection; `remaining` nets off `collectedSoFar`; status becomes `PARTIAL`
  while `stillOwed > 0`).
- `actions/admin-tournament-slots.ts` — slot CRUD, `setMatchDuration`, `getSlotPlanning`,
  `generateScheduleCandidates`, `approveSchedule`. Locking windows blocks those hours
  immediately.

**Quick book / booking bot** (`lib/booking-bot/`, `app/api/mobile/booking-bot/route.ts`,
`apps/mobile/src/screens/book/BookingBotScreen.tsx`)
- Deliberately a hand-written parser, not a model. The domain is three sports, a date and
  an hour range, and it sits in front of a price quote — so it is small enough to
  enumerate and test exhaustively, and it must not be free to invent a reading. It also
  runs server-side, so it improves over a Vercel deploy rather than a store release.
- `lib/booking-bot/fuzzy.ts` adds spelling tolerance by edit distance against a **closed**
  ~60-word vocabulary. Safe precisely because the list is closed; the worst case is the
  wrong weekday out of seven, and every correction is shown on the card.
- **Trap, learned the expensive way:** fuzzy matching harms correct input if left
  unguarded. `"day"` is ONE edit from `"may"`, and an early version rewrote
  `"day after tomorrow"` → `"may after tomorrow"` and booked a day early. The structural
  stop-list in `fuzzy.ts` and the "correct sentences pass through unchanged" corpus test
  are what keep that caught. Widen the vocabulary or the edit budget only with that test
  green.
- **Trap:** digit ranges are ambiguous between times and dates, and both readings usually
  survive every downstream check — `"12/9"` and `"12-09"` are valid as noon-to-9pm. Two
  narrow patches failed here before the general fix: parse the TIME first and blank the
  span it consumed before looking for a date, with a per-separator rule for the two
  separators that are also date separators.

**Tests** (`npm test` — Node's built-in runner via `tsx`, no test framework dependency)
- `tests/match-engine.parity.test.ts`, `tests/payment-split.parity.test.ts` — the two
  must-stay-in-sync pairs above. Both suites were mutation-checked when written: breaking a
  mirror on purpose fails them, so they are known to be capable of failing.
- `tests/booking-bot.test.ts` — includes a third sync guard: `VOCABULARY` in
  `lib/booking-bot/parse.ts` mirrors that file's own weekday/month tables and its sport
  and keyword regexes. It asserts every canonical form is still parseable, because a
  correction that rewrites a word INTO something unparseable makes messages worse rather
  than failing loudly.
- Adding a new mirrored pair? Add its parity test in the same commit, or the rule is a
  convention again.

**Mobile**
- `apps/mobile/src/lib/queryClient.ts` — QueryClient + hydrate/persist wiring.
- `apps/mobile/src/lib/queryPersist.ts` — MMKV-backed cache persistence.
- `apps/mobile/src/lib/api.ts` — API client; **connectivity is inferred from request
  outcomes**, not a native reachability module (that choice keeps it OTA-shippable).
  `subscribeConnectivity(fn)`. Aborts don't flip offline; any completed response clears it.
- `apps/mobile/src/components/OfflineBanner.tsx` — the "no internet" bar.
- `apps/mobile/src/screens/match/MatchScoreScreen.tsx` — the rebuilt scorer/scoreboard.
- `apps/mobile/src/screens/admin/AdminCreateBookingScreen.tsx` — admin booking creation.
- `apps/mobile/src/screens/home/HomeScreen.tsx`, `screens/camps/CampsScreen.tsx`.

**API routes of note**
- `app/api/match/route.ts` — scratch matches (create/score/undo/finish); accepts batched
  `events[]`.
- `app/api/mobile/*` — the app's entire surface.
- `app/api/phonepe/dqr/*` — per-surface initiate/status pairs (booking, cafe, pass,
  tournament, camp) + `dqr-callback` (S2S).

---

## 9. The user's persistent memory (history predating this doc)

The user keeps memory files at
`~/.claude/projects/-Users-nakulvarshney-Workspace-momentum-arena/memory/` with an index at
`MEMORY.md`. Notable entries — useful pointers if deeper history is needed:

`feedback_no_auto_main` (⚠️ never promote unprompted) · `project_booking_system` ·
`deployment_runbook` · `dqr_phonepe_integration` · `testflight_appstore` · `ota_self_hosted` ·
`admin_mobile_parity` · `mobile_admin_authz_audit` · `payment_orphan_leak_fix` ·
`app_coupons_first_app_booking` · `msg91_email_domain` · `ga4_mobile_analytics` ·
`pass_coverage_and_dqr_recovery` · `go_live_audit_2026_07_19` ·
`rewards_and_authz_hardening` · `store_launch_2026_07_24` · `nda_generator_2026_07_26` ·
`tournament_security_audit_2026_07_28` · `tournament_match_centre` ·
`tournament_engine_2026_07` · `book_via_checkout_redesign` · `session_handoff_2026_08_05`

---

## 10. Working preferences observed

- **Don't spawn many agents.** The user asked for this explicitly.
- Ship in batches; the user often says "we'll promote after all tasks completed" — that means
  keep working on `development`, not that promotion is pre-authorized.
- The user prefers **being driven to a real result** over hypotheses: when a bug was
  suspected, "You only drive a test tournament and test the scenario by yourself" — i.e.
  reproduce it end-to-end rather than reasoning about it.
- When a UI is wrong, the user has said **"Do not try to fix it. Redesign it again."**
- Be precise about which platform is meant — "mobile web" and "the app" are different
  surfaces and a fix to one is not a fix to the other.
- Report honestly: if something is only on `development`, say so; if a step was skipped, say
  so.

---

## 11. Quick-start checklist for a fresh session

```bash
# 1. Where am I?
git log --oneline -3 && git status --short

# 2. Refresh generated code FIRST — a stale Prisma client or an old node_modules
#    invents hundreds of phantom typecheck errors (§4.15).
npm install && npx prisma generate
(cd apps/mobile && npm install)

# 3. Baselines: web must be 0, mobile must be 15, tests must be green.
npm run typecheck
npm test
cd apps/mobile && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "error TS"
```

Then: work on `development`, keep web at 0 / mobile at 15 / tests green, don't touch `main`
unless asked, and don't add a native (or ideally any) dependency to `apps/mobile` if the
change is meant to ship over OTA.
