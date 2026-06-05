import { CourtZone, Sport, BookingCategory } from "@prisma/client";
import { db } from "./db";
import { getAllSlotHours, isWeekend } from "./court-config";
import { getTodayIST, getCurrentHourIST } from "./ist-date";

export type SlotStatus = "available" | "booked" | "locked" | "blocked";

/**
 * Lightweight snapshot of a court config used in `blockedReason`.
 * Carries just enough for the customer-facing tile + alternatives
 * sheet to render labels ("Right half booked" / "Switch to Half
 * Left") without an extra fetch. `category` lets the UI distinguish
 * a regular box-cricket blocker ("Half court booked") from a
 * bowling-machine blocker ("Bowling busy") without coupling to
 * specific config names.
 */
export interface BlockingConfig {
  configId: string;
  label: string;
  size: string;
  position: string;
  category: BookingCategory | null;
}

/**
 * Why a particular hour isn't bookable on this court config, plus
 * which sibling configs of the same sport+category are STILL free
 * at that hour so the UI can offer a one-tap pivot.
 *
 * Populated only for hours whose `status` is "booked" or "locked"
 * — for "blocked" (past time / admin block) the alternatives logic
 * doesn't apply because admin blocks are typically sport-wide.
 *
 * Both arrays are sorted desc by size so the biggest available
 * alternative — usually the most "equivalent" to what the user
 * asked for — appears first.
 */
export interface BlockedReason {
  blockedBy: BlockingConfig[];
  alternativesAtThisHour: BlockingConfig[];
}

export interface SlotAvailability {
  hour: number;
  status: SlotStatus;
  price: number; // in rupees
  blockedReason?: BlockedReason;
  /**
   * Canonical storage coordinates this displayed slot maps to. Set
   * only by `getDisplayShiftedAvailability` for the late-night
   * 12am-1am tile that's been shifted onto the next calendar
   * date's grid — for that slot, `lockDate` is the prior date and
   * `lockHour` is 24 (the legacy storage convention). Every other
   * slot omits these fields and locks against the request date /
   * `hour` directly.
   *
   * Booking-flow clients (web slot-selection-client, mobile
   * BookSlotsScreen) MUST forward `lockDate` to /api/booking/lock
   * when present — otherwise the resulting booking would be
   * recorded on the wrong calendar date.
   */
  lockDate?: string; // "YYYY-MM-DD"
  lockHour?: number;
}

// Severity ordering for ConfigSize → used to sort blockedBy /
// alternatives so the FULL court appears above MEDIUM appears
// above XS. Keeps the alternatives sheet stable and predictable.
const SIZE_ORDER: Record<string, number> = {
  FULL: 0,
  LARGE: 1,
  MEDIUM: 2,
  XS: 3,
};
function sizeRank(size: string): number {
  return SIZE_ORDER[size] ?? 99;
}

// Get availability for all slots on a given date for a specific court config
export async function getSlotAvailability(
  courtConfigId: string,
  date: Date
): Promise<SlotAvailability[]> {
  const config = await db.courtConfig.findUnique({
    where: { id: courtConfigId },
  });
  if (!config) throw new Error("Court config not found");

  const dateOnly = new Date(date.toISOString().split("T")[0]);
  const now = new Date();

  // 1. Bookings that reserve the slot: CONFIRMED (paid) or PENDING (awaiting admin verification)
  const conflictingBookings = await db.booking.findMany({
    where: {
      date: dateOnly,
      status: { in: ["CONFIRMED", "PENDING"] },
      courtConfig: {
        zones: { hasSome: config.zones as CourtZone[] },
      },
    },
    include: {
      courtConfig: true,
      slots: true,
    },
  });

  // Build set of occupied hours
  const occupiedHours = new Map<number, SlotStatus>();
  for (const booking of conflictingBookings) {
    for (const slot of booking.slots) {
      occupiedHours.set(
        slot.startHour,
        booking.status === "CONFIRMED" ? "booked" : "locked"
      );
    }
  }

  // 2. Transient SlotHolds — another user is currently in checkout for this slot
  // Include the hold's courtConfig so we can surface "what's blocking
  // this hour?" labels for in-flight holds, not just confirmed bookings.
  const activeHolds = await db.slotHold.findMany({
    where: {
      date: dateOnly,
      expiresAt: { gt: now },
      courtConfig: {
        zones: { hasSome: config.zones as CourtZone[] },
      },
    },
    include: { courtConfig: true },
  });
  for (const hold of activeHolds) {
    for (const hour of hold.hours) {
      // Holds shouldn't override "booked" (stricter) status
      if (!occupiedHours.has(hour)) {
        occupiedHours.set(hour, "locked");
      }
    }
  }

  // Check admin slot blocks
  const slotBlocks = await db.slotBlock.findMany({
    where: {
      date: dateOnly,
      OR: [
        { courtConfigId: courtConfigId },
        { sport: config.sport },
        { courtConfigId: null, sport: null }, // global blocks
      ],
    },
  });

  const blockedHours = new Set<number>();
  for (const block of slotBlocks) {
    if (block.startHour === null) {
      // Entire day blocked
      getAllSlotHours().forEach((h) => blockedHours.add(h));
    } else {
      blockedHours.add(block.startHour);
    }
  }

  // Also check if any overlapping configs have zone-level blocks
  // by checking blocks on configs that share zones
  const overlappingConfigBlocks = await db.slotBlock.findMany({
    where: {
      date: dateOnly,
      courtConfigId: { not: null },
      courtConfig: {
        zones: { hasSome: config.zones },
      },
    },
  });
  for (const block of overlappingConfigBlocks) {
    if (block.startHour === null) {
      getAllSlotHours().forEach((h) => blockedHours.add(h));
    } else {
      blockedHours.add(block.startHour);
    }
  }

  // Get pricing for this config
  const prices = await getSlotPrices(courtConfigId, date);

  // Check if the requested date is today or in the past (IST)
  const todayIST = getTodayIST();
  const dateStr = dateOnly.toISOString().split("T")[0];
  const isToday = dateStr === todayIST;
  const isPastDate = dateStr < todayIST;
  const currentHour = getCurrentHourIST();

  // ------------------------------------------------------------------
  // Build the per-hour "what's blocking?" + "what's still bookable?"
  // index that drives the customer-facing "Right half booked → try
  // Left half" UX. All the data already came back in the queries
  // above; we're just re-indexing it by hour and deriving the
  // alternatives set.
  //
  // We do this once per request, then `blockedReason` for each
  // returned hour is a constant-time lookup.
  // ------------------------------------------------------------------

  // Hour → blockedBy configs (booking AND hold sources merged).
  // Map-of-Map dedupes when the same sibling config blocks the
  // hour twice (e.g. two simultaneous holds on the same court).
  const blockersByHour = new Map<number, Map<string, BlockingConfig>>();
  // Hour → union of all zones that are spoken-for by the blockers
  // above. Used to decide which sibling configs are still bookable
  // (a sibling is bookable iff none of its zones are in this set).
  const blockedZonesByHour = new Map<number, Set<CourtZone>>();

  function recordBlocker(
    hour: number,
    cfg: {
      id: string;
      label: string;
      size: string;
      position: string;
      category: BookingCategory | null;
      zones: CourtZone[];
    },
  ) {
    if (!blockersByHour.has(hour)) blockersByHour.set(hour, new Map());
    blockersByHour.get(hour)!.set(cfg.id, {
      configId: cfg.id,
      label: cfg.label,
      size: cfg.size,
      position: cfg.position,
      category: cfg.category,
    });
    if (!blockedZonesByHour.has(hour))
      blockedZonesByHour.set(hour, new Set());
    for (const z of cfg.zones) blockedZonesByHour.get(hour)!.add(z);
  }

  for (const booking of conflictingBookings) {
    for (const slot of booking.slots) {
      recordBlocker(slot.startHour, booking.courtConfig);
    }
  }
  for (const hold of activeHolds) {
    for (const hour of hold.hours) {
      recordBlocker(hour, hold.courtConfig);
    }
  }

  // Fetch sibling configs of the same sport + category — these are
  // the ones we offer as alternatives. We filter to the same
  // `category` so a customer who picked Box-Cricket Full Field
  // doesn't get suggested the Bowling Machine (different category,
  // same sport) as a fall-back when their slot is booked. Includes
  // self only to avoid an extra exclude clause; we'll skip it during
  // the per-hour filter.
  const siblingConfigs = await db.courtConfig.findMany({
    where: {
      sport: config.sport,
      category: config.category,
      isActive: true,
      id: { not: courtConfigId },
    },
    select: {
      id: true,
      label: true,
      size: true,
      position: true,
      category: true,
      zones: true,
    },
  });

  // Per-sibling admin blocks. We already have sport-wide blocks in
  // `blockedHours`; this one indexes hours blocked at the
  // courtConfig level so we don't surface a sibling whose admin
  // explicitly blocked the hour, even if its zones look free.
  const siblingAdminBlocks = await db.slotBlock.findMany({
    where: {
      date: dateOnly,
      courtConfigId: { in: siblingConfigs.map((c) => c.id) },
    },
    select: { courtConfigId: true, startHour: true },
  });
  const blocksPerSibling = new Map<string, Set<number>>();
  for (const block of siblingAdminBlocks) {
    if (!block.courtConfigId) continue;
    if (!blocksPerSibling.has(block.courtConfigId))
      blocksPerSibling.set(block.courtConfigId, new Set());
    if (block.startHour === null) {
      getAllSlotHours().forEach((h) =>
        blocksPerSibling.get(block.courtConfigId!)!.add(h),
      );
    } else {
      blocksPerSibling.get(block.courtConfigId!)!.add(block.startHour);
    }
  }

  function alternativesForHour(hour: number): BlockingConfig[] {
    const blockedZones = blockedZonesByHour.get(hour);
    if (!blockedZones) return [];
    const out: BlockingConfig[] = [];
    for (const sib of siblingConfigs) {
      // If any of the sibling's zones is already blocked at this
      // hour, the sibling itself can't be booked.
      if (sib.zones.some((z) => blockedZones.has(z))) continue;
      // Sport-wide admin block hits every sibling too.
      if (blockedHours.has(hour)) continue;
      // Sibling-specific admin block.
      if (blocksPerSibling.get(sib.id)?.has(hour)) continue;
      out.push({
        configId: sib.id,
        label: sib.label,
        size: sib.size,
        position: sib.position,
        category: sib.category,
      });
    }
    // Biggest size first so the user's most-equivalent option is at
    // the top of the alternatives sheet.
    out.sort((a, b) => sizeRank(a.size) - sizeRank(b.size));
    return out;
  }

  function blockedByForHour(hour: number): BlockingConfig[] {
    const m = blockersByHour.get(hour);
    if (!m) return [];
    return Array.from(m.values()).sort(
      (a, b) => sizeRank(a.size) - sizeRank(b.size),
    );
  }

  // Build availability array
  const hours = getAllSlotHours();
  const inWindow = new Set(hours);
  const result: SlotAvailability[] = hours.map((hour) => {
    let status: SlotStatus = "available";

    // Block all hours on past dates, and past hours on today's date.
    if (isPastDate || (isToday && hour <= currentHour)) {
      status = "blocked";
    } else if (blockedHours.has(hour)) {
      status = "blocked";
    } else if (occupiedHours.has(hour)) {
      status = occupiedHours.get(hour)!;
    }

    // Only attach a blockedReason when the slot is occupied by
    // another customer's booking/hold — for admin/past blocks
    // there's no "alternative" worth surfacing (the entire sport is
    // typically closed).
    const blockedReason: BlockedReason | undefined =
      status === "booked" || status === "locked"
        ? {
            blockedBy: blockedByForHour(hour),
            alternativesAtThisHour: alternativesForHour(hour),
          }
        : undefined;

    return {
      hour,
      status,
      price: prices.get(hour) ?? 0,
      blockedReason,
    };
  });

  // Surface out-of-window occupied/blocked hours so the display
  // layer can pick them up. The admin /admin/bookings/create flow
  // iterates 0..23 (wall-clock), so a 12am-2am admin booking on
  // date X lands as BookingSlot rows with startHour ∈ {0, 1} on
  // date X — outside the customer-facing operating window (5..24).
  // Without this, those slots are invisible to getSlotAvailability
  // and the customer's grid (via getDisplayShiftedAvailability)
  // shows them as bookable when they're really taken.
  //
  // Result rows here are never "available" — we never invent
  // bookable slots outside the operating window. They exist purely
  // so a downstream display layer can mark the matching cell as
  // booked / locked / blocked.
  const allOutOfWindow = new Set<number>([
    ...occupiedHours.keys(),
    ...blockedHours,
  ]);
  for (const hour of allOutOfWindow) {
    if (inWindow.has(hour)) continue;
    let status: SlotStatus = "available";
    if (blockedHours.has(hour)) status = "blocked";
    else if (occupiedHours.has(hour)) status = occupiedHours.get(hour)!;
    if (status === "available") continue; // shouldn't happen but defensive
    const blockedReason: BlockedReason | undefined =
      status === "booked" || status === "locked"
        ? {
            blockedBy: blockedByForHour(hour),
            alternativesAtThisHour: alternativesForHour(hour),
          }
        : undefined;
    result.push({
      hour,
      status,
      price: prices.get(hour) ?? 0,
      blockedReason,
    });
  }

  return result;
}

// Get prices for each hour slot based on pricing rules and time classifications
async function getSlotPrices(
  courtConfigId: string,
  date: Date
): Promise<Map<number, number>> {
  const dayType = isWeekend(date) ? "WEEKEND" : "WEEKDAY";

  // Get time classifications for this day type
  const classifications = await db.timeClassification.findMany({
    where: { dayType },
    orderBy: { startHour: "asc" },
  });

  // Get pricing rules for this config
  const pricingRules = await db.pricingRule.findMany({
    where: { courtConfigId },
  });

  const priceMap = new Map<number, number>();
  const hours = getAllSlotHours();

  for (const hour of hours) {
    // Find which time type this hour falls into
    let timeType: "PEAK" | "OFF_PEAK" = "OFF_PEAK";
    for (const c of classifications) {
      if (hour >= c.startHour && hour < c.endHour) {
        timeType = c.timeType;
        break;
      }
    }

    // Find matching pricing rule
    const rule = pricingRules.find(
      (r) => r.dayType === dayType && r.timeType === timeType
    );
    priceMap.set(hour, rule?.pricePerSlot ?? 0);
  }

  return priceMap;
}

// ---------------------------------------------------------------------------
// Half-court ("Medium") unified availability
// ---------------------------------------------------------------------------
// Customers book a single "Half Court (40×90)" tile that represents *either*
// the LEFT or RIGHT MEDIUM config. The underlying LEFT/RIGHT configs share no
// zones, so two different customers can book the same hour simultaneously —
// the venue assigns physical sides at game time. An hour is available to the
// customer as long as at least one half is free. Pricing is identical between
// LEFT and RIGHT by business rule; we expose LEFT's price as canonical.

export interface MediumConfigsPair {
  leftId: string;
  rightId: string;
}

/**
 * Look up the LEFT + RIGHT MEDIUM courtConfig ids for a sport. Throws if
 * either side is missing (currently only CRICKET has MEDIUM configs).
 */
export async function getMediumConfigs(
  sport: Sport
): Promise<MediumConfigsPair> {
  const configs = await db.courtConfig.findMany({
    where: { sport, size: "MEDIUM", isActive: true },
    select: { id: true, position: true },
  });
  const left = configs.find((c) => c.position === "LEFT");
  const right = configs.find((c) => c.position === "RIGHT");
  if (!left || !right) {
    throw new Error(`Half-court configs not found for sport ${sport}`);
  }
  return { leftId: left.id, rightId: right.id };
}

/**
 * Per-hour merged availability across LEFT + RIGHT halves.
 * - available: at least one half is available
 * - booked:    both halves occupied by a CONFIRMED booking/hold
 * - locked:    at least one half locked, the other not strictly free
 * - blocked:   both halves blocked (admin block, or past hour)
 * Price is taken from LEFT's pricing table (LEFT == RIGHT by business rule).
 */
export async function getMergedMediumAvailability(
  sport: Sport,
  date: Date
): Promise<SlotAvailability[]> {
  const { leftId, rightId } = await getMediumConfigs(sport);

  const [left, right] = await Promise.all([
    getSlotAvailability(leftId, date),
    getSlotAvailability(rightId, date),
  ]);

  // Severity ordering: available < locked < booked/blocked.
  // Hour is "available" if at least one side is available. Otherwise pick the
  // least-severe of the two sides so the customer sees the clearest signal.
  const severity: Record<SlotStatus, number> = {
    available: 0,
    locked: 1,
    booked: 2,
    blocked: 2,
  };

  // Iterate the UNION of left + right hours — getSlotAvailability
  // now surfaces out-of-window occupied hours (e.g. an admin late-
  // night session on one side). If we still only iterated `right`,
  // a hour-0 booking on the left half would silently drop.
  const leftByHour = new Map(left.map((s) => [s.hour, s]));
  const rightByHour = new Map(right.map((s) => [s.hour, s]));
  const allHours = new Set<number>([
    ...leftByHour.keys(),
    ...rightByHour.keys(),
  ]);
  return Array.from(allHours)
    .sort((a, b) => a - b)
    .map((hour) => {
      const l = leftByHour.get(hour);
      const r = rightByHour.get(hour);
      let status: SlotStatus;
      if (l?.status === "available" || r?.status === "available") {
        // At least one side bookable — customer sees it as available.
        status = "available";
      } else if (l && r) {
        status = severity[l.status] <= severity[r.status] ? l.status : r.status;
      } else {
        // Only one side has this hour surfaced (out-of-window slot
        // unique to that side). Use its status — the missing side
        // is by definition not bookable in the operating window
        // either, so we don't promote it to "available."
        status = (l ?? r)!.status;
      }
      return {
        hour,
        status,
        // Prices are equal between halves; fall back to whichever
        // side has a non-zero figure.
        price: l?.price || r?.price || 0,
      };
    });
}

// ---------------------------------------------------------------------------
// Display-shifted availability for customer-facing slot grids
// ---------------------------------------------------------------------------
//
// Storage convention: a booking at "12am-1am of Saturday" is written
// as `(date = Friday, BookingSlot.startHour = 24)` — the venue's
// session date, not the wall-clock date the hour actually falls on.
//
// That made the customer slot grid for Friday display the 12am tile
// at the bottom even though wall-clock-wise it's Saturday's earliest
// hour. This wrapper flips the display: the customer's Saturday grid
// surfaces the 12am-1am slot at the top, sourced from Friday's
// hour-24 storage; Friday's grid no longer shows it.
//
// Storage convention is unchanged — `lockDate` + `lockHour` on each
// returned slot tell the booking-flow client to send the request
// against the original session date so the resulting Booking row
// still writes `(date = Friday, startHour = 24)`. The customer never
// sees the session-date storage; they see the wall-clock display.

function ymd(d: Date): string {
  return d.toISOString().split("T")[0];
}

// Severity ordering for SlotStatus — used by the display-shifted
// wrappers to pick the worst status when two storage conventions
// collide on the same display cell (e.g. prior date's hour 24 +
// current date's hour 0 both representing 12am of `date`).
const STATUS_SEVERITY: Record<SlotStatus, number> = {
  available: 0,
  locked: 1,
  booked: 2,
  blocked: 2,
};
function worseStatus(a: SlotStatus, b: SlotStatus): SlotStatus {
  return STATUS_SEVERITY[a] >= STATUS_SEVERITY[b] ? a : b;
}

/**
 * Customer-facing variant of `getSlotAvailability`. Same data, but
 * the 12am-1am slot is positioned on the FOLLOWING calendar date
 * instead of the venue's evening session date. See the file-level
 * comment above for the rationale and storage contract.
 *
 * Handles TWO storage conventions for the late-night slot:
 *
 *   1. Customer-flow legacy: `(date = X-1, startHour = 24)` —
 *      written by /api/booking/lock when a customer books the
 *      12am-1am tile from X's display-shifted grid.
 *   2. Admin create-booking: `(date = X, startHour ∈ {0..4})` —
 *      written by /admin/bookings/create which iterates wall-clock
 *      hours 0..23. The 1am-2am slot of date X only has form (2).
 *
 * Both surface on the same display cell. If both exist for the
 * same hour (shouldn't really happen — they're equivalent — but
 * possible if two paths race), the worst status wins so the
 * customer sees the "booked" signal instead of "available."
 */
export async function getDisplayShiftedAvailability(
  courtConfigId: string,
  date: Date,
): Promise<SlotAvailability[]> {
  const prevDate = new Date(date);
  prevDate.setUTCDate(prevDate.getUTCDate() - 1);

  const [current, prior] = await Promise.all([
    getSlotAvailability(courtConfigId, date),
    getSlotAvailability(courtConfigId, prevDate),
  ]);

  const currentDateStr = ymd(date);
  const prevDateStr = ymd(prevDate);

  // Build a display-hour map so we can merge multiple storage
  // sources cleanly (prior's hour 24 + current's hour 0 both →
  // display hour 0).
  const byDisplayHour = new Map<number, SlotAvailability>();
  const upsert = (s: SlotAvailability) => {
    const existing = byDisplayHour.get(s.hour);
    if (!existing) {
      byDisplayHour.set(s.hour, s);
      return;
    }
    // Merge: pick the worse status. Lock coords are stable per
    // source — for booked slots they're irrelevant (the customer
    // can't lock a taken slot anyway); for available cells they
    // come from the cell's natural storage, which is the
    // current-date one when both are available.
    const merged: SlotAvailability = {
      ...existing,
      status: worseStatus(existing.status, s.status),
      blockedReason: s.blockedReason ?? existing.blockedReason,
    };
    byDisplayHour.set(s.hour, merged);
  };

  // (1) Prior date's hour-24 entry → display hour 0 of `date`.
  //     Carries lockDate=prior so the booking client targets the
  //     legacy session-date storage when locking.
  const legacyMidnight = prior.find((s) => s.hour === 24);
  if (legacyMidnight) {
    upsert({
      ...legacyMidnight,
      hour: 0,
      lockDate: prevDateStr,
      lockHour: 24,
    });
  }

  // (2) Current date's slots, EXCEPT hour 24 — that one belongs on
  //     the NEXT date's grid (handled when that next date is
  //     requested). Hours 0..4 from current's out-of-window surface
  //     are the admin-stored late-night sessions; they sit at their
  //     natural display position (hour 0 → 0, hour 1 → 1, etc.).
  for (const s of current) {
    if (s.hour === 24) continue;
    upsert({
      ...s,
      lockDate: currentDateStr,
      lockHour: s.hour,
    });
  }

  return Array.from(byDisplayHour.values()).sort((a, b) => a.hour - b.hour);
}

/**
 * Display-shifted variant of `getMergedMediumAvailability`. Same
 * shift semantics as `getDisplayShiftedAvailability`.
 */
export async function getDisplayShiftedMediumAvailability(
  sport: Sport,
  date: Date,
): Promise<SlotAvailability[]> {
  const prevDate = new Date(date);
  prevDate.setUTCDate(prevDate.getUTCDate() - 1);

  const [current, prior] = await Promise.all([
    getMergedMediumAvailability(sport, date),
    getMergedMediumAvailability(sport, prevDate),
  ]);

  const currentDateStr = ymd(date);
  const prevDateStr = ymd(prevDate);

  // Same two-convention merge as getDisplayShiftedAvailability — see
  // its comment block for the storage-form details.
  const byDisplayHour = new Map<number, SlotAvailability>();
  const upsert = (s: SlotAvailability) => {
    const existing = byDisplayHour.get(s.hour);
    if (!existing) {
      byDisplayHour.set(s.hour, s);
      return;
    }
    byDisplayHour.set(s.hour, {
      ...existing,
      status: worseStatus(existing.status, s.status),
      blockedReason: s.blockedReason ?? existing.blockedReason,
    });
  };

  const legacyMidnight = prior.find((s) => s.hour === 24);
  if (legacyMidnight) {
    upsert({
      ...legacyMidnight,
      hour: 0,
      lockDate: prevDateStr,
      lockHour: 24,
    });
  }
  for (const s of current) {
    if (s.hour === 24) continue;
    upsert({ ...s, lockDate: currentDateStr, lockHour: s.hour });
  }
  return Array.from(byDisplayHour.values()).sort((a, b) => a.hour - b.hour);
}

// Check if specific slots are available for a config (used during booking)
export async function checkSlotsAvailable(
  courtConfigId: string,
  date: Date,
  hours: number[]
): Promise<{ available: boolean; conflicts: number[] }> {
  const availability = await getSlotAvailability(courtConfigId, date);
  const conflicts: number[] = [];

  for (const hour of hours) {
    const slot = availability.find((s) => s.hour === hour);
    if (!slot || slot.status !== "available") {
      conflicts.push(hour);
    }
  }

  return { available: conflicts.length === 0, conflicts };
}
