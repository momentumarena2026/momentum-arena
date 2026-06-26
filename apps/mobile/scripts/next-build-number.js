#!/usr/bin/env node
// Monotonic native build number = unix epoch MINUTES.
//
// Always strictly increasing (wall clock), needs no shared counter or commit
// lineage, and stays under Android's versionCode cap of 2,100,000,000 for
// ~3,900 years (it's ~29.7M today). Injected at archive time, never committed:
//   iOS:     xcodebuild ... CURRENT_PROJECT_VERSION=$(node scripts/next-build-number.js)
//   Android: ./gradlew ... -PversionCode=$(node scripts/next-build-number.js)
process.stdout.write(String(Math.floor(Date.now() / 60000)));
