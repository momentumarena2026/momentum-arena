# Momentum Arena — Project Architecture

Multi-sport facility booking platform for Momentum Arena (Mathura). Replaces a WhatsApp-based manual booking process with a self-serve web app, an admin console, and a customer mobile app.

---

## Repository layout

The repo is a **monorepo by convention** — a Next.js web app at the root and a React Native mobile app under `apps/mobile/`. They are not workspace-linked; they share concepts and HTTP contracts, not code.

```
/
├── app/              ← Next.js 16 App Router (public + customer + admin + REST)
├── actions/          ← Server actions (one file per domain, ~36 files)
├── lib/              ← Domain modules (db, auth, payments, pricing, …, ~37 files)
├── components/       ← shadcn/ui primitives + feature components
├── prisma/           ← schema.prisma + migrations + seed
├── scripts/          ← One-off maintenance scripts (TS/JS/Python)
├── docs/             ← Deploy runbook + email templates
├── public/           ← Static assets
├── types/            ← Module augmentation (next-auth)
├── middleware.ts     ← Edge cookie-presence gate
├── next.config.ts
├── vercel.json       ← Cron schedule + ignore script
└── apps/
    └── mobile/       ← React Native 0.85 (iOS + Android)
        ├── App.tsx
        ├── android/, ios/
        └── src/
            ├── screens/, navigation/, components/
            ├── lib/, providers/, theme/, config/
            └── types/
```

---

## Tech stack

### Web

| Layer            | Technology |
|------------------|-----------|
| Framework        | Next.js 16 (App Router, Turbopack) |
| Language         | TypeScript |
| UI               | React 19 · Tailwind CSS v4 · shadcn/ui · Base UI · lucide-react |
| Customer auth    | NextAuth v5 (JWT, Credentials provider) |
| Admin auth       | Custom session + cookie (`admin-session-token`) via `/godmode` |
| Mobile auth      | JWT bearer tokens served from `/api/mobile/*` |
| Database         | PostgreSQL (Neon, serverless driver) |
| ORM              | Prisma 6 with Neon adapter |
| Validation       | Zod 4 |
| Payments         | PhonePe Standard Checkout v2 (active) · Razorpay · UPI QR · Cash |
| Notifications    | MSG91 (email + SMS OTP + transactional) · in-app `Notification` rows |
| PDF / QR         | jspdf · qrcode · html5-qrcode |
| Charts           | recharts |
| Toasts / theming | sonner · next-themes |

### Mobile (`apps/mobile/`)

React Native 0.85.2 · React 19 · React Navigation v7 (native stack + bottom tabs) · TanStack Query v5 · React Hook Form + Zod · MMKV (cache) + Keychain (secrets) · Reanimated v4 + Worklets · Razorpay native SDK · `@eabdullazyanov/react-native-sms-user-consent` for SMS auto-fill · linear-gradient + svg + qrcode-svg.

The mobile app talks exclusively to the web app's `/api/mobile/*` REST surface — no Prisma or server-side code is shared.

---

## Routing (web)

Next.js **route groups** (parentheses) organize routes without affecting URLs.

| Group              | URL prefix      | Audience  | Layout role                                    |
|--------------------|-----------------|-----------|-----------------------------------------------|
| (root)             | `/`             | Public    | Marketing landing, sport pages, FAQ, policies |
| `(auth)`           | `/login`        | Public    | OTP login form                                 |
| `(admin-auth)`     | `/godmode`      | Public    | Admin password login + setup-password         |
| `(protected)`      | `/dashboard`, `/bookings`, `/profile`, `/referral` | Customer (NextAuth session) | Customer chrome, sign-out |
| `(admin)`          | `/admin/*`      | Admin (custom session) | Admin sidebar + nav |

Top-level public routes outside groups: `/book`, `/cafe`, `/coupons`, `/faq`, `/generator`, `/policies`, `/rewards`, `/sitemap.ts`, `/not-found.tsx`.

### Admin pages (24)

`admin/` page tree under `(admin)`:

`admin-users · analytics · bookings · cafe-coupons · cafe-live · cafe-menu · cafe-orders · calendar · checkin · coupons · discounts · equipment · expenses · faqs · generator · payment-settings · pricing · profile · razorpay · recurring · rewards · slots · sports · users · utr-verify`

### Middleware

[middleware.ts](middleware.ts) runs at the edge and gates routes by **cookie presence only** — it matches `/admin/:path*`, `/godmode/:path*`, `/dashboard/:path*`, `/bookings/:path*`, `/profile/:path*`. Real session validation happens server-side in `requireAdmin()` / `auth()` / `requireMobileUser()`.

---

## API routes (`app/api/`)

| Route                                    | Purpose |
|------------------------------------------|---------|
| `auth/[...nextauth]`                     | NextAuth handler (customer JWT) |
| `admin-auth/*`                           | Admin login, logout, invite acceptance, password setup |
| `availability`                           | Slot availability lookup |
| `booking/lock`, `booking/release-lock`   | Atomic slot reservation during checkout |
| `phonepe/initiate`, `phonepe/callback`, `phonepe/redirect` | Sports payments (Standard Checkout v2) |
| `phonepe/cafe-initiate`, `phonepe/cafe-callback`, `phonepe/cafe-redirect` | Cafe payments |
| `phonepe/static-qr-callback`             | Legacy V1 X-VERIFY for venue static QR |
| `razorpay/create-order`, `razorpay/verify` | Sports payments (legacy / fallback) |
| `razorpay/cafe-create-order`, `razorpay/cafe-verify` | Cafe payments |
| `invoice`, `cafe-invoice`, `cafe-menu-pdf` | PDF generation |
| `generator/*`                            | Hardware bulk-log endpoint + admin views |
| `cron/cleanup-locks`                     | Drop expired SlotHolds |
| `cron/expire-utrs`                       | Expire stale UTR submissions |
| `cron/generator-check`                   | Oil-change reminders, monthly summaries |
| `cron/send-reminders`                    | 24h + 2h booking reminders |
| `mobile/*`                               | Bearer-token REST surface for the RN app |

### Mobile REST surface

`/api/mobile/login · send-otp · verify-otp · google-login · forgot-password · change-password · set-password · me · dashboard · courts · booking · bookings · cafe · coupons · recurring · razorpay · settings`

---

## Authentication — three independent systems

The platform runs **three separate auth systems** that never share session state:

1. **Customer (web)** — NextAuth v5, JWT strategy, Credentials provider keyed on phone+OTP. Sessions land in `authjs.session-token` / `__Secure-authjs.session-token` cookies. See [lib/auth.ts](lib/auth.ts), [lib/auth.config.ts](lib/auth.config.ts).
2. **Admin (web)** — Hand-rolled. `AdminUser` table (separate from `User`), bcrypt passwords, role + permissions array. Custom signed cookie `admin-session-token`. Login via `/godmode`. See [lib/admin-auth.ts](lib/admin-auth.ts), [lib/admin-auth-session.ts](lib/admin-auth-session.ts), [lib/permissions.ts](lib/permissions.ts).
3. **Mobile** — JWT bearer tokens issued by `/api/mobile/login` and `/api/mobile/verify-otp`, validated by `requireMobileUser()`. Token stored in Keychain on device. See [lib/mobile-auth.ts](lib/mobile-auth.ts), [apps/mobile/src/lib/api.ts](apps/mobile/src/lib/api.ts).

OTP delivery is shared across customer-web and mobile via [lib/otp.ts](lib/otp.ts) (MSG91, with rate-limit + lockout in `RateLimit` table).

---

## Domain model

[prisma/schema.prisma](prisma/schema.prisma) (~1,370 lines, 12 migrations) is the system's center of gravity. Models fall into clusters:

### Core

- `User` (CUSTOMER / ADMIN role, optional password, referral code, birthday, soft-delete)
- `Account`, `Session`, `VerificationToken`, `RateLimit` — auth scaffolding
- `AdminUser` (separate identity), `AdminRole` enum (SUPERADMIN / ADMIN / STAFF)

### Court & booking

- `CourtConfig` — sport × size × position with zones; one row per bookable court configuration
- `SlotHold` — transient checkout reservation. Created when a customer proceeds to checkout, deleted atomically when payment commits or expires. Tracks the in-flight Razorpay/PhonePe order ID, applied coupon, and a `wasBookedAsHalfCourt` flag for the unified "Half Court (40x90)" customer flow.
- `Booking` + `BookingSlot` — confirmed reservations
- `BookingEditHistory` — admin audit trail
- `SlotBlock` — admin-imposed unavailability
- `PricingRule` (`courtConfig × dayType × timeType`), `TimeClassification` — pricing matrix
- `Notification` — outbound message log

### Payments

`Payment` and `CafePayment` are parallel models:

- Methods: `RAZORPAY · PHONEPE · UPI_QR · CASH · FREE`
- Status: `PENDING · PARTIAL · COMPLETED · REFUNDED · FAILED`
- UPI QR flow: customer submits `utrNumber`, admin verifies, cron expires unverified submissions
- Partial payments: `advanceAmount` + `remainingAmount`, with the venue-side remainder splittable across cash and UPI (`remainderCashAmount`, `remainderUpiAmount`, `remainderMethod`)
- `PaymentGatewayConfig` (singleton): toggles `activeGateway`, `onlineEnabled`, `upiQrEnabled`, `advanceEnabled`

### Cafe ordering

`CafeItem · CafeOrder · CafeOrderItem · CafePayment · CafeOrderEditHistory · CafeSettings (table count) · CafeDiscount · CafeDiscountUsage` — full QSR-style ordering with table numbers, status workflow (PENDING → PREPARING → READY → COMPLETED), guest checkout, and its own discount engine alongside the unified coupon system.

### Coupons (unified)

- `Coupon` — scope (SPORTS / CAFE / BOTH), discount type, max-uses, per-user cap, sport / category / user-group filters, stacking, system-code flag
- `CouponCondition` — extensible condition types (MIN_AMOUNT, FIRST_PURCHASE, USER_GROUP, SPORT_SPECIFIC, CATEGORY_SPECIFIC, TIME_WINDOW, BIRTHDAY, REFERRAL)
- `CouponUsage` — per-user-per-booking ledger
- **Admin-curated targeting** (recent addition): `UserGroup` + `UserGroupMember` for hand-built cohorts, `CouponEligibleUser` and `CouponEligibleGroup` for direct or group-scoped coupon eligibility
- Legacy `DiscountCode` + `DiscountUsage` still present alongside the unified system

### Reward points

- `RewardPointsBalance` (per user, lifetime earned/redeemed/current, tier)
- `PointsTransaction` (typed: EARNED_*, REDEEMED_*, EXPIRED, ADJUSTMENT)
- `RewardConfig` (singleton): earn rates, redemption ratio, tier thresholds, multipliers (basis points), expiry days, tiers `BRONZE → SILVER → GOLD → PLATINUM`

### Other features

- `Feedback` — post-match rating + tags
- `Waitlist` — slot-watch with status workflow and auto-expiry
- `Equipment` + `EquipmentRental` — per-hour rentals attached to bookings
- `RecurringBooking` + `RecurringConfig` — weekly or daily recurring with discount tiers
- `PromoBanner` — placement-aware homepage / checkout banners
- `FAQEntry` — bot + FAQ page

### Generator operations (venue infrastructure)

- `Generator` — venue diesel/petrol generators
- `GeneratorConfig` (singleton): petrol/oil prices, consumption rate, oil-change schedule (first / second / regular intervals), alert thresholds, MSG91 template IDs, mobile PIN, hardware API key
- `GeneratorFuelLog`, `GeneratorOilChange`, `GeneratorRunLog` — fuel + oil + runtime tracking. Run logs accept entries from the website or a hardware device via the bulk-log endpoint.

### Operational

- `CachedDocument` — bytes + mime-type for periodically regenerated PDFs (sports pricing, cafe menu)
- `Expense` + `ExpenseEditHistory` + `ExpenseOption` — internal cost tracker that replaced a Google Sheet. `ExpenseOption` makes every dropdown editable from the admin UI without redeploys; amounts stored in whole rupees.

---

## Server actions (`actions/`)

36 files, roughly split admin vs. customer. Naming convention `admin-*` for admin-only mutations:

| Customer-facing                                                                                  | Admin-only                                                                                                                                                                                              |
|--------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `auth.ts · booking.ts · cafe-orders.ts · checkin.ts · coupon-validation.ts · customer-coupons.ts · discount-validation.ts · equipment.ts · feedback.ts · generator.ts · profile.ts · recurring-booking.ts · referral.ts · reward-points.ts · upi-payment.ts · waitlist.ts · cafe-settings.ts` | `admin-analytics · admin-auth · admin-booking · admin-cafe · admin-cafe-discounts · admin-cafe-orders · admin-calendar · admin-coupons · admin-discounts · admin-equipment · admin-expenses · admin-faqs · admin-payment-settings · admin-pricing · admin-razorpay · admin-recurring · admin-rewards · admin-slots · admin-user-groups · admin-users` |

Heaviest actions by line count: `generator.ts` (~845), `upi-payment.ts` (~448), `recurring-booking.ts` (~443), `coupon-validation.ts` (~396).

---

## Library modules (`lib/`)

37 modules. Highlights:

- **Database**: [db.ts](lib/db.ts) — Prisma client singleton on Neon serverless adapter
- **Auth**: [auth.ts](lib/auth.ts), [auth.config.ts](lib/auth.config.ts), [auth-unified.ts](lib/auth-unified.ts), [admin-auth.ts](lib/admin-auth.ts), [admin-auth-session.ts](lib/admin-auth-session.ts), [mobile-auth.ts](lib/mobile-auth.ts), [permissions.ts](lib/permissions.ts), [otp.ts](lib/otp.ts), [password.ts](lib/password.ts), [phone.ts](lib/phone.ts)
- **Booking core**: [slot-hold.ts](lib/slot-hold.ts), [availability.ts](lib/availability.ts), [court-config.ts](lib/court-config.ts), [pricing.ts](lib/pricing.ts), [ist-date.ts](lib/ist-date.ts)
- **Payments**: [phonepe.ts](lib/phonepe.ts) (Standard Checkout v2 — recently migrated from V1 X-VERIFY), [phonepe-static-qr.ts](lib/phonepe-static-qr.ts) (legacy V1 for venue QR), [razorpay.ts](lib/razorpay.ts), [razorpay-api.ts](lib/razorpay-api.ts)
- **Notifications**: [notifications.ts](lib/notifications.ts), [email.ts](lib/email.ts), [reminders.ts](lib/reminders.ts), [generator-notifications.ts](lib/generator-notifications.ts), [ics.ts](lib/ics.ts)
- **Coupons / rewards**: [new-user-discount.ts](lib/new-user-discount.ts), [reward-points.ts](lib/reward-points.ts)
- **Chatbot**: [chat-engine.ts](lib/chat-engine.ts), [faq-data.ts](lib/faq-data.ts), [faq-search.ts](lib/faq-search.ts) — in-app FAQ assistant
- **Misc**: [analytics.ts](lib/analytics.ts), [expenses.ts](lib/expenses.ts), [generator-pin.ts](lib/generator-pin.ts), [utils.ts](lib/utils.ts)

---

## Components (`components/`)

shadcn/ui primitives in `components/ui/`. Feature components grouped by domain:

- `admin/` — booking edit history, edit-booking modal, edit-slots modal, create-booking form, date-filter input
- `booking/` — countdown timer, court diagram, date picker, discount input, slot grid, sport card
- `cafe/` — cafe-cart drawer, checkout client, menu page
- `payment/` — advance-payment selector, payment selector, UPI QR checkout, UPI QR display
- `chatbot/` · `rewards/` · top-level chrome (`bottom-nav`, `back-button`, `login-modal`, `checkout-auth`, `sign-out-button`, analytics trackers)

---

## Mobile app (`apps/mobile/`)

### Boot

[App.tsx](apps/mobile/App.tsx) shows an animated splash on every cold start (the native `LaunchScreen.storyboard` is plain black, so the JS splash takes over invisibly), then mounts `RootNavigator`.

### Navigation

- `RootNavigator` — branches on auth state: signed-in users see `MainNavigator`; signed-out users see modal stack with `Phone` → `Otp` screens
- `MainNavigator` — bottom tabs: Sports / Bookings / Cafe / Chat / Account (mirrors web bottom nav)
- `BookStack` — sport → court → slots → checkout → confirmation
- `AccountStack` — account screens

### Screens

`auth/{Phone,Otp} · book/{BookSport,BookCourt,BookSlots,Checkout,BookingConfirmed} · bookings/{BookingsList,BookingDetail,RecurringBookings} · cafe/CafeMenu · account/{Account,EditName} · home/Home · chat/Chat · splash/Splash`

### Lib

- [api.ts](apps/mobile/src/lib/api.ts) — Bearer-token fetch wrapper with a global 401 handler that signs the user out
- [auth.ts](apps/mobile/src/lib/auth.ts), [storage.ts](apps/mobile/src/lib/storage.ts) — token lifecycle (Keychain + MMKV)
- [booking.ts](apps/mobile/src/lib/booking.ts), [bookings.ts](apps/mobile/src/lib/bookings.ts), [cafe.ts](apps/mobile/src/lib/cafe.ts) — typed clients for `/api/mobile/*`
- [chat-engine.ts](apps/mobile/src/lib/chat-engine.ts), [faq-data.ts](apps/mobile/src/lib/faq-data.ts) — chat parity with web (duplicated, not shared)
- [queryClient.ts](apps/mobile/src/lib/queryClient.ts) — TanStack Query setup
- [format.ts](apps/mobile/src/lib/format.ts), [ist-date.ts](apps/mobile/src/lib/ist-date.ts), [types.ts](apps/mobile/src/lib/types.ts)

### Build configuration

`scripts/write-build-config.js` (run on `postinstall` and `npm run build-config`) picks the API backend by git branch at bundle time — branches map to local vs. preview vs. production hosts.

---

## Cron jobs

Scheduled via `vercel.json` against routes under `app/api/cron/`:

- `cleanup-locks` — drop expired `SlotHold` rows
- `expire-utrs` — expire stale UTR submissions on UPI QR payments
- `generator-check` — oil-change reminders + monthly summaries to admins
- `send-reminders` — 24h + 2h booking reminders (email + SMS)

All cron routes are guarded by a `CRON_SECRET` env var.

---

## Environment

Sample in [.env.example](.env.example). Required keys:

- `DATABASE_URL` — Neon PostgreSQL with pooled connection
- `AUTH_SECRET` — NextAuth JWT signing secret
- `MSG91_AUTH_KEY` + multiple template IDs (OTP email, OTP SMS, booking confirmation, admin pending booking)
- `ADMIN_NOTIFICATION_PHONES` — comma-separated 91-prefixed numbers
- `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET`
- `PHONEPE_CLIENT_ID` / `PHONEPE_CLIENT_SECRET` / `PHONEPE_CLIENT_VERSION` / `PHONEPE_ENV` (SANDBOX / PRODUCTION)
- `PHONEPE_WEBHOOK_USERNAME` / `PHONEPE_WEBHOOK_PASSWORD` — S2S callback auth
- `PHONEPE_STATIC_QR_SALT_KEY` / `PHONEPE_STATIC_QR_SALT_INDEX` — legacy V1 scheme for venue QR
- `CRON_SECRET`

---

## Operational notes

- **PhonePe Standard Checkout v2** is the primary online gateway — recently migrated from the V1 X-VERIFY scheme. Razorpay remains wired up. Static-QR callbacks still use V1.
- **Slot locking** uses `SlotHold` rows with a 5-minute TTL extended during payment. On payment success the hold is deleted atomically and a `Booking` + `Payment` are created. If the customer abandons checkout, the hold expires and no booking is ever written.
- **Admin sessions are independent** of customer sessions. A customer is signed in via `authjs.session-token`; an admin is signed in via `admin-session-token` (issued at `/godmode`). The two cookies coexist without interference.
- **Mobile and web share HTTP contracts**, not code. Adding a feature to the mobile app usually means adding a new `app/api/mobile/<feature>/route.ts` and a typed client in `apps/mobile/src/lib/`.
- **Vercel build is gated**: `ci(vercel): skip web build when only apps/mobile/ changed` — see `scripts/vercel-ignore.sh`.
- **Branch-driven mobile API host**: the RN app picks its backend at bundle time based on the current git branch (see `apps/mobile/scripts/write-build-config.js`).

---

## Related docs

- [README.md](README.md) — quick start
- [Momentum-Arena-Feature-Guide.pdf](Momentum-Arena-Feature-Guide.pdf) — product-side feature catalog
- [SEO-GUIDE.md](SEO-GUIDE.md), [LOCAL-SEO-GUIDE.md](LOCAL-SEO-GUIDE.md)
- [docs/PRODUCTION-DEPLOY-RUNBOOK-2026-04-16.md](docs/PRODUCTION-DEPLOY-RUNBOOK-2026-04-16.md) — production deploy procedure
- [docs/email-templates/](docs/email-templates/) — MSG91 transactional templates
