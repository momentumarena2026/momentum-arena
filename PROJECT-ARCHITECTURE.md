# Momentum Arena — Project Architecture

*Last updated: July 2026.*

Multi-sport facility platform for Momentum Arena (Mathura). Replaces a
WhatsApp-based manual booking process with a self-serve web app, iOS +
Android apps (customer **and** admin), and a full admin console.

---

## Repository layout

The repo is a **monorepo by convention** — a Next.js web app at the root and a
React Native mobile app under `apps/mobile/`. They are not workspace-linked;
they share concepts and HTTP contracts, not code.

```
/
├── app/                  ← Next.js App Router (public + customer + admin + REST)
├── actions/              ← Server actions (one file per domain, ~54 files)
├── lib/                  ← Domain modules (db, auth, payments, push, …, ~59 files)
├── components/           ← shadcn/ui primitives + feature components
├── prisma/               ← schema.prisma (~80 models/enums) + seed
├── scripts/              ← Build/deploy scripts (vercel-build.sh, publish-ota.ts, seeds)
├── .github/workflows/    ← CI: seeds, OTA publish, native builds, crons
├── docs/                 ← DEPLOYMENT.md, GO-LIVE.md, vendor onboarding
├── public/               ← Static assets (icons, UPI app logos, letterhead)
├── middleware.ts         ← Edge cookie-presence gate
├── vercel.json           ← Vercel cron schedule
└── apps/mobile/          ← React Native 0.85 (iOS + Android)
    ├── App.tsx            ← splash, OTA auto-apply, version gate
    ├── android/, ios/     ← native projects (Firebase configured)
    ├── fingerprints/      ← native-fingerprint baselines per channel/platform
    └── src/
        ├── screens/       ← customer + admin/* screens
        ├── navigation/, components/, providers/, theme/
        └── lib/           ← typed API clients, analytics, push, storage
```

---

## Tech stack

### Web

| Layer            | Technology |
|------------------|-----------|
| Framework        | Next.js (App Router, Turbopack) · React 19 · TypeScript |
| UI               | Tailwind CSS v4 · shadcn/ui · lucide-react · recharts · sonner |
| Customer auth    | NextAuth v5 (JWT) — **phone + SMS OTP** (MSG91) |
| Admin auth       | Custom session cookie (`admin-session-token`) via `/godmode` |
| Mobile API auth  | JWT bearer tokens under `/api/mobile/*` |
| Database         | PostgreSQL (Neon serverless) · Prisma with Neon adapter · Zod validation |
| Payments         | Razorpay (cards/netbanking) · **PhonePe Dynamic QR** (UPI intent + scan, auto-confirm) · static UPI QR + UTR verify · cash · 50% advance |
| Push             | Firebase Cloud Messaging (customer + admin devices), admin-editable templates |
| Analytics        | First-party events → Postgres (all envs) + **Google Analytics 4** (production only) |
| Email / SMS      | MSG91 — SMS OTP; transactional email from `mail.momentumarena.com` (template-based) |
| PDF / QR         | jspdf · reportlab (feature guide) · qrcode |

### Mobile (`apps/mobile/`)

React Native 0.85 · React 19 · React Navigation v7 · TanStack Query v5 ·
MMKV + Keychain · Reanimated v4 · Razorpay native SDK ·
`@react-native-firebase/{app,messaging,analytics}` (analytics uses the
AdId-free variants on both platforms) · **Expo Updates (self-hosted OTA)**
with code-signed bundles · SMS User Consent (Android OTP auto-read).

The app talks exclusively to the web app's `/api/mobile/*` REST surface.
Backend host is picked **at bundle time from the git branch**
(`main` → production, else staging) via `scripts/write-build-config.js`.

---

## Routing (web)

| Group          | URL prefix | Audience | Notes |
|----------------|-----------|----------|-------|
| (root)         | `/`       | Public   | Marketing, sport pages, FAQ, policies, coupons, rewards |
| `(auth)`       | `/login`  | Public   | Phone-OTP login |
| `(admin-auth)` | `/godmode`| Public   | Admin password login + invite/setup |
| `(protected)`  | `/dashboard`, `/bookings`, `/profile`, `/referral` | Customer | NextAuth session |
| `(admin)`      | `/admin/*`| Admin    | Permission-gated sidebar nav |

Public flow routes: `/book`, `/cafe`, `/shop`, `/coupons`, `/faq`,
`/policies`, `/rewards`.

### Admin console (32 page areas)

`analytics · reports · bookings (list/unconfirmed/calendar/recovery/create) ·
checkin · recurring · sports · equipment · pricing · slots · cafe-menu ·
cafe-orders · cafe-live · cafe-coupons · products · product-orders · pos ·
coupons · rewards · expenses (read-only legacy) · running-expenses ·
release-flow · ota · push (+ push/templates) · users · users/groups ·
admin-users · generator · faqs · payment-settings · razorpay · phonepe ·
utr-verify · discounts (legacy) · profile`

Middleware gates by cookie presence only; real authZ happens server-side
(`requireAdmin()` / permission checks per action and per API route — the
mobile admin routes enforce the same permission map).

---

## Authentication — three independent systems

1. **Customer (web)** — NextAuth v5 JWT, phone + OTP credentials. New users
   provide a name post-OTP. (`lib/auth.ts`, `lib/otp.ts` — rate-limited,
   lockout-protected.)
2. **Admin (web)** — separate `AdminUser` table, bcrypt, roles
   SUPERADMIN / ADMIN / STAFF + a 21-permission grid (`lib/permissions.ts`),
   custom signed cookie. Email invites/resets via MSG91 templates.
3. **Mobile** — JWT bearer from `/api/mobile/verify-otp`, stored in Keychain;
   `getMobileUser()` / `requireMobileAdmin(permission)` guard every route.
   The admin console is reached in-app via a hidden 5-tap gesture.

---

## Domain model (prisma/schema.prisma)

~80 models. Clusters:

- **Core** — `User` (phone-first, referral code, birthday, soft-delete),
  auth scaffolding, `RateLimit`, `AdminUser`, `ArenaSettings`,
  `OperatingWindow`.
- **Booking** — `CourtConfig` (sport × size × zones), `SlotHold` (5-min
  checkout hold; deleted atomically on payment), `Booking` + `BookingSlot`
  (statuses incl. COMPLETED / ABSENT), `BookingEditHistory`, `SlotBlock`,
  `PricingRule` × `TimeClassification`, `Waitlist`, `RecurringBooking` +
  `RecurringConfig`, `Equipment` + `EquipmentRental`.
- **Payments** — `Payment` / `CafePayment` / `ProductOrderPayment`
  (RAZORPAY · PHONEPE · UPI_QR · CASH · FREE; PENDING → COMPLETED/PARTIAL/
  REFUNDED), UTR fields for static-QR verification, advance/remainder split,
  `CafePaymentIntent` (no order row until gateway success),
  `PaymentGatewayConfig` singleton (active gateway, online/advance toggles,
  `upiQrMode` STATIC | DQR | OFF, `intentEnabled`).
- **Cafe** — `CafeItem` (stock-tracked), `CafeOrder` → PENDING → PREPARING →
  READY → COMPLETED, guest checkout, `CafeSettings` (open/closed),
  cafe-scoped discounts.
- **Shop** — `ProductCategory · Product · Cart · ProductOrder ·
  ProductStockMovement` + POS walk-in sales.
- **Coupons** — unified `Coupon` + `CouponCondition` (MIN_AMOUNT,
  FIRST_PURCHASE, FIRST_APP_BOOKING, USER_GROUP, TIME_WINDOW, BIRTHDAY …) +
  platform targeting (web/app) + `UserGroup` cohorts + usage ledgers.
- **Rewards** — `RewardConfig` (per-sport & cafe earn rates, redeem ratio,
  caps), `RewardBalance`, `RewardTransaction` (EARNED_BOOKING /
  _REMAINDER / _CAFE / _SIGNUP / _REFERRAL / _BIRTHDAY, REDEEMED, ADJUSTMENT),
  `RewardAlert`.
- **Push** — `PushDevice` / `AdminPushDevice` (FCM tokens + app version),
  `PushDispatch` (delivery log), **`PushTemplate`** (admin overrides for the
  20-trigger registry in `lib/push-templates.ts` — every automated push is
  editable/toggleable without deploys).
- **Analytics** — `AnalyticsSession` + `AnalyticsEvent` (first-party events
  from web + both apps, anonymous-to-authed backfill), `MetricRollup`
  (hourly), `UserCohort` (frozen at first booking), `Report` (queued report
  jobs), `ServerActionLog`.
- **Mobile ops** — `OtaRelease` + `OtaReleaseAsset` (self-hosted Expo
  Updates: draft/canary/rollout percentages, code-signing), `AppVersionGate`
  (min/forced version per platform).
- **Expenses** — `Expense` (+ edit history) with `ExpenseModule`
  GENERAL (legacy, read-only) | RUNNING (active), `ExpenseOption` for
  admin-editable dropdowns.
- **Venue infra** — `Generator*` (fuel/oil/run logs + hardware bulk-log API).
- **Dormant/legacy** — `PromoBanner`, `Feedback`, `DiscountCode` (superseded
  by the unified coupon system but still in schema).

---

## API surface (`app/api/`)

- **Payments**: `phonepe/*` (Standard Checkout + `dqr/*` initiate/status +
  S2S callbacks for booking & cafe), `razorpay/*` (+ `razorpay/webhook` for
  captured-payment recovery), `invoice` / `cafe-invoice` PDFs.
- **Booking**: `availability`, `booking/lock` + `release-lock`, `events`
  (first-party analytics ingestion, open + rate-limited).
- **Mobile**: `mobile/*` — the complete customer surface (auth, booking,
  cafe, shop, rewards, coupons, waitlist, account deletion, payment config)
  **plus `mobile/admin/*`** — the admin console API mirroring web server
  actions, permission-checked per route.
- **OTA**: `updates/manifest` + asset routes (self-hosted Expo Updates
  server, code-signed).
- **Cron** (`cron/*`, `CRON_SECRET`-guarded): see below.

## Cron jobs

- **Vercel crons** (`vercel.json`): `cleanup-locks`, `analytics-retention`,
  `cohort-backfill`, `reports-retention`, `rewards-expire`, `rewards-alerts`,
  `send-reminders`, `generator-check`.
- **GitHub Actions crons**: `cron-process-reports` (per-minute report queue),
  `cron-rollup-metrics` (hourly), `cron-send-reminders` (hourly backstop).

---

## Mobile app structure

- **Customer tabs**: Home · Sports (BookSport → BookCourt →
  BookSlots/BookBowlingSlots → Checkout → Confirmed) · Cafe (menu → cart →
  checkout → order tracking) · Shop · Account (bookings, rewards, coupons,
  waitlist, settings). Plus Chat (FAQ assistant) and phone-OTP auth modals.
- **Admin shell** (hidden entry): full parity with web admin — dashboard,
  bookings (list/calendar/check-in/unconfirmed/recovery), courts & pricing,
  cafe (incl. live board), shop/POS, promotions, expenses, analytics suite,
  push console + template editor, OTA rollout dashboard, settings.
- **Payments in-app**: Razorpay native SDK + the same Razorpay-style dark
  UPI sheet (intent deep-links `phonepe://`, `tez://`, `paytmmp://`, generic
  `upi://`; DQR scan; static QR fallback).
- **Push**: FCM with foreground banners, background handler, tap-routing per
  `data.kind`; device registration carries app version.
- **OTA**: checks on launch, auto-applies pending updates, sticky rollout
  bucket for staged percentages; force/soft version gates from the server.
- **Analytics**: `src/lib/analytics.ts` mirrors web — every event dual-writes
  to the first-party API (MMKV-queued, batched) and GA4 via Firebase
  (release builds of `main` only; module resolved lazily so OTA bundles are
  safe on older binaries).

---

## Deployment (summary — full runbook in docs/DEPLOYMENT.md)

- `development` → staging, `main` → production; **push = deploy** (Vercel).
- Builds are **schema-atomic**: `scripts/vercel-build.sh` runs cleanup SQL +
  `prisma db push` before `next build`; seed workflows are path-filtered to
  `prisma/**`. No commit-message tokens — retired 2026-07-02.
- Mobile: `ota-publish.yml` publishes JS bundles per channel and compares a
  **native fingerprint** to the committed baseline; native changes
  auto-dispatch test-track store builds on `development` (fastlane; prod
  tracks are manual). `post-native-release.yml` refreshes baselines +
  version gates.
- Promotion `development` → `main` is a plain merge with an empty-diff gate.

---

## Related docs

- [README.md](README.md) — quick start
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — deployment runbook
- [docs/GO-LIVE.md](docs/GO-LIVE.md) — launch checklist / current status
- [Momentum-Arena-Feature-Guide.pdf](Momentum-Arena-Feature-Guide.pdf) — product feature catalog + flowcharts
- [docs/phonepe-dqr-onboarding.md](docs/phonepe-dqr-onboarding.md) — DQR reference
- [SEO-GUIDE.md](SEO-GUIDE.md) · [LOCAL-SEO-GUIDE.md](LOCAL-SEO-GUIDE.md)
