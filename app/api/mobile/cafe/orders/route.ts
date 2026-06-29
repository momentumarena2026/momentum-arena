import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getMobileUser, getMobilePlatform } from "@/lib/mobile-auth";
import { db } from "@/lib/db";
import { PaymentMethod } from "@prisma/client";
import { createCafePaymentIntent } from "@/lib/cafe-intent";
import { validateCafeCoupon } from "@/actions/cafe-orders";
import { isCheckoutMethodEnabled } from "@/actions/admin-payment-settings";

/**
 * Mobile cafe order creation. Mirrors the web createCafeOrder
 * server action but speaks mobile JWT instead of NextAuth session.
 *
 *   - ONLINE methods (RAZORPAY) → stash a CafePaymentIntent, return
 *     its id. No CafeOrder is created yet. The razorpay-verify
 *     mobile endpoint materialises the order on payment success.
 *   - IN-PERSON methods (CASH, UPI_QR) → create the CafeOrder
 *     immediately, decrement stock atomically, route Ready-only
 *     orders straight to COMPLETED.
 *
 * PhonePe is intentionally not exposed on mobile — the only
 * supported gateway is Razorpay (matches the booking flow).
 */
const Body = z.object({
  items: z
    .array(
      z.object({
        cafeItemId: z.string().min(1),
        quantity: z.number().int().positive(),
      }),
    )
    .min(1),
  paymentMethod: z.enum(["RAZORPAY", "CASH", "UPI_QR"]),
  discountCode: z.string().trim().min(1).optional(),
  note: z.string().trim().max(500).optional(),
});

export async function POST(request: NextRequest) {
  const user = await getMobileUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 },
    );
  }
  const data = parsed.data;

  // Closed-cafe gate. Settings row may not exist yet on a fresh
  // DB — treat that as open so a never-configured environment
  // doesn't lock customers out.
  const settings = await db.cafeSettings.findFirst({
    select: { isOpen: true },
  });
  if (settings && settings.isOpen === false) {
    return NextResponse.json(
      {
        error:
          "The cafe is currently closed and not accepting online orders. Please try again later.",
      },
      { status: 409 },
    );
  }

  // Server-side enforcement of the admin payment-method config — the app
  // hardcodes the method tiles, so guard here too.
  if (!(await isCheckoutMethodEnabled(data.paymentMethod))) {
    return NextResponse.json(
      { error: "That payment method isn't available right now." },
      { status: 409 },
    );
  }

  // Hydrate items + validate availability.
  const cafeItemIds = data.items.map((i) => i.cafeItemId);
  const cafeItems = await db.cafeItem.findMany({
    where: { id: { in: cafeItemIds }, isAvailable: true },
  });
  if (cafeItems.length !== cafeItemIds.length) {
    return NextResponse.json(
      { error: "Some items are unavailable or not found" },
      { status: 409 },
    );
  }
  const itemMap = new Map(cafeItems.map((i) => [i.id, i]));

  // Stock pre-check — refuse with a friendly per-item message
  // before we burn coupon credit or create an intent.
  for (const line of data.items) {
    const ci = itemMap.get(line.cafeItemId)!;
    if (ci.quantity !== null && ci.quantity < line.quantity) {
      return NextResponse.json(
        {
          error:
            ci.quantity === 0
              ? `${ci.name} is out of stock`
              : `Only ${ci.quantity} ${ci.name} left — please reduce the quantity`,
        },
        { status: 409 },
      );
    }
  }

  // Totals
  let totalAmount = 0;
  for (const line of data.items) {
    const ci = itemMap.get(line.cafeItemId)!;
    totalAmount += ci.price * line.quantity;
  }
  const originalAmount = totalAmount;
  let discountAmount = 0;
  let discountCodeId: string | null = null;
  if (data.discountCode) {
    const categories = cafeItems.map((i) => i.category);
    const couponResult = await validateCafeCoupon(
      data.discountCode,
      totalAmount,
      categories,
      user.id,
      getMobilePlatform(request),
    );
    if (!couponResult.valid) {
      return NextResponse.json(
        { error: couponResult.error ?? "Invalid coupon" },
        { status: 400 },
      );
    }
    discountAmount = couponResult.discount ?? 0;
    discountCodeId = couponResult.discountId ?? null;
    totalAmount = Math.max(0, totalAmount - discountAmount);
  }

  const isOnline = data.paymentMethod === "RAZORPAY";

  if (isOnline) {
    // Payment-first: stash an intent, return its id.
    const intent = await createCafePaymentIntent({
      userId: user.id,
      guestName: null,
      guestPhone: null,
      note: data.note ?? null,
      paymentMethod: data.paymentMethod as PaymentMethod,
      cart: data.items.map((i) => ({
        cafeItemId: i.cafeItemId,
        quantity: i.quantity,
      })),
      totalAmount,
      originalAmount,
      discountAmount,
      discountCodeId,
    });
    return NextResponse.json({
      ok: true,
      intent: true,
      orderId: intent.id,
      totalAmount,
    });
  }

  // In-person path — create the order, decrement stock, route
  // Ready-only orders to COMPLETED immediately.
  const orderCount = await db.cafeOrder.count();
  const rand = Math.random().toString(36).substring(2, 5).toUpperCase();
  const orderNumber = `MA-CAFE-${String(orderCount + 1).padStart(4, "0")}-${rand}`;

  const allReady = data.items.every(
    (l) => itemMap.get(l.cafeItemId)!.quantity !== null,
  );
  const orderStatus: "PENDING" | "COMPLETED" = allReady ? "COMPLETED" : "PENDING";

  const orderItemsData = data.items.map((l) => {
    const ci = itemMap.get(l.cafeItemId)!;
    return {
      cafeItemId: l.cafeItemId,
      itemName: ci.name,
      quantity: l.quantity,
      unitPrice: ci.price,
      totalPrice: ci.price * l.quantity,
    };
  });

  const order = await db.cafeOrder.create({
    data: {
      orderNumber,
      userId: user.id,
      status: orderStatus,
      totalAmount,
      originalAmount,
      discountAmount,
      discountCodeId,
      note: data.note ?? null,
      items: { create: orderItemsData },
      payment: {
        create: {
          method: data.paymentMethod as PaymentMethod,
          status: "PENDING",
          amount: totalAmount,
        },
      },
    },
  });

  // Atomic stock decrement with gte race guard.
  for (const line of data.items) {
    const ci = itemMap.get(line.cafeItemId)!;
    if (ci.quantity === null) continue;
    const updated = await db.cafeItem.updateMany({
      where: { id: line.cafeItemId, quantity: { gte: line.quantity } },
      data: { quantity: { decrement: line.quantity } },
    });
    if (updated.count === 0) {
      return NextResponse.json(
        {
          error: `${ci.name} sold out before we could record the order. Please try again with reduced quantity.`,
        },
        { status: 409 },
      );
    }
  }

  if (discountCodeId && discountAmount > 0) {
    await db.cafeDiscount.update({
      where: { id: discountCodeId },
      data: { usedCount: { increment: 1 } },
    });
  }

  return NextResponse.json({
    ok: true,
    intent: false,
    orderId: order.id,
    orderNumber: order.orderNumber,
    status: orderStatus,
  });
}

/**
 * List the signed-in customer's cafe orders, newest first.
 * Excludes PENDING_PAYMENT (mid-checkout intents are not surfaced
 * as orders to the customer).
 */
export async function GET(request: NextRequest) {
  const user = await getMobileUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const orders = await db.cafeOrder.findMany({
    where: {
      userId: user.id,
      status: { not: "PENDING_PAYMENT" },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      items: {
        select: {
          id: true,
          itemName: true,
          quantity: true,
          unitPrice: true,
          totalPrice: true,
          cafeItem: { select: { isVeg: true } },
        },
      },
      payment: {
        select: { method: true, status: true, amount: true },
      },
    },
  });
  return NextResponse.json({
    orders: orders.map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      status: o.status,
      totalAmount: o.totalAmount,
      originalAmount: o.originalAmount,
      discountAmount: o.discountAmount,
      createdAt: o.createdAt.toISOString(),
      items: o.items.map((it) => ({
        id: it.id,
        itemName: it.itemName,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        totalPrice: it.totalPrice,
        isVeg: it.cafeItem?.isVeg ?? true,
      })),
      payment: o.payment
        ? {
            method: o.payment.method,
            status: o.payment.status,
            amount: o.payment.amount,
          }
        : null,
    })),
  });
}
