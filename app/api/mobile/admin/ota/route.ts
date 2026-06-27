import { NextRequest, NextResponse } from "next/server";
import { getMobileAdmin } from "@/lib/mobile-auth";
import { hasPermission } from "@/lib/permissions";
import { listOtaReleases } from "@/actions/admin-ota";
import { listAppVersionGates } from "@/actions/admin-app-version";

/**
 * Mobile admin OTA status (READ-ONLY).
 *
 * Mirrors the web app/(admin)/admin/ota page: returns every OTA release
 * (newest-first per channel × platform slot) plus the native version gates,
 * and the environment THIS deployment manages (prod domain → "production",
 * dev/preview/local → "development"). Rolling out from mobile is deliberately
 * NOT supported — that risky mutation stays on the web dashboard.
 *
 * Gated behind MANAGE_PRICING, the same permission the web OTA actions use.
 * The web actions auth via the cookie session (requireAdmin); a mobile bearer
 * request has no such cookie, so we authorize here with getMobileAdmin +
 * hasPermission and call the list actions with `skipAuth: true`.
 */
export async function GET(request: NextRequest) {
  const admin = await getMobileAdmin(request);
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (
    admin.role !== "SUPERADMIN" &&
    !hasPermission(admin.permissions ?? [], "MANAGE_PRICING")
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [releases, gates] = await Promise.all([
    listOtaReleases({ skipAuth: true }),
    listAppVersionGates({ skipAuth: true }),
  ]);

  // Lock to THIS deployment's environment: the production domain
  // (VERCEL_ENV=production → prod DB) manages "production"; dev/preview/local
  // manages "development". Each DB only holds its own channel's rows.
  const environment =
    process.env.VERCEL_ENV === "production" ? "production" : "development";

  return NextResponse.json({ environment, releases, gates });
}
