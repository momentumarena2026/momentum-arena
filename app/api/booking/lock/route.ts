import { NextRequest, NextResponse } from "next/server";
import { getAuthUserId } from "@/lib/auth-unified";
import { createSlotHold, createMediumHalfCourtHold } from "@/lib/slot-hold";
import { getSlotPricesForDate } from "@/lib/pricing";
import { getMediumConfigs } from "@/lib/availability";
import { Sport } from "@prisma/client";

// POST /api/booking/lock — creates a transient SlotHold (5 min TTL).
// Returns { success, holdId?, error?, conflicts? }.
//
// Two modes:
//   - Default: formData includes `courtConfigId` — locks that specific config.
//   - mode=medium: formData includes `sport` (and no courtConfigId) — the
//     system atomically picks LEFT or RIGHT MEDIUM half, preferring LEFT.
//     Resulting hold is tagged `wasBookedAsHalfCourt = true`.
export async function POST(request: NextRequest) {
  const userId = await getAuthUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();
  const mode = formData.get("mode") as string | null;
  const date = formData.get("date") as string;
  let hours: number[];
  try {
    hours = JSON.parse(formData.get("hours") as string) as number[];
  } catch {
    return NextResponse.json({ error: "Invalid data" }, { status: 400 });
  }

  if (!date || !hours?.length) {
    return NextResponse.json({ error: "Invalid data" }, { status: 400 });
  }

  const bookingDate = new Date(date);

  if (mode === "medium") {
    const sport = formData.get("sport") as string | null;
    if (!sport) {
      return NextResponse.json(
        { error: "sport is required when mode=medium" },
        { status: 400 }
      );
    }

    // LEFT and RIGHT halves have identical pricing by business rule — use
    // LEFT's pricing table as canonical for the hold's slotPrices payload.
    const { leftId } = await getMediumConfigs(sport as Sport);
    const allPrices = await getSlotPricesForDate(leftId, bookingDate);
    const slotPrices = hours.map((hour) => {
      const priceData = allPrices.find((p) => p.hour === hour);
      return { hour, price: priceData?.price ?? 0 };
    });

    const result = await createMediumHalfCourtHold(
      userId,
      sport as Sport,
      bookingDate,
      hours,
      slotPrices
    );
    return NextResponse.json(result);
  }

  const courtConfigId = formData.get("courtConfigId") as string;
  if (!courtConfigId) {
    return NextResponse.json({ error: "Invalid data" }, { status: 400 });
  }

  const allPrices = await getSlotPricesForDate(courtConfigId, bookingDate);
  const slotPrices = hours.map((hour) => {
    const priceData = allPrices.find((p) => p.hour === hour);
    return { hour, price: priceData?.price ?? 0 };
  });

  const result = await createSlotHold(
    userId,
    courtConfigId,
    bookingDate,
    hours,
    slotPrices
  );

  return NextResponse.json(result);
}
