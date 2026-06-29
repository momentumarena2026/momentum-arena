import { NextRequest, NextResponse } from "next/server";
import { requireMobileAdmin } from "@/lib/mobile-admin-guard";
import { restoreUser } from "@/actions/admin-users";

/**
 * POST /api/mobile/admin/users/[id]/restore
 *
 * Un-soft-deletes a user (clears deletedAt). Mirrors restoreUser in
 * actions/admin-users.ts. skipAuth: this route already authorized via the JWT
 * gate below.
 *
 * Permission: MANAGE_USERS (SUPERADMIN bypass) — the same key the web enforces.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireMobileAdmin(request, "MANAGE_USERS");
  if ("error" in gate) return gate.error;
  const { id } = await params;

  const result = await restoreUser(id, true);
  if (!result.success) {
    return NextResponse.json(
      { error: "Failed to restore user" },
      { status: 400 },
    );
  }
  return NextResponse.json({ ok: true });
}
