#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Generate the iOS AppIcon set and Android launcher mipmaps from a
 * single source PNG. Re-run this whenever the brand icon changes.
 *
 *   node scripts/generate-app-icons.js
 *
 * Source: src/assets/momentum-icon.png (already copied from
 * /public/icon.png).
 *
 * Output:
 *   ios/MomentumArena/Images.xcassets/AppIcon.appiconset/*.png
 *   ios/MomentumArena/Images.xcassets/AppIcon.appiconset/Contents.json
 *   android/app/src/main/res/mipmap-{mdpi,hdpi,xhdpi,xxhdpi,xxxhdpi}/ic_launcher{,_round}.png
 *
 * iOS rejects icons with an alpha channel, so all PNGs are flattened
 * onto a solid black background (matches the dark app theme — the icon
 * blends into the splash if the user looks at the home screen during
 * launch). Android's legacy launcher bitmaps are also flattened for
 * older OS versions; modern devices use the adaptive system anyway.
 *
 * Uses `sharp` from the web workspace (../../node_modules/sharp). No
 * separate install needed inside apps/mobile.
 */

const fs = require("fs");
const path = require("path");
const sharp = require(path.resolve(
  __dirname,
  "../../../node_modules/sharp",
));

const MOBILE_ROOT = path.resolve(__dirname, "..");
const SOURCE = path.join(MOBILE_ROOT, "src/assets/momentum-icon.png");
const BACKGROUND = { r: 0, g: 0, b: 0, alpha: 1 }; // pure black

// ─── iOS ─────────────────────────────────────────────────────────
// Each entry mirrors a slot in AppIcon.appiconset/Contents.json. We
// emit a single file per (size, scale) combo and reference it by
// `filename`.
const IOS_DIR = path.join(
  MOBILE_ROOT,
  "ios/MomentumArena/Images.xcassets/AppIcon.appiconset",
);
const IOS_ICONS = [
  { size: 20, scale: 2, idiom: "iphone" },
  { size: 20, scale: 3, idiom: "iphone" },
  { size: 29, scale: 2, idiom: "iphone" },
  { size: 29, scale: 3, idiom: "iphone" },
  { size: 40, scale: 2, idiom: "iphone" },
  { size: 40, scale: 3, idiom: "iphone" },
  { size: 60, scale: 2, idiom: "iphone" },
  { size: 60, scale: 3, idiom: "iphone" },
  { size: 1024, scale: 1, idiom: "ios-marketing" },
];

// ─── Android ─────────────────────────────────────────────────────
const ANDROID_RES = path.join(MOBILE_ROOT, "android/app/src/main/res");
const ANDROID_ICONS = [
  { density: "mdpi", px: 48 },
  { density: "hdpi", px: 72 },
  { density: "xhdpi", px: 96 },
  { density: "xxhdpi", px: 144 },
  { density: "xxxhdpi", px: 192 },
];

function flatten(srcBuffer, sizePx) {
  // Resize to sizePx × sizePx, preserve aspect, fit inside, then
  // flatten onto BACKGROUND so the output has no alpha channel
  // (App Store requirement for iOS, cleaner for Android too).
  return sharp(srcBuffer)
    .resize(sizePx, sizePx, {
      fit: "contain",
      background: BACKGROUND,
    })
    .flatten({ background: BACKGROUND })
    .png()
    .toBuffer();
}

async function emitIos(srcBuffer) {
  const images = [];
  for (const icon of IOS_ICONS) {
    const px = icon.size * icon.scale;
    const filename = `Icon-${icon.size}x${icon.size}@${icon.scale}x.png`;
    const out = path.join(IOS_DIR, filename);
    const buf = await flatten(srcBuffer, px);
    fs.writeFileSync(out, buf);
    images.push({
      idiom: icon.idiom,
      scale: `${icon.scale}x`,
      size: `${icon.size}x${icon.size}`,
      filename,
    });
    console.log(`[ios] ${filename} (${px}px)`);
  }

  const contents = {
    images,
    info: { author: "xcode", version: 1 },
  };
  fs.writeFileSync(
    path.join(IOS_DIR, "Contents.json"),
    JSON.stringify(contents, null, 2) + "\n",
  );
  console.log(`[ios] Contents.json updated`);
}

async function emitAndroid(srcBuffer) {
  for (const { density, px } of ANDROID_ICONS) {
    const dir = path.join(ANDROID_RES, `mipmap-${density}`);
    const buf = await flatten(srcBuffer, px);
    // Same bitmap drives both square and round launcher slots — the
    // brand icon already reads well as a circle, no need for a
    // separately masked round variant.
    fs.writeFileSync(path.join(dir, "ic_launcher.png"), buf);
    fs.writeFileSync(path.join(dir, "ic_launcher_round.png"), buf);
    console.log(`[android] mipmap-${density}/ic_launcher.png (${px}px)`);
  }
}

async function main() {
  if (!fs.existsSync(SOURCE)) {
    console.error(`source not found: ${SOURCE}`);
    process.exit(1);
  }
  const srcBuffer = fs.readFileSync(SOURCE);
  await emitIos(srcBuffer);
  await emitAndroid(srcBuffer);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
