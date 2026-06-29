import { NextRequest, NextResponse } from "next/server";
import { getMobileAdmin } from "@/lib/mobile-auth";
import { hasPermission, type Permission } from "@/lib/permissions";

export type MobileAdmin = NonNullable<Awaited<ReturnType<typeof getMobileAdmin>>>;

/**
 * Authenticate AND authorize a mobile admin request.
 *
 * The mobile admin routes reuse web server actions via skipAuth/adminOverride
 * params, which bypass the action's own `requireAdmin("KEY")` permission gate.
 * So the route MUST re-enforce the permission itself — otherwise any
 * authenticated admin (even STAFF / a single-permission admin) could perform
 * the action. This helper is that gate; call it at the top of every admin
 * route before any DB/action work:
 *
 *   const gate = await requireMobileAdmin(request, "MANAGE_BOOKINGS");
 *   if ("error" in gate) return gate.error;
 *   const admin = gate.admin; // use admin.id / admin.username
 *
 * SUPERADMIN bypasses the permission check (mirrors the web layout rule).
 */
export async function requireMobileAdmin(
  request: NextRequest,
  permission: Permission,
): Promise<{ admin: MobileAdmin } | { error: NextResponse }> {
  const admin = await getMobileAdmin(request);
  if (!admin) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (
    admin.role !== "SUPERADMIN" &&
    !hasPermission(admin.permissions ?? [], permission)
  ) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { admin };
}
