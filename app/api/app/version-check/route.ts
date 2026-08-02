import { NextResponse } from "next/server";
import { db } from "@/lib/db";

// Public update-check the app calls on launch + foreground. Tells it whether a
// NATIVE store update is available and whether it's FORCED (installed build <
// minSupportedBuild → blocking "Update Required" screen), plus the latest OTA
// sequence for display. The actual OTA download is handled by expo-updates;
// this endpoint is the source of truth for the native version gate.
//
//   GET /api/app/version-check?platform=ios&channel=production&build=312&runtimeVersion=1.0.0&ota=7
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const platform = url.searchParams.get("platform");
  const channel = url.searchParams.get("channel") || "production";
  const build = Number.parseInt(url.searchParams.get("build") || "0", 10) || 0;
  const runtimeVersion = url.searchParams.get("runtimeVersion") || undefined;
  const currentOta = Number.parseInt(url.searchParams.get("ota") || "0", 10) || 0;

  if (platform !== "ios" && platform !== "android") {
    return NextResponse.json({ error: "platform must be ios or android" }, { status: 400 });
  }

  const gate = await db.appVersionGate.findUnique({
    where: { platform_channel: { platform, channel } },
  });

  const native = gate
    ? {
        currentBuild: build,
        latestBuild: gate.latestBuild,
        latestVersionName: gate.latestVersionName,
        minSupportedBuild: gate.minSupportedBuild,
        // A build that's uploaded but still in review (or a Play draft) is NOT
        // downloadable — prompting for it sends the customer to a store page
        // with no Update button. latestIsLive is flipped by
        // scripts/check-store-availability.ts (hourly) or from /admin/ota.
        updateAvailable: gate.latestIsLive && build < gate.latestBuild,
        // Only force when we actually know the build AND it's below the floor.
        forced: build > 0 && build < gate.minSupportedBuild,
        storeUrl: gate.storeUrl,
        message: gate.message,
      }
    : {
        currentBuild: build,
        latestBuild: build,
        latestVersionName: null,
        minSupportedBuild: 0,
        updateAvailable: false,
        forced: false,
        storeUrl: null,
        message: null,
      };

  // Informational OTA status (expo-updates does the real fetch/apply).
  let ota = { latestSequence: 0, available: false };
  if (runtimeVersion) {
    const latest = await db.otaRelease.findFirst({
      where: { platform, channel, runtimeVersion, status: "PUBLISHED", kind: "UPDATE" },
      orderBy: { sequence: "desc" },
      select: { sequence: true },
    });
    if (latest) {
      ota = { latestSequence: latest.sequence, available: latest.sequence > currentOta };
    }
  }

  return NextResponse.json(
    { native, ota },
    // Never cache: a force-update / gate change must take effect on the very next
    // check. Caching here made the CDN + the device's HTTP layer keep replaying a
    // stale "not forced" answer for minutes after the admin flipped the gate.
    {
      headers: {
        "cache-control": "no-store, no-cache, must-revalidate, max-age=0",
      },
    },
  );
}
