import { NextResponse } from "next/server";
import {
  ANDROID_APP_SIGNING_SHA256,
  ANDROID_PACKAGE,
  ANDROID_UPLOAD_SHA256,
} from "@/lib/app-store-links";

/**
 * Digital Asset Links — what Android verifies before letting
 * momentumarena.com links open the app (App Links).
 *
 * Set ANDROID_SHA256_FINGERPRINTS to the app-signing certificate's SHA-256,
 * from Play Console -> your app -> Setup -> App signing. Comma-separate to
 * list more than one (you generally want BOTH the Play app-signing key and
 * your upload key, or links verify in production but not on the builds you
 * sideload while testing).
 *
 * 404s until configured, deliberately: a fingerprint that doesn't match
 * fails verification silently, and silent is the expensive kind of wrong.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  // Both keys are listed: the Play app-signing key covers real Store
  // installs, the upload key covers sideloaded and internal-test builds.
  // The env var can append more (a second signing key during a rotation).
  const extra = (process.env.ANDROID_SHA256_FINGERPRINTS ?? "")
    .split(",")
    .map((f) => f.trim().toUpperCase())
    .filter(Boolean);

  const fingerprints = Array.from(
    new Set([
      ANDROID_APP_SIGNING_SHA256.toUpperCase(),
      ANDROID_UPLOAD_SHA256.toUpperCase(),
      ...extra,
    ]),
  );

  return NextResponse.json(
    [
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: {
          namespace: "android_app",
          package_name: ANDROID_PACKAGE,
          sha256_cert_fingerprints: fingerprints,
        },
      },
    ],
    {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=0, s-maxage=86400",
      },
    },
  );
}
