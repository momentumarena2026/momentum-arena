const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

// Stamp the current git branch into src/config/build-config.generated.ts
// before any source is bundled. metro.config.js is loaded by every
// bundle invocation (`npm start`, Xcode's "Bundle React Native code
// and images" phase, Gradle's `bundleReleaseJsAndAssets` task), so
// doing it here covers debug runs and release IPAs/APKs alike — no
// Xcode or Gradle changes needed.
require('./scripts/write-build-config');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
