import { request } from "./admin-api";

/**
 * READ-ONLY mobile admin OTA status client.
 *
 * Mirrors the web /admin/ota page: lists OTA releases (newest-first per
 * channel × platform slot) and the native version gates for the environment
 * this deployment manages. Rollout/version-gate mutations stay on web — this
 * surface only displays status.
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

export const adminOtaApi = {
  status: () =>
    request<OtaStatusResponse>("/api/mobile/admin/ota", { method: "GET" }),
};
