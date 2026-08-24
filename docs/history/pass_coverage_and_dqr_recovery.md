---
name: pass-coverage-and-dqr-recovery
description: "PassRedemption.coveredSlots model + the DQR stuck-payment safety net — what shipped to main 2026-07-18 (ad7a67d) and what's still open"
metadata: 
  node_type: memory
  type: project
  originSessionId: 5ab2a2c4-5e6a-4f62-9239-19e35bd79d9b
  modified: 2026-07-23T15:00:33.420Z
---

**PROMOTED to main 2026-07-18, merge `ad7a67d`** (22 commits). Seed Production DB + OTA publish both green — the three additive columns are live in prod.

**Passes — the design that finally worked.** `PassRedemption.coveredSlots Json?` records WHICH slots a pass paid for (`[{h,m,min}]`). Before this, `coveredAmount` was re-derived on every admin edit by guessing, and seven audit rounds each broke something the previous fixed (only-shrink ratchet → priciest-first recompute → slot provenance → set algebra). **Do not go back to deriving it.** `scripts/verify-pass-coverage.ts` (13 scenarios, run against a real DB inside rolled-back transactions) fails if someone does — run it with `DATABASE_URL=<staging> npx tsx scripts/verify-pass-coverage.ts`.

Key invariant: owed-at-venue = `Booking.totalAmount − Payment.amount − coveredAmount(live redemption)`; `Payment.amount` is money actually captured; a pass buys COURT TIME only (never equipment), is court-GROUP scoped, judged against PLAY DATE, and bound to its price BANDS (now enforced on every admin path, not just checkout).

**DQR stuck payments.** Root cause is PhonePe-side (Open-Intent "replication" gap — third-party UPI apps debit against a txn PhonePe never matches). The app-side damage is fixed: `SlotHold.phonePeMerchantTxnId` is never overwritten while a payment is in flight (it's the ONLY pointer back to the hold — overwriting made paid money unrecoverable with no orphan record), `settlePriorDqrTxn` probes before minting, and "I've paid" runs a ladder (poll ~5s → confirm, or reserve an UNCONFIRMED booking). Admin queue renamed **Unconfirmed Payments**, covers bookings + cafe + pass claims, with `recoverDqrPayment(txnId)` beside the Razorpay recovery tool.

**⚠️ INTENT — keep the prod `intentEnabled` toggle OFF.** 2026-07-23 a real customer (Lovish) paid a pickleball booking via UPI intent (`upi_app_launched` in client logs), money debited + received by PhonePe, but NO booking (not confirmed, not unconfirmed, no orphan). Two compounding causes: (1) `releaseSlotHold` hard-deleted the hold on the navigate-away beacon, destroying `phonePeMerchantTxnId` — the only pointer back — FIXED on main `42dfb18` (all 4 slotHold.deleteMany sites now carry `paymentInitiatedAt: null`; PAYMENT_GRACE_HOURS had only covered the passive cron sweep, not the explicit release / re-lock paths). (2) PhonePe Open-Intent replication gap: a third-party-UPI-app (GPay/Paytm) intent payment isn't matched back to our merchant txn, so no S2S callback and `qrStatus(ourTxn)` returns PENDING/NOT_FOUND. **Before intent ON, ALL must be true:** (a) PhonePe confirms Open-Intent is provisioned/replicated for the merchant; (b) `intentInit` and `qrStatus` are on the same API version/namespace (suspected V1-init/V3-status mismatch → structural PAYMENT_NOT_FOUND); (c) a REAL end-to-end test via a third-party UPI app proves callback→booking→COMPLETED. Safety net (verify): "I've paid" claim fires on intent + reserves an unconfirmed booking from the retained hold; `recoverDqrPayment` should accept a PhonePe UTR; daily settlement-vs-bookings reconciliation. Scan-QR path is safe to keep ON throughout — it carries the merchant binding.

**Serverless notification lesson (bit us for months).** Notification dispatch in Server Actions was fire-and-forget (`notify(...).catch(...)` with no await), so the function froze on response and killed the SMS at random — the long-standing "admin unconfirmed-booking message sometimes doesn't arrive". Several sites also swallowed the error in an empty catch, so it left no trace. **Every notification dispatch must be inside `after()`** (next/server). Fixed across booking.ts, admin-booking.ts, upi-payment.ts and the mobile select-payment route.

Related: [[dqr_phonepe_integration]], [[deployment_runbook]], [[payment_orphan_leak_fix]], [[feedback_no_auto_main]]
