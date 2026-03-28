"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { Sport } from "@prisma/client";

export interface ProfileStats {
  totalBookings: number;
  totalHours: number;
  favouriteSport: Sport | null;
  totalSpentPaise: number;
  memberSince: Date;
}

export async function getProfileStats(): Promise<ProfileStats | null> {
  const session = await auth();
  if (!session?.user?.id) return null;

  const userId = session.user.id;

  const [user, confirmedBookings] = await Promise.all([
    db.user.findUnique({
      where: { id: userId },
      select: { createdAt: true },
    }),
    db.booking.findMany({
      where: { userId, status: "CONFIRMED" },
      include: {
        slots: { select: { startHour: true } },
        courtConfig: { select: { sport: true } },
      },
    }),
  ]);

  if (!user) return null;

  const totalBookings = confirmedBookings.length;

  const totalHours = confirmedBookings.reduce(
    (sum, b) => sum + b.slots.length,
    0
  );

  const totalSpentPaise = confirmedBookings.reduce(
    (sum, b) => sum + b.totalAmount,
    0
  );

  // Determine favourite sport
  const sportCounts: Partial<Record<Sport, number>> = {};
  for (const b of confirmedBookings) {
    const sport = b.courtConfig.sport;
    sportCounts[sport] = (sportCounts[sport] ?? 0) + 1;
  }

  let favouriteSport: Sport | null = null;
  let maxCount = 0;
  for (const [sport, count] of Object.entries(sportCounts) as [
    Sport,
    number,
  ][]) {
    if (count > maxCount) {
      maxCount = count;
      favouriteSport = sport;
    }
  }

  return {
    totalBookings,
    totalHours,
    favouriteSport,
    totalSpentPaise,
    memberSince: user.createdAt,
  };
}
