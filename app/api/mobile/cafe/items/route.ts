import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCafeSettings } from "@/actions/cafe-settings";

/**
 * Browse-only cafe menu for the mobile app. Returns the open/closed
 * flag alongside the items so the screen picks between the menu
 * view and the "Cafe is closed" view in a single round-trip. Items
 * are included even when closed so opening the cafe doesn't need a
 * second fetch — the screen just flips its render.
 *
 * Response: `{ isOpen: boolean, items: CafeItem[] }`.
 */
export async function GET() {
  // Public, like /cafe on the web and the mobile tournaments route.
  //
  // This used to require a token, so a signed-out phone got a 401 and the
  // screen — which turns any failure into "Couldn't load the cafe menu" —
  // reported a broken app rather than "sign in". Nothing here is
  // personal: the response is the item list and the open/closed flag, the
  // same thing any passer-by reads off the counter.
  //
  // Placing an order still requires a user (see ../orders/route.ts).
  const [items, settings] = await Promise.all([
    db.cafeItem.findMany({
      orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
    }),
    getCafeSettings(),
  ]);

  return NextResponse.json({ items, isOpen: settings.isOpen });
}
