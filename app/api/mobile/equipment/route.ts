import { NextRequest, NextResponse } from "next/server";
import { listEquipmentForBooking } from "@/lib/equipment";
import { getAuthUserId } from "@/lib/auth-unified";
import { logBookingRequest } from "@/lib/server-log";
import { BookingCategory, Sport } from "@prisma/client";

/**
 * GET /api/mobile/equipment?sport=CRICKET&category=BOWLING_MACHINE
 *
 * Public — surfaces the same customer-facing equipment list the
 * web checkout uses. Auth-free so it can be prefetched alongside
 * availability without forcing a sign-in.
 */
export async function GET(request: NextRequest) {
  const userId = await getAuthUserId(request).catch(() => null);
  const url = new URL(request.url);
  const sportParam = url.searchParams.get("sport");
  const categoryParam = url.searchParams.get("category");

  const logEquip = (
    outcome: "success" | "error",
    metadata: Record<string, unknown>,
    error?: string,
  ) =>
    logBookingRequest(request, "booking.view_equipment", outcome, {
      userId,
      metadata,
      error,
    });

  if (!sportParam || !(sportParam in Sport)) {
    logEquip("error", { sport: sportParam, category: categoryParam }, "Invalid or missing sport");
    return NextResponse.json(
      { error: "Invalid or missing sport" },
      { status: 400 },
    );
  }
  const sport = sportParam as Sport;

  let category: BookingCategory | null = null;
  if (categoryParam) {
    if (!(categoryParam in BookingCategory)) {
      logEquip("error", { sport, category: categoryParam }, "Invalid category");
      return NextResponse.json(
        { error: "Invalid category" },
        { status: 400 },
      );
    }
    category = categoryParam as BookingCategory;
  }

  const equipment = await listEquipmentForBooking({ sport, category });
  logEquip("success", { sport, category, itemCount: equipment.length });
  return NextResponse.json({ equipment });
}
