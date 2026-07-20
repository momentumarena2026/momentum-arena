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
 * updateAdminRewardConfig, both of which enforce MANAGE_REWARDS themselves
 * (requireAdmin resolves this request's Bearer token in-process). The guard
 * below is kept so a rejection surfaces as 401/403 JSON rather than a 500.
 * The client sends the full config object back (16 fields) so the update's
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
  const config = await getAdminRewardConfigFull();
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
    await updateAdminRewardConfig(body as AdminRewardConfigInput);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Invalid config" },
      { status: 400 },
    );
  }
  return NextResponse.json({ ok: true });
}
