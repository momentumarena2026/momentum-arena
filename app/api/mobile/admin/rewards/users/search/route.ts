import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getMobileAdmin } from "@/lib/mobile-auth";
import { hasPermission } from "@/lib/permissions";

/**
 * Search users for the mobile admin grant flow. Same shape as
 * `searchUsersForRewards` in actions/admin-rewards.ts but exposed
 * over HTTP for the mobile admin app.
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
  const limitRaw = Number(request.nextUrl.searchParams.get("limit") ?? 25);
  const limit = Math.min(Math.max(limitRaw, 1), 100);

  const users = await db.user.findMany({
    where: q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { email: { contains: q, mode: "insensitive" } },
            { phone: { contains: q } },
          ],
        }
      : undefined,
    take: limit,
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      rewardBalance: { select: { pointsAvailable: true } },
    },
  });

  return NextResponse.json({
    users: users.map((u) => ({
      userId: u.id,
      name: u.name,
      email: u.email,
      phone: u.phone,
      pointsAvailable: u.rewardBalance?.pointsAvailable ?? 0,
    })),
  });
}
