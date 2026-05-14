import { db } from "./db";
import { zonesOverlap, LOCK_TTL_MINUTES } from "./court-config";
import { CourtZone, Prisma, Sport } from "@prisma/client";
import { getMediumConfigs } from "./availability";

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
function advisoryLockKey(configId: string, date: string, hour: number): number {
  const str = `${configId}:${date}:${hour}`;
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
export async function createSlotHold(
  userId: string,
  courtConfigId: string,
  date: Date,
  hours: number[],
  slotPrices: SlotPrice[]
): Promise<HoldResult> {
  const dateOnly = new Date(date.toISOString().split("T")[0]);
  const dateStr = date.toISOString().split("T")[0];
  const now = new Date();
  const expiresAt = new Date(now.getTime() + LOCK_TTL_MINUTES * 60 * 1000);

  try {
    const holdId = await db.$transaction(
      async (tx) => {
        // 1. Acquire advisory locks (sorted to prevent ordering edge-cases)
        const sortedHours = [...hours].sort((a, b) => a - b);
        for (const hour of sortedHours) {
          const lockKey = advisoryLockKey(courtConfigId, dateStr, hour);
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockKey}::bigint)`;
        }

        // 2. Validate the court config
        const config = await tx.courtConfig.findUnique({
          where: { id: courtConfigId },
        });
        if (!config) throw new Error("Court config not found");
        if (!config.isActive) throw new Error("This court is currently unavailable");

        // 3. Find bookings on this date that could overlap
        const activeBookings = await tx.booking.findMany({
          where: {
            date: dateOnly,
            status: { in: ["PENDING", "CONFIRMED"] },
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
        const blocks = await tx.slotBlock.findMany({
          where: {
            date: dateOnly,
            OR: [
              { courtConfigId },
              { sport: config.sport },
              { courtConfigId: null, sport: null },
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

        // 7. Clean up any prior holds by this user for the same config+date
        await tx.slotHold.deleteMany({
          where: { userId, courtConfigId, date: dateOnly },
        });

        // 8. Calculate total
        const totalAmount = slotPrices.reduce((sum, s) => sum + s.price, 0);

        // 9. Create the SlotHold
        const hold = await tx.slotHold.create({
          data: {
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
    const message =
      error instanceof Error ? error.message : "Failed to reserve slots";

    if (message.startsWith("CONFLICTS:")) {
      const conflicts = message
        .replace("CONFLICTS:", "")
        .split(",")
        .map(Number);
      return {
        success: false,
        error: "Some slots are no longer available",
        conflicts,
      };
    }

    return { success: false, error: message };
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
  slotPrices: SlotPrice[]
): Promise<HoldResult> {
  const { leftId, rightId } = await getMediumConfigs(sport);
  const dateOnly = new Date(date.toISOString().split("T")[0]);
  const dateStr = date.toISOString().split("T")[0];
  const now = new Date();
  const expiresAt = new Date(now.getTime() + LOCK_TTL_MINUTES * 60 * 1000);

  try {
    const holdId = await db.$transaction(
      async (tx) => {
        // Lock the requested hours on BOTH halves so another half-court
        // transaction can't race us between checks. Sorted keys prevent
        // deadlocks against other same-half transactions.
        const sortedHours = [...hours].sort((a, b) => a - b);
        for (const cfgId of [leftId, rightId]) {
          for (const hour of sortedHours) {
            const lockKey = advisoryLockKey(cfgId, dateStr, hour);
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockKey}::bigint)`;
          }
        }

        // Helper: is every requested hour free on `configId`?
        const isHalfFree = async (configId: string): Promise<boolean> => {
          const config = await tx.courtConfig.findUnique({
            where: { id: configId },
          });
          if (!config || !config.isActive) return false;

          const activeBookings = await tx.booking.findMany({
            where: {
              date: dateOnly,
              status: { in: ["PENDING", "CONFIRMED"] },
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
          // on the sport, or globally, disqualifies the half.
          const blocks = await tx.slotBlock.findMany({
            where: {
              date: dateOnly,
              OR: [
                { courtConfigId: configId },
                { sport: config.sport },
                { courtConfigId: null, sport: null },
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
        // (the old one is superseded).
        await tx.slotHold.deleteMany({
          where: {
            userId,
            date: dateOnly,
            courtConfigId: { in: [leftId, rightId] },
          },
        });

        const totalAmount = slotPrices.reduce((sum, s) => sum + s.price, 0);

        const hold = await tx.slotHold.create({
          data: {
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
    const message =
      error instanceof Error ? error.message : "Failed to reserve slots";

    if (message.startsWith("CONFLICTS:")) {
      const conflicts = message
        .replace("CONFLICTS:", "")
        .split(",")
        .map(Number);
      return {
        success: false,
        error: "Some slots are no longer available",
        conflicts,
      };
    }

    return { success: false, error: message };
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

  try {
    const holdId = await db.$transaction(
      async (tx) => {
        // 1. Acquire advisory locks
        const sorted = [...slots].sort(
          (a, b) => slotKey(a.hour, a.minute) - slotKey(b.hour, b.minute),
        );
        for (const s of sorted) {
          const lockKey = advisoryLockKey(
            courtConfigId,
            dateStr,
            slotKey(s.hour, s.minute),
          );
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockKey}::bigint)`;
        }

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
            status: { in: ["CONFIRMED", "PENDING"] },
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
        const blocks = await tx.slotBlock.findMany({
          where: {
            date: dateOnly,
            OR: [{ courtConfigId }, { sport: config.sport }, { courtConfigId: null, sport: null }],
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

        // 6. Clean prior bowling holds from this user on the same date
        await tx.slotHold.deleteMany({
          where: { userId, courtConfigId, date: dateOnly },
        });

        const totalAmount = slots.reduce((sum, s) => sum + s.price, 0);

        const hold = await tx.slotHold.create({
          data: {
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
    const message =
      error instanceof Error ? error.message : "Failed to reserve slots";

    if (message.startsWith("CONFLICTS:")) {
      const conflicts = message
        .replace("CONFLICTS:", "")
        .split(",")
        .map(Number);
      return {
        success: false,
        error: "Some slots are no longer available",
        conflicts,
      };
    }
    return { success: false, error: message };
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
  const result = await db.slotHold.deleteMany({
    where: { id: holdId, userId },
  });
  return result.count > 0;
}

/**
 * Cron: delete all expired SlotHolds.
 * Runs periodically. Bookings are never touched by this cron.
 */
export async function cleanupExpiredHolds(): Promise<number> {
  const result = await db.slotHold.deleteMany({
    where: { expiresAt: { lt: new Date() } },
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
