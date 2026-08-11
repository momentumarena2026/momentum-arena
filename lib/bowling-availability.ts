import { BookingCategory, CourtZone, DayType } from "@prisma/client";
import { db } from "./db";
import { OCCUPYING_BOOKING_STATUSES, type LockKind } from "./availability";
import {
  getCurrentHourIST,
  getCurrentMinuteIST,
  getTodayIST,
} from "./ist-date";

/**
 * Half-hour-granular availability + pricing for the bowling-machine
 * court. Lives parallel to the hour-granular helpers in
 * `lib/availability.ts` rather than refactoring that file — every
 * existing cricket / football call site stays on the hour API, only
 * the bowling-machine surface uses this one.
 *
 * Slot key shape across the file:
 *   - `hour`   ∈ 0..24
 *   - `minute` ∈ 0 | 30
 *   - duration is always 30 minutes; the customer multi-selects
 *     consecutive 30-min entries to compose longer sessions.
 */

export type SlotStatus = "available" | "booked" | "locked" | "blocked" | "closed";

export interface BowlingSlot {
  hour: number;
  minute: number;
  status: SlotStatus;
  price: number; // rupees per 30-min slot
  /** See LockKind in lib/availability.ts — same two meanings. */
  lockKind?: LockKind;
  /** ISO expiry of the checkout hold; only with lockKind "checkout". */
  lockedUntil?: string;
}

/**
 * Build the canonical list of 30-min slot keys for a single day,
 * driven by the `OperatingWindow` rows attached to the bowling court.
 * Empty list = closed that day-type (caller still gets a valid array
 * back so the UI can render a friendly "no slots today" message).
 */
async function buildSlotKeysForDate(
  courtConfigId: string,
  date: Date,
): Promise<Array<{ hour: number; minute: number }>> {
  // IST weekend check — same convention as `isWeekend` in court-config.ts.
  // The booking schema stores dates as @db.Date (UTC midnight), so a
  // direct getUTCDay() is correct for the calendar weekday.
  const day = date.getUTCDay();
  const isWeekend = day === 0 || day === 6;
  const dayType: DayType = isWeekend ? "WEEKEND" : "WEEKDAY";

  const windows = await db.operatingWindow.findMany({
    where: { courtConfigId, dayType },
    orderBy: [{ sortOrder: "asc" }, { startHour: "asc" }],
  });

  const slots: Array<{ hour: number; minute: number }> = [];
  for (const w of windows) {
    let h = w.startHour;
    let m = w.startMinute;
    while (h < w.endHour || (h === w.endHour && m < w.endMinute)) {
      slots.push({ hour: h, minute: m });
      // Advance by 30 minutes.
      if (m === 0) {
        m = 30;
      } else {
        m = 0;
        h += 1;
      }
    }
  }
  return slots;
}

/**
 * Returns one entry per 30-min slot for the bowling-machine court on
 * `date`, with availability + price. Slots outside any operating
 * window are simply not emitted (the UI doesn't need to render them
 * as greyed-out blocks; the time picker only shows real slots).
 *
 * `adminOverride: true` opens up the time-window guards so admin can
 * book a session at any hour of the day:
 *   - Emits all 48 half-hour slots (00:00 → 23:30) instead of only
 *     the OperatingWindow rows.
 *   - Skips the past-time "closed" marker — admin can record a
 *     session that already happened.
 * It does NOT bypass the conflict / hold / slot-block checks; those
 * protect against actually double-booking the physical pitch and the
 * shared zones, which still matters from the admin side.
 */
export async function getBowlingMachineAvailability(
  courtConfigId: string,
  date: Date,
  // Optional admin-edit hook — drop this booking from the "occupied"
  // calculation so its existing slots show as available again. Used
  // by the admin edit-slots flow so the current slots stay selectable
  // when the admin reopens the modal.
  excludeBookingId?: string,
  options?: { adminOverride?: boolean },
): Promise<BowlingSlot[]> {
  const adminOverride = options?.adminOverride === true;
  const config = await db.courtConfig.findUnique({
    where: { id: courtConfigId },
  });
  if (!config) throw new Error("Court config not found");

  const dateOnly = new Date(date.toISOString().split("T")[0]);
  const now = new Date();

  // When admin overrides, ignore the OperatingWindow rows entirely
  // and emit a flat 48-slot list from midnight to midnight. The
  // customer-facing call still respects the operating windows so
  // the customer picker only shows slots staff have configured.
  const allSlots: Array<{ hour: number; minute: number }> = adminOverride
    ? Array.from({ length: 48 }, (_, i) => ({
        hour: Math.floor(i / 2),
        minute: i % 2 === 0 ? 0 : 30,
      }))
    : await buildSlotKeysForDate(courtConfigId, dateOnly);
  if (allSlots.length === 0) return [];

  // ── Bookings that occupy any slot via zone overlap ─────────────
  const conflictingBookings = await db.booking.findMany({
    where: {
      date: dateOnly,
      status: { in: [...OCCUPYING_BOOKING_STATUSES] },
      courtConfig: {
        zones: { hasSome: config.zones as CourtZone[] },
      },
      ...(excludeBookingId ? { id: { not: excludeBookingId } } : {}),
    },
    include: { slots: true },
  });

  // Map from "hour:minute" → status. Hour-granular bookings on the
  // overlapping half block BOTH 30-min slots of that hour (since the
  // physical pitch is taken for the full 60 minutes); half-hour
  // bookings (the bowling court itself) only block the matched slot.
  const occupied = new Map<string, SlotStatus>();
  function set(key: string, status: SlotStatus) {
    // "booked" beats "locked"; preserve stricter.
    const existing = occupied.get(key);
    if (existing === "booked") return;
    if (existing === "locked" && status === "locked") return;
    occupied.set(key, status);
  }
  function keyOf(h: number, m: number) {
    return `${h}:${m}`;
  }

  /** Keys held by a booking awaiting manual payment verification. */
  const verifyingKeys = new Set<string>();
  for (const booking of conflictingBookings) {
    // Only PENDING is provisional; CONFIRMED and the closed-out
    // COMPLETED / ABSENT sessions are firmly "booked".
    const status = booking.status === "PENDING" ? "locked" : "booked";
    const markVerifying = (key: string) => {
      if (status === "locked") verifyingKeys.add(key);
    };
    for (const s of booking.slots) {
      if (s.durationMinutes === 30) {
        set(keyOf(s.startHour, s.startMinute), status);
        markVerifying(keyOf(s.startHour, s.startMinute));
      } else {
        // 60-min booking → blocks both halves of the hour
        set(keyOf(s.startHour, 0), status);
        set(keyOf(s.startHour, 30), status);
        markVerifying(keyOf(s.startHour, 0));
        markVerifying(keyOf(s.startHour, 30));
      }
    }
  }

  // ── In-flight slot holds ───────────────────────────────────────
  const activeHolds = await db.slotHold.findMany({
    where: {
      date: dateOnly,
      expiresAt: { gt: now },
      courtConfig: {
        zones: { hasSome: config.zones as CourtZone[] },
      },
    },
  });
  /** Key → when the LAST hold covering it lapses (epoch ms). */
  const holdExpiryByKey = new Map<string, number>();
  // Latest expiry wins — the slot isn't free again until every hold on
  // it is gone, so counting down to the first would flip the tile back
  // to bookable while someone else is still paying.
  const noteExpiry = (key: string, at: Date) => {
    holdExpiryByKey.set(key, Math.max(holdExpiryByKey.get(key) ?? 0, at.getTime()));
  };
  for (const hold of activeHolds) {
    // hold.hours[i] paired with hold.startMinutes[i] (or 0 when the
    // parallel array is empty, i.e. a legacy 60-min hold).
    for (let i = 0; i < hold.hours.length; i++) {
      const h = hold.hours[i];
      const m = hold.startMinutes[i] ?? 0;
      // If startMinutes is empty, it's a 60-min hold blocking both halves.
      if (hold.startMinutes.length === 0) {
        set(keyOf(h, 0), "locked");
        set(keyOf(h, 30), "locked");
        noteExpiry(keyOf(h, 0), hold.expiresAt);
        noteExpiry(keyOf(h, 30), hold.expiresAt);
      } else {
        set(keyOf(h, m), "locked");
        noteExpiry(keyOf(h, m), hold.expiresAt);
      }
    }
  }

  /** Same precedence rule as lib/availability.ts: verification outranks a hold. */
  function lockFieldsFor(
    key: string,
    status: SlotStatus,
  ): { lockKind?: LockKind; lockedUntil?: string } {
    if (status !== "locked") return {};
    if (verifyingKeys.has(key)) return { lockKind: "verification" };
    const until = holdExpiryByKey.get(key);
    if (until === undefined) return {};
    return { lockKind: "checkout", lockedUntil: new Date(until).toISOString() };
  }

  // ── Admin slot blocks ──────────────────────────────────────────
  const slotBlocks = await db.slotBlock.findMany({
    where: {
      date: dateOnly,
      OR: [
        { courtConfigId },
        { sport: config.sport },
        { courtConfigId: null, sport: null },
      ],
    },
  });
  const blockedKeys = new Set<string>();
  for (const block of slotBlocks) {
    if (block.startHour === null) {
      // Whole day blocked
      for (const s of allSlots) blockedKeys.add(keyOf(s.hour, s.minute));
    } else if (block.startMinute === 30) {
      blockedKeys.add(keyOf(block.startHour, 30));
    } else {
      // 0 = block whole hour (both halves)
      blockedKeys.add(keyOf(block.startHour, 0));
      blockedKeys.add(keyOf(block.startHour, 30));
    }
  }

  // ── Pricing — flat per-slot ₹ pulled from PricingRule ──────────
  // Bowling-machine PricingRule rows are seeded as ₹250 per slot
  // (same value across WEEKDAY/WEEKEND × PEAK/OFF_PEAK) so a single
  // findFirst is enough. Falls back to 250 if the row is missing.
  const dayType: DayType =
    [0, 6].includes(dateOnly.getUTCDay()) ? "WEEKEND" : "WEEKDAY";
  const priceRule = await db.pricingRule.findFirst({
    where: {
      courtConfigId,
      dayType,
    },
    orderBy: { pricePerSlot: "asc" }, // ties on weekday/weekend; pick off-peak by default
  });
  const slotPrice = priceRule?.pricePerSlot ?? 250;

  // Past-time guard for today only — same logic the hour grid uses,
  // but in IST. `today.getHours()` returns the SERVER local time which
  // is UTC on Vercel, so at 7:13 PM IST the bowling picker was leaving
  // 2 PM IST onwards "available" because UTC nowHour=13 only closed
  // slots whose hour was < 13 in the (mistakenly UTC-based) check.
  // Booking.date is stored as UTC midnight of the IST calendar day, so
  // the `isToday` comparison also needs to match against IST's today,
  // not UTC's today (off-by-one between 18:30 UTC and 00:00 UTC).
  const istTodayStr = getTodayIST(); // "YYYY-MM-DD" in IST
  const requestedStr = dateOnly.toISOString().split("T")[0];
  const isToday = requestedStr === istTodayStr;
  const nowHour = getCurrentHourIST();
  const nowMin = getCurrentMinuteIST();

  // ── Night-hour rollover ────────────────────────────────────────────
  // Night hours (typically 6 PM → midnight at this venue) are excluded
  // from the bowling-machine OperatingWindow because they're reserved
  // for cricket / football turf bookings on the shared zones. But the
  // moment the wall clock crosses an hour boundary, if nobody booked
  // the turf for that hour, the second half of the hour is dead weight
  // — nobody's playing on it. Open it up as a 30-min bowling slot.
  //
  // Conditions for emitting the synthetic (H, 30) slot:
  //   1. Today's view (rollover is purely a real-time release).
  //   2. The clock is in the first half of hour H (nowMin < 30) so the
  //      slot's start time (H:30) is still in the future.
  //   3. (H, 30) isn't already a regular operating-window slot
  //      (otherwise the normal flow has already emitted it).
  //   4. Hour H is not occupied by any conflicting booking, hold, or
  //      admin SlotBlock on the overlapping zones — uses the same
  //      `occupied` / `blockedKeys` maps the regular flow built above,
  //      so half-court bookings on the non-overlapping half don't
  //      block (zone-overlap check) — exactly the case the user
  //      called out ("if half is booked and other half is empty,
  //      still open the bowling slot").
  //
  // If the turf gets booked between rollover and slot-start, the next
  // request sees the new booking in `occupied` and stops emitting the
  // rollover. Customers already mid-checkout are protected by the
  // verifyBowlingHoldStillBookable guard at payment-init time.
  if (isToday && nowMin < 30) {
    const H = nowHour;
    const rolloverKey = keyOf(H, 30);
    const alreadyEmitted = allSlots.some(
      (s) => s.hour === H && s.minute === 30,
    );
    if (!alreadyEmitted) {
      const hourIsOccupied =
        occupied.has(keyOf(H, 0)) || occupied.has(rolloverKey);
      const hourIsBlocked =
        blockedKeys.has(keyOf(H, 0)) || blockedKeys.has(rolloverKey);
      if (!hourIsOccupied && !hourIsBlocked) {
        allSlots.push({ hour: H, minute: 30 });
      }
    }
  }

  return allSlots.map(({ hour, minute }) => {
    const key = keyOf(hour, minute);
    let status: SlotStatus = "available";
    if (blockedKeys.has(key)) status = "blocked";
    else {
      const occ = occupied.get(key);
      if (occ) status = occ;
    }
    // Hide past slots on today. Admin override skips this guard
    // entirely so staff can log a session that already started or
    // happened earlier in the day.
    if (isToday && !adminOverride) {
      if (hour < nowHour || (hour === nowHour && minute <= nowMin)) {
        status = "closed";
      }
    }
    return {
      hour,
      minute,
      status,
      price: slotPrice,
      ...lockFieldsFor(key, status),
    };
  });
}

/**
 * Re-check that an in-flight bowling-machine hold can still be booked.
 *
 * `createBowlingMachineHold` already conflict-checks against existing
 * bookings + holds at lock time, but admin overrides (or any future
 * code path that bypasses the hold-conflict check during booking
 * creation) could theoretically land a turf booking on the shared
 * zones AFTER the customer locked their bowling slot. Without this
 * check, the customer would proceed to payment and we'd end up either
 * (a) double-booking the physical pitch, or (b) charging them for a
 * slot we silently dropped at createBookingFromHold time.
 *
 * Called from every payment-init path (Razorpay create-order, PhonePe
 * initiate, mobile counterparts, cash flow) BEFORE money moves. A
 * matching defense-in-depth check also lives inside
 * createBookingFromHold for the rare race where a conflict appears
 * between payment-init and payment-completion.
 *
 * For non-bowling holds this is a no-op (`{ ok: true }`) so callers
 * can call it unconditionally without branching on category.
 */
export async function verifyBowlingHoldStillBookable(
  holdId: string,
): Promise<{ ok: true } | { ok: false; reason: string; conflicts: string[] }> {
  const hold = await db.slotHold.findUnique({
    where: { id: holdId },
    include: { courtConfig: true },
  });
  if (!hold) {
    return { ok: false, reason: "Hold not found", conflicts: [] };
  }
  if (hold.courtConfig.category !== ("BOWLING_MACHINE" as BookingCategory)) {
    // Hour-granular sports use a different lock + booking path; the
    // standard zone-overlap check at createBookingFromHold time is
    // enough for them.
    return { ok: true };
  }

  const dateOnly = new Date(hold.date.toISOString().split("T")[0]);
  const config = hold.courtConfig;

  // Bookings on overlapping zones — same shape the lock + availability
  // paths use so the rule is consistent end-to-end.
  const conflictingBookings = await db.booking.findMany({
    where: {
      date: dateOnly,
      status: { in: [...OCCUPYING_BOOKING_STATUSES] },
      courtConfig: {
        zones: { hasSome: config.zones as CourtZone[] },
      },
    },
    include: { slots: true },
  });

  // The held bowling slots as "hour:minute" keys.
  const requested = new Set(
    hold.hours.map(
      (h, i) => `${h}:${hold.startMinutes[i] ?? 0}`,
    ),
  );

  const conflicts: string[] = [];
  for (const b of conflictingBookings) {
    for (const s of b.slots) {
      if (s.durationMinutes === 30) {
        const key = `${s.startHour}:${s.startMinute}`;
        if (requested.has(key)) conflicts.push(key);
      } else {
        // 60-min turf booking blocks BOTH halves of that hour
        const k0 = `${s.startHour}:0`;
        const k1 = `${s.startHour}:30`;
        if (requested.has(k0)) conflicts.push(k0);
        if (requested.has(k1)) conflicts.push(k1);
      }
    }
  }

  if (conflicts.length > 0) {
    return {
      ok: false,
      reason:
        "Some of the bowling-machine slots in your hold have been booked on the shared pitch. Pick fresh slots and try again.",
      conflicts,
    };
  }
  return { ok: true };
}

