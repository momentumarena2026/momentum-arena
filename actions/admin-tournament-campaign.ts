"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import { fireMilestone, draftCampaign } from "@/lib/tournament-campaign";

async function gate() {
  return requireAdmin("MANAGE_TOURNAMENTS");
}

export async function listCampaignItems(tournamentId: string) {
  await gate();
  await draftCampaign(tournamentId).catch(() => {}); // backfill older tournaments
  return db.tournamentCampaignItem.findMany({
    where: { tournamentId },
    orderBy: [{ milestone: "asc" }, { kind: "asc" }],
  });
}

const editSchema = z.object({
  title: z.string().trim().min(1).max(100),
  body: z.string().trim().max(500).optional(),
  enabled: z.boolean(),
});

export async function updateCampaignItem(
  itemId: string,
  input: unknown
): Promise<{ success: boolean; error?: string }> {
  await gate();
  const parsed = editSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message || "Invalid" };
  }
  const item = await db.tournamentCampaignItem.findUnique({
    where: { id: itemId },
    select: { tournamentId: true, status: true },
  });
  if (!item) return { success: false, error: "Item not found" };
  await db.tournamentCampaignItem.update({
    where: { id: itemId },
    data: {
      title: parsed.data.title,
      body: parsed.data.body || null,
      enabled: parsed.data.enabled,
      // Editing a skipped banner re-arms it (e.g. after adding an image).
      status: item.status === "SKIPPED" ? "DRAFT" : item.status,
    },
  });
  revalidatePath(`/admin/tournaments/${item.tournamentId}`);
  return { success: true };
}

/** Manual "Send now" for a single item's milestone entry. */
export async function sendCampaignItemNow(
  itemId: string
): Promise<{ success: boolean; error?: string }> {
  await gate();
  const item = await db.tournamentCampaignItem.findUnique({
    where: { id: itemId },
    select: { id: true, tournamentId: true, milestone: true, kind: true, status: true, enabled: true },
  });
  if (!item) return { success: false, error: "Item not found" };
  if (item.status === "SENT") return { success: false, error: "Already sent" };
  if (!item.enabled) return { success: false, error: "Enable the item first" };

  // Fire just this item: temporarily scope by marking others of the
  // milestone untouched — fireMilestone only touches DRAFT/SCHEDULED
  // enabled items, so isolate by re-checking after.
  const before = await db.tournamentCampaignItem.findMany({
    where: {
      tournamentId: item.tournamentId,
      milestone: item.milestone,
      id: { not: item.id },
      status: { in: ["DRAFT", "SCHEDULED"] },
      enabled: true,
    },
    select: { id: true },
  });
  // Park siblings so only this item fires.
  await db.tournamentCampaignItem.updateMany({
    where: { id: { in: before.map((x) => x.id) } },
    data: { status: "PARKED" },
  });
  const res = await fireMilestone(item.tournamentId, item.milestone);
  await db.tournamentCampaignItem.updateMany({
    where: { id: { in: before.map((x) => x.id) } },
    data: { status: "DRAFT" },
  });
  revalidatePath(`/admin/tournaments/${item.tournamentId}`);
  if (res.fired === 0) {
    return { success: false, error: "Nothing sent — check the item (banner needs an image)" };
  }
  return { success: true };
}
