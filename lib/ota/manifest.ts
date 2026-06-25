import { randomBytes } from "crypto";
import type { OtaRelease, OtaReleaseAsset } from "@prisma/client";
import {
  buildSignatureHeader,
  createHash,
  isCodeSigningConfigured,
} from "@/lib/ota/signing";

// Assembles Expo Updates protocol responses (manifest + directives) as signed
// multipart/mixed bodies. Shapes follow the v1 protocol + Expo's reference
// server. See lib/ota/signing.ts for the crypto.

type ReleaseWithAssets = OtaRelease & { assets: OtaReleaseAsset[] };

interface ManifestAsset {
  key: string;
  contentType: string;
  url: string;
  hash: string;
  fileExtension: string;
}

export function buildManifest(release: ReleaseWithAssets) {
  return {
    id: release.id,
    createdAt: release.createdAt.toISOString(),
    runtimeVersion: release.runtimeVersion,
    launchAsset: {
      key: release.launchAssetKey,
      contentType: release.launchAssetContentType,
      url: release.launchAssetUrl,
      hash: release.launchAssetHash,
      fileExtension: ".bundle",
    } satisfies ManifestAsset,
    assets: release.assets.map(
      (a): ManifestAsset => ({
        key: a.key,
        contentType: a.contentType,
        url: a.url,
        hash: a.hash,
        fileExtension: a.fileExtension,
      }),
    ),
    metadata: (release.metadata as Record<string, unknown>) ?? {},
    extra: {
      ...((release.extra as Record<string, unknown>) ?? {}),
      // OTA build number — the app reads this from Updates.manifest.extra to
      // display "OTA N" in the version string.
      otaBuildNumber: release.sequence,
    },
  };
}

export function noUpdateAvailableDirective(): string {
  return JSON.stringify({ type: "noUpdateAvailable" });
}

export function rollBackToEmbeddedDirective(commitTime: string): string {
  return JSON.stringify({
    type: "rollBackToEmbedded",
    parameters: { commitTime },
  });
}

type PartName = "manifest" | "directive" | "extensions";
interface Part {
  name: PartName;
  body: string;
  /** Sign this part's body when code signing is configured. */
  sign: boolean;
}

/**
 * Build a `multipart/mixed` Response. The boundary in the Content-Type header
 * matches the parts, and each part carries `Content-Disposition: form-data;
 * name="<part>"` so the client parses by name. When signing, the
 * `expo-signature` header covers the byte-identical part body.
 */
export function buildMultipartResponse(parts: Part[]): Response {
  const boundary = `expo-${randomBytes(12).toString("hex")}`;
  const sign = isCodeSigningConfigured();
  let body = "";
  for (const part of parts) {
    body += `--${boundary}\r\n`;
    body += `Content-Type: application/json; charset=utf-8\r\n`;
    body += `Content-Disposition: form-data; name="${part.name}"\r\n`;
    if (part.sign && sign) {
      body += `expo-signature: ${buildSignatureHeader(part.body)}\r\n`;
    }
    body += `\r\n${part.body}\r\n`;
  }
  body += `--${boundary}--\r\n`;
  return new Response(body, {
    status: 200,
    headers: {
      "expo-protocol-version": "1",
      "expo-sfv-version": "0",
      "cache-control": "private, max-age=0",
      "content-type": `multipart/mixed; boundary=${boundary}`,
    },
  });
}

/** Deterministic include/exclude for staged rollout. Buckets are 0–99. */
export function isInRollout(bucket: number, rolloutPercent: number): boolean {
  if (rolloutPercent >= 100) return true;
  if (rolloutPercent <= 0) return false;
  return bucket < rolloutPercent;
}

/** Read the sticky per-install rollout bucket from the Expo-Extra-Params SFV. */
export function parseRolloutBucket(extraParams: string | null): number | null {
  if (!extraParams) return null;
  const m = extraParams.match(/rollout-bucket\s*=\s*"?(\d{1,3})"?/i);
  if (!m) return null;
  const n = Number.parseInt(m[1], 10);
  return Number.isFinite(n) ? Math.min(99, Math.max(0, n)) : null;
}

/** Stable fallback bucket for installs that didn't send one. */
export function deterministicBucket(seed: string): number {
  const hex = createHash(seed, "sha256", "hex").slice(0, 8);
  return Number.parseInt(hex, 16) % 100;
}
