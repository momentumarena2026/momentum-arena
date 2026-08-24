---
name: testflight-appstore
description: "iOS TestFlight/App Store Connect setup — app record, API key, the 3 binary gotchas, tester groups, reviewer OTP bypass"
metadata: 
  node_type: memory
  type: project
  originSessionId: 5ab2a2c4-5e6a-4f62-9239-19e35bd79d9b
  modified: 2026-07-30T19:52:17.785Z
---

The Momentum Arena iOS app (bundle **com.momentumarena**, team **Sportive Ventures WHF7M743MW**) is **live on TestFlight** as of 2026-06-25. App Store Connect **Apple ID 6783955158**, name "Momentum Arena". The live build is **1.0.0 (build 3)** — builds 1 & 2 were rejected during Apple's silent post-upload processing.

**Build/upload pipeline (CLI, no Xcode GUI):** archive from the latest `development` code in a worktree → `xcodebuild archive -allowProvisioningUpdates DEVELOPMENT_TEAM=WHF7M743MW CODE_SIGN_STYLE=Automatic MARKETING_VERSION=1.0.0 CURRENT_PROJECT_VERSION=<n> TARGETED_DEVICE_FAMILY=1` → `xcodebuild -exportArchive` (ExportOptions.plist method=app-store-connect) → `xcrun altool --upload-app --apiKey XLBK5M2393 --apiIssuer cead394e-4785-4b48-b1cb-e431f9f62b1b`. **App Store Connect API key** `.p8` lives at `~/.appstoreconnect/private_keys/AuthKey_XLBK5M2393.p8` (App Manager). A reusable ASC API helper is at `/tmp/asc.js` (build state, groups, testers, external review submit).

**THE 3 BINARY GOTCHAS (each caused a silent "uploaded-then-vanished, build never appears" rejection; the email arrives ~15 min later):**
1. **iPad icons** (ITMS-90023) → shipped **iPhone-only** (`TARGETED_DEVICE_FAMILY=1`, baked the device family into the archive, not the project).
2. **Missing top-level `CFBundleIconName`=`AppIcon`** in Info.plist — RN's actool emits only the nested `CFBundleIcons`; the top-level key must be added by hand. THIS is the usual RN-app cause.
3. **ITMS-90683 missing `NSPhotoLibraryUsageDescription`** — a transitive SDK references the photo library; a purpose string is required even if unused. (All three fixes committed on `development` in Info.plist; also added `ITSAppUsesNonExemptEncryption=NO` to skip the export-compliance prompt; **requires a registered device** in the portal for `-allowProvisioningUpdates` to mint the dev profile — registered Nakul's iPhone UDID `00008140-001159123E0B001C`.)

**Tester groups (created via API):** Internal "Internal Testers" (`y12.nakul@gmail.com`, no review) + External "External Testers" (`tangrianand@gmail.com`, `saxenautkarsh193@gmail.com`, needs Beta App Review). External review contact: Nakul Varshney / +919870437753 / y12.nakul@gmail.com.

**Gotcha #4 — CI uploads never reached testers (found 2026-07-31):** the fastlane `beta` lane used `skip_waiting_for_build_processing: true` and assigned no groups, so every CI dev build sat "Ready to Submit" with zero testers while `post_release` had already bumped AppVersionGate.latestBuild → dev app showed an un-actionable "Update available" prompt. Fixed in `apps/mobile/fastlane/Fastfile` (dev `ce43406`): the lane now waits for processing + assigns `["Internal Testers","External Testers"]` + submits beta review before post_release. Stuck build 29757021 was recovered by hand via ASC API (add to `betaGroups/{id}/relationships/builds`, then POST `betaAppReviewSubmissions`); group IDs: internal `dc43dabe-c55d-4917-9f4d-f82fcd905d78`, external `85d5f950-c73f-4db7-bbc7-5e0d18422781`. A JWT-based helper pattern lives in that session's scratchpad (`asc.mjs`, ES256 with `dsaEncoding: "ieee-p1363"`).

**Reviewer OTP bypass** (so Apple's reviewer can pass phone-OTP login): `lib/otp.ts` has an env-gated bypass — if `APPSTORE_TEST_PHONE` (=`<APPSTORE_TEST_PHONE>`) + `APPSTORE_TEST_OTP` (=`<APPSTORE_TEST_OTP>`) are set, that phone skips MSG91 and accepts the fixed OTP in any runtime (it short-circuits BEFORE the lockout/rate-limit checks). **RESOLVED + LIVE** on `development.momentumarena.com` (env was set to "All Environments" which includes Preview; earlier failures were just stale-deploy timing — it works after the deploy propagates). **External Beta App Review SUBMITTED 2026-06-25** (betaReviewState=WAITING_FOR_REVIEW) for build 1.0.0(3) with demo login <APPSTORE_TEST_PHONE>/<APPSTORE_TEST_OTP> — Apple processing (hours), then `tangrianand@`+`saxenautkarsh193@` get invites. A temporary diagnostic route `app/api/debug/env-check` (gated by `?k=otadbg-7c3f9a`, booleans only) was added to confirm env presence — REMOVE it. Related: [[dqr-phonepe-integration]], [[ota-self-hosted]].
