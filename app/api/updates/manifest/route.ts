import { db } from "@/lib/db";
import {
  buildManifest,
  buildMultipartResponse,
  deterministicBucket,
  isInRollout,
  noUpdateAvailableDirective,
  parseRolloutBucket,
  rollBackToEmbeddedDirective,
} from "@/lib/ota/manifest";

// Self-hosted Expo Updates manifest endpoint (protocol v1). The native client
// hits this on launch; we return the newest PUBLISHED release this install is
// bucketed into for its (channel, platform, runtimeVersion), code-signed.
// Uses Node crypto + Buffer, so it must run on the Node runtime.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function noUpdate(protocolVersion: number): Response {
  if (protocolVersion < 1) {
    // Pre-directive clients: an empty 200 multipart means "nothing new".
    return buildMultipartResponse([]);
  }
  return buildMultipartResponse([
    { name: "directive", body: noUpdateAvailableDirective(), sign: true },
  ]);
}

export async function GET(req: Request) {
  const h = req.headers;
  const url = new URL(req.url);
  const protocolVersion = Number.parseInt(h.get("expo-protocol-version") ?? "0", 10);
  const platform = h.get("expo-platform") ?? url.searchParams.get("platform");
  const runtimeVersion =
    h.get("expo-runtime-version") ?? url.searchParams.get("runtime-version");
  const channel = h.get("expo-channel-name") ?? "production";
  const currentUpdateId = h.get("expo-current-update-id");
  const embeddedUpdateId = h.get("expo-embedded-update-id");

  if (platform !== "ios" && platform !== "android") {
    return new Response("Invalid or missing expo-platform", { status: 400 });
  }
  if (!runtimeVersion) {
    return new Response("Missing expo-runtime-version", { status: 400 });
  }

  // Sticky per-install bucket for staged rollout; fall back to a deterministic
  // hash of a stable id so a given install never flips out of a rollout.
  const bucket =
    parseRolloutBucket(h.get("expo-extra-params")) ??
    deterministicBucket(currentUpdateId ?? embeddedUpdateId ?? "anon");

  const candidates = await db.otaRelease.findMany({
    where: { channel, platform, runtimeVersion, status: "PUBLISHED" },
    orderBy: { createdAt: "desc" },
    include: { assets: true },
    take: 20,
  });

  // Newest release this install is rolled into; else newest fully-rolled-out.
  const active =
    candidates.find((r) => isInRollout(bucket, r.rolloutPercent)) ??
    candidates.find((r) => r.rolloutPercent >= 100);

  if (!active) return noUpdate(protocolVersion);

  // Rollback: tell the client to revert to the embedded (store) bundle.
  if (active.kind === "ROLLBACK") {
    if (protocolVersion < 1) {
      return new Response("Rollback requires protocol version 1", { status: 400 });
    }
    if (currentUpdateId && embeddedUpdateId && currentUpdateId === embeddedUpdateId) {
      return noUpdate(protocolVersion); // already on the embedded bundle
    }
    const commitTime = (active.commitTime ?? active.createdAt).toISOString();
    return buildMultipartResponse([
      { name: "directive", body: rollBackToEmbeddedDirective(commitTime), sign: true },
    ]);
  }

  // Already running this update.
  if (currentUpdateId && currentUpdateId === active.id) {
    return noUpdate(protocolVersion);
  }

  const manifest = JSON.stringify(buildManifest(active));
  return buildMultipartResponse([{ name: "manifest", body: manifest, sign: true }]);
}
