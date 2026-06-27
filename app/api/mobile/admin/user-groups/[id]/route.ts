import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getMobileAdmin } from "@/lib/mobile-auth";
import { hasPermission } from "@/lib/permissions";
import { deleteUserGroup, updateUserGroup } from "@/actions/admin-user-groups";

/**
 * Mobile admin user-group rename/edit + (soft) delete. Wraps the web
 * `updateUserGroup` / `deleteUserGroup` server actions (skipAuth — the
 * JWT admin is verified here).
 *
 * Permission: MANAGE_COUPONS (SUPERADMIN bypass).
 */
async function guard(request: NextRequest) {
  const admin = await getMobileAdmin(request);
  if (!admin) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (
    admin.role !== "SUPERADMIN" &&
    !hasPermission(admin.permissions ?? [], "MANAGE_COUPONS")
  ) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { admin };
}

const patchSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  description: z.string().max(500).nullable().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await guard(request);
  if ("error" in auth) return auth.error;
  const { id } = await params;

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid data" },
      { status: 400 },
    );
  }

  const result = await updateUserGroup(id, parsed.data, true);
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await guard(request);
  if ("error" in auth) return auth.error;
  const { id } = await params;

  const result = await deleteUserGroup(id, true);
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
