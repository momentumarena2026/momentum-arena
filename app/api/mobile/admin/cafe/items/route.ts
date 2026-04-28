import { NextRequest, NextResponse } from "next/server";
import { getMobileAdmin } from "@/lib/mobile-auth";
import { getCafeItems } from "@/actions/admin-cafe";
import type { CafeItemCategory } from "@prisma/client";

/**
 * GET /api/mobile/admin/cafe/items?category=&search=&showUnavailable=1
 *
 * Lists cafe menu items, optionally filtered by category and a free-
 * text search across name + description. The mobile menu screen wants
 * to show unavailable items by default (so the toggle button is
 * usable), so the default for `showUnavailable` is true here — the
 * web admin client passes a checkbox.
 */
export async function GET(request: NextRequest) {
  const admin = await getMobileAdmin(request);
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const category = searchParams.get("category") || undefined;
  const search = searchParams.get("search") || undefined;
  const showUnavailable = searchParams.get("showUnavailable") !== "0";

  const result = await getCafeItems(
    {
      category: category as CafeItemCategory | undefined,
      search,
      showUnavailable,
    },
    true,
  );

  return NextResponse.json({ items: result.items, grouped: result.grouped });
}
