"use server";

import { requireAdmin as requireAdminBase } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { DayType, type CourtZone } from "@prisma/client";

/**
 * Admin actions for the new Bowling-Machine practice flow inside
 * /admin/sports/bowling-machine. Three concerns live here:
 *
 *   1. Which half-court the machine blocks (LEFT vs RIGHT). The
 *      CourtConfig.zones array is the source of truth — the LEFT
 *      half is {LEATHER_1, BOX_A} and the RIGHT half is
 *      {LEATHER_2, BOX_B}. Flipping the zones swaps which physical
 *      side gets zone-blocked when a bowling booking lands.
 *   2. The OperatingWindow rows that describe disjoint open hours
 *      per day-type. Empty list = closed that day-type.
 *   3. Booking ID of the singleton bowling court — so the UI and
 *      future code paths can look it up without grepping for
 *      `position = 'BOWLING_MACHINE'`.
 *
 * MANAGE_SPORTS guards every mutation. SUPERADMIN bypasses.
 */

async function requireAdmin() {
  const user = await requireAdminBase("MANAGE_SPORTS");
  return user.id;
}

// ── Zone presets for the two physical halves ──────────────────────
// LEFT-half  = LEATHER_1 + BOX_A (matches CRICKET Medium-Left)
// RIGHT-half = LEATHER_2 + BOX_B (matches CRICKET Medium-Right)
const LEFT_HALF_ZONES: CourtZone[] = ["LEATHER_1", "BOX_A"];
const RIGHT_HALF_ZONES: CourtZone[] = ["LEATHER_2", "BOX_B"];

export type BowlingHalf = "LEFT" | "RIGHT";

/**
 * Read the singleton bowling-machine config + every operating
 * window row attached to it. Returns null when the config row
 * isn't present (e.g. someone deleted it post-migration).
 */
export async function getBowlingMachineSettings() {
  await requireAdmin();

  const config = await db.courtConfig.findFirst({
    where: { category: "BOWLING_MACHINE" },
    include: {
      operatingWindows: {
        orderBy: [{ dayType: "asc" }, { sortOrder: "asc" }, { startHour: "asc" }],
      },
    },
  });

  if (!config) return null;

  // Determine which half the machine currently occupies. We match
  // by the set of zones rather than position so a future admin
  // rename of `position` doesn't break the detection.
  const zones = new Set(config.zones);
  const isLeft = zones.has("LEATHER_1") && zones.has("BOX_A");
  const half: BowlingHalf = isLeft ? "LEFT" : "RIGHT";

  return {
    id: config.id,
    label: config.label,
    half,
    slotDurationMinutes: config.slotDurationMinutes,
    isActive: config.isActive,
    windows: config.operatingWindows.map((w) => ({
      id: w.id,
      dayType: w.dayType,
      startHour: w.startHour,
      startMinute: w.startMinute,
      endHour: w.endHour,
      endMinute: w.endMinute,
      sortOrder: w.sortOrder,
    })),
  };
}

/**
 * Swap the bowling-machine court's zones to occupy either the LEFT
 * or RIGHT physical half. Updates the CourtConfig.zones list in
 * place; the existing zone-overlap logic in the booking grid then
 * blocks the new half + the full field automatically.
 */
export async function setBowlingMachineHalf(half: BowlingHalf) {
  await requireAdmin();

  const config = await db.courtConfig.findFirst({
    where: { category: "BOWLING_MACHINE" },
    select: { id: true },
  });
  if (!config) return { success: false, error: "Bowling-machine court not configured" };

  await db.courtConfig.update({
    where: { id: config.id },
    data: {
      zones: half === "LEFT" ? LEFT_HALF_ZONES : RIGHT_HALF_ZONES,
    },
  });

  revalidatePath("/admin/sports/bowling-machine");
  // Calendar grids that render per-config blocking also need
  // refreshing so the staffer sees the new physical side reflected
  // immediately.
  revalidatePath("/admin/bookings/calendar");
  revalidatePath("/admin/bookings");
  return { success: true };
}

/**
 * Replace the bowling-machine court's full window list. Caller
 * passes the desired final state; we wipe and re-insert inside a
 * transaction so the row IDs don't churn in a way that breaks the
 * admin client's React keys mid-edit.
 *
 * Validation:
 *   - hours in 0–24, minutes 0 or 30
 *   - end >= start within each window (zero-length windows
 *     rejected — they're never useful and easy to mis-enter)
 *   - windows within the same dayType don't overlap. We compute
 *     in minutes-from-midnight to keep the maths obvious.
 */
export interface WindowInput {
  dayType: DayType;
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
}

export async function updateBowlingMachineWindows(windows: WindowInput[]) {
  await requireAdmin();

  const config = await db.courtConfig.findFirst({
    where: { category: "BOWLING_MACHINE" },
    select: { id: true },
  });
  if (!config) {
    return { success: false, error: "Bowling-machine court not configured" };
  }

  // ── Validation ──────────────────────────────────────────────
  function minutesOf(h: number, m: number) {
    return h * 60 + m;
  }

  for (const w of windows) {
    if (
      !Number.isInteger(w.startHour) ||
      !Number.isInteger(w.endHour) ||
      w.startHour < 0 ||
      w.startHour > 24 ||
      w.endHour < 0 ||
      w.endHour > 24
    ) {
      return { success: false, error: "Hours must be 0–24" };
    }
    if (![0, 30].includes(w.startMinute) || ![0, 30].includes(w.endMinute)) {
      return { success: false, error: "Minutes must be 00 or 30" };
    }
    if (minutesOf(w.endHour, w.endMinute) <= minutesOf(w.startHour, w.startMinute)) {
      return {
        success: false,
        error: `Window ${w.startHour}:${String(w.startMinute).padStart(2, "0")} → ${w.endHour}:${String(w.endMinute).padStart(2, "0")} is empty`,
      };
    }
  }

  // Overlap check per dayType
  for (const dt of ["WEEKDAY", "WEEKEND"] as DayType[]) {
    const same = windows
      .filter((w) => w.dayType === dt)
      .map((w) => [minutesOf(w.startHour, w.startMinute), minutesOf(w.endHour, w.endMinute)] as const)
      .sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < same.length; i++) {
      if (same[i][0] < same[i - 1][1]) {
        return { success: false, error: `${dt} windows overlap` };
      }
    }
  }

  await db.$transaction(async (tx) => {
    await tx.operatingWindow.deleteMany({
      where: { courtConfigId: config.id },
    });
    if (windows.length > 0) {
      await tx.operatingWindow.createMany({
        data: windows.map((w, i) => ({
          courtConfigId: config.id,
          dayType: w.dayType,
          startHour: w.startHour,
          startMinute: w.startMinute,
          endHour: w.endHour,
          endMinute: w.endMinute,
          sortOrder: i,
        })),
      });
    }
  });

  revalidatePath("/admin/sports/bowling-machine");
  // Customer-facing slot picker derives its grid from these
  // windows once Phase 4 ships — kicking those caches here means
  // a window edit lands without the admin having to hard-reload.
  revalidatePath("/book/cricket");
  revalidatePath("/admin/bookings/calendar");
  return { success: true };
}
