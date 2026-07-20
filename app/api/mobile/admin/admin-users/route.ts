import { NextRequest, NextResponse } from "next/server";
import { getMobileAdmin } from "@/lib/mobile-auth";
import {
  listAdminAccounts,
  createAdminAccount,
  type CreateAdminAccountInput,
} from "@/actions/admin-admin-users";

/**
 * Mobile admin-account management (db.adminUser) — SUPERADMIN only. GET lists
 * accounts, POST creates one with a password directly (no e-mail invite).
 *
 * The bearer token + SUPERADMIN role are checked here so failures surface as
 * proper 401/403 JSON. The actions re-check independently (requireSuperadmin
 * reads the same bearer token in-process) — defence in depth, not redundancy.
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

export async function GET(request: NextRequest) {
  const g = await guardSuperadmin(request);
  if ("error" in g) return g.error;
  const admins = await listAdminAccounts();
  return NextResponse.json({ admins });
}

export async function POST(request: NextRequest) {
  const g = await guardSuperadmin(request);
  if ("error" in g) return g.error;

  const body = (await request.json().catch(() => null)) as
    | CreateAdminAccountInput
    | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  try {
    const admin = await createAdminAccount(body);
    return NextResponse.json({ admin });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to create" },
      { status: 400 },
    );
  }
}
