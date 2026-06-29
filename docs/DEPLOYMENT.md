# Momentum Arena — Manual Deployment Runbook

Everything you need to ship **without help**. This repo deploys itself off two
git branches plus a handful of GitHub Actions workflows; there is no magic.

- **`development`** → staging (Vercel preview + staging DB)
- **`main`** → production (Vercel production + production DB)

Normal flow: commit your change → push to `development` (auto-deploys + tests on
staging) → **promote `development` → `main`** (auto-deploys to production).

> The single most important rule is the **`[skip ci]` rule** for schema changes.
> Read §3 before any deploy that touches `prisma/schema.prisma`.

---

## 0. TL;DR cheat sheet

| You changed… | Do this |
|---|---|
| **Web/backend, no schema change** | push to `development`, then promote to `main` **with `[skip ci]`** |
| **Anything in `prisma/schema.prisma`** | push to `development`, then promote to `main` **WITHOUT `[skip ci]`** (so the prod DB gets synced) |
| **A coupon / seed data** | run the matching `workflow_dispatch` workflow (§6) |
| **Mobile JS only** | push to `development`/`main` — OTA auto-publishes (§7); roll out from `/admin/ota` |
| **Mobile native code / new dependency** | run `native-ios` / `native-android` workflow (§8) — new store build |

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

## 3. Database schema sync — the `[skip ci]` rule ⚠️

There are **no Prisma migrations** applied on deploy. The schema is synced with
`prisma db push --accept-data-loss`, run by two push-triggered workflows:

- **`seed-staging.yml`** — on push to `development` → `STAGING_DB_URL`
- **`seed-production.yml`** — on push to `main` → `PRODUCTION_DB_URL`

Each runs: `pre-db-push-cleanup.sql` → `prisma db push` → `prisma/seed.ts`
(only upserts the `gamelord` superadmin; it does **not** seed coupons/data).

**The rule:** a commit message containing **`[skip ci]` skips these workflows.**

- **Schema change** (you edited `prisma/schema.prisma`): the `main` merge commit
  must **NOT** contain `[skip ci]`, or the production DB never gets the new
  columns/enum and the new code 500s. Keep changes **additive** (new
  nullable/defaulted columns, new enum values) so `db push --accept-data-loss`
  is safe — never rename/drop in the same push as code that needs the old name.
- **Schema-free change**: add **`[skip ci]`** to the merge so the redundant
  db-push/seed doesn't run (faster, avoids flaky-network blips).

**Manual schema push** (if a workflow failed): GitHub → *Actions* → the failed
"Seed Staging/Production DB" run → **Re-run all jobs**. (Last resort, with the DB
URL in hand: `DATABASE_URL=… npx prisma db push --accept-data-loss --skip-generate`.)

---

## 4. Promote `development` → `main` (the core skill)

Run this once staging looks good. It fast-forwards production to whatever is on
`development`, with a verification gate.

```bash
cd <repo root>            # your normal checkout
git fetch origin

# Decide the message. Append " [skip ci]" ONLY if this is schema-FREE (see §3).
MSG="Merge development into main: <short description>"

git switch main
git reset --hard origin/main          # ensure local main == remote main
git merge --no-ff origin/development -m "$MSG"

# GATE — must print NOTHING. If it prints files, main != development; stop & inspect.
git diff --stat origin/development HEAD

git push origin main                  # → triggers prod deploy (+ seed-production unless [skip ci])
git switch development                 # back to your working branch
```

Then watch the prod DB sync (only relevant for schema changes):
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
(with `[skip ci]`) and updates the in-DB **version gate** (min-supported build).
Do it per platform. After it lands, JS-only changes resume OTA-publishing
normally (§7).

See also the App Store / TestFlight specifics in project memory
(`testflight_appstore.md`) and the OTA architecture (`ota_self_hosted.md`).

---

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

- **Forgot to drop `[skip ci]` on a schema change** → prod code references a
  missing column/enum and 500s. Fix: re-run `seed-production` (Actions →
  Re-run), or push an empty no-`[skip ci]` commit to `main`.
- **OTA keeps saying "native build required"** → the fingerprint baseline is
  stale; cut the native build and update `apps/mobile/fingerprints/*`.
- **Vercel didn't build** → check the branch (only `main`/`development` deploy)
  and that the diff isn't entirely under `apps/mobile/`.
- **Promotion gate (`git diff origin/development HEAD`) is non-empty** → `main`
  has commits `development` doesn't; never force — investigate first.
