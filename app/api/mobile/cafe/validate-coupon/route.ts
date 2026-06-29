import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getMobileUser, getMobilePlatform } from "@/lib/mobile-auth";
import { db } from "@/lib/db";
import { validateCafeCoupon } from "@/actions/cafe-orders";

/**
 * POST /api/mobile/cafe/validate-coupon — preview a cafe coupon before
 * placing the order. Mirrors how the order route computes the cart amount +
 * categories from the DB (the client cart doesn't carry categories), then
 * runs the same validateCafeCoupon used at order time so the preview matches
 * exactly. Returns { valid, discount?, discountId?, error? }.
 */
const Body = z.object({
  code: z.string().trim().min(1),
  items: z
    .array(
      z.object({
        cafeItemId: z.string().min(1),
        quantity: z.number().int().positive(),
      }),
    )
    .min(1),
});

export async function POST(request: NextRequest) {
  const user = await getMobileUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { valid: false, error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 },
    );
  }
  const { code, items } = parsed.data;

  const cafeItems = await db.cafeItem.findMany({
    where: { id: { in: items.map((i) => i.cafeItemId) } },
    select: { id: true, price: true, category: true },
  });
  const itemMap = new Map(cafeItems.map((i) => [i.id, i]));

  let amount = 0;
  for (const line of items) {
    const ci = itemMap.get(line.cafeItemId);
    if (ci) amount += ci.price * line.quantity;
  }
  const categories = cafeItems.map((i) => i.category);

  const result = await validateCafeCoupon(
    code,
    amount,
    categories,
    user.id,
    getMobilePlatform(request),
  );
  return NextResponse.json(result);
}
