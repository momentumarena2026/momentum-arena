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

// Update cafe settings (admin only)
export async function updateCafeSettings(data: { totalTables: number }) {
  const session = await adminAuth();
  if (!session || !hasPermission(session.permissions, "MANAGE_CAFE_MENU")) {
    throw new Error("Unauthorized: MANAGE_CAFE_MENU permission required");
  }

  const settings = await getCafeSettings();
  return db.cafeSettings.update({
    where: { id: settings.id },
    data: { totalTables: data.totalTables },
  });
}
