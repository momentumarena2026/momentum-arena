import { NextRequest, NextResponse } from "next/server";
import { getMobileAdmin } from "@/lib/mobile-auth";
import { hasPermission } from "@/lib/permissions";
import { getAdminUsers } from "@/actions/admin-users";

/**
 * GET /api/mobile/admin/users?search=&role=&page=
 *
 * Thin wrapper over the web `getAdminUsers` server action so the RN
 * admin can render the same read-only user directory the web
 * /admin/users page does (search by name/email/phone + role filter +
 * pagination). `skipAuth: true` is safe — the JWT admin is verified
 * here, and the action's own cookie-based requireAdmin would otherwise
 * reject bearer-token callers.
 *
 * Permission: MANAGE_USERS (SUPERADMIN bypass).
 */
export async function GET(request: NextRequest) {
  const admin = await getMobileAdmin(request);
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (
    admin.role !== "SUPERADMIN" &&
    !hasPermission(admin.permissions ?? [], "MANAGE_USERS")
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const search = searchParams.get("search")?.trim() || undefined;
  const role = searchParams.get("role")?.trim() || undefined;
  const pageRaw = parseInt(searchParams.get("page") || "1", 10);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;

  try {
    const result = await getAdminUsers(
      { search, role, page, limit: 20 },
      true,
    );

    return NextResponse.json({
      users: result.users.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        phone: u.phone,
        role: u.role,
        bookingCount: u._count.bookings,
        createdAt: u.createdAt.toISOString(),
      })),
      total: result.total,
      page: result.page,
      totalPages: result.totalPages,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load users" },
      { status: 500 },
    );
  }
}
