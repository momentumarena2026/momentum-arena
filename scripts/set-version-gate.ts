/**
 * Upsert an AppVersionGate row after a native build is uploaded to a store, so
 * the version-check API reports the new build as the latest available. It never
 * downgrades latestBuild and never raises minSupportedBuild — forcing an update
 * stays a deliberate admin action in /admin/ota.
 *
 *   tsx scripts/set-version-gate.ts --platform ios --channel development \
 *     --build 29708123 --versionName 1.0.0 \
 *     --storeUrl https://apps.apple.com/app/id6783955158
 *
 * Requires env: DATABASE_URL.
 */
import { PrismaClient } from "@prisma/client";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const platform = arg("platform");
  const channel = arg("channel");
  const build = Number(arg("build"));
  const versionName = arg("versionName")?.trim() || null;
  const storeUrl = arg("storeUrl")?.trim();

  if (platform !== "ios" && platform !== "android") {
    throw new Error("--platform must be ios|android");
  }
  if (channel !== "development" && channel !== "production") {
    throw new Error("--channel must be development|production");
  }
  if (!Number.isFinite(build) || build <= 0) {
    throw new Error("--build must be a positive integer");
  }
  if (!storeUrl) {
    throw new Error("--storeUrl is required");
  }

  const db = new PrismaClient();
  try {
    const existing = await db.appVersionGate.findUnique({
      where: { platform_channel: { platform, channel } },
    });
    if (existing && existing.latestBuild >= build) {
      console.log(
        `gate ${channel}/${platform}: existing latestBuild ${existing.latestBuild} >= ${build}, leaving as-is`,
      );
      return;
    }
    await db.appVersionGate.upsert({
      where: { platform_channel: { platform, channel } },
      update: { latestBuild: build, latestVersionName: versionName, storeUrl },
      create: {
        platform,
        channel,
        latestBuild: build,
        latestVersionName: versionName,
        storeUrl,
        minSupportedBuild: 0,
      },
    });
    console.log(
      `✓ gate ${channel}/${platform} -> latestBuild ${build} (${versionName ?? "-"}) ${storeUrl}`,
    );
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
