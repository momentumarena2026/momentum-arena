/**
 * "Is this build actually downloadable yet?" — the store side of the version
 * gate.
 *
 * Uploading a binary and it being available to customers are different events,
 * separated by App Store review (hours-to-days) and, on Play, by our uploads
 * landing as drafts that someone rolls out by hand. CI records a new build with
 * `AppVersionGate.latestIsLive = false`; these helpers tell the reconciler
 * (scripts/check-store-availability.ts) when to flip it true.
 *
 * Both lookups fail SOFT: a network blip or a store API change must never flip
 * a live gate back off, so callers treat `null` as "don't know, leave it".
 */

import jwt from "jsonwebtoken";

export const IOS_BUNDLE_ID = "com.momentumarena";
export const ANDROID_PACKAGE = "com.momentumarena";

/**
 * Marketing version currently on the App Store, e.g. "1.0.0" — via the public
 * iTunes Lookup API (no credentials). `country` matters: a release can be live
 * in one storefront before another, and our customers are in India.
 *
 * Returns null when the lookup fails or the app isn't found.
 */
export async function fetchLiveAppStoreVersion(
  bundleId: string = IOS_BUNDLE_ID,
  country = "in",
): Promise<string | null> {
  try {
    const res = await fetch(
      `https://itunes.apple.com/lookup?bundleId=${encodeURIComponent(bundleId)}&country=${country}&t=${Date.now()}`,
      { cache: "no-store" },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      resultCount?: number;
      results?: { version?: string }[];
    };
    const version = data.results?.[0]?.version;
    return typeof version === "string" && version.trim() ? version.trim() : null;
  } catch {
    return null;
  }
}

/** What the Play production track is serving right now. */
export interface PlayTrackState {
  /** versionCodes of releases whose status is "completed" at full rollout. */
  liveVersionCodes: number[];
  /** Marketing names of those releases, e.g. ["1.0.1"]. */
  liveVersionNames: string[];
}

/**
 * Read the Play *production* track via the Publishing API, using the same
 * service-account JSON the release workflow signs uploads with
 * (GOOGLE_PLAY_JSON_KEY).
 *
 * Only `status === "completed"` releases count, and a staged rollout only
 * counts at 100%: prompting the 80% who can't install it yet is the exact bug
 * this module exists to prevent.
 *
 * Returns null when credentials are absent or any call fails — never throws, so
 * a Play outage can't disturb the gate.
 */
export async function fetchLivePlayTrack(
  serviceAccountJson: string | undefined,
  packageName: string = ANDROID_PACKAGE,
): Promise<PlayTrackState | null> {
  if (!serviceAccountJson?.trim()) return null;
  try {
    const key = JSON.parse(serviceAccountJson) as {
      client_email?: string;
      private_key?: string;
    };
    if (!key.client_email || !key.private_key) return null;

    // Service-account JWT → OAuth2 access token (androidpublisher scope).
    const now = Math.floor(Date.now() / 1000);
    const assertion = jwt.sign(
      {
        iss: key.client_email,
        scope: "https://www.googleapis.com/auth/androidpublisher",
        aud: "https://oauth2.googleapis.com/token",
        iat: now,
        exp: now + 3600,
      },
      key.private_key,
      { algorithm: "RS256" },
    );
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
    });
    if (!tokenRes.ok) return null;
    const { access_token: accessToken } = (await tokenRes.json()) as {
      access_token?: string;
    };
    if (!accessToken) return null;

    const auth = { Authorization: `Bearer ${accessToken}` };
    const base = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(packageName)}`;

    // Track reads need an edit context; we create one and never commit it, so
    // nothing about the listing changes. Delete it afterwards to stay tidy.
    const editRes = await fetch(`${base}/edits`, { method: "POST", headers: auth });
    if (!editRes.ok) return null;
    const { id: editId } = (await editRes.json()) as { id?: string };
    if (!editId) return null;

    try {
      const trackRes = await fetch(`${base}/edits/${editId}/tracks/production`, {
        headers: auth,
      });
      if (!trackRes.ok) return null;
      const track = (await trackRes.json()) as {
        releases?: {
          status?: string;
          userFraction?: number;
          name?: string;
          versionCodes?: (string | number)[];
        }[];
      };
      const live = (track.releases ?? []).filter(
        (r) =>
          r.status === "completed" &&
          // userFraction is only present mid-rollout; absent means full.
          (r.userFraction == null || r.userFraction >= 1),
      );
      return {
        liveVersionCodes: live
          .flatMap((r) => r.versionCodes ?? [])
          .map((c) => Number(c))
          .filter((c) => Number.isFinite(c)),
        liveVersionNames: live
          .map((r) => (r.name ?? "").trim())
          .filter((n) => n.length > 0),
      };
    } finally {
      await fetch(`${base}/edits/${editId}`, {
        method: "DELETE",
        headers: auth,
      }).catch(() => {});
    }
  } catch {
    return null;
  }
}

/**
 * Play release names are free text and often carry the build number
 * ("1.0.1 (29760833)"). Match on the version code when we have it, else fall
 * back to a name containing the marketing version.
 */
export function playTrackHasBuild(
  track: PlayTrackState,
  build: number,
  versionName: string | null,
): boolean {
  if (track.liveVersionCodes.includes(build)) return true;
  if (!versionName) return false;
  return track.liveVersionNames.some(
    (n) => n === versionName || n.startsWith(`${versionName} `),
  );
}
