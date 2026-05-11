import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getMobileAdmin } from "@/lib/mobile-auth";
import { hasPermission } from "@/lib/permissions";
import { adminGrantPoints } from "@/lib/rewards/earn";

/**
 * Bulk-grant points from mobile admin. Mirrors actions/admin-rewards
 * adminBulkGrantPoints — one ADJUSTMENT_AUDIT alert is raised per
 * grant so traces are identical regardless of which surface issued it.
 */
const schema = z.object({
  userIds: z.array(z.string().min(1)).min(1).max(1000),
  points: z.number().int().min(1).max(1_000_000),
  reason: z.string().min(3).max(500),
});

export async function POST(request: NextRequest) {
  const admin = await getMobileAdmin(request);
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (
    admin.role !== "SUPERADMIN" &&
    !hasPermission(admin.permissions ?? [], "MANAGE_REWARDS")
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  let granted = 0;
  let skipped = 0;
  for (const userId of parsed.data.userIds) {
    const r = await adminGrantPoints({
      userId,
      points: parsed.data.points,
      actorAdminId: admin.id,
      reason: parsed.data.reason,
    });
    if (r.awarded) granted++;
    else skipped++;
  }
  return NextResponse.json({
    granted,
    skipped,
    totalPointsAwarded: granted * parsed.data.points,
  });
}
