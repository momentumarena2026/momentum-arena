/**
 * "7–8 PM is taken. Nearest free: 6–7 PM, 8–9 PM, or 7–8 PM on Turf 1."
 *
 * Deliberately independent of the bot. Today a customer who wants a taken
 * slot sees a greyed tile and leaves; this turns that dead end into the
 * two or three offers a person at the counter would make. The slot picker
 * should use it too — the bot is just the first caller.
 *
 * Pure functions over availability the caller has already fetched. No DB,
 * no network, no clock: fully testable, and it cannot itself trip the
 * 30-req/min rate limit on /api/availability.
 */

export type SlotStatus = "available" | "booked" | "locked" | "blocked";

/** One hour of one court, as /api/availability returns it. */
export type HourSlot = {
  hour: number;
  status: SlotStatus;
  price: number;
};

/** Availability for one court on one date. */
export type CourtDay = {
  courtConfigId: string;
  courtLabel: string;
  slots: HourSlot[];
};

export type Suggestion = {
  courtConfigId: string;
  courtLabel: string;
  startHour: number;
  endHour: number;
  price: number;
  /** Hours away from what they asked for. 0 = same time, other court. */
  distanceHours: number;
  /** True when this is a different court than the one requested. */
  differentCourt: boolean;
};

/**
 * Is the whole window bookable on this court?
 *
 * "locked" counts as unavailable: someone else is on the payment screen.
 * It may free up in minutes, but offering it now risks sending two
 * customers at the same slot, and the second one has already typed their
 * card in. Availability is re-checked at hold time regardless — this is
 * about not making an offer we are likely to break.
 */
export function isWindowFree(
  slots: HourSlot[],
  startHour: number,
  endHour: number,
): boolean {
  // A non-finite bound means the caller lost track of the window. Return
  // "not free" rather than looping: a NaN window slipped through once in
  // testing and came back as a bookable slot priced at ₹0, because every
  // comparison against NaN is false and the loop body never ran.
  if (!Number.isFinite(startHour) || !Number.isFinite(endHour)) return false;
  if (endHour <= startHour) return false;
  for (let h = startHour; h < endHour; h++) {
    const slot = slots.find((s) => s.hour === h);
    if (!slot || slot.status !== "available") return false;
  }
  return true;
}

/** Total price of a window, assuming every hour in it is free. */
export function windowPrice(
  slots: HourSlot[],
  startHour: number,
  endHour: number,
): number {
  let total = 0;
  for (let h = startHour; h < endHour; h++) {
    total += slots.find((s) => s.hour === h)?.price ?? 0;
  }
  return total;
}

/**
 * Alternatives to a window that isn't free, best first.
 *
 * Ranking, in order:
 *   1. Same court, same time is impossible — that's why we're here.
 *   2. A DIFFERENT court at the SAME time beats a time shift. People
 *      organise around when they can turn up, not which turf they're on;
 *      moving an eight-a-side game by an hour means re-herding eight
 *      people, and moving it one court over means nothing.
 *   3. Then by how far the time moves, closest first.
 *   4. Then earlier over later at equal distance — a group that wanted
 *      7pm will more often take 6pm than 8pm, because 8pm eats into the
 *      evening they'd planned around it.
 *
 * `maxShiftHours` bounds the search: an offer four hours from what was
 * asked for is noise, not help.
 */
export function suggestAlternatives(
  courts: CourtDay[],
  requested: { courtConfigId: string | null; startHour: number; endHour: number },
  opts: { maxShiftHours?: number; limit?: number } = {},
): Suggestion[] {
  const maxShift = opts.maxShiftHours ?? 3;
  const limit = opts.limit ?? 3;
  const duration = requested.endHour - requested.startHour;
  if (!Number.isFinite(duration) || duration <= 0) return [];

  const out: (Suggestion & { rank: number })[] = [];

  // `courts` arrives in the caller's preference order (see
  // orderCourtsByPreference), so its index IS the court's desirability.
  // Used as the tie-break below instead of price.
  for (const [rank, court] of courts.entries()) {
    const differentCourt =
      requested.courtConfigId != null && court.courtConfigId !== requested.courtConfigId;

    // Same time, other court — offset 0 is only meaningful on a different
    // court, since the requested one is by definition not free.
    for (let shift = 0; shift <= maxShift; shift++) {
      for (const dir of shift === 0 ? [0] : [-1, 1]) {
        const start = requested.startHour + shift * dir;
        const end = start + duration;
        if (shift === 0 && !differentCourt) continue;
        // Don't offer a window the venue can't sell — the slots array
        // only spans the operating window, so a missing hour is closed.
        if (!isWindowFree(court.slots, start, end)) continue;

        out.push({
          rank,
          courtConfigId: court.courtConfigId,
          courtLabel: court.courtLabel,
          startHour: start,
          endHour: end,
          price: windowPrice(court.slots, start, end),
          distanceHours: shift,
          differentCourt,
        });
      }
    }
  }

  out.sort((a, b) => {
    // Same time on another court wins outright.
    const aSame = a.distanceHours === 0 ? 0 : 1;
    const bSame = b.distanceHours === 0 ? 0 : 1;
    if (aSame !== bSame) return aSame - bSame;
    if (a.distanceHours !== b.distanceHours) return a.distanceHours - b.distanceHours;
    // Earlier beats later at the same distance.
    if (a.startHour !== b.startHour) return a.startHour - b.startHour;
    // Then the caller's court preference — NOT price. Cricket's half
    // courts are subdivisions of the full field, so they undercut it on
    // price while being a smaller product. Sorting by price pushed
    // "Full Field" out of a three-item list in favour of two halves of
    // itself and a practice pitch.
    return a.rank - b.rank;
  });

  // One offer per (court, start) — the loop can reach the same window
  // twice when shift 0 and a ±0 direction coincide.
  const seen = new Set<string>();
  return out
    .filter((s) => {
      const k = `${s.courtConfigId}@${s.startHour}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, limit)
    .map(({ rank: _rank, ...s }) => s);
}

/**
 * Preference order for a request that names a sport but no court — which
 * is nearly all of them, since nobody types "Turf 2".
 *
 * Biggest first. Cricket at this venue spans a ₹2,000 full turf, two
 * ₹1,200 half-courts and a ₹200 leather practice pitch; "book a cricket
 * court" means the turf. Two orderings were tried against real data and
 * both were wrong: cheapest-first answered with the practice net, and
 * Prisma's `size: "asc"` sorts by the enum's DECLARATION order
 * (XS, SMALL, MEDIUM, LARGE, XL, FULL, SHARED) — which puts the smallest
 * court first and reads like it should do the opposite.
 *
 * SHARED sits after the real sizes: it is a co-use config, not a court
 * somebody means by default.
 */
const SIZE_RANK: Record<string, number> = {
  FULL: 0, XL: 1, LARGE: 2, MEDIUM: 3, SMALL: 4, XS: 5, SHARED: 6,
};

export function orderCourtsByPreference<T extends { size: string; label: string }>(
  configs: T[],
): T[] {
  return [...configs].sort(
    (a, b) =>
      (SIZE_RANK[a.size] ?? 9) - (SIZE_RANK[b.size] ?? 9) ||
      a.label.localeCompare(b.label),
  );
}

/**
 * The first court that can take the whole window, or null.
 *
 * Used when the customer named a sport but not a court — which is almost
 * always, since nobody types "Turf 2".
 *
 * Takes `courts` in the caller's PREFERENCE order and returns the first
 * free one. It deliberately does not pick the cheapest: for cricket the
 * configs range from a ₹2,000 full turf to a ₹200 leather practice pitch
 * and a half-court, and cheapest-first answers "book a cricket court"
 * with the practice net. Which config a bare request means is domain
 * knowledge the caller holds (see the ordering in the bot route), not
 * something a price comparison can recover.
 */
export function firstCourtWithWindow(
  courts: CourtDay[],
  startHour: number,
  endHour: number,
): { court: CourtDay; price: number } | null {
  for (const court of courts) {
    if (isWindowFree(court.slots, startHour, endHour)) {
      return { court, price: windowPrice(court.slots, startHour, endHour) };
    }
  }
  return null;
}
