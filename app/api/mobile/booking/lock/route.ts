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
import { snapshotEquipmentForHold } from "@/lib/equipment";
import { sportForCourtConfigId } from "@/lib/booking-log-sport";
import { db } from "@/lib/db";
import { Prisma, Sport } from "@prisma/client";
import { AnalyticsCategory, logServerAction, resolveRequestPlatform } from "@/lib/server-log";

/**
 * Snapshot the customer's equipment picks onto the just-created hold.
 * Mirror of the web lock route's helper — soft-fail keeps the slot
 * hold alive even if the equipment payload is stale. See web route
 * for the rationale.
 */
async function applyEquipmentToFreshHold(
  holdId: string,
  picks: Array<{ equipmentId: string; quantity?: number }> | undefined,
  slotCount: number,
): Promise<{ applied: boolean; error?: string }> {
  if (!picks || picks.length === 0) return { applied: true };
  const normalized = picks
    .filter((p) => p && typeof p.equipmentId === "string")
    .map((p) => ({
      equipmentId: p.equipmentId,
      quantity: typeof p.quantity === "number" && p.quantity > 0 ? p.quantity : 1,
    }));
  if (normalized.length === 0) return { applied: true };

  const snap = await snapshotEquipmentForHold(normalized, slotCount);
  if (!snap.ok) {
    console.warn("[mobile-lock] equipment snapshot failed for hold", holdId, snap.error);
    return { applied: false, error: snap.error };
  }
  try {
    await db.slotHold.update({
      where: { id: holdId },
      data: {
        equipmentSelection: snap.result.snapshot as unknown as Prisma.InputJsonValue,
        equipmentTotalAmount: snap.result.totalRupees,
      },
    });
    return { applied: true };
  } catch (err) {
    console.warn("[mobile-lock] equipment update failed for hold", holdId, err);
    return { applied: false, error: "Couldn't save equipment selection" };
  }
}

function logBookingLock(
  request: NextRequest,
  userId: string,
  outcome: "success" | "error",
  metadata: Record<string, unknown>,
  error?: string,
) {
  logServerAction({
    userId,
    action: "booking.lock",
    category: AnalyticsCategory.BOOKING,
    outcome,
    path: request.nextUrl.pathname,
    method: "POST",
    platform: resolveRequestPlatform(request),
    metadata,
    error,
  });
}

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
    // Optional equipment picks captured on the slot-selection screen
    // before checkout. Snapshotted onto the fresh hold so the
    // checkout page can render a read-only summary instead of
    // a separate selector. Soft-fails if items are stale (see helper).
    equipmentSelection?: Array<{ equipmentId: string; quantity?: number }>;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const { mode, sport, courtConfigId, date, hours, slots, equipmentSelection } = body;

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
      const resolvedSport = await sportForCourtConfigId(courtConfigId);
      logBookingLock(
        request,
        user.id,
        "error",
        {
          mode: "bowling-machine",
          courtConfigId,
          date,
          sport: resolvedSport,
          slots: slots.length,
        },
        "Slots no longer available",
      );
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
    if (result.success && result.holdId) {
      const eq = await applyEquipmentToFreshHold(
        result.holdId,
        equipmentSelection,
        slots.length,
      );
      const resolvedSport = await sportForCourtConfigId(courtConfigId);
      logBookingLock(request, user.id, "success", {
        mode: "bowling-machine",
        holdId: result.holdId,
        courtConfigId,
        date,
        sport: resolvedSport,
        slotCount: slots.length,
        equipmentApplied: eq.applied,
      });
      return NextResponse.json({ ...result, equipmentApplied: eq.applied });
    }
    const resolvedSport = await sportForCourtConfigId(courtConfigId);
    logBookingLock(
      request,
      user.id,
      "error",
      { mode: "bowling-machine", courtConfigId, date, sport: resolvedSport },
      result.error,
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
    if (result.success && result.holdId) {
      const eq = await applyEquipmentToFreshHold(
        result.holdId,
        equipmentSelection,
        hours.length,
      );
      logBookingLock(request, user.id, "success", {
        mode: "medium",
        holdId: result.holdId,
        sport,
        date,
        slotCount: hours.length,
        equipmentApplied: eq.applied,
      });
      return NextResponse.json({ ...result, equipmentApplied: eq.applied });
    }
    logBookingLock(
      request,
      user.id,
      "error",
      { mode: "medium", sport, date },
      result.error,
    );
    return NextResponse.json(result);
  }

  if (!courtConfigId) {
    return NextResponse.json({ error: "courtConfigId is required" }, { status: 400 });
  }

  const resolvedSport = await sportForCourtConfigId(courtConfigId);
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
    slotPrices,
    // Stamp the app on the hold. This request is the last point in the
    // journey that knows: the payment callback arrives from PhonePe's
    // servers and the Razorpay webhook from theirs.
    resolveRequestPlatform(request),
  );

  if (result.success && result.holdId) {
    const eq = await applyEquipmentToFreshHold(
      result.holdId,
      equipmentSelection,
      hours.length,
    );
    logBookingLock(request, user.id, "success", {
      mode: mode ?? "default",
      holdId: result.holdId,
      courtConfigId,
      date,
      sport: resolvedSport,
      slotCount: hours.length,
      equipmentApplied: eq.applied,
    });
    return NextResponse.json({ ...result, equipmentApplied: eq.applied });
  }

  logBookingLock(
    request,
    user.id,
    "error",
    { mode: mode ?? "default", courtConfigId, date, sport: resolvedSport },
    result.error,
  );
  return NextResponse.json(result);
}
