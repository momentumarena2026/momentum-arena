"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { Sport } from "@prisma/client";
import { requireAdmin as requireAdminBase } from "@/lib/admin-auth";

async function requireAdmin() {
  const user = await requireAdminBase("MANAGE_SLOTS");
  return user.id;
}

/**
 * Every action below is gated behind MANAGE_SLOTS for every caller.
 * `requireAdmin` resolves the caller from the web cookie session OR the
 * mobile Bearer JWT, so the mobile admin routes call these plainly — there
 * is no auth-bypass argument to pass (and never should be: in a
 * "use server" module the arguments come from the client).
 */

const blockSlotSchema = z.object({
  courtConfigId: z.string().optional(),
  sport: z.enum(["CRICKET", "FOOTBALL", "PICKLEBALL"]).optional(),
  date: z.string().min(1),
  startHour: z.number().int().min(5).max(24).optional(),
  reason: z.string().optional(),
});

export async function blockSlot(
  data: {
    courtConfigId?: string;
    sport?: Sport;
    date: string;
    startHour?: number;
    reason?: string;
  },
) {
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
      // A hand-raised block has no event behind it, but it is still worth
      // saying so: without this it is indistinguishable from a block
      // whose owner was never recorded, and the backfill would have to
      // guess which it was looking at.
      sourceType: "MANUAL",
      sourceLabel: parsed.data.reason || "Blocked by admin",
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
