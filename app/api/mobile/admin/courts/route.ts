import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getMobileAdmin } from "@/lib/mobile-auth";

/**
 * GET /api/mobile/admin/courts
 *
 * List of active CourtConfig rows for the mobile Edit Booking form's
 * court picker. Returned grouped-friendly (sport included) so the
 * client can render web-style "🏏 Cricket / Full / Half / Small"
 * tiles without a second request.
 */
export async function GET(request: NextRequest) {
  const admin = await getMobileAdmin(request);
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const courts = await db.courtConfig.findMany({
    where: { isActive: true },
    select: {
      id: true,
      sport: true,
      label: true,
      size: true,
      position: true,
      widthFt: true,
      lengthFt: true,
    },
    orderBy: [{ sport: "asc" }, { widthFt: "desc" }, { label: "asc" }],
  });

  return NextResponse.json({ courts });
}
