"use server";

import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { PaymentMethod } from "@prisma/client";
import { normalizeIndianPhone } from "@/lib/phone";
import { createCafePaymentIntent } from "@/lib/cafe-intent";
import { isCheckoutMethodEnabled } from "@/actions/admin-payment-settings";

async function getOptionalCustomerId(): Promise<string | null> {
  try {
    const session = await auth();
    if (!session?.user?.id) return null;
    const user = await db.user.findUnique({ where: { id: session.user.id } });
    return user ? user.id : null;
  } catch {
    return null;
  }
}

export async function createCafeOrder(data: {
  items: { cafeItemId: string; quantity: number }[];
  paymentMethod: PaymentMethod;
  discountCode?: string;
  note?: string;
  guestName?: string;
  guestPhone?: string;
  tableNumber?: number;
}) {
  const userId = await getOptionalCustomerId();

  try {
    if (!data.items || data.items.length === 0) {
      return { success: false, error: "At least one item is required" };
    }

    // Closed-cafe guard. The customer-facing /cafe page renders
    // CafeClosedPage when `CafeSettings.isOpen === false`, but a
    // stale browser tab or in-flight mobile request from before the
    // admin closed the cafe could still hit this action. Refuse at
    // the action layer so the closed state is authoritative.
    //
    // We deliberately read `isOpen` directly off the row rather than
    // routing through `getCafeSettings` here — this is a hot path
    // and the row is a single record. If the lookup fails (the row
    // genuinely doesn't exist yet — fresh DB), treat as open so we
    // don't lock customers out of a never-configured cafe.
    const settings = await db.cafeSettings.findFirst({
      select: { isOpen: true },
    });
    if (settings && settings.isOpen === false) {
      return {
        success: false,
        error:
          "The cafe is currently closed and not accepting online orders. Please try again later.",
      };
    }

    // Server-side enforcement of the admin payment-method config.
    if (!(await isCheckoutMethodEnabled(data.paymentMethod))) {
      return {
        success: false,
        error: "That payment method isn't available right now.",
      };
    }

    // Validate items exist and are available
    const cafeItemIds = data.items.map((i) => i.cafeItemId);
    const cafeItems = await db.cafeItem.findMany({
      where: { id: { in: cafeItemIds }, isAvailable: true },
    });

    if (cafeItems.length !== cafeItemIds.length) {
      return { success: false, error: "Some items are unavailable or not found" };
    }

    const itemMap = new Map(cafeItems.map((i) => [i.id, i]));

    // Stock guard. For items with non-null `quantity` (drinks,
    // ice-cream, packaged snacks — anything the venue physically
    // procures) we refuse the order when the requested quantity
    // exceeds what's on hand. Kitchen-prepared items leave
    // CafeItem.quantity as NULL and skip the check entirely.
    //
    // The DB-level decrement that follows the order create runs
    // with a conditional WHERE clause so a race between two
    // simultaneous orders can't drive stock negative — see the
    // updateMany below.
    for (const line of data.items) {
      const cafeItem = itemMap.get(line.cafeItemId)!;
      if (cafeItem.quantity !== null && cafeItem.quantity < line.quantity) {
        return {
          success: false,
          error: cafeItem.quantity === 0
            ? `${cafeItem.name} is out of stock`
            : `Only ${cafeItem.quantity} ${cafeItem.name} left — please reduce the quantity`,
        };
      }
    }

    // Calculate totals from current prices
    let totalAmount = 0;
    const orderItems = data.items.map((item) => {
      const cafeItem = itemMap.get(item.cafeItemId)!;
      const totalPrice = cafeItem.price * item.quantity;
      totalAmount += totalPrice;
      return {
        cafeItemId: item.cafeItemId,
        itemName: cafeItem.name,
        quantity: item.quantity,
        unitPrice: cafeItem.price,
        totalPrice,
      };
    });

    const originalAmount = totalAmount;
    let discountAmount = 0;
    let discountCodeId: string | null = null;

    // Apply discount if provided
    if (data.discountCode) {
      const itemCategories = cafeItems.map((i) => i.category);
      const couponResult = await validateCafeCoupon(
        data.discountCode,
        totalAmount,
        itemCategories
      );
      if (couponResult.valid && couponResult.discount) {
        discountAmount = couponResult.discount;
        discountCodeId = couponResult.discountId || null;
        totalAmount = totalAmount - discountAmount;
        if (totalAmount < 0) totalAmount = 0;
      } else {
        return { success: false, error: couponResult.error || "Invalid coupon" };
      }
    }

    // Payment-first vs in-person dispatch.
    //
    // ONLINE methods (RAZORPAY, PHONEPE) — stash a CafePaymentIntent
    // (cart + totals + customer info) and return its id. NO
    // CafeOrder row is created. The gateway create-order /
    // initiate-payment endpoint stamps the gateway reference on the
    // intent. On verified payment, `materializeOrderFromIntent`
    // creates the real CafeOrder + items + payment. Modal dismiss /
    // payment failure deletes the intent — the CafeOrder table
    // never carries phantom cancelled rows. Mirrors the
    // SlotHold → Booking pattern on the sports side.
    //
    // IN-PERSON methods (CASH, UPI_QR) — order is real the moment
    // the counter staff confirms it. Create the CafeOrder directly,
    // decrement stock, route Ready-only orders straight to
    // COMPLETED.
    const isOnlineMethod =
      data.paymentMethod === "RAZORPAY" || data.paymentMethod === "PHONEPE";

    // Normalize guest phone so the "91XXXXXXXXXX" form is used
    // consistently — this is what our SMS/analytics pipelines expect.
    const guestPhoneTrimmed = data.guestPhone?.trim();
    const guestPhoneNormalized = guestPhoneTrimmed
      ? normalizeIndianPhone(guestPhoneTrimmed)
      : null;

    if (isOnlineMethod) {
      // Online path — stash a CafePaymentIntent and return its id.
      // The gateway create-order route will look it up by this id
      // and stamp the gateway reference. Stock is not touched, no
      // CafeOrder is created, and the coupon usage is NOT burned
      // here (it's burned at materialise time, so abandoned
      // checkouts don't waste a coupon).
      const intent = await createCafePaymentIntent({
        userId: userId || null,
        guestName: userId ? null : data.guestName?.trim() || "Guest",
        guestPhone: userId ? null : guestPhoneNormalized,
        note: data.note?.trim() || null,
        paymentMethod: data.paymentMethod,
        cart: data.items.map((i) => ({
          cafeItemId: i.cafeItemId,
          quantity: i.quantity,
        })),
        totalAmount,
        originalAmount,
        discountAmount,
        discountCodeId,
      });
      return {
        success: true,
        // The client treats this as `orderId` for backwards-compat
        // with the existing flow, but it's the INTENT id — the real
        // CafeOrder id is returned by the verify endpoint once the
        // payment lands.
        orderId: intent.id,
        intent: true,
      };
    }

    // ─── In-person path (CASH / UPI_QR) ───
    // Generate order number with random suffix to prevent race condition
    const orderCount = await db.cafeOrder.count();
    const rand = Math.random().toString(36).substring(2, 5).toUpperCase();
    const orderNumber = `MA-CAFE-${String(orderCount + 1).padStart(4, "0")}-${rand}`;

    const allReady = data.items.every(
      (line) => itemMap.get(line.cafeItemId)!.quantity !== null,
    );
    const orderStatus: "PENDING" | "COMPLETED" = allReady ? "COMPLETED" : "PENDING";

    const order = await db.cafeOrder.create({
      data: {
        orderNumber,
        userId: userId || null,
        guestName: !userId ? (data.guestName?.trim() || "Guest") : null,
        guestPhone: !userId ? (guestPhoneNormalized || null) : null,
        tableNumber: data.tableNumber || null,
        status: orderStatus,
        totalAmount,
        originalAmount,
        discountAmount,
        discountCodeId,
        note: data.note?.trim() || null,
        items: { create: orderItems },
        payment: {
          create: {
            method: data.paymentMethod,
            status: "PENDING",
            amount: totalAmount,
          },
        },
      },
      include: { items: true, payment: true },
    });

    // Stock decrement for in-person path. Sequential + gte guard
    // so a concurrent order can't drive stock negative.
    for (const line of data.items) {
      const cafeItem = itemMap.get(line.cafeItemId)!;
      if (cafeItem.quantity === null) continue;
      const updated = await db.cafeItem.updateMany({
        where: {
          id: line.cafeItemId,
          quantity: { gte: line.quantity },
        },
        data: { quantity: { decrement: line.quantity } },
      });
      if (updated.count === 0) {
        return {
          success: false,
          error: `${cafeItem.name} sold out before we could record the order — please try again with reduced quantity`,
        };
      }
    }

    // Burn coupon usage. For in-person orders this is safe at
    // create time — there's no abandon path. For online orders
    // it's burned inside materializeOrderFromIntent instead.
    if (discountCodeId && discountAmount > 0) {
      await db.cafeDiscount.update({
        where: { id: discountCodeId },
        data: { usedCount: { increment: 1 } },
      });
    }

    // Parity with the admin status-transition path (admin-cafe-orders.ts):
    // an order that lands DIRECTLY in COMPLETED (all items ready, no kitchen
    // step) still earns cafe reward points. The transition path only fires
    // when an order is *moved* to COMPLETED, so without this an all-ready
    // order would never earn. Idempotent + fire-and-forget at the lib layer.
    if (orderStatus === "COMPLETED" && userId) {
      const { awardCafePoints } = await import("@/lib/rewards/earn");
      void awardCafePoints(order.id).catch((err) =>
        console.error("[rewards] cafe award failed for", order.id, err),
      );
    }

    return {
      success: true,
      orderId: order.id,
      orderNumber: order.orderNumber,
    };
  } catch (error) {
    console.error("Failed to create cafe order:", error);
    return { success: false, error: "Failed to create order" };
  }
}

export async function validateCafeCoupon(
  code: string,
  amount: number,
  itemCategories: string[],
  explicitUserId?: string
) {
  // Web callers rely on the NextAuth session; mobile routes (no session)
  // pass the bearer user's id explicitly so the per-user usage check still
  // applies in both preview and at order time.
  const userId = explicitUserId ?? (await auth())?.user?.id;

  try {
    const discount = await db.cafeDiscount.findUnique({
      where: { code: code.toUpperCase().trim() },
    });

    if (!discount) {
      return { valid: false, error: "Coupon not found" };
    }

    if (!discount.isActive) {
      return { valid: false, error: "Coupon is no longer active" };
    }

    const now = new Date();
    if (now < discount.validFrom || now > discount.validUntil) {
      return { valid: false, error: "Coupon has expired or is not yet valid" };
    }

    // Check max uses
    if (discount.maxUses && discount.usedCount >= discount.maxUses) {
      return { valid: false, error: "Coupon usage limit reached" };
    }

    // Check per-user usage
    if (userId) {
      const userUsageCount = await db.cafeDiscountUsage.count({
        where: { discountId: discount.id, userId },
      });
      if (userUsageCount >= discount.maxUsesPerUser) {
        return { valid: false, error: "You have already used this coupon" };
      }
    }

    // Check minimum order amount. Both sides are rupees (Float)
    // after the cafe-prices-to-float-rupees migration; drop the
    // pre-migration /100 paise display.
    if (discount.minOrderAmount && amount < discount.minOrderAmount) {
      return {
        valid: false,
        error: `Minimum order of ₹${discount.minOrderAmount.toLocaleString("en-IN")} required`,
      };
    }

    // Check category filter
    if (discount.categoryFilter.length > 0) {
      const hasMatchingCategory = itemCategories.some((cat) =>
        discount.categoryFilter.includes(cat as never)
      );
      if (!hasMatchingCategory) {
        return {
          valid: false,
          error: "Coupon not applicable to items in your cart",
        };
      }
    }

    // Calculate discount amount. Both `amount` and the returned
    // `discountValue` are rupees (Float) post-migration; the
    // surrounding CafeOrder.discountAmount column is Float too.
    let discountValue: number;
    if (discount.type === "PERCENTAGE") {
      // value is in basis points (e.g., 1000 = 10%). 200 ₹ × 1000
      // bps / 10000 = 20 ₹.
      discountValue = (amount * discount.value) / 10000;
    } else {
      // FLAT — value is the rupee amount (post-migration; was
      // paise pre-migration).
      discountValue = discount.value;
    }

    // Cap discount at order amount
    if (discountValue > amount) {
      discountValue = amount;
    }

    return {
      valid: true,
      discount: discountValue,
      discountId: discount.id,
      code: discount.code,
      type: discount.type,
    };
  } catch (error) {
    console.error("Failed to validate coupon:", error);
    return { valid: false, error: "Failed to validate coupon" };
  }
}

export async function getMyCafeOrders(page = 1, limit = 20) {
  const userId = await getOptionalCustomerId();
  if (!userId) return [];

  const safeLimit = Math.min(limit, 50);
  const orders = await db.cafeOrder.findMany({
    where: { userId },
    include: {
      items: {
        include: { cafeItem: { select: { name: true, isVeg: true } } },
      },
      payment: true,
    },
    orderBy: { createdAt: "desc" },
    take: safeLimit,
    skip: (page - 1) * safeLimit,
  });

  return orders;
}
