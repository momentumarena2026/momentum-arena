"use server";

import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";
import { OPERATING_HOURS } from "@/lib/court-config";
import { revalidatePath } from "next/cache";

/**
 * Result shape — discriminated union so the admin client can
 * branch on `ok` without try/catch crossing the server-action
 * boundary.
 */
export type SetArenaHoursResult =
  | { ok: true; openHour: number; closeHour: number }
  | { ok: false; error: string };

/**
 * Read the live arena operating hours. Public-by-design: customer
 * slot pickers + the home-page hero hours block both consume
 * this. Falls back to the historical hardcoded defaults
 * (OPERATING_HOURS) if the row doesn't exist or the read fails,
 * so a broken/empty settings row never takes the slot picker
 * down.
 */
export async function getArenaSettings(): Promise<{
  openHour: number;
  closeHour: number;
}> {
  try {
    const row = await db.arenaSettings.findFirst({
      select: { openHour: true, closeHour: true },
    });
    if (row) {
      return { openHour: row.openHour, closeHour: row.closeHour };
    }
    return { openHour: OPERATING_HOURS.start, closeHour: OPERATING_HOURS.end };
  } catch (err) {
    console.error("[arena-settings] read failed, returning defaults", err);
    return { openHour: OPERATING_HOURS.start, closeHour: OPERATING_HOURS.end };
  }
}

/**
 * Update the arena operating hours. Admin-only.
 *
 * Constraints (mirror the legacy hardcoded range):
 *   - openHour 0..23 (inclusive). 24 doesn't make sense as a
 *     start because the slot would land outside the same calendar
 *     day before any 12am bookings even exist.
 *   - closeHour 1..29 (inclusive). Values ≥ 24 mean the last slot
 *     ends after midnight next day; e.g. 25 = last slot 12am-1am,
 *     29 = last slot 4am-5am. The hours-rendering helpers already
 *     wrap hour-mod-24 for display.
 *   - openHour < closeHour (must give at least one bookable hour).
 *
 * Never throws — returns `{ok:false, error}` for every failure so
 * the client's `if (!result.ok)` branch handles UI feedback
 * without an error boundary surfacing as a generic Server
 * Components digest error.
 */
export async function updateArenaSettings(data: {
  openHour: number;
  closeHour: number;
}): Promise<SetArenaHoursResult> {
  // Auth — same gate as every other pricing/admin write.
  try {
    await requireAdmin("MANAGE_PRICING");
  } catch {
    return {
      ok: false,
      error: "You don't have permission to update arena hours.",
    };
  }

  const open = Math.trunc(data.openHour);
  const close = Math.trunc(data.closeHour);

  if (!Number.isFinite(open) || open < 0 || open > 23) {
    return { ok: false, error: "Opening hour must be between 0 and 23." };
  }
  if (!Number.isFinite(close) || close < 1 || close > 29) {
    return {
      ok: false,
      error:
        "Closing hour must be between 1 and 29 (25 = 1am next day, 29 = 5am next day).",
    };
  }
  if (open >= close) {
    return {
      ok: false,
      error: "Closing hour must be after opening hour.",
    };
  }

  try {
    const existing = await db.arenaSettings.findFirst({
      select: { id: true },
    });
    if (existing) {
      await db.arenaSettings.update({
        where: { id: existing.id },
        data: { openHour: open, closeHour: close },
      });
    } else {
      await db.arenaSettings.create({
        data: { openHour: open, closeHour: close },
      });
    }
  } catch (err) {
    console.error("[arena-settings] update failed", err);
    return {
      ok: false,
      error:
        err instanceof Error && err.message
          ? `Couldn't save arena hours: ${err.message}`
          : "Couldn't save arena hours. Please try again.",
    };
  }

  // Best-effort revalidation — write already landed.
  try {
    revalidatePath("/admin/pricing");
    revalidatePath("/admin/calendar");
    revalidatePath("/book");
  } catch (err) {
    console.error("[arena-settings] revalidatePath failed", err);
  }

  return { ok: true, openHour: open, closeHour: close };
}
