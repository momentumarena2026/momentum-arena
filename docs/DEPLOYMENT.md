# Momentum Arena — Manual Deployment Runbook

Everything you need to ship **without help**. This repo deploys itself off two
git branches plus a handful of GitHub Actions workflows; there is no magic.

- **`development`** → staging (Vercel preview + staging DB)
- **`main`** → production (Vercel production + production DB)

Normal flow: commit your change → push to `development` (auto-deploys + tests on
staging) → **promote `development` → `main`** (auto-deploys to production).

> Schema sync is **fully automatic** (see §3): the Vercel build runs
> `prisma db push` before the code goes live, and the seed workflows are
> path-filtered to `prisma/**`. Never put `[skip ci]`-class tokens in commit
> messages — they're retired and a pre-push hook blocks the dangerous cases.

---

## 0. TL;DR cheat sheet

| You changed… | Do this |
|---|---|
| **Web/backend, no schema change** | push to `development`, then promote to `main` — nothing else |
| **Anything in `prisma/schema.prisma`** | same — the build syncs the DB automatically (keep changes additive, §3) |
| **A coupon / seed data** | run the matching `workflow_dispatch` workflow (§6) |
| **Mobile JS only** | push to `development`/`main` — OTA auto-publishes (§7); roll out from `/admin/ota` |
| **Mobile native code / new dependency** | push to `development` — test-track builds **auto-dispatch** on fingerprint change; production store builds are a manual `native-ios` / `native-android` dispatch (§8) |

---

## 1. Prerequisites (one-time)

- `git`, Node 20+, and the **GitHub CLI** (`gh auth login`).
- Push access to `momentumarena2026/momentum-arena`.
- You do **not** need any production secrets locally — schema pushes and seeds
  run inside GitHub Actions using repo secrets. Keep it that way (never paste
  `PRODUCTION_DB_URL` into a terminal).

---

## 2. Web / backend deploy (Vercel — automatic)

Vercel is wired to the repo via git. **Pushing the branch is the deploy.**

- Push to **`development`** → Vercel **preview/staging** build.
- Push to **`main`** → Vercel **production** build.
- `scripts/vercel-ignore.sh` skips the build when: (a) the branch isn't
  `main`/`development`, or (b) the diff is entirely under `apps/mobile/`
  (mobile-only change → no web rebuild needed).
- Build command is just `next build` (`prisma generate` runs on `postinstall`).
  **The build does NOT touch the database** — schema sync is separate (§3).

**Rollback (web):** Vercel dashboard → the project → *Deployments* → pick the last
good one → *Promote to Production* (a.k.a. "Instant Rollback"). No git needed.

---

## 3. Database schema sync — fully automatic ⚠️

There are **no Prisma migrations** applied on deploy. The schema is synced with
`prisma db push --accept-data-loss`, in **two automatic layers** (no commit-message
tokens, no decisions at promotion time):

1. **Inside every Vercel build** (`scripts/vercel-build.sh`, the `build` script):
   `pre-db-push-cleanup.sql` → `prisma db push` → `next build`. The deploy is
   **schema-atomic** — code can't go live against a DB missing its columns, and a
   failed push fails the build (the previous deployment keeps serving). Preview
   builds sync the staging DB, Production builds sync the prod DB, via each
   scope's `DATABASE_URL`. Local `npm run build` skips the DB steps entirely
   (guarded on the `$VERCEL` env).
2. **Path-filtered seed workflows** (belt-and-suspenders + seeding):
   - **`seed-staging.yml`** — push to `development` touching `prisma/**` → `STAGING_DB_URL`
   - **`seed-production.yml`** — push to `main` touching `prisma/**` → `PRODUCTION_DB_URL`

   Each runs: `pre-db-push-cleanup.sql` → `prisma db push` → `prisma/seed.ts`
   (only upserts the `gamelord` superadmin; it does **not** seed coupons/data).
   Both also expose `workflow_dispatch` as a recovery hatch — never needed in
   the normal flow.

**The retired `[skip ci]` convention:** commit messages used to control whether
the seed workflows ran. That was removed on 2026-07-02 after a token inside a
commit *body* ("NO [skip ci]: …") silently skipped a needed db push (GitHub
matches the token anywhere in the message). **Don't put `[skip ci]`-class tokens
in commit messages at all** — the path filters make them unnecessary, and a
local pre-push hook blocks the dangerous cases (token in body, or token on a
schema/mobile push).

Keep schema changes **additive** (new nullable/defaulted columns, new enum
values) so `db push --accept-data-loss` is safe — never rename/drop in the same
push as code that needs the old name.

---

## 4. Promote `development` → `main` (the core skill)

Run this once staging looks good. It fast-forwards production to whatever is on
`development`, with a verification gate.

```bash
cd <repo root>            # your normal checkout
git fetch origin

# Plain message — no tokens, no schema-vs-not decision. The pipeline
# self-selects: Vercel's build syncs the schema before code goes live, and
# seed-production only fires when the push touches prisma/**.
MSG="Merge development into main: <short description>"

git switch main
git reset --hard origin/main          # ensure local main == remote main
git merge --no-ff origin/development -m "$MSG"

# GATE — must print NOTHING. If it prints files, main != development; stop & inspect.
git diff --stat origin/development HEAD

git push origin main                  # → prod deploy (schema syncs inside the build)
git switch development                 # back to your working branch
```

For schema-touching promotions you can watch the seed workflow too (it runs
automatically via the `prisma/**` path filter):
```bash
gh run watch "$(gh run list --workflow=seed-production.yml --limit 1 --json databaseId -q '.[0].databaseId')" --exit-status
```

> Only `main` and `development` accept pushes (branch policy + Vercel allowlist).
> Always promote by merging `origin/development` so prod == staging exactly.

---

## 5. Verify a deploy

```bash
# Web is up + the Razorpay webhook secret is configured:
curl -s https://momentumarena.com/api/razorpay/webhook        # {"ok":true,"secretConfigured":true}

# Latest workflow runs (look for green):
gh run list --limit 8
```
Then smoke-test the actual change in the browser / app.

---

## 6. Seed / one-shot data (coupons, etc.)

Coupons are **not** seeded by `prisma/seed.ts` (that was removed so deploys can't
clobber admin edits). Each is a manual, idempotent `workflow_dispatch` script:

```bash
# Create the PICKLEBALL25 launch coupon in prod (or staging):
gh workflow run seed-pickleball-coupon.yml -f environment=production

# Create the APPFIRST first-app-booking coupon (created INACTIVE — then review
# the discount value and toggle Active in Admin → Coupons):
gh workflow run seed-app-first-booking-coupon.yml -f environment=production
```
Or from the GitHub UI: *Actions* → pick the workflow → *Run workflow* → choose
`production`/`staging`. To author a new one-shot, copy
`scripts/seed-pickleball25-coupon.ts` + `.github/workflows/seed-pickleball-coupon.yml`.

---

## 7. Mobile OTA (JS-only changes — no store review)

`ota-publish.yml` runs on push to `development`/`main` **when `apps/mobile/**` or
`scripts/publish-ota.ts` changed** (or via manual dispatch). Per platform it
compares the native **fingerprint** to the committed baseline
(`apps/mobile/fingerprints/<channel>.<platform>.fingerprint`):

- **JS-only** (fingerprint unchanged):
  - `development` → publishes a **DRAFT** release.
  - `main` (production) → auto-publishes a **CANARY @ 20%**.
  - In **both** cases an admin finishes the rollout from **`/admin/ota`** (web
    admin): promote the canary to 100%, or roll out the dev DRAFT.
- **Native change** (fingerprint differs) → it will **not** OTA; it warns that a
  new store build is required (and on `development` auto-dispatches the test build).

```bash
# Force an OTA publish without a code change:
gh workflow run ota-publish.yml --ref main
```
**OTA rollback:** `/admin/ota` → set the bad release's rollout to 0% / promote the
previous release (the model supports a ROLLBACK release).

---

## 8. Mobile native builds (native code / new dependency / SDK bump)

Needed when the fingerprint changes (anything OTA can't carry). Manual dispatch:

```bash
# iOS — TestFlight (dev target) or App Store (prod target):
gh workflow run native-ios.yml --ref main -f track=testflight   # or: -f track=appstore

# Android — Play internal (dev target) or production track:
gh workflow run native-android.yml --ref main -f track=internal # or: -f track=production
```
- `testflight`/`internal` → OTA channel **development**; `appstore`/`production`
  → channel **production**.
- Builds run on GitHub-hosted runners via **fastlane** (lane `beta` for
  test tracks, `release` for store tracks). Build number = unix-epoch-minutes
  (auto); marketing version from `apps/mobile/scripts/version.js` (optional
  `-f bump=patch|minor|major`). No EAS — it's bare fastlane + Xcode/Gradle.
- App identity (both platforms): **`com.momentumarena`**.

### 8a. Credentials checklist (the part that lives outside the repo)

These are **GitHub repo secrets** (Settings → Secrets and variables → Actions).
The workflows decode them at build time; nothing sensitive is committed.

**iOS** (`native-ios.yml`) — needs an **Apple Developer Program** membership +
**App Store Connect** access for `com.momentumarena`:
| Secret | What it is | Where to get / regenerate |
|---|---|---|
| `ASC_API_KEY_P8_BASE64` | base64 of the App Store Connect API key `AuthKey_XLBK5M2393.p8` (key id **XLBK5M2393**) | App Store Connect → *Users and Access → Integrations → App Store Connect API* → create a key (Admin/App Manager). You also need its **Issuer ID** + **Key ID** wired into the iOS fastlane config |
| `IOS_DIST_CERT_BASE64` | base64 of the **Apple Distribution** certificate exported as `.p12` | Apple Developer → *Certificates* → create "Apple Distribution" → export from Keychain as `.p12` → `base64 -i cert.p12` |
| `IOS_DIST_CERT_PASSWORD` | the password you set when exporting the `.p12` | you choose it at export time |

Provisioning profiles are **not** checked in — the API key + `-allowProvisioningUpdates`
let Xcode manage them. So the moving parts are just: the ASC API key + the
distribution cert.

**Android** (`native-android.yml`) — needs a **Google Play Console** account for
`com.momentumarena` + a Play **service account** with release permissions:
| Secret | What it is | Where to get / regenerate |
|---|---|---|
| `ANDROID_KEYSTORE_BASE64` | base64 of the **upload keystore** `upload-keystore.jks` | the keystore you generated for this app (`keytool -genkeypair …`) → `base64 -i upload-keystore.jks`. **Back this file up offline** — losing it blocks updates unless you've enrolled in Play App Signing key reset |
| `ANDROID_KEYSTORE_PASSWORD` | keystore store password | set at keystore creation |
| `ANDROID_KEY_ALIAS` | the key alias inside the keystore | set at keystore creation |
| `ANDROID_KEY_PASSWORD` | the key password | set at keystore creation |
| `GOOGLE_PLAY_JSON_KEY` | the **entire** Play service-account JSON (file contents) | Google Play Console → *Setup → API access* → create/link a Google Cloud service account → grant "Release" → download the JSON key |

> ⚠️ The Apple distribution cert + the Android upload keystore are the two
> irreplaceable-if-lost artifacts. Keep encrypted off-repo backups of both
> (and the `.p12` / `.jks` passwords).

### 8b. After a native release ships — refresh the OTA baseline

A new store binary changes the native fingerprint, so OTA must learn the new
baseline or it'll keep warning "native build required". Run:

```bash
gh workflow run post-native-release.yml --ref main \
  -f platform=ios -f channel=production -f build=<buildNumber> \
  -f versionName=1.0.1 -f storeUrl="https://apps.apple.com/app/idXXXXXXXX"
```
This recomputes + commits `apps/mobile/fingerprints/<channel>.<platform>.fingerprint`
(the auto-commit carries `[skip ci]` — the one legitimate remaining use of the
token: machine-generated commits that must not re-trigger ota-publish) and
updates the in-DB **version gate** (min-supported build).
Do it per platform. After it lands, JS-only changes resume OTA-publishing
normally (§7).

See also the App Store / TestFlight specifics in project memory
(`testflight_appstore.md`) and the OTA architecture (`ota_self_hosted.md`).

---

### 8b-bis. OTA publishes itself — do NOT dispatch it by hand

`ota-publish.yml` triggers on `push` to development and main with
`paths: apps/mobile/**`. It works on both branches. It is simply not
prompt: runs are created about 30 minutes after the push.

    89cbb82  development  pushed 19:42 UTC -> run #290 created 20:12  (30 min)
    6481e36  main         pushed 20:05 UTC -> run #292 created 20:35  (30 min)

Do not run `gh workflow run ota-publish.yml` after a promotion. The trigger
handles it, and dispatching only adds a duplicate draft to /admin/ota for
someone to pick between.

The trap this replaces: checking the run list seconds after a push shows
nothing, which looks exactly like a broken trigger. Three separate wrong
theories got built on that (path filters, lost webhooks, main-vs-
development) before the timestamps settled it. The GitHub PushEvent API had
already confirmed every push was delivered.

RULE: never conclude "CI did not fire" from a check made near the push.
Give it 45 minutes, then look the run up by commit SHA:

    gh api "repos/momentumarena2026/momentum-arena/actions/workflows/ota-publish.yml/runs?per_page=5" \
      --jq '.workflow_runs[] | "\(.run_number) \(.event) \(.head_branch) \(.head_sha[0:7]) \(.conclusion)"'

Rollout stays manual by design: the workflow publishes a DRAFT and an admin
releases it from /admin/ota.

## 8c. Version pinning — do NOT use `bump` on both platforms ⚠️

Both native workflows resolve the version through
`apps/mobile/scripts/version.js`, and `post-native-release` **commits the
result back to `main`**. Dispatching iOS and Android with `bump=patch`
therefore RACES: iOS writes `1.0.3`, Android then reads that and builds
`1.0.4`. Two platforms, two different versions, one release.

Always pin first, then dispatch both with `bump=none`:

```bash
node apps/mobile/scripts/version.js 1.0.5     # explicit set
git add apps/mobile/version.json && git commit -m "chore(release): 1.0.5"
git push origin HEAD:main
gh workflow run native-ios.yml     --ref main -f track=appstore   -f bump=none
gh workflow run native-android.yml --ref main -f track=production -f bump=none
```

Check the pin survived before dispatching — a still-running earlier build's
`post-native-release` can overwrite it:

```bash
git fetch origin && git show origin/main:apps/mobile/version.json
```

### 8d. New iOS capability = two extra failures, in this order ⚠️

Learned the hard way shipping Universal Links (1.0.2 → 1.0.5, three failed
builds). Adding ANY entitlement to `MomentumArena.entitlements`:

1. **First failure** — `Provisioning profile "MomentumArenaAppStoreCI"
   doesn't include the <capability> entitlement.`
   Fix in the portal, not the repo: developer.apple.com → Identifiers →
   `com.momentumarena` → tick the capability → Save. Nothing in CI can do
   this for you.

2. **Second failure** — `No profile for team 'WHF7M743MW' matching
   'MomentumArenaAppStoreCI' found.`
   Enabling a capability invalidates the old profile but leaves its NAME
   taken, so sigh regenerates it as `MomentumArenaAppStoreCI <timestamp>`.
   The Fastfile now signs with `lane_context[SharedValues::SIGH_NAME]`
   rather than the constant, so this one is already fixed — but if you see
   it again, that's the cause.

Android needs no equivalent: App Links verify off `assetlinks.json`, with
no capability to enable.

### 8e. Read the failure properly

`gh run view <id> --log` returns nothing while a run is IN PROGRESS. To get
the real error from a finished run — the fastlane summary in the UI is not
the error:

```bash
gh run view <run-id> --log-failed | grep -iE "error:|entitlement|provisioning"
```


## 9. Cron jobs (automatic — nothing to deploy)

- **Vercel crons** (`vercel.json`) hit `/api/cron/*` on schedule (cleanup-locks,
  analytics-retention, cohort-backfill, reports-retention, rewards-expire,
  rewards-alerts, send-reminders, generator-check). They authenticate with
  `CRON_SECRET`.
- **GitHub cron workflows**: `cron-process-reports` (every minute),
  `cron-rollup-metrics` (hourly), `cron-send-reminders` (hourly). All also have
  `workflow_dispatch` if you need to run one by hand.

---

## 10. Secrets & environment

**GitHub repo secrets** (Settings → Secrets → Actions) — used by workflows:
- `STAGING_DB_URL`, `PRODUCTION_DB_URL` — Neon connection strings
- `BLOB_READ_WRITE_TOKEN` — Vercel Blob (the OTA bundle store)
- **iOS native build:** `ASC_API_KEY_P8_BASE64`, `IOS_DIST_CERT_BASE64`,
  `IOS_DIST_CERT_PASSWORD` (see §8a for what each is + where to get it)
- **Android native build:** `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`,
  `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`, `GOOGLE_PLAY_JSON_KEY` (see §8a)

**Vercel environment variables** (Project → Settings → Environment Variables) —
used by the running app; the canonical list is `.env.example`. Key ones:
`DATABASE_URL`, `AUTH_SECRET`, `CRON_SECRET`, `BLOB_READ_WRITE_TOKEN`,
`RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` / `RAZORPAY_WEBHOOK_SECRET`,
`PHONEPE_*` (+ `PHONEPE_DQR_*` for Dynamic QR), `ADMIN_NOTIFICATION_PHONES`,
FCM/push credentials. Set the **same keys** in Vercel's *Production* and
*Preview* scopes (Preview = staging), each pointing at the right environment.

---

## 11. Rollback summary

| Layer | How to roll back |
|---|---|
| **Web code** | Vercel dashboard → Deployments → promote the last good build (instant) |
| **Code (git)** | `git revert <sha>` on `development`, then promote to `main` |
| **Schema** | `db push` is forward-only; additive changes are harmless to leave. To remove a column: edit `schema.prisma` + re-push (mind `--accept-data-loss`) |
| **Mobile OTA** | `/admin/ota` → rollout 0% / promote previous release |
| **Mobile native** | Submit a new build; you cannot un-ship a store binary, only supersede it |

---

## 12. Common gotchas

- **Prod code references a missing column/enum (P2022) after a deploy** →
  shouldn't happen anymore (the Vercel build syncs schema before code goes
  live), but if it does: run the `seed-production` workflow manually
  (Actions → *Seed Production DB* → Run workflow) or redeploy from the
  Vercel dashboard — the rebuild re-runs `prisma db push`.
- **OTA keeps saying "native build required"** → the fingerprint baseline is
  stale; cut the native build and update `apps/mobile/fingerprints/*`.
- **Vercel didn't build** → check the branch (only `main`/`development` deploy)
  and that the diff isn't entirely under `apps/mobile/`.
- **Promotion gate (`git diff origin/development HEAD`) is non-empty** → `main`
  has commits `development` doesn't; never force — investigate first.
