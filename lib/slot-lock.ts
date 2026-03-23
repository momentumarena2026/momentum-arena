import { db } from "./db";
import { zonesOverlap, LOCK_TTL_MINUTES } from "./court-config";
import { CourtZone } from "@prisma/client";

export interface LockResult {
  success: boolean;
  bookingId?: string;
  error?: string;
  conflicts?: number[];
}

// Create a slot lock with serializable transaction to prevent race conditions
export async function createSlotLock(
  userId: string,
  courtConfigId: string,
  date: Date,
  hours: number[],
  slotPrices: { hour: number; price: number }[]
): Promise<LockResult> {
  const dateOnly = new Date(date.toISOString().split("T")[0]);
  const now = new Date();
  const lockExpiry = new Date(now.getTime() + LOCK_TTL_MINUTES * 60 * 1000);

  try {
    const result = await db.$transaction(
      async (tx) => {
        // Get the config we're trying to book
        const config = await tx.courtConfig.findUnique({
          where: { id: courtConfigId },
        });
        if (!config) throw new Error("Court config not found");
        if (!config.isActive) throw new Error("This court is currently unavailable");

        // Find all active bookings on this date with overlapping zones
        const activeBookings = await tx.booking.findMany({
          where: {
            date: dateOnly,
            OR: [
              { status: "CONFIRMED" },
              { status: "LOCKED", lockExpiresAt: { gt: now } },
            ],
          },
          include: {
            courtConfig: true,
            slots: true,
          },
        });

        const conflicting = activeBookings.filter((b) =>
          zonesOverlap(
            b.courtConfig.zones as CourtZone[],
            config.zones as CourtZone[]
          )
        );

        // Check for hour conflicts
        const occupiedHours = new Set<number>();
        for (const booking of conflicting) {
          for (const slot of booking.slots) {
            occupiedHours.add(slot.startHour);
          }
        }

        const conflicts = hours.filter((h) => occupiedHours.has(h));
        if (conflicts.length > 0) {
          throw new Error(`CONFLICTS:${conflicts.join(",")}`);
        }

        // Check admin blocks
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
            throw new Error(
              `Slot at hour ${block.startHour} is blocked by admin`
            );
          }
        }

        // Cancel any existing locks by this user for same config+date
        await tx.booking.updateMany({
          where: {
            userId,
            courtConfigId,
            date: dateOnly,
            status: "LOCKED",
          },
          data: { status: "CANCELLED" },
        });

        // Calculate total
        const totalAmount = slotPrices.reduce((sum, s) => sum + s.price, 0);

        // Create the locked booking
        const booking = await tx.booking.create({
          data: {
            userId,
            courtConfigId,
            date: dateOnly,
            status: "LOCKED",
            lockedAt: now,
            lockExpiresAt: lockExpiry,
            totalAmount,
            slots: {
              create: slotPrices.map((s) => ({
                startHour: s.hour,
                price: s.price,
              })),
            },
          },
        });

        return booking.id;
      },
      {
        isolationLevel: "Serializable",
        timeout: 10000,
      }
    );

    return { success: true, bookingId: result };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to lock slots";

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

// Release a slot lock (user abandoned checkout)
export async function releaseSlotLock(
  bookingId: string,
  userId: string
): Promise<boolean> {
  const result = await db.booking.updateMany({
    where: {
      id: bookingId,
      userId,
      status: "LOCKED",
    },
    data: { status: "CANCELLED" },
  });
  return result.count > 0;
}

// Clean up expired locks (called by cron)
export async function cleanupExpiredLocks(): Promise<number> {
  const result = await db.booking.updateMany({
    where: {
      status: "LOCKED",
      lockExpiresAt: { lt: new Date() },
    },
    data: { status: "CANCELLED" },
  });
  return result.count;
}
