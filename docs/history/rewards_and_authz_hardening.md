---
name: rewards-and-authz-hardening
description: "Rewards engine hardened + harness-verified (47/47), and a whole-surface auth-bypass class closed — both on development (b512b4a, d84dcd5), not main"
metadata: 
  node_type: memory
  type: project
  originSessionId: 5ab2a2c4-5e6a-4f62-9239-19e35bd79d9b
  modified: 2026-07-22T07:57:46.516Z
---

**PROMOTED TO MAIN 2026-07-22, merge `ed782a9`** (main tree == development). Two commits after the go-live audit (see [[go_live_audit_2026_07_19]]):

**`d84dcd5` — auth-bypass class closed (was exploitable by anyone).** Admin `"use server"` action files took a `skipAuth`/`adminIdOverride`/`adminOverride` argument; since every export in a `"use server"` module is a public POST endpoint whose ARGS COME FROM THE CLIENT (and the action id ships in the public `/_next/static` bundle), passing `skipAuth:true` self-bypassed the permission gate. 27 of 28 admin files + the customer `userIdOverride` on rewards/shop-order/waitlist (an IDOR: read anyone's points, cancel anyone's order). Fix: `lib/admin-auth.ts` `requireAdmin()` and `lib/auth-unified.ts` `getAuthUserId()` now resolve identity from the request itself (cookie OR mobile Bearer, via `headers()` — mobile calls actions in-process). **97 bypass params removed across 70 files; every permission string preserved.** `lib/bowling-availability.ts`'s `adminOverride` is a BUSINESS RULE (past-slot visibility), NOT auth — left alone. The Razorpay webhook's legit server-to-server confirm moved to `lib/shop-confirm.ts` (`confirmShopOrderPaid`), a non-"use server" module where an explicit userId is safe.

**`b512b4a` — 22 rewards defects + executable harness.** `scripts/verify-rewards.ts` = 45 scenarios run against a real DB (rolled-back, self-cleaning) asserting `RewardBalance.pointsAvailable === SUM(RewardTransaction.points)` and `>= 0` after every case. **Final run 47/47.** This is the passes-harness pattern; it is the gate — reading missed all these because they're wrong on NUMBERS, which pass tsc. Key fixes: concurrent-redeem negative balance (atomic conditional `updateMany`, no CHECK/migration); expiry destroying held points (FIFO-reconstruct each lot's unconsumed remainder from the whole ledger, robust to legacy null-sourceTxnId); orphan-net crash on rewards shortfall; web signup/referral never awarded (sync `after()` freeze); bulk-grant idempotency; DQR/cafe earn+clawback gaps; adminEditPayment reconcile keyed on sourceTxnId not bookingId (bookingId collides with `@@unique([type,bookingId])`). Harness itself surfaced 4 more (cafe PENDING_PAYMENT earned, signup/referral/birthday not idempotent, bulk alert fire-and-forget, refund replay).

**`lib/db.ts` transaction timeout raised** maxWait 2s→15s, timeout 5s→20s. Neon serverless cold-start can exceed the 5s default and abort a live money transaction as "Transaction not found". Real prod fix, not a test crutch. NOTE: running verify-rewards against remote Neon is flaky on the DEFAULT timeout — the harness proves logic, not latency. Run it after any rewards change: `DATABASE_URL='<staging direct, non-pooler>' npx tsx scripts/verify-rewards.ts`. Use the DIRECT endpoint (drop `-pooler`) — the pooler drops interactive transactions.

**Still NOT release-ready** (nothing here changes the earlier gates): the go-live audit fixes were never exercised with real payments; prod `intentEnabled` still ON; task #68 (UPI intent) untested against live PhonePe. The rewards ENGINE is proven; the UI/gateway/timing around it is not. Related: [[go_live_audit_2026_07_19]], [[pass_coverage_and_dqr_recovery]], [[feedback_no_auto_main]]
