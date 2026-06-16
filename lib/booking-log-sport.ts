import { db } from "@/lib/db";
import type { Sport } from "@prisma/client";

const sportByConfigId = new Map<string, Sport>();

/** Resolve sport from a court config id (cached for hot availability polling). */
export async function sportForCourtConfigId(
  configId: string | null | undefined,
): Promise<Sport | null> {
  if (!configId) return null;
  const cached = sportByConfigId.get(configId);
  if (cached) return cached;
  const row = await db.courtConfig.findUnique({
    where: { id: configId },
    select: { sport: true },
  });
  if (row?.sport) sportByConfigId.set(configId, row.sport);
  return row?.sport ?? null;
}
