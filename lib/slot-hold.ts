import { db } from "./db";
import { zonesOverlap, LOCK_TTL_MINUTES } from "./court-config";
import { CourtZone, Prisma } from "@prisma/client";

export interface HoldResult {
  success: boolean;
  holdId?: string;
  error?: string;
  conflicts?: number[];
}

export interface SlotPrice {
  hour: number;
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
