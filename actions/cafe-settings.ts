"use server";

import { db } from "@/lib/db";
import { adminAuth } from "@/lib/admin-auth-session";
import { hasPermission } from "@/lib/permissions";

// Get or create default cafe settings. Defensive: if the create
// itself fails (RLS / migration mid-flight / etc.) we fall back to
// a literal default so the customer-facing /cafe page and the
// admin /admin/cafe-menu header keep rendering instead of crashing
// the segment with a Server Components error. The fallback object
// matches the shape Prisma returns so callers don't need to
// special-case the empty state.
export async function getCafeSettings() {
  try {
    let settings = await db.cafeSettings.findFirst();
    if (!settings) {
      settings = await db.cafeSettings.create({
        data: { totalTables: 10 },
      });
    }
    return settings;
  } catch (err) {
    console.error("[cafe-settings] getCafeSettings failed", err);
    return {
      id: "__fallback__",
      totalTables: 10,
      isOpen: true,
      updatedAt: new Date(),
    };
  }
}

// Update cafe settings (admin only). Auth check inlined rather than
// extracted into a non-exported helper — "use server" files may
// emit warnings or fail to bundle correctly when they contain
// non-exported async functions in some Next 16 builds; keeping the
// file's exports tight avoids the gotcha entirely.
export async function updateCafeSettings(data: { totalTables: number }) {
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
 */
export async function setCafeOpen(isOpen: boolean) {
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
