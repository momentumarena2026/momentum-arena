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
 *
 * Implementation note — DO NOT route through `getCafeSettings()`.
 * That helper returns a synthetic `{ id: "__fallback__", ... }`
 * object when the read fails, and feeding that id into
 * `db.cafeSettings.update` triggers Prisma's "record not found"
 * (P2025) which React 19 surfaces to the client as a generic
 * "Server Components render" error with a digest. Instead we hit
 * the row directly here and upsert on absence, so the action can
 * never throw P2025 for the synthetic-id case.
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

  let updated;
  try {
    const existing = await db.cafeSettings.findFirst({
      select: { id: true },
    });
    if (existing) {
      // Update by the actual primary key — never the fallback id.
      updated = await db.cafeSettings.update({
        where: { id: existing.id },
        data: { isOpen },
      });
    } else {
      // First-time write — create the singleton row carrying the
      // admin's chosen state. totalTables falls back to the default
      // we use everywhere else (10) so the row stays valid for the
      // table-count UI on the same page.
      updated = await db.cafeSettings.create({
        data: { isOpen, totalTables: 10 },
      });
    }
  } catch (err) {
    // Re-throw as a regular Error so the client-side try/catch in
    // CafeOpenToggle catches it with a readable message instead of
    // a Prisma error class that may serialise poorly across the
    // server-action boundary.
    console.error("[cafe-settings] setCafeOpen failed", err);
    throw new Error(
      err instanceof Error && err.message
        ? `Couldn't update cafe state: ${err.message}`
        : "Couldn't update cafe state. Please try again.",
    );
  }

  const { revalidatePath } = await import("next/cache");
  revalidatePath("/cafe");
  revalidatePath("/admin/cafe-menu");
  return updated;
}
