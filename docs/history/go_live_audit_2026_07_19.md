---
name: go-live-audit-2026-07-19
description: "Pre-store-release audit: 29 defects fixed and pushed to development (9ca11a4), the 5 staging transactions still needed, and why the fix loop stopped at round 3"
metadata: 
  node_type: memory
  type: project
  originSessionId: 5ab2a2c4-5e6a-4f62-9239-19e35bd79d9b
  modified: 2026-07-22T07:57:53.021Z
---

**PROMOTED TO MAIN 2026-07-22 (merge `ed782a9`, alongside authz + rewards — see [[rewards_and_authz_hardening]]).** Was development @ `9ca11a4` (2026-07-19). 60 files, +3647/-862. Pre-release audit of the whole app: 66 findings raised, 57 survived adversarial verification, ~29 distinct defects fixed over 3 rounds.

**What was fixed** (detail is in the commit message, which is long and worth reading): client-set charge amounts on 5 payment routes (a tampered client could book full price for ₹1 — hardening only `/api/mobile` was bypassable because `lib/auth-unified` accepts the mobile JWT on web routes too); shop Razorpay verify not binding order→payment; equipment missing from the venue remainder everywhere; cafe coupon limits unenforceable; a 12-file sweep so COMPLETED/ABSENT stop putting an occupied court back on sale; ~8 more serverless fire-and-forget notification sites; reminders comparing IST slot hours to a UTC clock.

**`lib/booking-amounts.ts` is new and is now the ONLY place the payable is derived.** It exists because that derivation had been reimplemented eight times and was wrong differently in each. Read its docblock before touching amount math.

**⚠️ NOTHING HERE HAS BEEN RUN.** All of it is reasoned-about and compile-verified only. Before promoting to main, execute on staging: (1) a recurring series, (2) a 50% advance with rented equipment, (3) a bowling 30-min booking, (4) a pass redemption then admin edit-slots, (5) mark a booking Complete. Those five cover most of the diff.

**Why the loop stopped at round 3 rather than reaching "bug free".** Each round fixed the previous round's regression and introduced its own — review-clean rate went 43% → 61% → **14%**. Round 2 closed the ₹1 exploit and undercharged every recurring booking 12× (the multiplier lives only in URL params, never persisted on the SlotHold, so `overrideAmount` was its sole carrier). Round 3 fixed that and added an unauthenticated `commitFullyCoveredHold` server action — reverted by hand. **The lesson: file-scoped fix agents make locally-correct changes that break flows they cannot see, and no amount of additional reading rounds catches it.** A wrong number passes `tsc`, `next build` and `eslint` cleanly. Running one real transaction beats another audit round.

**Still open, unchanged by this work:** production `intentEnabled` is still ON (see [[dqr_phonepe_integration]]), task #68 (real UPI intent tap-to-pay) untested, and the 3–4 customers from the original stuck-payment incident unreconciled against the PhonePe dashboard.

Known remaining findings not fixed (round-3 reviewers, all non-blocking): percentage coupons on recurring still derive off one session; `recomputeCafeOrderTotals` regression on deploy-straddling orders; advance-only payment config blocked in mobile checkout; some raw error strings shown to customers in the DQR sheets.

Related: [[pass_coverage_and_dqr_recovery]], [[deployment_runbook]], [[feedback_no_auto_main]]
