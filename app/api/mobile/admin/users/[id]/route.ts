import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireMobileAdmin } from "@/lib/mobile-admin-guard";
import { updateUser, deleteUser } from "@/actions/admin-users";
import type { UserRole } from "@prisma/client";

/**
 * PATCH  /api/mobile/admin/users/[id]  — edit name/email/phone/role
 * DELETE /api/mobile/admin/users/[id]  — soft-delete (sets deletedAt)
 *
 * Mirrors updateUser / deleteUser in actions/admin-users.ts. deleteUser is a
 * SOFT delete (deletedAt = now) and refuses self-deletion + users with active
 * bookings; both actions return { success, error? } rather than throwing.
 *
 * Permission: MANAGE_USERS (SUPERADMIN bypass) — the same key the web enforces.
 */

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  role: z.enum(["CUSTOMER", "ADMIN"]).optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireMobileAdmin(request, "MANAGE_USERS");
  if ("error" in gate) return gate.error;
  const { id } = await params;

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid data" },
      { status: 400 },
    );
  }

  const result = await updateUser(
    id,
    {
      ...(parsed.data.name !== undefined && { name: parsed.data.name }),
      ...(parsed.data.email !== undefined && { email: parsed.data.email }),
      ...(parsed.data.phone !== undefined && { phone: parsed.data.phone }),
      ...(parsed.data.role !== undefined && {
        role: parsed.data.role as UserRole,
      }),
    },
    true,
  );

  if (!result.success) {
    return NextResponse.json(
      { error: result.error ?? "Failed to update user" },
      { status: 400 },
    );
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireMobileAdmin(request, "MANAGE_USERS");
  if ("error" in gate) return gate.error;
  const { id } = await params;

  // Pass the JWT admin's id so deleteUser's self-deletion + active-booking
  // guards run exactly as on web (it normally reads the actor from the cookie
  // session, which is absent for bearer-token callers).
  const result = await deleteUser(id, {
    skipAuth: true,
    adminId: gate.admin.id,
  });
  if (!result.success) {
    return NextResponse.json(
      { error: result.error ?? "Failed to delete user" },
      { status: 400 },
    );
  }
  return NextResponse.json({ ok: true });
}
