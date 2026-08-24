---
name: mobile-admin-authz-audit
description: 2026-06-28 multi-agent security/parity audit of the mobile app — closed the admin-route authorization class-bug + google-login aud; open decisions + Wave-3 feature gaps
metadata: 
  node_type: memory
  type: project
  originSessionId: 5ab2a2c4-5e6a-4f62-9239-19e35bd79d9b
---

Full mobile-app audit (security + web parity) on 2026-06-28, shipped to `development` as **`0f0396f`** + bottom-tab permission gating `4f8d260`, then **PROMOTED TO MAIN `b18ddbc`** (schema-free `[skip ci]`, tree-identical gate passed, prod DB untouched).

**The class-bug (fixed):** mobile admin routes authenticated via `getMobileAdmin` but many never re-checked PERMISSION — they call web actions with `skipAuth`/`adminOverride`, which bypasses the action's own `requireAdmin("KEY")`. So any logged-in admin (even STAFF) could refund/edit-payment/confirm/cancel/edit bookings, block slots, manage cafe menu+orders, expenses, check-in, create/search customers. Fix = new **`lib/mobile-admin-guard.ts`** `requireMobileAdmin(request, permission)` (401/403, SUPERADMIN bypass) applied to ~38 routes with the SAME key web enforces. The correct pre-existing template was `bookings/recovery/route.ts`. Auth-only-by-design routes (no perm gate, correct): login, me, profile, devices, stats. admin-users = direct `role==="SUPERADMIN"` gate (correct).

**Other security fixes in 0f0396f:** google-login initially patched (aud allow-list) — but then **Google login was REMOVED ENTIRELY (main `6a20a31`)** because it's unused + not planned: deleted `app/api/mobile/google-login/route.ts` + the web NextAuth Google provider in `lib/auth.ts` (+ its dead signIn-google branch + the OAuth-only events.createUser bonus hook). Phone-OTP is now the ONLY auth provider; the GOOGLE_OAUTH_AUDIENCES env requirement is moot. No `google` refs remain. payment-settings POST → MANAGE_PRICING (was VIEW_RAZORPAY). utr-verify cafe path → MANAGE_CAFE_ORDERS. set-password requires current password when one exists. Parity bugs: sports parent-toggle uses `some` (was `every`); OTA "forcing" uses web's `min>=latest` formula. Deleted dead AdminPlaceholderScreen + orphan lib/cafe-cart-ui.ts.

**Audited CLEAN (no action):** money/units (paise↔rupees faithful — booking/cafe/shop/rewards mostly share server logic; no wrong charges), IDOR (every customer route scopes to token user.id; no body-supplied userId trusted), destructive-action confirms, nav wiring, client↔route contracts, More-hub row permission gating.

**OPEN DECISIONS — ALL RESOLVED (main `f4a9c71`, 2026-06-29):**
1. ✅ coupons + user-groups permission key → web ACTIONS now require MANAGE_COUPONS (was MANAGE_DISCOUNTS) — matches sidebar + mobile. (actions/admin-coupons.ts, admin-user-groups.ts)
2. ✅ recurring `allowedDays` → mobile per-day picker REMOVED; mobile now always saves all-7 (web auto-derives the day). (AdminRecurringConfigScreen.tsx)
3. ✅ bottom-tab permission gating → shipped earlier (`4f8d260`).

**WAVE-3 feature-parity — BUILT & SHIPPED (main `82cbc5c`, 2026-06-29, 6 parallel agents, schema-free, all 23 routes permission-gated):** coupons targeting/conditions/filters/stackable (+ new route coupons/users); push audience-targeting + dry-run + admin test-push + device mgmt (+ push/users, push/test, push/devices); generator create/delete/config/analytics/history + run timer (+ generator/[id],config,analytics,history,run); products category CRUD + stock-adjust-with-note (+ products/categories[+[id]]); equipment category + displayOrder; pricing PEAK/OFF-PEAK band CRUD (was read-only); razorpay drill-down tabs (+ razorpay/transactions); users create/edit/soft-delete/restore (+ users/[id][+restore]); profile confirm-password. Web actions admin-push.ts + admin-users.ts gained backward-compatible `skipAuth`. admin-users invite-email DROPPED (no email infra in repo; web doesn't email either — direct-create is correct parity).
**STILL DEFERRED (needs a NEW APP BINARY, not OTA — `expo-image-picker` native module):** product image upload + equipment imageUrl upload. Everything else is OTA-shippable.

**WEB-side latent bugs — BOTH RESOLVED (main `f4a9c71`, 2026-06-29):** (a) FLAT-coupon unit — the real root cause was a web↔mobile DATA inconsistency, NOT a validator bug: web admin + `coupon-validation.ts` + `lib/auto-apply-promo.ts` all treat FLAT `value`/`maxDiscount` as whole RUPEES (the canonical unit of existing coupon data; schema's "paise" comment is wrong), but the NEW mobile admin stored/displayed them ×100 as paise → mobile-created FLAT coupons would 100x the discount. Fixed the MOBILE admin to use rupees (no ×100 save / no ÷100 display); validator left untouched → no migration, existing web coupons safe. ⚠️ if any FLAT coupon was already created via the mobile admin before this fix, its stored `value` is 100x too big — check/fix that row manually. (b) ✅ cafe direct-COMPLETED orders now award points — same idempotent fire-and-forget `awardCafePoints` added to both create paths (`actions/cafe-orders.ts` in-person + `lib/cafe-intent.ts` online), matching the transition path's `COMPLETED && userId`.

See [[admin_mobile_parity]] and [[session_handoff_2026_06_27]].
