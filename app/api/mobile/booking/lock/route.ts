import { NextRequest, NextResponse } from "next/server";
import { getMobileUser } from "@/lib/mobile-auth";
import { createSlotHold, createMediumHalfCourtHold } from "@/lib/slot-hold";
import { getSlotPricesForDate } from "@/lib/pricing";
import { getMediumConfigs } from "@/lib/availability";
import { Sport } from "@prisma/client";

// POST /api/mobile/booking/lock — JSON-body wrapper around the web lock
// endpoint. Accepts the mobile JWT and mirrors the response shape so native
// callers don't have to fiddle with FormData.
export async function POST(request: NextRequest) {
  const user = await getMobileUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    mode?: string;
    sport?: Sport;
    courtConfigId?: string;
    date?: string;
    hours?: number[];
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const { mode, sport, courtConfigId, date, hours } = body;
  if (!date || !Array.isArray(hours) || hours.length === 0) {
    return NextResponse.json({ error: "Invalid data" }, { status: 400 });
  }

  const bookingDate = new Date(date);

  if (mode === "medium") {
    if (!sport) {
      return NextResponse.json(
        { error: "sport is required when mode=medium" },
        { status: 400 }
      );
    }
    const { leftId } = await getMediumConfigs(sport);
    const allPrices = await getSlotPricesForDate(leftId, bookingDate);
    const slotPrices = hours.map((hour) => {
      const p = allPrices.find((x) => x.hour === hour);
      return { hour, price: p?.price ?? 0 };
    });
    const result = await createMediumHalfCourtHold(
      user.id,
      sport,
      bookingDate,
      hours,
      slotPrices
    );
    return NextResponse.json(result);
  }

  if (!courtConfigId) {
    return NextResponse.json({ error: "courtConfigId is required" }, { status: 400 });
  }

  const allPrices = await getSlotPricesForDate(courtConfigId, bookingDate);
  const slotPrices = hours.map((hour) => {
    const p = allPrices.find((x) => x.hour === hour);
    return { hour, price: p?.price ?? 0 };
  });

  const result = await createSlotHold(
    user.id,
    courtConfigId,
    bookingDate,
    hours,
    slotPrices
  );

  return NextResponse.json(result);
}
