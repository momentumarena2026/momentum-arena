import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getMobileAdmin } from "@/lib/mobile-auth";
import { hasPermission } from "@/lib/permissions";

/**
 * Mobile counterpart of the web `getAllMatchingUserIdsForRewards`
 * action — returns IDs of every user matching the query, not just
 * the visible page. Drives the "Select all matching" button on the
 * Admin Rewards distribute screen.
 *
 * Hard-capped at 10_000 IDs (same cap as the web action) so a
 * runaway empty-query request can't ship megabytes of strings to
 * the device.
 */
export async function GET(request: NextRequest) {
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

  const q = request.nextUrl.searchParams.get("query")?.trim() ?? "";
  const CAP = 10_000;

  const where = q
    ? {
        OR: [
          { name: { contains: q, mode: "insensitive" as const } },
          { email: { contains: q, mode: "insensitive" as const } },
          { phone: { contains: q } },
        ],
      }
    : {};

  const [users, total] = await Promise.all([
    db.user.findMany({
      where,
      take: CAP,
      orderBy: { createdAt: "desc" },
      select: { id: true },
    }),
    db.user.count({ where }),
  ]);

  return NextResponse.json({
    userIds: users.map((u) => u.id),
    total,
    truncated: total > CAP,
  });
}
