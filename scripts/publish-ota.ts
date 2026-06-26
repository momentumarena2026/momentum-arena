/**
 * Publish a new OTA release (self-hosted Expo Updates).
 *
 *   tsx scripts/publish-ota.ts \
 *     --channel development --platform ios --runtime 1.0.0 \
 *     --changelog "Fix booking summary" [--rollout 0] [--publish] [--no-export]
 *
 * Runs `expo export`, uploads the JS bundle + assets to Vercel Blob
 * (content-addressed, public), then creates an OtaRelease. By default it is a
 * DRAFT that an admin flips live from /admin/ota. With --publish it is created
 * live (PUBLISHED) at --rollout % — used by CI to auto-canary production; an
 * admin promotes it to 100% from /admin/ota. --publish mirrors the admin
 * rollout invariant (at most one PUBLISHED release per channel/platform/runtime
 * slot) by archiving the prior live release in the same slot.
 * Requires env: DATABASE_URL, BLOB_READ_WRITE_TOKEN.
 */
import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { put } from "@vercel/blob";
import { PrismaClient } from "@prisma/client";
import { assetHash, assetKey } from "../lib/ota/signing";

const MOBILE_DIR = path.resolve(__dirname, "../apps/mobile");
const DIST_DIR = path.join(MOBILE_DIR, "dist");

const CONTENT_TYPES: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", svg: "image/svg+xml", ttf: "font/ttf", otf: "font/otf",
  woff: "font/woff", woff2: "font/woff2", json: "application/json", mp4: "video/mp4",
};
const contentTypeFor = (ext: string) =>
  CONTENT_TYPES[ext.toLowerCase().replace(/^\./, "")] ?? "application/octet-stream";

function arg(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required --${name}`);
}
const hasFlag = (name: string) => process.argv.includes(`--${name}`);

async function uploadFile(
  releaseId: string, runtime: string, channel: string, filePath: string,
): Promise<{ key: string; hash: string; url: string }> {
  const bytes = readFileSync(filePath);
  const hash = assetHash(bytes);
  const key = assetKey(bytes);
  // Content-addressed, immutable path. addRandomSuffix:false keeps it stable.
  const blobPath = `ota/${channel}/${runtime}/${releaseId}/${key}${path.extname(filePath)}`;
  const ext = path.extname(filePath).slice(1);
  const res = await put(blobPath, bytes, {
    access: "public",
    addRandomSuffix: false,
    contentType: ext === "hbc" || ext === "bundle" || ext === "js"
      ? "application/javascript"
      : contentTypeFor(ext),
  });
  return { key, hash, url: res.url };
}

async function main() {
  const channel = arg("channel");
  const platform = arg("platform"); // ios | android
  const runtime = arg("runtime");
  const changelog = arg("changelog", "");
  const rollout = Number.parseInt(arg("rollout", "0"), 10);
  if (platform !== "ios" && platform !== "android") throw new Error("platform must be ios|android");
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error("BLOB_READ_WRITE_TOKEN is not set");

  if (!hasFlag("no-export")) {
    console.log(`▶ expo export (${platform})…`);
    execSync(`npx expo export --platform ${platform} --output-dir dist`, {
      cwd: MOBILE_DIR, stdio: "inherit",
    });
  }
  const metadataPath = path.join(DIST_DIR, "metadata.json");
  if (!existsSync(metadataPath)) throw new Error(`No metadata.json at ${metadataPath} — run export first`);
  const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
  const fm = metadata.fileMetadata?.[platform];
  if (!fm?.bundle) throw new Error(`metadata.json has no fileMetadata.${platform}.bundle`);

  const releaseId = randomUUID();
  console.log(`▶ release ${releaseId} — uploading bundle + ${fm.assets?.length ?? 0} assets to Blob…`);

  const launch = await uploadFile(releaseId, runtime, channel, path.join(DIST_DIR, fm.bundle));
  const assets: {
    key: string; hash: string; url: string; contentType: string; fileExtension: string;
  }[] = [];
  for (const a of fm.assets ?? []) {
    const up = await uploadFile(releaseId, runtime, channel, path.join(DIST_DIR, a.path));
    assets.push({ ...up, contentType: contentTypeFor(a.ext), fileExtension: `.${a.ext}` });
  }

  // manifest.extra.expoClient — read expoConfig.json if the export produced one.
  const expoConfigPath = path.join(DIST_DIR, "expoConfig.json");
  const extra = existsSync(expoConfigPath)
    ? { expoClient: JSON.parse(readFileSync(expoConfigPath, "utf8")) }
    : {};

  const db = new PrismaClient();
  // OTA build number for this (channel, platform, runtimeVersion) slot.
  const last = await db.otaRelease.findFirst({
    where: { channel, platform, runtimeVersion: runtime },
    orderBy: { sequence: "desc" },
    select: { sequence: true },
  });
  const sequence = (last?.sequence ?? 0) + 1;
  const publishNow = hasFlag("publish");
  const percent = Math.min(100, Math.max(0, rollout));

  const release = await db.$transaction(
    async (tx) => {
      // --publish creates the release live. Mirror the admin rollout invariant:
      // at most one PUBLISHED release per (channel, platform, runtimeVersion)
      // slot, so archive the prior live one. Installs outside this canary keep
      // running their currently-installed bundle until an admin promotes it.
      if (publishNow) {
        await tx.otaRelease.updateMany({
          where: { channel, platform, runtimeVersion: runtime, status: "PUBLISHED" },
          data: { status: "ARCHIVED" },
        });
      }
      return tx.otaRelease.create({
        data: {
          id: releaseId,
          channel, platform, runtimeVersion: runtime,
          status: publishNow ? "PUBLISHED" : "DRAFT",
          sequence,
          rolloutPercent: percent,
          activatedAt: publishNow ? new Date() : null,
          launchAssetKey: launch.key,
          launchAssetHash: launch.hash,
          launchAssetUrl: launch.url,
          launchAssetContentType: "application/javascript",
          metadata: {},
          extra,
          changelog: changelog || null,
          assets: {
            create: assets.map((a) => ({
              key: a.key, hash: a.hash, url: a.url,
              contentType: a.contentType, fileExtension: a.fileExtension,
            })),
          },
        },
      });
    },
    { timeout: 30000 },
  );
  await db.$disconnect();

  if (publishNow) {
    console.log(`\n✓ PUBLISHED canary release: ${release.id} @ ${percent}%`);
    console.log(`  channel=${channel} platform=${platform} runtime=${runtime} assets=${assets.length}`);
    console.log(`  → promote to 100% from /admin/ota once healthy`);
  } else {
    console.log(`\n✓ DRAFT release created: ${release.id}`);
    console.log(`  channel=${channel} platform=${platform} runtime=${runtime} assets=${assets.length}`);
    console.log(`  → roll it out from /admin/ota`);
  }
}

main().catch((e) => {
  console.error("✗ publish failed:", e);
  process.exit(1);
});
