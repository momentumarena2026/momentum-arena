import { NextRequest, NextResponse } from "next/server";
import { getMobileAdmin } from "@/lib/mobile-auth";
import { hasPermission } from "@/lib/permissions";
import {
  getAdminRewardConfigFull,
  updateAdminRewardConfig,
  type AdminRewardConfigInput,
} from "@/actions/admin-rewards";

/**
 * Mobile admin rewards config. Reuses getAdminRewardConfigFull /
 * updateAdminRewardConfig via their skipAuth flag under MANAGE_REWARDS. The
 * client sends the full config object back (16 fields) so the update's
 * schema.parse is satisfied without a server-side merge.
 */
async function guard(request: NextRequest) {
  const admin = await getMobileAdmin(request);
  if (!admin) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (
    admin.role !== "SUPERADMIN" &&
    !hasPermission(admin.permissions ?? [], "MANAGE_REWARDS")
  ) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { admin };
}

export async function GET(request: NextRequest) {
  const g = await guard(request);
  if ("error" in g) return g.error;
  const config = await getAdminRewardConfigFull(true);
  return NextResponse.json({ config });
}

export async function POST(request: NextRequest) {
  const g = await guard(request);
  if ("error" in g) return g.error;
  const body = await request.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  try {
    await updateAdminRewardConfig(body as AdminRewardConfigInput, true);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Invalid config" },
      { status: 400 },
    );
  }
  return NextResponse.json({ ok: true });
}
