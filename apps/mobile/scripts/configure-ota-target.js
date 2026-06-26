#!/usr/bin/env node
// Point the OTA client at the right manifest host + channel for the build's
// branch, BEFORE archiving:
//   development build → development.momentumarena.com, channel "development"
//   production build  → www.momentumarena.com,        channel "production"
//
// Run it ahead of the archive, e.g.:
//   node scripts/configure-ota-target.js production   # for a main / App Store build
//   node scripts/configure-ota-target.js development  # default (TestFlight / dev)
//
// Edits app.json + ios/Expo.plist + android AndroidManifest.xml + strings.xml
// in place. Idempotent.
const fs = require("fs");
const path = require("path");

const TARGETS = {
  development: {
    url: "https://development.momentumarena.com/api/updates/manifest",
    channel: "development",
  },
  production: {
    url: "https://www.momentumarena.com/api/updates/manifest",
    channel: "production",
  },
};

const target = process.argv[2];
const cfg = TARGETS[target];
if (!cfg) {
  console.error("usage: configure-ota-target.js <development|production>");
  process.exit(1);
}

const root = path.resolve(__dirname, "..");
const URL_RE = /https:\/\/(?:development|www)\.momentumarena\.com\/api\/updates\/manifest/g;

function edit(rel, fn) {
  const p = path.join(root, rel);
  fs.writeFileSync(p, fn(fs.readFileSync(p, "utf8")));
}

// app.json (JSON — set fields directly)
const appJsonPath = path.join(root, "app.json");
const appJson = JSON.parse(fs.readFileSync(appJsonPath, "utf8"));
appJson.expo.updates.url = cfg.url;
appJson.expo.updates.requestHeaders["expo-channel-name"] = cfg.channel;
fs.writeFileSync(appJsonPath, JSON.stringify(appJson, null, 2) + "\n");

// iOS Expo.plist — EXUpdatesURL + the channel header
edit("ios/Expo.plist", (s) =>
  s
    .replace(URL_RE, cfg.url)
    .replace(
      /(<key>expo-channel-name<\/key>\s*<string>)(?:development|production)(<\/string>)/,
      `$1${cfg.channel}$2`,
    ),
);

// Android AndroidManifest.xml — EXPO_UPDATE_URL meta-data value
edit("android/app/src/main/AndroidManifest.xml", (s) => s.replace(URL_RE, cfg.url));

// Android strings.xml — expo_updates_request_headers JSON
edit("android/app/src/main/res/values/strings.xml", (s) =>
  s.replace(
    /("expo-channel-name"\s*:\s*")(?:development|production)(")/,
    `$1${cfg.channel}$2`,
  ),
);

console.log(`OTA target → ${target}: ${cfg.url} (channel "${cfg.channel}")`);
