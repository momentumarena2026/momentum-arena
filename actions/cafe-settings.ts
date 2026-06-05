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
 * Result shape for `setCafeOpen` — kept as a plain serialisable
 * discriminated union so the server action can RETURN errors
 * instead of THROWING them. Throwing across the server-action
 * boundary in Next 16 + React 19 surfaces as the generic "Server
 * Components render" digest error on the client, which is
 * impossible for the admin to act on. Returning a result instead
 * keeps the error path completely inside our client-side `if (!ok)`
 * branch — no error boundary, no digest.
 */
export type SetCafeOpenResult =
  | { ok: true; isOpen: boolean }
  | { ok: false; error: string };

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
 * (P2025). Instead we hit the row directly here and create-if-
 * missing, so the synthetic id is never reachable. Every failure
 * mode (auth lapse, missing migration column, transient pool,
 * unknown Prisma error) gets caught and returned as a `{ ok:false,
 * error }` tuple — the action itself never throws.
 */
export async function setCafeOpen(isOpen: boolean): Promise<SetCafeOpenResult> {
  // Auth check returns a failure result instead of throwing — the
  // throw path used to bubble across the action boundary as the
  // digest render error.
  try {
    const session = await adminAuth();
    if (
      !session ||
      !hasPermission(
        (session as unknown as { permissions: string[] }).permissions,
        "MANAGE_CAFE_MENU",
      )
    ) {
      return {
        ok: false,
        error: "You don't have permission to change the cafe state.",
      };
    }
  } catch (err) {
    console.error("[cafe-settings] setCafeOpen auth failed", err);
    return {
      ok: false,
      error: "Auth check failed — please sign in again and retry.",
    };
  }

  // DB write — findFirst by id only so the read succeeds even if a
  // future column was added to the schema but hasn't migrated yet.
  // If we have a row, update by its real id; if not, create the
  // singleton.
  try {
    const existing = await db.cafeSettings.findFirst({
      select: { id: true },
    });
    if (existing) {
      await db.cafeSettings.update({
        where: { id: existing.id },
        data: { isOpen },
      });
    } else {
      await db.cafeSettings.create({
        data: { isOpen, totalTables: 10 },
      });
    }
  } catch (err) {
    console.error("[cafe-settings] setCafeOpen DB write failed", err);
    return {
      ok: false,
      error:
        err instanceof Error && err.message
          ? `Couldn't save cafe state: ${err.message}`
          : "Couldn't save cafe state. Please try again.",
    };
  }

  // Revalidate downstream surfaces. revalidatePath itself can
  // (theoretically) fail if Next's cache layer hits an issue; keep
  // it inside try/catch so a stale-cache miss never turns into a
  // digest error AFTER the write has already succeeded.
  try {
    const { revalidatePath } = await import("next/cache");
    revalidatePath("/cafe");
    revalidatePath("/admin/cafe-menu");
  } catch (err) {
    console.error("[cafe-settings] revalidatePath failed", err);
    // Write succeeded — fall through to the success result. The
    // client's own router.refresh() will pull the new state on
    // its own.
  }

  return { ok: true, isOpen };
}
