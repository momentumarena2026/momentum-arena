# Momentum Arena — Production Go-Live Checklist

What's left to take the product **fully live for the public**. The **website is
already live** (Vercel production). "Go live" below mainly means **shipping the
mobile apps to the App Store + Play production tracks** and flipping every
service from sandbox/test to production.

Status legend: ✅ done · 🟡 partial/ready · ⬜ to do · 🔒 your action (secrets /
store / vendor — I can't do these)

---

## 0. Where things stand today

| Surface | State |
|---|---|
| **Website** | ✅ Live on Vercel production (`www.momentumarena.com`) |
| **iOS app** | 🟡 On **TestFlight** (build 29706516, runtimeVersion 2). **Not** on the App Store yet. |
| **Android app** | 🟡 On **Play Internal testing** (versionCode 29706573, rtv 2). **Not** on the Play production track yet. |
| **Mobile OTA** | ✅ Development channel proven. 🟡 **Production channel dormant** until the first *production* native build commits a prod fingerprint baseline (automatic via `post-native-release`). |
| **main branch** | ✅ Up to date — `main` tree == `development`, so a `--ref main` native build has all the latest code. |

---

## 1. Blockers — must be done before the public launch

1. ⬜🔒 **Razorpay LIVE keys + webhook** — set `RAZORPAY_KEY_ID`/`SECRET` to
   `rzp_live_*` and `RAZORPAY_WEBHOOK_SECRET` in the Vercel **Production** scope,
   and register the webhook (`/api/razorpay/webhook`) in the Razorpay dashboard.
   *Without the webhook secret, captured-but-no-booking recovery silently never
   fires.* Verify: `curl https://www.momentumarena.com/api/razorpay/webhook`
   → `"secretConfigured": true`.
2. ⬜🔒 **PhonePe PRODUCTION** — `PHONEPE_ENV=PRODUCTION` + production
   `PHONEPE_CLIENT_ID`/`SECRET`/`CLIENT_VERSION` + `PHONEPE_WEBHOOK_USERNAME`/
   `PASSWORD` (set the same user/pass in the PhonePe dashboard Webhooks tab).
   Requires PhonePe merchant **production approval**.
3. ⬜🔒 **MSG91 production** — real SMS/email OTP keys + templates
   (`MSG91_AUTH_KEY`, the template IDs). Real OTP delivery is required for
   customer sign-in.
4. ⬜🔒 **App Store submission** (iOS) — see §3.
5. ⬜🔒 **Play production submission** (Android) — see §3.
6. ⬜🔒 **Reviewer login bypass decision** — see §5 (security-sensitive).

---

## 2. Production environment & secrets

Set in **Vercel → Project → Settings → Environment Variables → Production**
(the canonical list is `.env.example`). Don't forget these, each in the
**Production** scope pointing at prod values:

- `DATABASE_URL` (prod Neon) · `AUTH_SECRET` · `CRON_SECRET`
- `RAZORPAY_KEY_ID` (live) · `RAZORPAY_KEY_SECRET` · `RAZORPAY_WEBHOOK_SECRET`
- `PHONEPE_ENV=PRODUCTION` · `PHONEPE_CLIENT_ID`/`SECRET`/`CLIENT_VERSION` ·
  `PHONEPE_WEBHOOK_USERNAME`/`PASSWORD`
- `MSG91_*` (auth key + all template IDs)
- `EXPO_OTA_PRIVATE_KEY` · `BLOB_READ_WRITE_TOKEN` (OTA signing + bundle store)
- `ADMIN_NOTIFICATION_PHONES`
- **Leave UNSET in production:** `APPSTORE_TEST_PHONE`, `APPSTORE_TEST_OTP`
  (see §5).

**GitHub repo secrets** for the build/seed workflows (most already set this
session): `STAGING_DB_URL`, `PRODUCTION_DB_URL`, `BLOB_READ_WRITE_TOKEN`, and the
native-signing secrets (see `docs/DEPLOYMENT.md` §8a).

---

## 3. Ship the mobile apps to production stores

`main` has the code + the workflows. One dispatch each builds + uploads:

```bash
# iOS → App Store (TestFlight build first if you want a final beta pass):
gh workflow run native-ios.yml --ref main -f track=appstore        # optional: -f bump=patch

# Android → Play production track:
gh workflow run native-android.yml --ref main -f track=production  # optional: -f bump=patch
```
- These auto-build (build # = unix-epoch-minutes), upload, and the chained
  `post-native-release` job commits the **production** fingerprint baseline +
  updates the in-DB version gate — which **activates the production OTA channel**
  for future JS-only updates.
- **Then, in the store consoles (🔒 you):**
  - **App Store Connect** (Apple ID 6783955158): finish the listing
    (screenshots, description, keywords, privacy "nutrition label", age rating),
    pick the uploaded build, and **Submit for Review**.
  - **Google Play Console** (`com.momentumarena`): complete the **store
    listing**, **content rating**, **Data safety** form, target-audience, then
    promote the production build and **Submit for Review**.
- Bump the marketing version with `-f bump=patch|minor|major` on the **first**
  platform you build, then `none` on the second (it reads the committed
  `version.json`). See `docs/DEPLOYMENT.md` §8.

After the apps are approved, set the production `AppVersionGate` rows in
`/admin/ota` (storeUrls: `apps.apple.com/app/id6783955158`,
`play.google.com/store/apps/details?id=com.momentumarena`).

---

## 4. Payments — production readiness detail

- **Razorpay** (gateway / cards / netbanking) — live keys + webhook (§1.1).
- **PhonePe gateway** — production env + creds + webhook (§1.2).
- **UPI** — the default "Pay by UPI" path:
  - **Static QR + manual UTR** works today (admin verifies UTRs in
    `/admin/utr-verify`). Set `PHONEPE_STATIC_QR_SALT_KEY` if you use static-QR
    webhooks.
  - 🟡 **PhonePe DQR** (auto-confirming dynamic QR) is **optional & dormant** —
    needs PhonePe DQR onboarding (`PHONEPE_DQR_MERCHANT_ID` + `SALT_KEY` +
    `STORE_ID`, see `docs/phonepe-dqr-onboarding.md`) **and** the admin toggle on
    `/admin/payment-settings`. Until then UPI uses the static-QR flow — **not a
    launch blocker**. Set `PHONEPE_DQR_MODE=intent` only once PhonePe enables
    Open-Intent acceptance on your VPA (defaults to scan-only `qr`).
- **Admin payment-method config** — confirm which methods are enabled for
  bookings / cafe / shop on `/admin/payment-settings` before launch.

---

## 5. Security & cleanup before public launch

- 🔒 **Reviewer OTP bypass** (`lib/otp.ts`): phone `9090909090` + OTP `654321`,
  active only when `APPSTORE_TEST_PHONE`/`APPSTORE_TEST_OTP` are set. App/Play
  reviewers need to log in, and a **production** store build points at
  `www.momentumarena.com`. So during review you'll likely need the bypass set on
  the **Production** backend; **remove it once both apps are approved** (it's a
  known-credentials backdoor past SMS auth). Alternative: keep it off prod and
  give reviewers a different demo path.
- 🔒 **Rotate chat-leaked secrets** — `STAGING_DB_URL` + `BLOB_READ_WRITE_TOKEN`
  were pasted into a chat earlier this project; rotate both.
- ✅ Debug route `app/api/debug/env-check` — already removed.
- ⬜ **Activate the `APPFIRST` coupon** — created inactive in prod; review the
  discount value and toggle Active in `/admin/coupons` when the app is live.
- 🔒 Confirm **FCM/push** credentials are the production project, and that
  `ADMIN_NOTIFICATION_PHONES` are the real numbers.

---

## 6. Do the deployment scripts need changes for production?

**No code/script edits are required** — the pipeline is already environment-aware
and switches on the branch:

- **Vercel** auto-deploys `main` → production (`scripts/vercel-ignore.sh`).
- **Schema sync** runs against `PRODUCTION_DB_URL` on push to `main`
  (`seed-production.yml`).
- **OTA** publishes to channel **`production`** on `main` and auto-canaries at
  20% (`ota-publish.yml`); `configure-ota-target.js` already points prod builds
  at `www.momentumarena.com`.
- **Native builds** take a `track` input — use `appstore` / `production` for the
  store release (vs `testflight` / `internal` for beta).

So "going to production" is driven by **(a) the env values you set in the Vercel
Production scope** (§2 — `PHONEPE_ENV=PRODUCTION`, `rzp_live_*` keys, etc.) and
**(b) the `track=appstore|production` dispatch input** (§3) — **not** by editing
scripts. The only repo changes this audit made are doc fixes:
`.env.example` now documents `RAZORPAY_WEBHOOK_SECRET` and corrects the
`PHONEPE_DQR_MODE` default note.

---

## 7. Suggested launch-day sequence

1. Set all **Production** env vars (§2) — payments live, MSG91 live, OTA keys.
2. Verify web: `curl …/api/razorpay/webhook` → `secretConfigured:true`; do a
   small real Razorpay + UPI payment end-to-end on the website.
3. Dispatch `native-ios.yml -f track=appstore` and `native-android.yml -f
   track=production`; submit both in the store consoles.
4. (During review) ensure reviewer login works; **after approval, remove the OTP
   bypass from prod** (§5).
5. On approval: set the production `AppVersionGate` rows, **activate `APPFIRST`**,
   announce launch.
6. First production OTA is now possible — a JS-only push to `main` auto-canaries
   to 20%; promote to 100% from `/admin/ota` once healthy.
