---
name: book-via-checkout-redesign
description: "Book-via checkout (Pass / Pass+Pay vs Online) — pass-mode hold model, courtBase repricing, default-pass-tab with opt-out sentinel; shipped web+app on development"
metadata: 
  node_type: memory
  type: project
  originSessionId: 5ab2a2c4-5e6a-4f62-9239-19e35bd79d9b
  modified: 2026-07-31T21:26:00.063Z
---

**Book-via checkout redesign (shipped 2026-07-31, development commits 0d9a009 / a06f0bc / 326d840; NOT on main).** Pass-holders see a "Book via" switch at the top of checkout: tab 1 "Pass" (full coverage → slim recap + one-tap Book now via the legacy redeem route) or "Pass + Pay" (partial → whole regular checkout repriced on the remainder), tab 2 "Online Payment" (untouched flow).

**Model (don't re-derive):**
- `SlotHold.passModeId` + `passModeCoverage` JSON snapshot `{passId, passName, coveredMinutes, coveredAmount, fullCoverage, coveredSlots:[{h,m,min}]}` — snapshotted on tab entry by `setHoldPassMode(hold, on)` in [lib/passes.ts]; entering/exiting clears coupon/points both ways (they reprice on the new base).
- `holdCourtBase(hold)` in lib/booking-amounts.ts = totalAmount − coveredAmount (totalAmount when not in pass mode). ALL pricing consumers use it: coupon validation, points, deriveHoldCharge, web page + mobile hold GET (`courtBase` field). Booking.totalAmount keeps FULL value; payment.amount = remainder; passRedemption carries covered value. `settleHoldPassMode` runs post-create in `createBookingFromHold` (debitPass idempotent per bookingId, so double-settle with the redeem route is safe).
- **Default = Pass tab**: `ensureDefaultBookVia(hold)` runs on first load (web checkout page render + mobile hold GET). Explicit "Online Payment" switch writes sentinel `passModeCoverage = {optOut:true}` (passModeId null) — sticky across reloads; parsers treat it as "no coverage". Never remove the sentinel semantics without replacing the stickiness.
- Pass mode forces single-session (no recurring). Full-coverage tab skips coupon auto-apply; Pass+Pay auto-applies on the remainder.

E2E: money math (₹600+₹800 hold, peak-only pass → base 600, redemption 60min/₹800) and default/opt-out both verified against staging via tsx scripts (`npx tsx --env-file=.env` from repo root with @/ imports; scratchpad scripts can't resolve relative libs).

**Multi-pass engine (2026-08-01, dev 88a2b96…1c3961e):** PassRedemption is now one row per (bookingId, userPassId) — `@@unique([bookingId, userPassId])`, bookingId NO LONGER unique (all findUnique-by-bookingId consumers were converted; never reintroduce one). `getPassOfferForHold` stacks ALL eligible passes soonest-expiring first (peak+off-peak split one booking; same-band passes stack 2h old + 1h new, n deep); offer/coverage carry `passes[]` share breakdowns; settle/redeem debit per share; restore loops rows; syncPassAfterAdminEdit handles multi-row; analytics/CA MUST sum redemptions per booking (last-row-wins Map bug fixed 1c3961e). Admin create-booking has payWithPass (full → PASS/₹0 payment; partial → remainder via chosen method) + coverage preview (web action previewAdminPassCoverage / mobile pass-preview route). Checkout summaries price covered slots at ₹0 with per-pass "Included" lines (no minus row). E2E: cross-band 2-pass, 2h+1h stacking (auto-EXHAUSTED), 3-pass cover, full Pass+Pay booking with all money surfaces agreeing.

Related: [[pass-coverage-and-dqr-recovery]] (coveredSlots model), [[passes-ui-info-bar-2026-07-31]], [[app-coupons-first-app-booking]] (auto-apply).
