import { NextRequest, NextResponse } from "next/server";
import { getMobileUser } from "@/lib/mobile-auth";
import {
  addToCart,
  clearCart,
  getCartForUser,
  mergeIntoServerCart,
  setCartQuantity,
} from "@/lib/cart";

/**
 * GET  /api/mobile/shop/cart                    — return current cart
 * POST /api/mobile/shop/cart                    — body-driven mutations:
 *   { op: "add",    productId, quantity }
 *   { op: "set",    productId, quantity }       (quantity 0 = remove)
 *   { op: "clear" }
 *   { op: "merge",  lines: [{productId, quantity}] }  (post-signin)
 */
export async function GET(request: NextRequest) {
  const user = await getMobileUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const cart = await getCartForUser(user.id);
  return NextResponse.json({ cart });
}

export async function POST(request: NextRequest) {
  const user = await getMobileUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    op?: "add" | "set" | "clear" | "merge";
    productId?: string;
    quantity?: number;
    lines?: Array<{ productId: string; quantity: number }>;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  try {
    if (body.op === "add") {
      if (!body.productId || typeof body.quantity !== "number") {
        return NextResponse.json(
          { error: "productId and quantity required" },
          { status: 400 },
        );
      }
      const cart = await addToCart(user.id, body.productId, body.quantity);
      return NextResponse.json({ cart });
    }
    if (body.op === "set") {
      if (!body.productId || typeof body.quantity !== "number") {
        return NextResponse.json(
          { error: "productId and quantity required" },
          { status: 400 },
        );
      }
      const cart = await setCartQuantity(user.id, body.productId, body.quantity);
      return NextResponse.json({ cart });
    }
    if (body.op === "clear") {
      const cart = await clearCart(user.id);
      return NextResponse.json({ cart });
    }
    if (body.op === "merge") {
      const cart = await mergeIntoServerCart(user.id, body.lines ?? []);
      return NextResponse.json({ cart });
    }
    return NextResponse.json({ error: "Unknown op" }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Cart mutation failed" },
      { status: 400 },
    );
  }
}
