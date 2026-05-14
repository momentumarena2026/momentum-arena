import { NextRequest, NextResponse } from "next/server";
import { listEquipmentForBooking } from "@/lib/equipment";
import { BookingCategory, Sport } from "@prisma/client";

/**
 * GET /api/mobile/equipment?sport=CRICKET&category=BOWLING_MACHINE
 *
 * Public — surfaces the same customer-facing equipment list the
 * web checkout uses. Auth-free so it can be prefetched alongside
 * availability without forcing a sign-in.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const sportParam = url.searchParams.get("sport");
  const categoryParam = url.searchParams.get("category");

  if (!sportParam || !(sportParam in Sport)) {
    return NextResponse.json(
      { error: "Invalid or missing sport" },
      { status: 400 },
    );
  }
  const sport = sportParam as Sport;

  let category: BookingCategory | null = null;
  if (categoryParam) {
    if (!(categoryParam in BookingCategory)) {
      return NextResponse.json(
        { error: "Invalid category" },
        { status: 400 },
      );
    }
    category = categoryParam as BookingCategory;
  }

  const equipment = await listEquipmentForBooking({ sport, category });
  return NextResponse.json({ equipment });
}
