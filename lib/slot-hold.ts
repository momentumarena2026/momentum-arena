import type { BookingPlatform } from "@/actions/booking";
import { db } from "./db";
import { zonesOverlap, LOCK_TTL_MINUTES } from "./court-config";
import { CourtZone, Prisma, Sport } from "@prisma/client";
import { getMediumConfigs, OCCUPYING_BOOKING_STATUSES } from "./availability";

export interface HoldResult {
  success: boolean;
  holdId?: string;
  error?: string;
  conflicts?: number[];
}

export interface SlotPrice {
  hour: number;
  // 0 (default, hour granularity) or 30 (bowling-machine half-hour
  // slot). The Json blob persisted on SlotHold.slotPrices keeps this
  // optional so legacy entries without a minute key remain valid;
  // any consumer reading them defaults to 0.
  minute?: number;
  price: number;
}

export interface BowlingSlotPrice {
  hour: number;
  minute: 0 | 30;
  price: number;
}

/**
 * Generate a stable advisory lock key from configId + date + hour.
 * PostgreSQL advisory locks use bigint keys.
 * We hash the string to a 32-bit integer to stay within range.
 */
export function advisoryLockKey(configId: string, date: string, hour: number): number {
  const str = `${configId}:${date}:${hour}`;
  return hashToLockKey(str);
}

/**
 * The locks that actually exclude two bookings of the same ground.
 *
 * A court-hour lock keyed on the CONFIG serialises two people reaching for the
 * same config — and nothing else. But whether two bookings conflict is decided
 * by ZONE overlap: on this arena, Full Field covers [LEATHER_1, BOX_A, BOX_B,
 * LEATHER_2] and Medium (Left Half) covers [LEATHER_1, BOX_A], so they clash —
 * and their config ids hash to different keys, so neither waited for the other.
 * Two customers were sold overlapping halves of the same ground for the same
 * hour, reproduced end to end.
 *
 * Locking per (zone, date, hour) makes the exclusion match the conflict rule.
 * Keys are returned SORTED so every caller acquires them in the same order,
 * which is what stops two overlapping requests deadlocking against each other.
 */
export function courtHourLockKeys(
  zones: string[],
  configId: string,
  date: string,
  hours: number[],
): number[] {
  const keys = new Set<number>();
  for (const hour of hours) {
    // The config key stays, so nothing that relied on it loses its exclusion.
    keys.add(hashToLockKey(`${configId}:${date}:${hour}`));
    for (const zone of zones) keys.add(hashToLockKey(`zone:${zone}:${date}:${hour}`));
  }
  return [...keys].sort((a, b) => a - b);
}

/**
 * Take every court-hour lock for one request, in one round trip.
 *
 * TWO reasons this is a function rather than a loop at each call site.
 *
 * The first is that there are THREE call sites and the zone fix reached only
 * one of them. `createMediumHalfCourtHold` — the "Half Court (40x90)" flow,
 * a mainstream customer journey — kept locking on the two half configs' ids
 * alone, which share no key with the zone keys a Full Field booking takes. So
 * the double-sell the zone fix was written to close stayed wide open through
 * the other door, reproduced 3 times in 3 with ordinary concurrent traffic.
 * A helper cannot be half-migrated.
 *
 * The second is cost. Each lock was its own `$executeRaw`, so a request paid
 * one network round trip per (zone, hour): locks = hours x (zones + 1), and a
 * Full Field booking of 8 hours took 40 of them and blew the transaction's
 * 15-second timeout — measured, with the customer shown the raw Prisma
 * exception. Booking a whole day of the venue's flagship ground is an ordinary
 * thing to want. `unnest` takes them all in one statement, in array order,
 * which is also what keeps the ordering guarantee that stops two overlapping
 * requests deadlocking.
 */
export async function lockCourtHours(
  tx: { $executeRaw: (q: TemplateStringsArray, ...v: unknown[]) => Promise<unknown> },
  targets: { configId: string; zones: string[] }[],
  dateStr: string,
  hours: number[],
  /**
   * Keys from another family to take in the SAME sorted acquisition — the
   * bowling machine's half-hour keys, which give it precision against other
   * bowling bookings that whole hours cannot. They must come through here
   * rather than in a second statement: deadlock freedom depends on every
   * transaction taking ALL of its keys in ascending order, and two statements
   * are two orders.
   */
  extraKeys: number[] = [],
): Promise<void> {
  const keys = new Set<number>(extraKeys);
  for (const t of targets) {
    for (const k of courtHourLockKeys(t.zones, t.configId, dateStr, hours)) keys.add(k);
  }
  if (keys.size === 0) return;
  const sorted = [...keys].sort((a, b) => a - b);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(k) FROM unnest(${sorted}::bigint[]) AS k`;
}

function hashToLockKey(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0; // Convert to 32-bit int
  }
  return Math.abs(hash);
}

/**
 * Create a transient slot hold during checkout.
 *
 * A SlotHold reserves the slot for 5 minutes (LOCK_TTL_MINUTES) while the user
 * completes payment. If the user commits to a payment (online success OR UPI
 * "I've completed the payment"), the hold is deleted atomically with creating
 * a Booking. If the user abandons checkout, the hold just expires naturally —
 * no Booking is ever created, so no admin action needed and no DB noise.
 *
 * Concurrency: uses PostgreSQL advisory locks. Never deadlocks. Lock is released
 * automatically when the transaction commits.
 *
 * Flow:
 * 1. Acquire advisory locks for all requested hours
 * 2. Check conflicts against confirmed bookings, pending bookings, and active holds
 * 3. Check admin blocks
 * 4. Delete any prior holds by this user for the same config+date (cleanup)
 * 5. Create the SlotHold
 */
/**
 * Turn whatever went wrong into something a customer can read.
 *
 * The three hold paths each ended `return { success: false, error: message }`,
 * and the lock endpoints return that object verbatim at HTTP 200 — so when a
 * transaction timed out against a contended lock, the booking screen showed
 * the customer the raw exception: "Invalid `prisma.$executeRaw()` invocation:
 * Transaction API error: Transaction not found...". Reproduced by holding the
 * lock a booking needed. The status code said 200, so nothing upstream
 * flagged it either.
 *
 * `CONFLICTS:` and the venue's own deliberate sentences ("This court is
 * currently unavailable") are answers and pass through. Anything else is an
 * internal fault: the real error goes to the log where it is useful, and the
 * customer is told to try again, which is true — nothing was reserved and
 * nothing was charged, since a hold is taken before any money moves.
 */
function holdFailure(error: unknown): HoldResult {
  const message = error instanceof Error ? error.message : "Failed to reserve slots";

  if (message.startsWith("CONFLICTS:")) {
    return {
      success: false,
      error: "Some slots are no longer available",
      conflicts: message.replace("CONFLICTS:", "").split(",").map(Number),
    };
  }

  // AN ALLOWLIST, NOT A BLOCKLIST.
  //
  // The first version listed the Prisma signatures and let everything else
  // through, which meant any OTHER exception still reached the customer
  // verbatim: a plain TypeError from a helper — "Cannot read properties of
  // undefined (reading 'reduce')" — rendered on the booking screen, which is
  // precisely what this function exists to prevent. The set of sentences we
  // deliberately show is small and knowable; the set of ways code can throw
  // is not.
  if (
    CUSTOMER_SAFE_REFUSALS.includes(message) ||
    // The one refusal that carries a number in it.
    /^Slot at hour \d+ is blocked by admin$/.test(message)
  ) {
    return { success: false, error: message };
  }
  console.error("[slot-hold] internal failure taking a hold:", error);
  return {
    success: false,
    error: "We couldn't hold those slots just now. Please try again.",
  };
}

/**
 * The refusals a customer is meant to read, verbatim. Anything thrown from a
 * hold path that is not on this list is a fault, not an answer.
 *
 * Kept next to `holdFailure` deliberately: adding a `throw new Error("...")`
 * to a hold path without adding it here turns that sentence into "please try
 * again", which is a visible, harmless failure — the other direction, a
 * blocklist, fails silently and shows a stack-trace fragment to a customer.
 */
const CUSTOMER_SAFE_REFUSALS: string[] = [
  "Court config not found",
  "This court is currently unavailable",
  "This court is blocked for the entire day",
  "This court was just reconfigured. Please try again.",
  "All bowling slots are blocked for this day",
  "This slot is blocked",
  "Failed to reserve slots",
];

/**
 * Which of the requested slots are already taken.
 *
 * Exported because the admin booking path needs exactly this question
 * answered under its advisory lock, and the alternative — a copy of the rule
 * inlined there — is how two rules become two different rules. That is not
 * hypothetical here: the first version of that re-check compared `startHour`
 * alone, so a bowling machine's 14:30 clashed with an existing 14:00 and the
 * venue was refused a half-hour that was genuinely free.
 *
 * The granularity is the thing's own: a 30-minute slot occupies its half
 * hour, a 60-minute booking occupies both halves of its hour. Labels come
 * back in the shape the caller asked in, so the error names what the admin
 * typed.
 */
export function findSlotClashes(
  taken: { slots: { startHour: number; startMinute: number; durationMinutes: number }[] }[],
  wanted:
    | { kind: "hours"; hours: number[] }
    | { kind: "halfHours"; slots: { hour: number; minute: number }[] },
): string[] {
  const busy = new Set<string>();
  for (const b of taken) {
    for (const sl of b.slots) {
      if (sl.durationMinutes === 30) busy.add(`${sl.startHour}:${sl.startMinute}`);
      else {
        busy.add(`${sl.startHour}:0`);
        busy.add(`${sl.startHour}:30`);
      }
    }
  }
  const asked =
    wanted.kind === "halfHours"
      ? wanted.slots.map((sl) => ({
          key: `${sl.hour}:${sl.minute}`,
          label: `${sl.hour}:${String(sl.minute).padStart(2, "0")}`,
        }))
      : wanted.hours.flatMap((h) => [
          { key: `${h}:0`, label: String(h) },
          { key: `${h}:30`, label: String(h) },
        ]);
  return [...new Set(asked.filter((a) => busy.has(a.key)).map((a) => a.label))];
}

export async function createSlotHold(
  userId: string,
  courtConfigId: string,
  date: Date,
  hours: number[],
  slotPrices: SlotPrice[],
  platform: BookingPlatform = "web"
): Promise<HoldResult> {
  const dateOnly = new Date(date.toISOString().split("T")[0]);
  const dateStr = date.toISOString().split("T")[0];
  const now = new Date();
  const expiresAt = new Date(now.getTime() + LOCK_TTL_MINUTES * 60 * 1000);

  // The zones this config covers, read BEFORE the transaction so the locks can
  // be taken on the thing that actually decides a conflict. Reading it inside
  // would mean locking first and learning what to lock afterwards.
  const zonesForLock =
    (
      await db.courtConfig.findUnique({
        where: { id: courtConfigId },
        select: { zones: true },
      })
    )?.zones ?? [];

  try {
    const holdId = await db.$transaction(
      async (tx) => {
        // 1. Acquire advisory locks — per ZONE as well as per config, sorted so
        //    every caller takes them in the same order. Keyed on the config
        //    alone, two overlapping configs of the same ground (Full Field and
        //    Medium Left Half share LEATHER_1 and BOX_A) hashed to different
        //    keys and neither waited for the other, so the same ground could be
        //    sold twice for the same hour.
        await lockCourtHours(
          tx,
          [{ configId: courtConfigId, zones: zonesForLock as string[] }],
          dateStr,
          hours,
        );

        // 2. Validate the court config
        const config = await tx.courtConfig.findUnique({
          where: { id: courtConfigId },
        });
        if (!config) throw new Error("Court config not found");
        if (!config.isActive) throw new Error("This court is currently unavailable");
        // THE ZONES WE LOCKED MUST BE THE ZONES WE CHECK.
        //
        // `zonesForLock` is read before the transaction — it has to be, or we
        // would be locking first and learning what to lock afterwards — while
        // the conflict check below uses the zones read fresh inside it. An
        // admin repointing a config's zones in that window put those two out
        // of step: the lock was taken on the old ground and the check done on
        // the new, and two holds landed on the same zone (4 trials in 8).
        // Rare, and admin-triggered rather than customer-reachable, but the
        // outcome is the one this whole file exists to prevent. Retrying is
        // the honest answer — the second attempt reads the new zones and locks
        // them, and nothing has been reserved or charged yet.
        const locked = [...(zonesForLock as string[])].sort().join(",");
        const fresh = [...(config.zones as string[])].sort().join(",");
        if (locked !== fresh) {
          throw new Error("This court was just reconfigured. Please try again.");
        }

        // 3. Find bookings on this date that could overlap
        const activeBookings = await tx.booking.findMany({
          where: {
            date: dateOnly,
            status: { in: [...OCCUPYING_BOOKING_STATUSES] },
          },
          include: {
            courtConfig: true,
            slots: true,
          },
        });

        const conflictingBookings = activeBookings.filter((b) =>
          zonesOverlap(
            b.courtConfig.zones as CourtZone[],
            config.zones as CourtZone[]
          )
        );

        // 4. Find active SlotHolds on this date that could overlap
        //    (exclude holds owned by the same user — those are superseded)
        const activeHolds = await tx.slotHold.findMany({
          where: {
            date: dateOnly,
            expiresAt: { gt: now },
            userId: { not: userId },
          },
          include: { courtConfig: true },
        });

        const conflictingHolds = activeHolds.filter((h) =>
          zonesOverlap(
            h.courtConfig.zones as CourtZone[],
            config.zones as CourtZone[]
          )
        );

        // 5. Collect occupied hours from both sources
        const occupiedHours = new Set<number>();
        for (const booking of conflictingBookings) {
          for (const slot of booking.slots) {
            occupiedHours.add(slot.startHour);
          }
        }
        for (const hold of conflictingHolds) {
          for (const hour of hold.hours) {
            occupiedHours.add(hour);
          }
        }

        const conflicts = hours.filter((h) => occupiedHours.has(h));
        if (conflicts.length > 0) {
          throw new Error(`CONFLICTS:${conflicts.join(",")}`);
        }

        // 6. Check admin blocks
        //    The zone-overlap clause catches blocks placed on a *sibling*
        //    config on the same physical ground (e.g. admin blocks Full
        //    Field; this hold is for Left Half). getAvailability greys
        //    those hours out, so the write path must reject them too.
        const blocks = await tx.slotBlock.findMany({
          where: {
            date: dateOnly,
            OR: [
              { courtConfigId },
              { sport: config.sport },
              { courtConfigId: null, sport: null },
              { courtConfig: { zones: { hasSome: config.zones } } },
            ],
          },
        });
        for (const block of blocks) {
          if (block.startHour === null) {
            throw new Error("This court is blocked for the entire day");
          }
          if (hours.includes(block.startHour)) {
            throw new Error(`Slot at hour ${block.startHour} is blocked by admin`);
          }
        }

        // 7. Clean up any prior holds by this user for the same config+date.
        // paymentInitiatedAt: null keeps a hold with an in-flight payment
        // alive as a booking-reconstruction blueprint (see releaseSlotHold /
        // PAYMENT_GRACE_HOURS) — re-locking the same slot must not orphan a
        // payment the customer already started.
        await tx.slotHold.deleteMany({
          where: { userId, courtConfigId, date: dateOnly, paymentInitiatedAt: null },
        });

        // 8. Calculate total
        const totalAmount = slotPrices.reduce((sum, s) => sum + s.price, 0);

        // 9. Create the SlotHold
        const hold = await tx.slotHold.create({
          data: {
            platform,
            userId,
            courtConfigId,
            date: dateOnly,
            hours,
            slotPrices: slotPrices as unknown as Prisma.InputJsonValue,
            totalAmount,
            expiresAt,
          },
        });

        return hold.id;
      },
      { timeout: 15000 }
    );

    return { success: true, holdId };
  } catch (error) {
    return holdFailure(error);
  }
}

/**
 * Create a slot hold for the unified "Half Court (40×90)" customer flow.
 *
 * The customer picks hours against a merged LEFT+RIGHT availability view. The
 * system needs to atomically pick a concrete half that has ALL requested
 * hours free. We prefer LEFT (arbitrary tie-break); if any requested hour is
 * not free on LEFT we fall back to RIGHT. If neither half covers every hour
 * the hold fails — the client should refetch merged availability to reflect
 * the real state.
 *
 * The resulting SlotHold is tagged `wasBookedAsHalfCourt = true` so that the
 * Booking created from it carries the same flag and customer-facing views
 * render a neutral "Half Court (40×90)" label instead of LEFT/RIGHT.
 *
 * Concurrency: advisory locks are taken on the *chosen* half's (configId,
 * date, hour) keys — same pattern as createSlotHold. Because LEFT and RIGHT
 * share no zones, a race between two half-court customers is fine: the first
 * gets LEFT, the second falls through to RIGHT.
 */
export async function createMediumHalfCourtHold(
  userId: string,
  sport: Sport,
  date: Date,
  hours: number[],
  slotPrices: SlotPrice[],
  platform: BookingPlatform = "web"
): Promise<HoldResult> {
  const dateOnly = new Date(date.toISOString().split("T")[0]);
  const dateStr = date.toISOString().split("T")[0];
  const now = new Date();
  const expiresAt = new Date(now.getTime() + LOCK_TTL_MINUTES * 60 * 1000);

  try {
    // INSIDE the try. `getMediumConfigs` throws when a sport has no active
    // MEDIUM configs — true of FOOTBALL on this arena today — and sitting
    // above the try meant that exception escaped `holdFailure` entirely and
    // came out of the route as a framework 500, instead of the
    // `{success:false,error}` shape every other failure on this path returns.
    const { leftId, rightId } = await getMediumConfigs(sport);
    // The zones of BOTH halves, read before the transaction so the locks can
    // be taken on the thing that decides a conflict. Either half may be the
    // one handed out, so both are locked — and a Full Field request, which
    // locks the union of the ground's zones, now genuinely waits for this one.
    const halfZones = await db.courtConfig.findMany({
      where: { id: { in: [leftId, rightId] } },
      select: { id: true, zones: true },
    });

    const holdId = await db.$transaction(
      async (tx) => {
        // Lock the requested hours on BOTH halves, BY ZONE.
        //
        // Keyed on the two half-config ids alone — which is what this did —
        // the key set shared nothing with the zone keys a Full Field booking
        // takes, so the two never waited for each other and the same ground
        // was sold twice for the same hour. Reproduced 3 times in 3.
        await lockCourtHours(
          tx,
          halfZones.map((c) => ({ configId: c.id, zones: c.zones as string[] })),
          dateStr,
          hours,
        );

        // Helper: is every requested hour free on `configId`?
        const isHalfFree = async (configId: string): Promise<boolean> => {
          const config = await tx.courtConfig.findUnique({
            where: { id: configId },
          });
          if (!config || !config.isActive) return false;

          const activeBookings = await tx.booking.findMany({
            where: {
              date: dateOnly,
              status: { in: [...OCCUPYING_BOOKING_STATUSES] },
            },
            include: { courtConfig: true, slots: true },
          });
          const conflictingBookings = activeBookings.filter((b) =>
            zonesOverlap(
              b.courtConfig.zones as CourtZone[],
              config.zones as CourtZone[]
            )
          );

          const activeHolds = await tx.slotHold.findMany({
            where: {
              date: dateOnly,
              expiresAt: { gt: now },
              userId: { not: userId },
            },
            include: { courtConfig: true },
          });
          const conflictingHolds = activeHolds.filter((h) =>
            zonesOverlap(
              h.courtConfig.zones as CourtZone[],
              config.zones as CourtZone[]
            )
          );

          const occupied = new Set<number>();
          for (const b of conflictingBookings) {
            for (const s of b.slots) occupied.add(s.startHour);
          }
          for (const h of conflictingHolds) {
            for (const hr of h.hours) occupied.add(hr);
          }

          if (hours.some((h) => occupied.has(h))) return false;

          // Admin blocks — any requested hour blocked on this specific half,
          // on the sport, globally, or on a sibling config sharing this
          // half's zones (e.g. a Full Field block covers both halves)
          // disqualifies the half.
          const blocks = await tx.slotBlock.findMany({
            where: {
              date: dateOnly,
              OR: [
                { courtConfigId: configId },
                { sport: config.sport },
                { courtConfigId: null, sport: null },
                { courtConfig: { zones: { hasSome: config.zones } } },
              ],
            },
          });
          for (const block of blocks) {
            if (block.startHour === null) return false;
            if (hours.includes(block.startHour)) return false;
          }
          return true;
        };

        // Prefer LEFT; fall back to RIGHT.
        let chosenId: string | null = null;
        if (await isHalfFree(leftId)) chosenId = leftId;
        else if (await isHalfFree(rightId)) chosenId = rightId;

        if (!chosenId) {
          // Surface as a conflict list so the client can refetch merged
          // availability. We can't cheaply list which hours collide without
          // re-running the queries, so return all requested hours.
          throw new Error(`CONFLICTS:${hours.join(",")}`);
        }

        // Clean up any prior holds this user has on EITHER half for this date
        // (the old one is superseded). paymentInitiatedAt: null retains a
        // hold with an in-flight payment so re-locking can't orphan it.
        await tx.slotHold.deleteMany({
          where: {
            userId,
            date: dateOnly,
            paymentInitiatedAt: null,
            courtConfigId: { in: [leftId, rightId] },
          },
        });

        const totalAmount = slotPrices.reduce((sum, s) => sum + s.price, 0);

        const hold = await tx.slotHold.create({
          data: {
            platform,
            userId,
            courtConfigId: chosenId,
            date: dateOnly,
            hours,
            slotPrices: slotPrices as unknown as Prisma.InputJsonValue,
            totalAmount,
            expiresAt,
            wasBookedAsHalfCourt: true,
          },
        });

        return hold.id;
      },
      { timeout: 15000 }
    );

    return { success: true, holdId };
  } catch (error) {
    return holdFailure(error);
  }
}

/**
 * Bowling-machine variant of createSlotHold. The two flows differ
 * only in granularity: bowling stores parallel `hours[]` +
 * `startMinutes[]` arrays so each entry identifies a single 30-min
 * slot. Existing cricket / football holds keep `startMinutes` empty,
 * which downstream code (availability, createBookingFromHold) treats
 * as "all entries start at :00 for 60 minutes" — backwards compatible.
 *
 * Conflict detection runs against the full overlapping-zones set,
 * just like createSlotHold: a 60-min cricket booking on the
 * matching half blocks BOTH halves of an hour, and a 30-min bowling
 * booking blocks only its specific half. Advisory locks are keyed
 * on the half-hour slot index so two customers picking different
 * 30-min slots within the same hour can race safely.
 */
export async function createBowlingMachineHold(
  userId: string,
  courtConfigId: string,
  date: Date,
  slots: BowlingSlotPrice[],
  platform: BookingPlatform = "web"
): Promise<HoldResult> {
  const dateOnly = new Date(date.toISOString().split("T")[0]);
  const dateStr = date.toISOString().split("T")[0];
  const now = new Date();
  const expiresAt = new Date(now.getTime() + LOCK_TTL_MINUTES * 60 * 1000);

  // Encode each (hour, minute) as a single integer for the
  // advisory-lock key. hour*2 + halfOffset gives stable, small
  // values 10..50 for the venue's operating hours.
  function slotKey(h: number, m: number) {
    return h * 2 + (m === 30 ? 1 : 0);
  }

  // The ground this machine stands on, read before the transaction so the
  // locks can be taken on what actually decides a conflict.
  const zonesForLock =
    (
      await db.courtConfig.findUnique({
        where: { id: courtConfigId },
        select: { zones: true },
      })
    )?.zones ?? [];

  try {
    const holdId = await db.$transaction(
      async (tx) => {
        // 1. Acquire advisory locks — ON THE GROUND, plus the half-hour keys.
        //
        // This kept its config-only keys when the other two hold paths moved
        // to zone keys, on the stated reasoning that "a bowling machine is a
        // single resource rather than a patch of ground shared between
        // configs". That reasoning was simply false: the machine's config
        // carries zones [LEATHER_1, BOX_A], which is the whole of Medium
        // (Left Half) and contains Leather Pitch 1. Its key set therefore
        // intersected neither of theirs, and a bowling customer and a cricket
        // customer could each be sold the same ground for the same hour —
        // 12 trials in 12, against two different configs.
        //
        // The conflict CHECK below was right all along; it is the lock that
        // let two transactions both reach it before either committed.
        //
        // Both families in one sorted acquisition: the zone keys are whole
        // hours, because that is the granularity the courts are sold in, and
        // the half-hour keys stay so that two bowling bookings still exclude
        // each other at 14:00 and 14:30 separately.
        const sorted = [...slots].sort(
          (a, b) => slotKey(a.hour, a.minute) - slotKey(b.hour, b.minute),
        );
        await lockCourtHours(
          tx,
          [{ configId: courtConfigId, zones: zonesForLock as string[] }],
          dateStr,
          [...new Set(sorted.map((s) => s.hour))],
          sorted.map((s) => advisoryLockKey(courtConfigId, dateStr, slotKey(s.hour, s.minute))),
        );

        // 2. Validate the court config
        const config = await tx.courtConfig.findUnique({
          where: { id: courtConfigId },
        });
        if (!config) throw new Error("Court config not found");
        if (!config.isActive) throw new Error("This court is currently unavailable");

        // 3. Conflict check via zone overlap.
        const conflictingBookings = await tx.booking.findMany({
          where: {
            date: dateOnly,
            status: { in: [...OCCUPYING_BOOKING_STATUSES] },
            courtConfig: {
              zones: { hasSome: config.zones as CourtZone[] },
            },
          },
          include: { slots: true },
        });
        const requested = new Set(slots.map((s) => `${s.hour}:${s.minute}`));
        const conflictKeys: string[] = [];
        for (const b of conflictingBookings) {
          for (const s of b.slots) {
            if (s.durationMinutes === 30) {
              if (requested.has(`${s.startHour}:${s.startMinute}`)) {
                conflictKeys.push(`${s.startHour}:${s.startMinute}`);
              }
            } else {
              // 60-min booking → blocks BOTH halves of that hour
              if (requested.has(`${s.startHour}:0`)) conflictKeys.push(`${s.startHour}:0`);
              if (requested.has(`${s.startHour}:30`)) conflictKeys.push(`${s.startHour}:30`);
            }
          }
        }

        // 4. Conflict check against in-flight holds (excluding this user's own)
        const otherHolds = await tx.slotHold.findMany({
          where: {
            date: dateOnly,
            expiresAt: { gt: now },
            userId: { not: userId },
            courtConfig: {
              zones: { hasSome: config.zones as CourtZone[] },
            },
          },
        });
        for (const h of otherHolds) {
          for (let i = 0; i < h.hours.length; i++) {
            const hr = h.hours[i];
            const mn = h.startMinutes[i] ?? 0;
            // Hour-granular hold (legacy / non-bowling) blocks BOTH halves
            if (h.startMinutes.length === 0) {
              if (requested.has(`${hr}:0`)) conflictKeys.push(`${hr}:0`);
              if (requested.has(`${hr}:30`)) conflictKeys.push(`${hr}:30`);
            } else if (requested.has(`${hr}:${mn}`)) {
              conflictKeys.push(`${hr}:${mn}`);
            }
          }
        }

        if (conflictKeys.length > 0) {
          // Re-encode as half-hour slot indices so the client can
          // highlight them. Caller maps these back to {hour,minute}.
          const conflictIndices = Array.from(new Set(conflictKeys)).map((k) => {
            const [h, m] = k.split(":").map(Number);
            return slotKey(h, m);
          });
          throw new Error(`CONFLICTS:${conflictIndices.join(",")}`);
        }

        // 5. Slot-block check
        //    Same zone-overlap clause as createSlotHold: a block on a
        //    sibling config sharing this bowling court's zones (e.g. the
        //    cricket Full Field) takes the physical ground out of play,
        //    and the hold is the only place admin blocks are enforced
        //    before the Booking is written.
        const blocks = await tx.slotBlock.findMany({
          where: {
            date: dateOnly,
            OR: [
              { courtConfigId },
              { sport: config.sport },
              { courtConfigId: null, sport: null },
              { courtConfig: { zones: { hasSome: config.zones } } },
            ],
          },
        });
        for (const b of blocks) {
          if (b.startHour === null) {
            throw new Error("All bowling slots are blocked for this day");
          }
          for (const s of slots) {
            if (s.hour !== b.startHour) continue;
            if (b.startMinute === 30 && s.minute === 30) {
              throw new Error("This slot is blocked");
            }
            if (b.startMinute === 0) {
              throw new Error("This slot is blocked");
            }
          }
        }

        // 6. Clean prior bowling holds from this user on the same date.
        // paymentInitiatedAt: null retains a hold with an in-flight payment
        // (booking-reconstruction blueprint) so re-locking can't orphan it.
        await tx.slotHold.deleteMany({
          where: { userId, courtConfigId, date: dateOnly, paymentInitiatedAt: null },
        });

        const totalAmount = slots.reduce((sum, s) => sum + s.price, 0);

        const hold = await tx.slotHold.create({
          data: {
            platform,
            userId,
            courtConfigId,
            date: dateOnly,
            hours: slots.map((s) => s.hour),
            startMinutes: slots.map((s) => s.minute),
            slotPrices: slots as unknown as Prisma.InputJsonValue,
            totalAmount,
            expiresAt,
          },
        });

        return hold.id;
      },
      { timeout: 15000 },
    );

    return { success: true, holdId };
  } catch (error) {
    return holdFailure(error);
  }
}

/**
 * Release (delete) a slot hold. User abandoning checkout.
 * Safe to call on an already-deleted/expired hold.
 */
export async function releaseSlotHold(
  holdId: string,
  userId: string
): Promise<boolean> {
  // ONLY release a hold with no payment in flight. This is the explicit
  // "user left checkout" path (the release-lock beacon fires on navigate-
  // away). Once a payment has been initiated — paymentInitiatedAt is
  // stamped the moment a DQR QR / gateway order is created — the hold is
  // the SOLE blueprint for rebuilding the booking if the money lands late,
  // so it must survive and ride the PAYMENT_GRACE_HOURS window the cleanup
  // cron enforces (sweepExpiredHolds, below). Deleting it here orphaned
  // real captured payments: a customer paid via UPI intent, navigated back,
  // the beacon fired, and the money had no hold left to reconstruct from.
  // Availability gates on expiresAt > now, so a retained expired hold does
  // NOT keep the slot blocked.
  const result = await db.slotHold.deleteMany({
    where: { id: holdId, userId, paymentInitiatedAt: null },
  });
  return result.count > 0;
}

/**
 * How long, after a payment was initiated against a hold, we keep the
 * (expired) hold row around purely as a booking-reconstruction blueprint.
 *
 * A hold has two jobs: (1) reserve the slot during checkout, (2) carry the
 * court/time/amount/coupon/points data needed to build the Booking once the
 * gateway confirms payment. Job (1) ends at `expiresAt` (15 min) — slot
 * availability is gated on `expiresAt > now`, so an expired-but-undeleted
 * hold does NOT keep blocking the slot. But job (2) must outlive job (1):
 * a customer can complete a Razorpay/PhonePe payment AFTER our 15-min hold
 * expired (the gateway's payment window is independent of our TTL). If we
 * delete the row at expiry, the verify/webhook/recovery paths have nothing
 * to rebuild from and the captured payment is orphaned (paid, no booking).
 *
 * So: holds with a payment attempt are retained for this window after the
 * attempt, giving the late-payment + webhook + admin-recovery paths time to
 * reconstruct the booking. createBookingFromHold re-checks slot conflicts,
 * so a retained hold can never double-book a slot that got re-taken.
 */
const PAYMENT_GRACE_HOURS = 24;

/**
 * Cron: delete expired SlotHolds.
 *
 * Holds with NO payment attempt are deleted as soon as they expire (frees
 * the table promptly). Holds that DID start a payment are kept for
 * PAYMENT_GRACE_HOURS after the attempt so a late payment / webhook / admin
 * recovery can still rebuild the booking from them (see the constant above).
 * Bookings are never touched by this cron.
 */
export async function cleanupExpiredHolds(): Promise<number> {
  const now = new Date();
  const graceCutoff = new Date(now.getTime() - PAYMENT_GRACE_HOURS * 60 * 60 * 1000);
  const result = await db.slotHold.deleteMany({
    where: {
      expiresAt: { lt: now },
      OR: [
        // No payment was ever attempted → delete immediately at expiry.
        {
          paymentInitiatedAt: null,
          razorpayOrderId: null,
          phonePeMerchantTxnId: null,
        },
        // Payment attempted (paymentInitiatedAt stamped) but the grace
        // window has elapsed → recovery window is over.
        { paymentInitiatedAt: { lt: graceCutoff } },
        // Defensive: a payment ref exists but paymentInitiatedAt wasn't
        // stamped on this path — fall back to row activity (updatedAt).
        { paymentInitiatedAt: null, updatedAt: { lt: graceCutoff } },
      ],
    },
  });
  return result.count;
}

/**
 * Fetch a valid (non-expired) hold by id for a given user.
 * Returns null if expired, deleted, or owned by someone else.
 */
export async function getValidHold(holdId: string, userId: string) {
  const hold = await db.slotHold.findUnique({
    where: { id: holdId },
    include: { courtConfig: true },
  });
  if (!hold) return null;
  if (hold.userId !== userId) return null;
  if (hold.expiresAt < new Date()) return null;
  return hold;
}
