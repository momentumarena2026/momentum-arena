import { NextResponse } from "next/server";
import { ANDROID_PACKAGE } from "@/lib/app-store-links";

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
  const raw = process.env.ANDROID_SHA256_FINGERPRINTS?.trim();
  if (!raw) {
    return NextResponse.json(
      { error: "ANDROID_SHA256_FINGERPRINTS is not configured" },
      { status: 404 },
    );
  }

  const fingerprints = raw
    .split(",")
    .map((f) => f.trim().toUpperCase())
    .filter(Boolean);

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
