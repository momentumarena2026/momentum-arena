"use server";

import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";
import { revalidatePath } from "next/cache";

/**
 * Master switch for the website's "get the app" prompts — the sticky strip
 * under the mobile header, the store icon in the header, and the footer
 * download section. One flag for all three: they're one campaign, and
 * having them drift out of sync (strip on, footer off) reads as a bug.
 *
 * Public read is used on every page render, so it must never throw — a
 * settings-row failure hides the prompts rather than breaking the site.
 */
export async function isDownloadAppBannerEnabled(): Promise<boolean> {
  try {
    const settings = await db.arenaSettings.findFirst({
      select: { downloadAppBannerEnabled: true },
    });
    return settings?.downloadAppBannerEnabled ?? false;
  } catch {
    return false;
  }
}

export async function setDownloadAppBannerEnabled(
  enabled: boolean,
): Promise<{ ok: true }> {
  await requireAdmin("MANAGE_PRICING");

  const existing = await db.arenaSettings.findFirst({ select: { id: true } });
  if (existing) {
    await db.arenaSettings.update({
      where: { id: existing.id },
      data: { downloadAppBannerEnabled: enabled },
    });
  } else {
    await db.arenaSettings.create({ data: { downloadAppBannerEnabled: enabled } });
  }

  // Every customer page renders these, so the whole tree needs revalidating.
  revalidatePath("/", "layout");
  return { ok: true };
}
