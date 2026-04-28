import { NextRequest, NextResponse } from "next/server";
import { getMobileAdmin } from "@/lib/mobile-auth";

/**
 * Hydrates the mobile admin session on cold start. The mobile app
 * stores the JWT in Keychain after login and calls this on launch
 * to confirm the token still maps to a live AdminUser row (which
 * may have been deleted or had its role/permissions changed since
 * the token was issued).
 */
export async function GET(request: NextRequest) {
  const admin = await getMobileAdmin(request);
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({
    admin: {
      id: admin.id,
      username: admin.username,
      email: admin.email,
      role: admin.role,
      permissions: admin.permissions,
    },
  });
}
