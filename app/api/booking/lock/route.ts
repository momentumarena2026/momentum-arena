import { NextRequest, NextResponse } from "next/server";
import { getAuthUserId } from "@/lib/auth-unified";
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
 * Snapshot the customer's equipment picks onto the just-created hold,
 * if any were sent through the lock request.
 *
 * Soft-fail: a snapshot failure (item disabled mid-flow, malformed
 * payload) is logged but does NOT release the hold. The slots are
 * the valuable resource (5-min TTL); the customer can still re-pick
 * gear from the checkout page if needed. Returning `equipmentApplied`
 * in the response lets the client surface a one-time toast if it
 * cares to.
 */
async function applyEquipmentToFreshHold(
  holdId: string,
  rawPicks: unknown,
  slotCount: number,
): Promise<{ applied: boolean; error?: string }> {
  if (!rawPicks) return { applied: true };
  let picks: Array<{ equipmentId: string; quantity: number }>;
  try {
    const parsed = typeof rawPicks === "string" ? JSON.parse(rawPicks) : rawPicks;
    picks = (parsed as Array<{ equipmentId: string; quantity?: number }>)
      .filter((p) => p && typeof p.equipmentId === "string")
      .map((p) => ({
        equipmentId: p.equipmentId,
        quantity: typeof p.quantity === "number" && p.quantity > 0 ? p.quantity : 1,
      }));
  } catch {
    return { applied: false, error: "Invalid equipment payload" };
  }
  if (picks.length === 0) return { applied: true };

  const snap = await snapshotEquipmentForHold(picks, slotCount);
  if (!snap.ok) {
    console.warn("[lock] equipment snapshot failed for hold", holdId, snap.error);
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
    console.warn("[lock] equipment update failed for hold", holdId, err);
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

  // Bowling-machine mode uses a different input shape — a JSON array
  // of {hour, minute} objects, not a flat hours[]. Handle it first
  // so we don't try to JSON.parse the wrong field.
  if (mode === "bowling-machine") {
    const courtConfigId = formData.get("courtConfigId") as string;
    if (!courtConfigId || !date) {
      return NextResponse.json({ error: "Invalid data" }, { status: 400 });
    }
    let picks: Array<{ hour: number; minute: 0 | 30 }>;
    try {
      picks = JSON.parse(formData.get("slots") as string);
    } catch {
      return NextResponse.json({ error: "Invalid slots" }, { status: 400 });
    }
    if (!picks?.length) {
      return NextResponse.json({ error: "Invalid data" }, { status: 400 });
    }

    // Re-derive prices + statuses server-side from
    // getBowlingMachineAvailability so:
    //   (a) the client can't smuggle a cheaper price into the hold
    //   (b) a stale picker can't lock a slot that's now past in IST,
    //       blocked by an admin SlotBlock, booked on the overlapping
    //       turf zones, or otherwise non-bookable.
    // getBowlingMachineAvailability stamps `status` using IST-aware
    // now-hour / now-minute (see lib/bowling-availability.ts), so this
    // double-check inherits the correct timezone.
    const avail = await getBowlingMachineAvailability(courtConfigId, new Date(date));
    const lookup = new Map(
      avail.map((s) => [`${s.hour}:${s.minute}`, s] as const),
    );

    const unavailable: string[] = [];
    for (const p of picks) {
      const entry = lookup.get(`${p.hour}:${p.minute}`);
      if (!entry || entry.status !== "available") {
        unavailable.push(`${p.hour}:${p.minute}`);
      }
    }
    if (unavailable.length > 0) {
      const resolvedSport = await sportForCourtConfigId(courtConfigId);
      logBookingLock(
        request,
        userId,
        "error",
        {
          mode: "bowling-machine",
          courtConfigId,
          date,
          sport: resolvedSport,
          slots: picks.length,
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

    const slotPrices: BowlingSlotPrice[] = picks.map((p) => ({
      hour: p.hour,
      minute: p.minute,
      price: lookup.get(`${p.hour}:${p.minute}`)!.price,
    }));

    const result = await createBowlingMachineHold(
      userId,
      courtConfigId,
      new Date(date),
      slotPrices,
    );
    if (result.success && result.holdId) {
      const eq = await applyEquipmentToFreshHold(
        result.holdId,
        formData.get("equipmentSelection"),
        picks.length,
      );
      const resolvedSport = await sportForCourtConfigId(courtConfigId);
      logBookingLock(request, userId, "success", {
        mode: "bowling-machine",
        holdId: result.holdId,
        courtConfigId,
        date,
        sport: resolvedSport,
        slotCount: picks.length,
        equipmentApplied: eq.applied,
      });
      return NextResponse.json({ ...result, equipmentApplied: eq.applied });
    }
    const resolvedSport = await sportForCourtConfigId(courtConfigId);
    logBookingLock(
      request,
      userId,
      "error",
      { mode: "bowling-machine", courtConfigId, date, sport: resolvedSport },
      result.error,
    );
    return NextResponse.json(result);
  }

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
    if (result.success && result.holdId) {
      const eq = await applyEquipmentToFreshHold(
        result.holdId,
        formData.get("equipmentSelection"),
        hours.length,
      );
      logBookingLock(request, userId, "success", {
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
      userId,
      "error",
      { mode: "medium", sport, date },
      result.error,
    );
    return NextResponse.json(result);
  }

  const courtConfigId = formData.get("courtConfigId") as string;
  if (!courtConfigId) {
    return NextResponse.json({ error: "Invalid data" }, { status: 400 });
  }

  const resolvedSport = await sportForCourtConfigId(courtConfigId);
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

  if (result.success && result.holdId) {
    const eq = await applyEquipmentToFreshHold(
      result.holdId,
      formData.get("equipmentSelection"),
      hours.length,
    );
    logBookingLock(request, userId, "success", {
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
    userId,
    "error",
    { mode: mode ?? "default", courtConfigId, date, sport: resolvedSport },
    result.error,
  );
  return NextResponse.json(result);
}
