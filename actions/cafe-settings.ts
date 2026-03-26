"use server";

import { db } from "@/lib/db";

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
  const settings = await getCafeSettings();
  return db.cafeSettings.update({
    where: { id: settings.id },
    data: { totalTables: data.totalTables },
  });
}
