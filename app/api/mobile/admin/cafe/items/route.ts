import { NextRequest, NextResponse } from "next/server";
import { requireMobileAdmin } from "@/lib/mobile-admin-guard";
import { getCafeItems, createCafeItem } from "@/actions/admin-cafe";
import type { CafeItemCategory } from "@prisma/client";

const CATEGORIES: CafeItemCategory[] = [
  "SNACKS",
  "BEVERAGES",
  "MEALS",
  "DESSERTS",
  "COMBOS",
];

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
  const gate = await requireMobileAdmin(request, "MANAGE_CAFE_MENU");
  if ("error" in gate) return gate.error;

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

/**
 * POST /api/mobile/admin/cafe/items
 *
 * Creates a new cafe menu item — same fields as the web add-item form
 * (cafe-menu-client.tsx). The PREP/READY "fulfilment" choice is
 * derived from `quantity`: null = kitchen-prepared (PREP, no stock
 * tracking), an integer = ready-to-serve (READY, stock-tracked).
 *
 * Auth: requireMobileAdmin re-enforces MANAGE_CAFE_MENU here, then we
 * call the web action with skipAuth=true to bypass its NextAuth gate.
 */
export async function POST(request: NextRequest) {
  const gate = await requireMobileAdmin(request, "MANAGE_CAFE_MENU");
  if ("error" in gate) return gate.error;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const {
    name,
    description,
    category,
    price,
    costPrice,
    quantity,
    isVeg,
    tags,
  } = body as Record<string, unknown>;

  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }
  if (typeof category !== "string" || !CATEGORIES.includes(category as CafeItemCategory)) {
    return NextResponse.json({ error: "Invalid category" }, { status: 400 });
  }
  const priceNum = Number(price);
  if (!Number.isFinite(priceNum) || priceNum <= 0) {
    return NextResponse.json({ error: "Price must be positive" }, { status: 400 });
  }

  const result = await createCafeItem(
    {
      name: name.trim(),
      description:
        typeof description === "string" && description.trim()
          ? description.trim()
          : undefined,
      category: category as CafeItemCategory,
      price: priceNum,
      costPrice:
        costPrice === null || costPrice === undefined || costPrice === ""
          ? null
          : Number(costPrice),
      quantity:
        quantity === null || quantity === undefined ? null : Math.trunc(Number(quantity)),
      isVeg: !!isVeg,
      tags: Array.isArray(tags) ? tags.map((t) => String(t)) : [],
    },
    true,
  );

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true, item: result.item });
}
