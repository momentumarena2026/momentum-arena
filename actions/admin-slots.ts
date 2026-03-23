"use server";

import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { Sport } from "@prisma/client";

async function requireAdmin() {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "ADMIN") {
    throw new Error("Unauthorized");
  }
  return session.user.id;
}

const blockSlotSchema = z.object({
  courtConfigId: z.string().optional(),
  sport: z.enum(["CRICKET", "FOOTBALL", "PICKLEBALL", "BADMINTON"]).optional(),
  date: z.string().min(1),
  startHour: z.number().int().min(5).max(24).optional(),
  reason: z.string().optional(),
});

export async function blockSlot(data: {
  courtConfigId?: string;
  sport?: Sport;
  date: string;
  startHour?: number;
  reason?: string;
}) {
  const adminId = await requireAdmin();

  const parsed = blockSlotSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false, error: "Invalid block data" };
  }

  await db.slotBlock.create({
    data: {
      courtConfigId: parsed.data.courtConfigId || null,
      sport: parsed.data.sport || null,
      date: new Date(parsed.data.date),
      startHour: parsed.data.startHour ?? null,
      reason: parsed.data.reason || null,
      blockedBy: adminId,
    },
  });

  return { success: true };
}

export async function unblockSlot(blockId: string) {
  await requireAdmin();

  await db.slotBlock.delete({ where: { id: blockId } });
  return { success: true };
}

export async function getSlotBlocks(date: string) {
  await requireAdmin();

  const blocks = await db.slotBlock.findMany({
    where: { date: new Date(date) },
    include: { courtConfig: true },
    orderBy: { startHour: "asc" },
  });

  return blocks;
}

export async function toggleSportActive(sport: Sport, isActive: boolean) {
  await requireAdmin();

  await db.courtConfig.updateMany({
    where: { sport },
    data: { isActive },
  });

  return { success: true };
}

export async function toggleConfigActive(configId: string, isActive: boolean) {
  await requireAdmin();

  await db.courtConfig.update({
    where: { id: configId },
    data: { isActive },
  });

  return { success: true };
}

export async function getAllSportsWithConfigs() {
  await requireAdmin();

  const configs = await db.courtConfig.findMany({
    orderBy: [{ sport: "asc" }, { size: "asc" }, { position: "asc" }],
  });

  return configs;
}
