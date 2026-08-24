---
name: passes-premain-checklist
description: "RESOLVED 2026-07-17 — passes module PROMOTED to main (merge f49f49c) after all 5 gate items passed; kept for the record of what the gate covered"
metadata: 
  node_type: memory
  type: project
  originSessionId: 5ab2a2c4-5e6a-4f62-9239-19e35bd79d9b
---

**PROMOTED 2026-07-17: merge commit f49f49c took development (head 9b5b892) to main** — passes module (customer+admin, web+app), promo-banners/Web & App Config module, coupon autoApply + WORLDCUP25 + BOOKING_DATE condition, account revamp, header fixes. Gate walked with the user before promoting; seed-production ran the prod db push + seeds (WORLDCUP25, pickleball banner, gamelord perms). The original 5 gate items, for the record:

1. **md docs** — ✅ DONE (559c947): docs/PASSES.md + docs/TRUSTED-DEVICES.md written; CLAUDE.md gained a "Module docs" index.
2. **Permissions** — ✅ VERIFIED: MANAGE_PASSES + MANAGE_TRUSTED_DEVICES in lib/permissions.ts AND apps/mobile/src/lib/admin-permissions.ts (labels included), grantable from admin-users on both surfaces.
3a. **Analytics revenue attribution** — ✅ DONE (43ff51b): cash-basis sweep across all 7 earnings functions (pass sales on purchase date under their sport; pass-settled portions net out via PassRedemption.coveredAmount). Pre-migration dev-test redemptions have coveredAmount 0 — cosmetic only, prod starts clean.
3. **GA4 pass events** — ✅ DONE web (198e679) + mobile (3febbab): pass_purchase_started/completed (per method), pass_redeemed (covered/remainder/full_coverage), pass_member_added — one vocabulary across lib/analytics.ts and apps/mobile/src/lib/analytics.ts.
4. **Mobile app parity** — ✅ DONE (3febbab customer + 6c1891d admin): customer = My Passes wallet, PassDetail (members + WhatsApp invite + history), PassesStore (UPI-DQR default / Razorpay purchase w/ start-date chips), checkout "Use my pass" redemption (full + top-up); admin = AdminPassesScreen (plans band-wizard, sold ops incl. issue/gift/extend/±hours/cancel/members, sharing caps) under More → Promotions. Key plumbing: pass purchase + redeem routes now use unified auth (web cookie or mobile bearer); actions/admin-passes.ts takes AdminPassCtx {skipAuth, adminId} from the mobile routes.
5. **Account restructure** — ✅ DONE (db8a34f web, ef17f94 mobile): hub-tile reorg in the user's priority order, /my-passes page, How-rewards-work + Recurring links removed, Cafe Orders added.

Note: all of this is JS/route-level — mobile changes ship via OTA (no native fingerprint change expected from these commits).

**Why:** the user explicitly asked to be reminded of these when they request the main promotion.
**How to apply:** on "push to main", show the table (all ✅), get the user's confirm, then promote development→main per the runbook. Never promote unprompted ([[feedback_no_auto_main]]).

Related: [[feedback_no_auto_main]], [[deployment_runbook]]
