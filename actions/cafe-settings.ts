"use server";

import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";

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

// Update cafe settings (admin only). Uses the same `requireAdmin`
// helper every other cafe-admin action uses (actions/admin-cafe.ts,
// actions/admin-cafe-orders.ts) so the auth surface is identical
// across the admin area.
export async function updateCafeSettings(data: { totalTables: number }) {
  await requireAdmin("MANAGE_CAFE_MENU");
  const settings = await getCafeSettings();
  return db.cafeSettings.update({
    where: { id: settings.id },
    data: { totalTables: data.totalTables },
  });
}

/**
 * Result shape for `setCafeOpen` — plain serialisable discriminated
 * union so the server action can RETURN errors instead of THROWING
 * them. Any throw across a Next 16 / React 19 server action
 * boundary surfaces as the generic "Server Components render"
 * digest error on the client. Returning a result keeps the error
 * path inside our client-side `if (!ok)` branch.
 */
export type SetCafeOpenResult =
  | { ok: true; isOpen: boolean }
  | { ok: false; error: string };

/**
 * Master open/closed switch. Drives the customer-facing /cafe page
 * and the mobile Cafe tab:
 *   - `true`  → menu + ordering flow active
 *   - `false` → "Cafe is closed" page for customers
 *
 * The admin walk-in order creation on /admin/cafe-orders/create is
 * unaffected — floor staff keep serving counter orders regardless.
 *
 * Auth is via `requireAdmin("MANAGE_CAFE_MENU")` — the same gate
 * the page itself sits behind, so anyone who can SEE the toggle
 * can also flip it.
 */
export async function setCafeOpen(
  isOpen: boolean,
): Promise<SetCafeOpenResult> {
  // Auth — same surface as every other cafe-menu admin action, and
  // unconditional: this is a "use server" export, so its arguments
  // come from the client. `requireAdmin` accepts either the web
  // cookie session or the mobile Bearer JWT, so mobile admin routes
  // calling this in-process authenticate here too. If the call would
  // throw (no session / no permission) we catch it and convert into a
  // failure result rather than letting it bubble across the
  // server-action boundary as a digest error.
  try {
    await requireAdmin("MANAGE_CAFE_MENU");
  } catch {
    return {
      ok: false,
      error: "You don't have permission to change the cafe state.",
    };
  }

  // DB write — findFirst by id only, so the read succeeds even if a
  // future schema column hasn't migrated yet. Upsert on absence so
  // the synthetic-id path from the fallback is unreachable here.
  try {
    const existing = await db.cafeSettings.findFirst({ select: { id: true } });
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

  // Best-effort cache revalidation — the write already succeeded
  // so a stale-cache miss must NOT surface as a failure to the
  // client (router.refresh on the client side will pull the new
  // state anyway).
  try {
    const { revalidatePath } = await import("next/cache");
    revalidatePath("/cafe");
    revalidatePath("/admin/cafe-menu");
  } catch (err) {
    console.error("[cafe-settings] revalidatePath failed", err);
  }

  return { ok: true, isOpen };
}
