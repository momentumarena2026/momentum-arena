import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getMobileUser } from "@/lib/mobile-auth";
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
export async function GET(request: NextRequest) {
  const user = await getMobileUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [items, settings] = await Promise.all([
    db.cafeItem.findMany({
      orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
    }),
    getCafeSettings(),
  ]);

  return NextResponse.json({ items, isOpen: settings.isOpen });
}
