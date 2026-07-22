import { NextRequest, NextResponse } from "next/server";
import { getMobileAdmin } from "@/lib/mobile-auth";
import {
  updateAdminAccount,
  deleteAdminAccount,
  type UpdateAdminAccountInput,
} from "@/actions/admin-admin-users";

/**
 * Edit / delete a single admin account (db.adminUser) — SUPERADMIN only.
 * PATCH updates email / role / permissions / password; DELETE removes a
 * deletable, non-superadmin account.
 */
async function guardSuperadmin(request: NextRequest) {
  const admin = await getMobileAdmin(request);
  if (!admin)
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (admin.role !== "SUPERADMIN") {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { admin };
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const g = await guardSuperadmin(request);
  if ("error" in g) return g.error;
  const { id } = await params;

  const body = (await request.json().catch(() => null)) as
    | UpdateAdminAccountInput
    | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  try {
    const admin = await updateAdminAccount(id, body);
    return NextResponse.json({ admin });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to update" },
      { status: 400 },
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const g = await guardSuperadmin(request);
  if ("error" in g) return g.error;
  const { id } = await params;

  try {
    await deleteAdminAccount(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to delete" },
      { status: 400 },
    );
  }
}
