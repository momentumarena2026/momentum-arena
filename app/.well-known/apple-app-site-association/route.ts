import { NextResponse } from "next/server";
import { ANDROID_PACKAGE, APPLE_TEAM_ID } from "@/lib/app-store-links";

/**
 * Apple App Site Association — the file iOS fetches to decide whether
 * momentumarena.com links may open the app (Universal Links).
 *
 * Served from a route rather than a static file for two reasons: it must
 * be returned as application/json with NO .json extension, and the app id
 * embeds the Apple Team ID, which belongs in env rather than the repo.
 *
 * The Team ID is NOT a secret — it ships inside this very file, which is
 * world-readable by design — so it's defaulted here rather than made a
 * deploy-time step that can be forgotten. APPLE_TEAM_ID still overrides,
 * which is what a second Apple account would need.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const teamId = process.env.APPLE_TEAM_ID?.trim() || APPLE_TEAM_ID;

  return NextResponse.json(
    {
      applinks: {
        // `details` alone is the modern form; `apps` must still be present
        // and empty or older iOS rejects the file.
        apps: [],
        details: [
          {
            appID: `${teamId}.${ANDROID_PACKAGE}`,
            // The iOS bundle id matches the Android package here
            // (com.momentumarena) — see apps/mobile/app.json.
            paths: ["*"],
          },
        ],
      },
    },
    {
      headers: {
        "Content-Type": "application/json",
        // iOS refetches periodically; a day is long enough to be cheap and
        // short enough that a fix lands without waiting a week.
        "Cache-Control": "public, max-age=0, s-maxage=86400",
      },
    },
  );
}
