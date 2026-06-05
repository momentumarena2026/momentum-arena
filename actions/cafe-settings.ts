"use server";

import { db } from "@/lib/db";
import { adminAuth } from "@/lib/admin-auth-session";
import { hasPermission } from "@/lib/permissions";

// Get or create default cafe settings
export async function getCafeSettings() {
  let settings = await db.cafeSettings.findFirst();
  if (!settings) {
    settings = await db.cafeSettings.create({
      data: { totalTables: 10 },
    });
  }
  return settings;
}

async function requireCafeAdmin() {
  const session = await adminAuth();
  if (
    !session ||
    !hasPermission(
      (session as unknown as { permissions: string[] }).permissions,
      "MANAGE_CAFE_MENU",
    )
  ) {
    throw new Error("Unauthorized: MANAGE_CAFE_MENU permission required");
  }
}

// Update cafe settings (admin only)
export async function updateCafeSettings(data: { totalTables: number }) {
  await requireCafeAdmin();

  const settings = await getCafeSettings();
  return db.cafeSettings.update({
    where: { id: settings.id },
    data: { totalTables: data.totalTables },
  });
}

/**
 * Master open/closed switch. Drives the customer-facing `/cafe`
 * page and the mobile Cafe tab: `true` → menu + ordering flow,
 * `false` → "Cafe is closed" page. Admin-side walk-in order
 * creation stays available either way so floor staff can keep
 * the cafe running operationally even when customer ordering is
 * closed.
 *
 * Separate from `updateCafeSettings` so the admin toggle UI can
 * fire a one-field action and so a future automation
 * (e.g. "auto-close at 11pm") can target just this flag.
 */
export async function setCafeOpen(isOpen: boolean) {
  await requireCafeAdmin();

  const settings = await getCafeSettings();
  const updated = await db.cafeSettings.update({
    where: { id: settings.id },
    data: { isOpen },
  });

  const { revalidatePath } = await import("next/cache");
  revalidatePath("/cafe");
  revalidatePath("/admin/cafe-menu");
  return updated;
}
