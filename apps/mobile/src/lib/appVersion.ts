import * as Application from "expo-application";
import * as Updates from "expo-updates";
import { Platform } from "react-native";
import { env } from "../config/env";
import { GIT_BRANCH } from "../config/build-config.generated";

/**
 * In-app version + update plumbing.
 *
 * The numbers here power three flows:
 *
 *   1. The version-check call below (talks to the backend so the server can
 *      decide if a build is too old and must be force-updated).
 *   2. The "App version" row on the Account screen (`versionLabel`).
 *   3. App.tsx's force-update gate.
 *
 * Key invariant: `nativeBuildNumber()` reads the *native* build version
 * (CFBundleVersion on iOS / versionCode on Android). That number is baked
 * into the binary at archive time and an OTA update can NEVER change it —
 * so it's the only reliable signal for "is the installed app store binary
 * too old". OTA bundles bump `otaBuildNumber` (from the manifest extra)
 * instead, which is tracked separately.
 */

/**
 * Native build number — CFBundleVersion (iOS) / versionCode (Android) at
 * runtime. OTA-immune: an over-the-air JS update can't change this, so it's
 * the canonical "which store binary is installed" value. Falls back to 0 if
 * unavailable (e.g. some dev contexts).
 */
export function nativeBuildNumber(): number {
  return Number(Application.nativeBuildVersion ?? 0);
}

/**
 * Marketing / user-facing version string — CFBundleShortVersionString (iOS)
 * / versionName (Android), e.g. "1.0.0". "?" if unavailable.
 */
export function marketingVersion(): string {
  return Application.nativeApplicationVersion ?? "?";
}

/**
 * Release channel, derived from the git branch the bundle was built from —
 * the same build-config the API base URL keys off (see config/env.ts).
 * `main` → "production"; everything else → "development".
 */
export function channel(): "production" | "development" {
  return GIT_BRANCH === "main" ? "production" : "development";
}

/**
 * Sequence number of the currently-running OTA bundle, read from the
 * manifest's `extra.otaBuildNumber`. 0 means the embedded bundle that
 * shipped with the binary (no OTA applied yet, or running in dev).
 */
export function otaBuildNumber(): number {
  try {
    return Number((Updates.manifest as any)?.extra?.otaBuildNumber ?? 0);
  } catch {
    return 0;
  }
}

/**
 * Human-readable version label for the Account screen, e.g.
 * "1.0.0 · build 312 · OTA 7 · dev".
 */
export function versionLabel(): string {
  const ch = channel() === "production" ? "prod" : "dev";
  return `${marketingVersion()} · build ${nativeBuildNumber()} · OTA ${otaBuildNumber()} · ${ch}`;
}

export interface NativeVersionInfo {
  currentBuild: number;
  latestBuild: number;
  latestVersionName: string;
  minSupportedBuild: number;
  updateAvailable: boolean;
  forced: boolean;
  storeUrl: string;
  message: string | null;
}

export interface OtaVersionInfo {
  latestSequence: number;
  available: boolean;
}

export interface VersionCheckResult {
  native: NativeVersionInfo;
  ota: OtaVersionInfo;
}

/**
 * Ask the backend whether the installed build is current / supported.
 *
 * Returns the parsed `{ native, ota }` payload, or `null` on any error
 * (network failure, non-2xx, malformed JSON). Callers MUST treat `null` as
 * "couldn't determine — carry on normally" and never hard-block on it: a
 * flaky network must not lock users out of the app.
 */
export async function checkAppVersion(): Promise<VersionCheckResult | null> {
  try {
    const platform = Platform.OS === "ios" ? "ios" : "android";
    const params = new URLSearchParams({
      platform,
      channel: channel(),
      build: String(nativeBuildNumber()),
      runtimeVersion: String(Updates.runtimeVersion ?? ""),
      ota: String(otaBuildNumber()),
    });
    const url = `${env.apiUrl}/api/app/version-check?${params.toString()}`;

    const res = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      // Always hit the network — a gate/force change must apply on the next
      // check, never a cached "not forced" answer.
      cache: "no-store",
    });
    if (!res.ok) return null;

    const json = (await res.json()) as VersionCheckResult;
    if (!json || !json.native) return null;
    return json;
  } catch {
    // Network error / parse error / updates not available — treat as
    // "unknown" so the app renders normally.
    return null;
  }
}
