---
name: ga4-mobile-analytics
description: "GA4 on iOS/Android via @react-native-firebase/analytics — gating, OTA-safe lazy guard, needs NEW native builds + refreshed Firebase config files to go live"
metadata: 
  node_type: memory
  type: project
  originSessionId: 5ab2a2c4-5e6a-4f62-9239-19e35bd79d9b
---

Mobile Google Analytics (commit eeb79f3, development, 2026-07-05): `apps/mobile/src/lib/analytics.ts` `trackEvent` dual-writes like web — GA4 via `@react-native-firebase/analytics` (21.14.0) + first-party `/api/events`. Full funnel instrumentation across 15 screens mirrors web event names/args exactly (see [[project-booking-system]]).

Key mechanics:
- **GA gate**: `env.gitBranch === "main" && !__DEV__` — the mobile analogue of web's www-only gtag gate. `setAnalyticsCollectionEnabled` toggled to the same gate at init, so dev/staging builds send NOTHING to GA (incl. auto events). `page_view` → GA-native `logScreenView`.
- **OTA safety**: native module resolved lazily via `require()` in try/catch (`getGa()`), so the JS bundle OTA-ships to old binaries without crashing — GA silently off until the user installs a new native build. Do NOT convert to a top-level value import. runtimeVersion stayed "2".
- **iOS**: Podfile sets `$RNFirebaseAnalyticsWithoutAdIdSupport = true` (no IDFA → no ATT prompt; App Store privacy = "analytics only"). Pods installed with GLOBAL CocoaPods 1.16.2 (matches Podfile.lock) because `bundle exec` is broken (Ruby 4.0.3, no Gemfile.lock, fastlane gem missing).

**To activate (as of 2026-07-05):**
1. ~~Config files~~ DONE/NON-ISSUE: user linked Firebase project `momentum-arena-11975` to GA on 2026-07-05; freshly downloaded config files were byte-identical to repo copies. GA4 linking does NOT change GoogleService-Info.plist / google-services.json — `IS_ANALYTICS_ENABLED=false` is a legacy-GA flag with no effect; the SDK fetches measurement config dynamically via GOOGLE_APP_ID. Repo files are build-ready as-is.
2. New NATIVE builds required both platforms (iOS TestFlight pipeline per [[testflight-appstore]] + Android). Verify in GA Admin → Data streams that the iOS/Android streams landed in the SAME GA4 property as web stream G-JV1973H52L.
3. App Store privacy questionnaire: declare analytics data collection when submitting the new build.
4. Claude cannot read ~/Downloads even unsandboxed (macOS TCC) — have the user copy files into the workspace when needed.
