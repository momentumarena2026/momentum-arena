---
name: payment-orphan-leak-fix
description: Captured-but-no-booking money leak (hold swept before late payment) — root cause + the 3-layer schema-free fix shipped to main c75f0e9
metadata:
  type: project
  originSessionId: 5ab2a2c4-5e6a-4f62-9239-19e35bd79d9b
---

**Prod incident (2026-06-29, user Yash Agrawal 918800453015, order_T7LQAq5SzNFJvG):** Razorpay verify failed "Hold expired" AFTER signature passed = money captured, no booking, no refund (silent orphan). Surfaced in the web Action Log.

**Root cause:** a `SlotHold` does two jobs with opposite lifetimes — (1) reserve the slot during checkout (expires fast, 15 min), (2) carry the booking blueprint (court/time/amount/coupon/points) used to rebuild the Booking after the gateway confirms. A customer can pay AFTER the 15-min hold expires (gateway window is independent of our TTL); `cleanupExpiredHolds` then DELETED the hold, so verify/webhook/recovery had nothing to rebuild from. Key facts: availability gates on `expiresAt > now` (so keeping an expired row does NOT re-block the slot); `createBookingFromHold` tolerates an expired hold (findUnique, no expiry check) but only re-checked slot conflicts for BOWLING_MACHINE; **no DB unique constraint** stops two bookings on the same court+date+slot → naive "keep + rebuild" would double-book. Razorpay auto-capture is ON (no `payment_capture:0`; webhook only handles `payment.captured`).

**The fix — `c75f0e9` on main (schema-free, all 3 layers):**
- **L1 preserve blueprint** — `lib/slot-hold.ts cleanupExpiredHolds` keeps holds with a payment attempt (`paymentInitiatedAt`/gateway ref) for **24h** (`PAYMENT_GRACE_HOURS`) after the attempt; no-payment holds deleted at expiry as before. `create-order` already stamps `paymentInitiatedAt`.
- **L2 conflict-aware rebuild** — `actions/booking.ts createBookingFromHold` now re-checks slot conflicts for ALL categories (added non-bowling `else`: zones `hasSome` + requested-hour overlap → throw `SLOT_CONFLICT`). The `$transaction` is wrapped in try/catch: on any `*SLOT_CONFLICT` it records a "slot-taken" orphan (only if a gateway payment id is present) and returns null → callers never double-book (tx rollback restores the hold). Bowling's throw `BOWLING_SLOT_CONFLICT` also matches `.includes("SLOT_CONFLICT")`.
- **L3 loud + durable orphans** — new `lib/payment-orphan.ts recordOrphanPayment()` writes a distinct **`payment.orphan`** action to the existing server-action log (no new table). Wired at every captured-but-no-booking point: razorpay verify (web `app/api/razorpay/verify` + mobile `app/api/mobile/razorpay/verify`) `!hold`; razorpay `webhook` no-hold; phonepe `callback` `!hold` (after status.success); `lib/dqr-confirm` `!hold`; + the central slot-taken path. Verify routes no longer say "try again" when money was captured (returns `paymentReceived:true` + a do-not-pay-again message) to prevent double-charge. Label added in `lib/server-log-shared.ts`.

**Admin workflow for orphans:** filter the web Action Log by action `payment.orphan` → get pay_/order id + amount → honour via Bookings → Recovery (paste pay_ id) OR refund in the gateway dashboard. **Refund execution is deliberately manual** (no auto-refund; no Razorpay refund helper exists in repo — `lib/razorpay.ts` has create-order/verify/webhook-verify/fetchRazorpayPayment only).

**Deliberately NOT done (possible follow-ups):** (a) auto-refund of orphans after N hours; (b) build a Razorpay refund helper + a one-click "refund orphan" button on the recovery page; (c) structural rework = persist booking intent in its own `BookingPaymentIntent` model (mirror the existing `CafePaymentIntent`, which already survives independent of any lock — cafe DQR has no orphan problem because of this) so holds revert to pure short-lived locks. NOTE this repo deploys schema via `prisma db push` (seed-production.yml / seed-staging.yml), NOT `migrate deploy` — a new model is an out-of-band prod step, which is why the fix was kept schema-free.

See [[dqr_phonepe_integration]] and [[project_booking_system]].
