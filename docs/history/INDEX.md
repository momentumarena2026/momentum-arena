# Memory Index

- [feedback_no_auto_main.md](feedback_no_auto_main.md) — ⚠️ Never promote to main unless explicitly asked; default = development only
- [feedback_no_manual_ota_dispatch.md](feedback_no_manual_ota_dispatch.md) — ⚠️ Never dispatch OTA by hand; the push trigger fires ~30 min late on its own

- [project_booking_system.md](project_booking_system.md) — Full Momentum Arena architecture: web + mobile (customer + admin), payments, FCM push, hidden admin entry
- [session_handoff_2026_05_03.md](session_handoff_2026_05_03.md) — In-flight fix: 5-tap admin easter egg falsely triggers from fast drag on Account screen
- [dqr_phonepe_integration.md](dqr_phonepe_integration.md) — PhonePe DQR checkout: gating, env/UAT-500 gotchas, and the Paytm-intent stuck-payment incident (intent replication pending → keep intent toggle OFF)
- [testflight_appstore.md](testflight_appstore.md) — iOS TestFlight live (build 1.0.0(3)): ASC API-key upload pipeline, the 4 pipeline gotchas (3 binary + CI-never-assigned-testers), tester groups, reviewer OTP bypass
- [ota_self_hosted.md](ota_self_hosted.md) — Self-hosted Expo Updates OTA (SDK 56) + admin rollout dashboard: architecture, what's built in _tf, what's left, env/secrets needed
- [session_handoff_2026_06_27.md](session_handoff_2026_06_27.md) — In-flight: push notifications — iOS delivery proven (build 29708669), foreground banner shipping via OTA DRAFT; resume = roll out DRAFT + test + promote aps-fix/banner to main
- [admin_mobile_parity.md](admin_mobile_parity.md) — Full-parity mobile admin project (rebuild all web admin in app): nav reorg + Phase 0 shipped, per-phase plan #59–67, the route+client+screen build pattern
- [mobile_admin_authz_audit.md](mobile_admin_authz_audit.md) — 2026-06-28 multi-agent security audit: closed admin-route authZ class-bug + google-login aud + open decisions
- [payment_orphan_leak_fix.md](payment_orphan_leak_fix.md) — Captured-but-no-booking money leak (hold swept before late payment): root cause + 3-layer schema-free fix (main c75f0e9)
- [app_coupons_first_app_booking.md](app_coupons_first_app_booking.md) — Platform-restricted coupons + FIRST_APP_BOOKING condition (both coupon systems): on development b236b43, needs prisma db push before main
- [deployment_runbook.md](deployment_runbook.md) — How the app deploys (Vercel, db push via seed workflows, the [skip ci] rule, dev→main promotion, coupon seeds, mobile OTA/native); full doc in repo docs/DEPLOYMENT.md
- [msg91_email_domain.md](msg91_email_domain.md) — Email sends from mail.momentumarena.com subdomain (MSG91 hard-requires MX; apex MX = org email, untouchable); EMAIL_DOMAIN env + DNS layout
- [ga4_mobile_analytics.md](ga4_mobile_analytics.md) — GA4 in the apps (Firebase Analytics): main-only gate, OTA-safe lazy guard, activation blocked on refreshed config files + new native builds
- [passes_premain_checklist.md](passes_premain_checklist.md) — RESOLVED: passes + promo-banners + coupons promoted to main 2026-07-17 (merge f49f49c); gate record kept
- [pass_coverage_and_dqr_recovery.md](pass_coverage_and_dqr_recovery.md) — coveredSlots model (never re-derive it) + DQR stuck-payment net; main ad7a67d; prod intent toggle STILL ON
- [go_live_audit_2026_07_19.md](go_live_audit_2026_07_19.md) — Pre-release audit on development 9ca11a4: 29 defects fixed, 5 staging transactions still required, why the fix loop stopped
- [rewards_and_authz_hardening.md](rewards_and_authz_hardening.md) — Rewards engine harness-verified 47/47 + whole-surface auth-bypass class closed; dev b512b4a/d84dcd5, not main
- [store_launch_2026_07_24.md](store_launch_2026_07_24.md) — v1.0.0 submitted to BOTH stores (in review); CI build/submit mechanics, store content, demo login, 16KB follow-up owed
- [nda_generator_2026_07_26.md](nda_generator_2026_07_26.md) — Admin HR/Legal: Employee dashboard (encrypted Aadhaar, monthly salary) + NDA & Offer-Letter generators (select-employee, letterhead PDFs, sign-over-stamp, non-public assets); NDA v1 on main, full expansion on development 6b27207
- [tournament_security_audit_2026_07_28.md](tournament_security_audit_2026_07_28.md) — 12 tournament vulns found AND fixed (dev 2e97d2a); carries the reusable DQR-pointer + scorer-credential + status⇒money rules
- [tournament_match_centre.md](tournament_match_centre.md) — ESPN-style match centre: scorecard/commentary derived from the event log, scorer player tagging, pinned live card (web + app)
- [tournament_engine_2026_07.md](tournament_engine_2026_07.md) — Full tournament engine P1–P8 on development ONLY: wizard, reg (Razorpay+DQR+points+venue), pools/fixtures/slot-blocks, points/bracket, LIVE scoring, campaign autopilot, app parity; all gaps closed; full-lifecycle E2E browser-verified 2026-07-28 (test residue `claude-test-cup` on staging DB)
- [passes_ui_info_bar_2026_07_31.md](passes_ui_info_bar_2026_07_31.md) — Passes sport-filter + day/night hour chips & admin Information Bar: dev 41d5404/02ab7ec, not main; the wedged-browser-tab debugging trap
- [book_via_checkout_redesign.md](book_via_checkout_redesign.md) — Book-via checkout + MULTI-PASS engine (PassRedemption per (booking,pass), n-pass stacking, ₹0 covered rows, admin payWithPass + edit-payment convert, cash-basis analytics) — ON MAIN (3c27c09+b1dfb4c, prod db pushed 2026-07-31); dev OTA iOS #158 / Android #139 (2026-08-01: purchase→pass-detail nav + loader handoff + 25%-pill retired)
- [session_handoff_2026_08_05.md](session_handoff_2026_08_05.md) — 21-item list DONE + all 5 follow-ups closed; #5/#8/#10 + camps toggle + OTA ladder on development only; prod-DB-via-Actions pattern
