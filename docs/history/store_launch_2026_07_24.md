---
name: store-launch-2026-07-24
description: "v1.0.0 submitted to BOTH stores 2026-07-24 (App Store + Google Play, in review); how the CI build/submit works, the store content, and the 16KB follow-up"
metadata: 
  node_type: memory
  type: project
  originSessionId: 5ab2a2c4-5e6a-4f62-9239-19e35bd79d9b
  modified: 2026-07-24T10:24:10.376Z
---

**Momentum Arena v1.0.0 submitted to BOTH app stores 2026-07-24, in review.** First public release. iOS App Store + Google Play (package/bundle `com.momentumarena`, Apple ID 6783955158, team Sportive Ventures WHF7M743MW). Web + backend already live on prod (main).

**Release mechanics (all in GitHub Actions, manual `workflow_dispatch`):**
- iOS: `native-ios.yml` → track `appstore` (→ `release` fastlane lane: `configure_ota production` → archive → `upload_to_app_store` binary-only). Trigger from CLI: `gh workflow run native-ios.yml --repo momentumarena2026/momentum-arena --ref main -f track=appstore -f bump=none`.
- Android: `native-android.yml` → track `production` (→ builds signed AAB, `upload_to_play_store track:production release_status:draft`). Same CLI with `native-android.yml -f track=production`.
- **Guard: production tracks (appstore/production) ONLY run from `main`** (added this session; TestFlight/internal run anywhere). All 13 required GitHub secrets are set.
- `configure-ota-target.js production` (run inside the lanes) points OTA at `www.momentumarena.com` + channel `production`. Server-side `EXPO_OTA_PRIVATE_KEY` signs the manifest (Vercel env, not a GH secret).

**Store submission choices:** iOS release = **Manual** (press Release after approval). Play = **managed publishing OFF** → auto-publishes to India on approval, full rollout. Age rating 4+/Everyone. Category Sports. Reviewer demo login **phone <APPSTORE_TEST_PHONE> / OTP <APPSTORE_TEST_OTP>** (the `APPSTORE_TEST_PHONE`/`APPSTORE_TEST_OTP` env bypass — MUST stay live on prod during review). Screenshots: App Store slot wanted **6.5" = 1284×2778** (not 6.9"); Play phone 1350×2670. Store content (listings, privacy label / data-safety answers, review notes) is in this session's transcript.

**Shipped for the submission:** public `app/delete-account/page.tsx` → `https://www.momentumarena.com/delete-account` (Play Data-safety requires a no-login deletion-instructions URL; account deletion itself is in-app only).

**16 KB page-size — FIX APPLIED on main (`d6116c8`), ships the NEXT Android build; MUST VERIFY then.** Play flagged v1.0.0 "app does not support 16 KB memory page sizes" (bypassed with "Proceed anyway" — no launch impact). RN 0.85.2 + NDK r27 already compile our `.so` libs 16KB-aligned, so the gap was packaging: added `packaging { jniLibs { useLegacyPackaging = false } }` to `apps/mobile/android/app/build.gradle` (stores native libs uncompressed → bundler page-aligns to 16KB in the AAB). **Verify at the next production build that the warning is gone.** If a specific third-party `.so` is still flagged, that dependency ships a pre-linked unaligned library — no packaging flag fixes that; upgrade the dep (extract the AAB, `llvm-readelf -l` each .so, LOAD segment Align must be ≥ 0x4000).

Related: [[testflight_appstore]], [[ota_self_hosted]], [[deployment_runbook]], [[rewards_and_authz_hardening]]
