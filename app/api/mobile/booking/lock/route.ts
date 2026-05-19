import { NextRequest, NextResponse } from "next/server";
import { getMobileUser } from "@/lib/mobile-auth";
import {
  createSlotHold,
  createMediumHalfCourtHold,
  createBowlingMachineHold,
  type BowlingSlotPrice,
} from "@/lib/slot-hold";
import { getSlotPricesForDate } from "@/lib/pricing";
import { getMediumConfigs } from "@/lib/availability";
import { getBowlingMachineAvailability } from "@/lib/bowling-availability";
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
    // Bowling-machine mode only — parallel slot payload at 30-min
    // granularity. Same shape as the web /api/booking/lock?mode=
    // bowling-machine path.
    slots?: Array<{ hour: number; minute: 0 | 30 }>;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const { mode, sport, courtConfigId, date, hours, slots } = body;

  // Bowling-machine path uses `slots[]` instead of `hours[]`.
  if (mode === "bowling-machine") {
    if (!courtConfigId || !date || !Array.isArray(slots) || slots.length === 0) {
      return NextResponse.json({ error: "Invalid data" }, { status: 400 });
    }
    // Re-derive both price AND status from getBowlingMachineAvailability
    // so a stale picker (e.g. a phone left open past the slot's start
    // time) can't lock a now-past, blocked, or zone-occupied slot.
    // The availability function stamps `status` using IST-aware
    // now-hour / now-minute, so the gate inherits the correct
    // timezone end-to-end. Mirror of the web lock route.
    const avail = await getBowlingMachineAvailability(
      courtConfigId,
      new Date(date),
    );
    const lookup = new Map(
      avail.map((s) => [`${s.hour}:${s.minute}`, s] as const),
    );

    const unavailable: string[] = [];
    for (const s of slots) {
      const entry = lookup.get(`${s.hour}:${s.minute}`);
      if (!entry || entry.status !== "available") {
        unavailable.push(`${s.hour}:${s.minute}`);
      }
    }
    if (unavailable.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Some slots are no longer available. Refresh the picker and try again.",
          conflicts: unavailable,
        },
        { status: 409 },
      );
    }

    const slotPrices: BowlingSlotPrice[] = slots.map((s) => ({
      hour: s.hour,
      minute: s.minute,
      price: lookup.get(`${s.hour}:${s.minute}`)!.price,
    }));
    const result = await createBowlingMachineHold(
      user.id,
      courtConfigId,
      new Date(date),
      slotPrices,
    );
    return NextResponse.json(result);
  }

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
