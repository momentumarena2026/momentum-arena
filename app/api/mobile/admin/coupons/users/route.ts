import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireMobileAdmin } from "@/lib/mobile-admin-guard";

/**
 * GET /api/mobile/admin/coupons/users?q=...
 *
 * Customer lookup for the coupon "Customer Targeting" picker (eligible
 * users). Gated by MANAGE_COUPONS — the same scope the coupons admin
 * already holds — so a coupon manager who lacks MANAGE_BOOKINGS can
 * still search customers here (mirrors the web UserPicker, which is
 * powered by searchUsersForPicker under MANAGE_COUPONS).
 *
 * Static segment "users" takes precedence over the sibling [id] dynamic
 * route in Next.js, so this never collides with PATCH/DELETE /:id.
 */
export async function GET(request: NextRequest) {
  const gate = await requireMobileAdmin(request, "MANAGE_COUPONS");
  if ("error" in gate) return gate.error;

  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  // Same 2-char minimum the web picker uses — saves a round trip on the
  // first keystroke.
  if (q.length < 2) return NextResponse.json({ users: [] });

  const users = await db.user.findMany({
    where: {
      deletedAt: null,
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        { phone: { contains: q } },
      ],
    },
    select: { id: true, name: true, email: true, phone: true },
    take: 20,
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ users });
}
