---
name: app-coupons-first-app-booking
description: App-specific (platform-restricted) coupons + FIRST_APP_BOOKING condition across both coupon systems — shipped to development b236b43, needs prisma db push before main
metadata:
  type: project
  originSessionId: 5ab2a2c4-5e6a-4f62-9239-19e35bd79d9b
---

Feature: platform-restricted coupons (all/web/ios/android) + a "first app booking" auto-discount, across BOTH the booking `Coupon` module and the cafe `CafeDiscount` system. **LIVE on main `35a32ea`** (prod schema synced — seed-production run 28376390028 success: prisma db push + seed). User decisions: auto-apply on app + cover cafe too + granular iOS/Android options.

**Deploy mechanism learned:** seed-staging.yml fires on push to `development`, seed-production.yml on push to `main` — both run `prisma db push --accept-data-loss` (after pre-db-push-cleanup.sql) + `prisma/seed.ts`. So a SCHEMA-change promotion must NOT use `[skip ci]` (that skips seed-production → prod DB never synced). Schema-free promotions keep using `[skip ci]`. Staging auto-synced on the dev push; prod auto-synced on the main push.

**Schema (additive, backward-compatible):** `Coupon.validPlatforms String[] @default([])`, `CafeDiscount.validPlatforms String[] @default([])`, `CouponConditionType += FIRST_APP_BOOKING`. Empty validPlatforms = all platforms; App-only = `["android","ios"]`.

**Engine:** `validateCoupon` (actions/coupon-validation.ts) + `validateCafeCoupon` (actions/cafe-orders.ts) take a `platform` arg, enforce validPlatforms (shared helpers in **lib/coupon-platform.ts** — `isPlatformAllowed` + `platformRestrictionMessage`, a plain module so the "use server" files can import them). `FIRST_APP_BOOKING` passes only when platform is android/ios AND the user has 0 prior app bookings (status CONFIRMED/COMPLETED/ABSENT, createdByAdminId null; web bookings don't count). NOTE the pre-existing `FIRST_PURCHASE` condition keys on prior COUPON USAGE, not bookings — FIRST_APP_BOOKING is deliberately separate. Platform threaded through 6 call sites (web applyCouponToHold + checkout-client "web"; mobile booking apply-coupon/validate + cafe orders/validate via getMobilePlatform).

**Auto-apply:** `APP_FIRST_BOOKING_CODE = "APPFIRST"` in lib/auto-apply-promo.ts; mobile `CheckoutScreen.tsx` attempts it FIRST (server-gated, silently no-ops if ineligible) before the new-user/sport-fallback codes. Admin must CREATE the actual `APPFIRST` coupon: App-only + a FIRST_APP_BOOKING condition. (Mobile mirrors the constant locally — can't import the web package.)

**Sport-promo / banner / slot decoration (fix `5dcbe43`):** `getActiveSportPromo` (actions/sport-promo.ts) drives web slot-price strike-throughs + the launch banner + admin-side auto-apply, and did NOT check validPlatforms — so an App-only coupon still decorated web. Now takes `platform: CouponPlatform = "web"` and returns null via `isPlatformAllowed`, so switching a coupon to App-only auto-removes ALL web surfaces (banner, slot prices, checkout-page promo, admin web auto-apply). Mobile `app/api/mobile/sport-promo/route.ts` passes getMobilePlatform so the app still shows it. Lesson: a coupon's validPlatforms must gate every surface — validateCoupon (apply/manual) AND getActiveSportPromo (decoration/banner/auto-apply).

**APPFIRST coupon CREATED in prod** (inactive, id cmqza585600005nyql5c9jtda) via **scripts/seed-app-first-booking-coupon.ts** + **.github/workflows/seed-app-first-booking-coupon.yml** (workflow_dispatch, create-if-absent, mirrors seed-pickleball-coupon.yml). Defaults: 20% off capped ₹150, App-only, FIRST_APP_BOOKING condition, 1/user, isPublic, **isActive FALSE** (user reviews value + toggles Active to go live). NOTE: coupons are NOT seeded via prisma/seed.ts (they deliberately stripped coupon upserts from it to avoid clobbering admin edits) — use dedicated workflow_dispatch seed scripts.

**Customer listings** (actions/customer-coupons.ts): app-only coupons hidden on web + web-only on app (platformWhere filter on all three queries). Admin create/update persist validPlatforms in admin-coupons.ts + admin-cafe-discounts.ts. Admin UI (web coupons-manager + cafe-coupons-client; mobile AdminCouponsScreen + AdminCafeCouponsScreen + their routes/clients): "Valid on" picker (All/App only/Web only/iOS only/Android only) + FIRST_APP_BOOKING condition (booking only) + per-row restriction badges.

**⚠️ DEPLOY (schema change — repo syncs via `prisma db push`, NOT migrate-on-deploy):** the columns/enum are ADDITIVE → safe to push anytime, no data loss. Correct order: (1) `npx prisma db push` on STAGING (seed-staging.yml) → verify on development/staging; (2) `npx prisma db push` on PROD (seed-production.yml) — safe to run while old code is live, it ignores the new column/enum; (3) THEN promote code to main. Do NOT promote main before the prod db push or coupon queries 500 on missing column/enum. Verifier left main promotion to the user for this reason.

See [[payment_orphan_leak_fix]], [[mobile_admin_authz_audit]].
