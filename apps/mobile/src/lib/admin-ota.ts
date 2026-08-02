import { request } from "./admin-api";

/**
 * Mobile admin OTA client.
 *
 * Mirrors the web /admin/ota page: lists OTA releases (newest-first per
 * channel × platform slot) and the native version gates for the environment
 * this deployment manages, AND drives the same rollout / version-gate
 * mutations. Reads hit GET /api/mobile/admin/ota; mutations POST to the same
 * route with an `action` discriminator (the route authorizes once, then calls
 * the matching web action with skipAuth).
 */

export type OtaPlatform = "ios" | "android";
export type OtaReleaseStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";
export type OtaReleaseKind = "UPDATE" | "ROLLBACK";

// Dates arrive as JSON strings over the wire.
export interface OtaReleaseRow {
  id: string;
  channel: string;
  runtimeVersion: string;
  platform: OtaPlatform;
  kind: OtaReleaseKind;
  status: OtaReleaseStatus;
  rolloutPercent: number;
  sequence: number;
  changelog: string | null;
  publishedBy: string | null;
  assetCount: number;
  createdAt: string;
  activatedAt: string | null;
}

export interface AppVersionGateRow {
  id: string;
  platform: OtaPlatform;
  channel: string;
  latestBuild: number;
  latestVersionName: string | null;
  /** Store actually serves this build. False while it's in App Store review or
   *  sitting as a Play draft — the app shows no update prompt until it flips. */
  latestIsLive: boolean;
  liveConfirmedAt: string | null;
  minSupportedBuild: number;
  storeUrl: string;
  message: string | null;
  updatedBy: string | null;
  updatedAt: string;
}

export interface OtaStatusResponse {
  environment: "development" | "production";
  releases: OtaReleaseRow[];
  gates: AppVersionGateRow[];
}

type MutationResult = { success: true };

/** Input for saving (create/update) a native version gate. */
export interface SaveGateInput {
  platform: OtaPlatform;
  channel: string;
  latestBuild: number;
  latestVersionName?: string;
  storeUrl: string;
  message?: string;
  // When provided, the route applies it via setMinSupportedBuild after the
  // upsert so a single Save can also adjust the minimum supported build.
  minSupportedBuild?: number;
}

function post(body: Record<string, unknown>) {
  return request<MutationResult>("/api/mobile/admin/ota", {
    method: "POST",
    body,
  });
}

export const adminOtaApi = {
  status: () =>
    request<OtaStatusResponse>("/api/mobile/admin/ota", { method: "GET" }),

  // ---- OTA release mutations ----
  /** Publish a DRAFT/ARCHIVED release at a chosen rollout %. */
  rollout: (releaseId: string, percent: number) =>
    post({ action: "rollout", releaseId, percent }),
  /** Adjust the rollout % of an already-published release. */
  setPercent: (releaseId: string, percent: number) =>
    post({ action: "setPercent", releaseId, percent }),
  /** Roll a live release back to the previous good build. */
  rollback: (releaseId: string) => post({ action: "rollback", releaseId }),
  /** Retire a release so it's never served. */
  archive: (releaseId: string) => post({ action: "archive", releaseId }),

  // ---- Native version-gate mutations ----
  /** Create or update the gate for a (platform, channel) slot. */
  saveGate: (input: SaveGateInput) => post({ action: "saveGate", ...input }),
  /** Directly set minSupportedBuild for a slot. */
  setMinBuild: (platform: OtaPlatform, channel: string, build: number) =>
    post({ action: "setMinBuild", platform, channel, build }),
  /** Force update: raise minSupportedBuild to the latest store build. */
  forceUpdate: (platform: OtaPlatform, channel: string) =>
    post({ action: "forceUpdate", platform, channel }),

  /** Manual override for the hourly store-availability checker. */
  setStoreLive: (platform: OtaPlatform, channel: string, isLive: boolean) =>
    post({ action: "setStoreLive", platform, channel, isLive }),
  /** Un-force: lower the minimum supported build to 0 (nobody blocked). */
  unforce: (platform: OtaPlatform, channel: string) =>
    post({ action: "setMinBuild", platform, channel, build: 0 }),
};
