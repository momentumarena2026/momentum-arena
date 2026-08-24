---
name: Booking System Architecture
description: Momentum Arena sports booking system - web + mobile (customer + admin), payments, FCM, admin escape hatches
type: project
originSessionId: aa339a16-76d9-4c1d-9a57-2ba0429802ad
---
BookMyShow-style booking system for Momentum Arena (Mathura sports facility) — replaces WhatsApp-based manual booking.

**Stack**:
- Web: Next.js 16 App Router (Turbopack), NextAuth v5 JWT, server actions + Zod, shadcn/ui dark theme
- Mobile: React Native 0.85.2, TanStack Query v5, React Navigation v7
- DB: Neon PostgreSQL + Prisma (uses `@prisma/adapter-neon`); local dev needs `globalThis.WebSocket` patch with `ws` + `{ family: 4 }`
- Payments: Razorpay + static UPI QR (WhatsApp to +91 6396177261) + cash + PhonePe + Free
- Notifications: email + SMS (MSG91) + in-app + FCM push (`firebase-admin` server, `@react-native-firebase/messaging` mobile)
- Cron: GitHub Actions (Vercel Hobby is daily-only; GH Actions free tier covers hourly /api/cron/send-reminders)

**Court Layout**: 80x90ft main turf with sliding nets at 10ft/40ft/70ft → 4 zones (LEATHER_1, BOX_A, BOX_B, LEATHER_2). Separate SHARED_COURT for Pickleball/Badminton.

**Sports**: Cricket (all sizes incl Small 30x90), Football (Medium+ only), Pickleball, Badminton.

**Key decisions**:
- Zone-based overlap detection (set intersection)
- 1hr slots, 5AM–1AM, 10-min slot locking with Serializable transactions
- Pricing: configSize × dayType × timeType, admin-managed
- No user cancellation; admin-only refunds
- `Booking.platform` column tracks `android` / `ios` / `web` (legacy bookings backfilled to `web`)

**Mobile admin app** (hidden inside the customer RN app):
- Entry: 5 rapid taps on "Momentum Arena · v0.1.0" footer of Account screen → renders `/godmode` → `AdminShell`
- Auth: separate JWT + Keychain slot (`lib/mobile-auth.ts` → `signMobileAdminToken`, `verifyMobileAdminToken`, `getMobileAdmin`, `getMobilePlatform`)
- Sharing actions between web (cookie) and mobile (JWT): `adminIdOverride` / `adminOverride` / `preAuthorized` / `skipAuth` parameters on server actions
- After mobile mutations, server actions call `revalidateBookingPaths()` to invalidate web App Router caches
- Bottom tabs: Bookings, Check-in, Calendar, Cafe, Expenses
- Screens shipped: AdminBookingsList, AdminUnconfirmedBookingsList (separate from Pending — same composite filter as web: status PENDING + payment.status PENDING + method UPI_QR/CASH), AdminBookingDetail (with all action buttons), AdminEditSlots, AdminEditBooking, AdminEditPayment, AdminCreateBooking
- Header uses `useSafeAreaInsets()` + `paddingTop: insets.top + spacing["3"]` for iOS notch

**Admin escape hatches** (recently shipped, on `main`):
- `3d837ad` — "Confirm Booking" button on stuck PENDING bookings
- `b4f1adb` — Always-visible custom amount on web create form + "Edit Payment" modal on every booking detail (method/status/total/advance/Razorpay ID/UTR/audit note → writes `BookingEditHistory` PAYMENT_EDITED row)
- `8604703` — Full mobile Create Booking flow + always-visible custom amount on mobile (mirrors web)
- `cb768c7` — Hoisted `useMemo` above early returns in EditPayment (Rules of Hooks)
- `92fb5f8` — `reset()` root stack on Customer-view / sign-out from admin

**Web/mobile parity gap deliberately left open**: Web's create form's partial-advance method is still hard-coded to CASH/UPI_QR; only mobile's create form supports Razorpay as advance method. ~5 min fix to bring web to parity.

**How to apply:** All booking-related code follows existing patterns (server actions with Zod, NextAuth v5 JWT for web, JWT bearer for mobile, shadcn/ui dark theme web, RN/TanStack Query mobile). Always commit + push to both `development` and `main` when shipping (user pattern).
