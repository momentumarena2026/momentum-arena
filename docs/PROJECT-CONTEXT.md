# Momentum Arena — Project Context

**This is the living orientation document for the whole codebase.** It is referenced from
`CLAUDE.md`, so any Claude session that opens this repo is pointed here regardless of which
machine or account it runs on.

**If you are a Claude session reading this for the first time:** read it end to end before
touching anything. It carries the rules, the deployment model, and the non-obvious traps
that are expensive to rediscover. Then verify before acting — anything naming a file, flag,
or function was true when written, so confirm it still exists before relying on it.

**Last substantive update:** 2026-08-15 · accurate as of `main` = `01213d4` (app 1.0.5).

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

- Primary working dir in the last session: a git worktree at
  `/Users/nakulvarshney/Workspace/momentum-arena/.claude/worktrees/_tf`
- That worktree sits on a **detached HEAD**. Push with an explicit refspec:
  `git push origin HEAD:development`
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

> **Note on a doc discrepancy.** `CLAUDE.md` §"Branch discipline" describes the gate as
> printing *nothing*. In practice it prints the three files above, because CI writes
> fingerprint/version commits directly onto `main` that `development` never receives. Three
> CI-owned files = clean. Anything else = stop. (Verified on the 2026-08-06 promotions
> `eeb834f` and `af1b75b`.)

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

---

## 4. Hard-won gotchas (these cost real debugging time)

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
13. **Cricket scoring has three rules that look like details and aren't.**
    (a) *Zero overs is not "unlimited", it is broken.* It switches off both the
    innings close and the NRR rule that charges a bowled-out side its full
    quota — which is how three matches in a live pool ended up with wrong net
    run rates. `startLiveMatch` now refuses a cricket match without 1–90 overs.
    (b) *Wickets per side is a tournament setting, not ten.* Momentum's cup
    plays 8; hardcoding 10 silently disabled the same all-out rule.
    (c) *A run-out is not the bowler's wicket.* It must not reach their figures
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

- **`main` = `af1b75b`.** `development` is level with it apart from the three CI-owned files.
- **Web/API changes are live** once Vercel finishes deploying. The edge caching and route
  parallelisation benefit the app immediately too, since the app calls the same endpoints —
  no app update needed for that half.
- **App-side changes are NOT yet on phones.** The query-cache persistence, the match-scoring
  rebuild, the camps UPI picker and the admin coupon picker all sit in the bundle until an
  **OTA rollout is cut**. This is the main outstanding action.
- No `prisma/**` changes in either promotion, so **no db push was triggered** and none is
  needed.
- First request to each newly-cached endpoint after deploy is still a MISS; the edge fills on
  first use. Confirm with (run twice — second should say `HIT`):
  ```bash
  curl -sI https://www.momentumarena.com/api/mobile/tournaments | grep -i "cache-control\|x-vercel-cache"
  ```

### Known open items
- **Task #68** — UPI *intent* (tap-to-pay) end-to-end test. The admin toggle exists. The user
  has said it is working fine, but it was never formally closed out. Related history: a
  Paytm-intent stuck-payment incident means the **intent toggle** has been handled cautiously.
- Older backlog context lives in the user's memory files (see §9).

---

## 8. File map — where things live

**Server / shared**
- `lib/public-match.ts` — scratch-match event log + `replay()`. **Source of truth**; mirrored
  at `apps/mobile/src/lib/match-engine.ts` — keep the two in sync.
- `lib/api-cache.ts` — `CACHE.catalog` / `CACHE.promo` edge-cache headers. Read the doc
  comment before applying to a new route.
- `lib/admin-coupon-options.ts` — shared coupon prefilter for web + app create-booking.
- `lib/payment-split.ts` — `venueAmountStillDue(totalAmount, payment)`. Nets off
  `remainderCashAmount + remainderUpiAmount` but **not** discount legs (those already reduce
  `Booking.totalAmount`). Mirrored in `apps/mobile/src/lib/admin-bookings.ts`.
- `lib/cricket-dismissal.ts` — pure: `creditsBowler()`, `needsFielder()`,
  `dismissalLine()`. The one authority on whether a wicket is the bowler's and how
  the scorecard reads. Both consoles mirror `needsFielder`'s intent when deciding
  whether to ask for a fielder — keep them agreeing.
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

# 2. Typecheck baselines: web must be 0, mobile must be 15
npx tsc --noEmit -p tsconfig.json | head
cd apps/mobile && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "error TS"
```

Then: work on `development`, keep web at 0 / mobile at 15, don't touch `main` unless asked,
and don't add a native (or ideally any) dependency to `apps/mobile` if the change is meant
to ship over OTA.
