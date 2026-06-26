#!/usr/bin/env node
// Single source of truth for the marketing (app) version = apps/mobile/version.json.
// Kept OUT of app.json on purpose: app.json is part of the @expo/fingerprint
// native-change gate, so a version bump there would churn the OTA baseline. The
// bare native build reads this value via fastlane args (MARKETING_VERSION), not
// app.json, so a standalone file is both correct and fingerprint-neutral.
//
//   node scripts/version.js none              -> print current, no change
//   node scripts/version.js patch|minor|major -> bump that part, write, print
//   node scripts/version.js 1.2.3             -> set exactly, write, print
//
// Always prints the resulting version to stdout. CI: the native build resolves
// the version with a `bump` choice and feeds it to fastlane; post-native-release
// then sets + commits the same value so it persists for the next build.
const fs = require("fs");
const path = require("path");

const VERSION_FILE = path.resolve(__dirname, "../version.json");
const arg = (process.argv[2] || "none").trim();

const json = JSON.parse(fs.readFileSync(VERSION_FILE, "utf8"));
const cur = json.version || "1.0.0";

function write(v) {
  json.version = v;
  fs.writeFileSync(VERSION_FILE, JSON.stringify(json, null, 2) + "\n");
}

let next = cur;
if (/^\d+\.\d+\.\d+$/.test(arg)) {
  // Explicit set (used by post-native-release to persist the built version).
  next = arg;
  if (next !== cur) write(next);
} else {
  let [maj, min, pat] = cur.split(".").map((n) => parseInt(n, 10) || 0);
  switch (arg) {
    case "major":
      maj += 1;
      min = 0;
      pat = 0;
      break;
    case "minor":
      min += 1;
      pat = 0;
      break;
    case "patch":
      pat += 1;
      break;
    case "none":
      break;
    default:
      console.error(
        `version.js: unknown arg '${arg}' (use none|patch|minor|major|x.y.z)`,
      );
      process.exit(1);
  }
  next = `${maj}.${min}.${pat}`;
  if (arg !== "none" && next !== cur) write(next);
}

process.stdout.write(next);
