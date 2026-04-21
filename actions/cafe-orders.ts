"use server";

import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { PaymentMethod } from "@prisma/client";
import { normalizeIndianPhone } from "@/lib/phone";

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

    // Validate items exist and are available
    const cafeItemIds = data.items.map((i) => i.cafeItemId);
    const cafeItems = await db.cafeItem.findMany({
      where: { id: { in: cafeItemIds }, isAvailable: true },
    });

    if (cafeItems.length !== cafeItemIds.length) {
      return { success: false, error: "Some items are unavailable or not found" };
    }

    const itemMap = new Map(cafeItems.map((i) => [i.id, i]));

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

    // Generate order number with random suffix to prevent race condition
    const orderCount = await db.cafeOrder.count();
    const rand = Math.random().toString(36).substring(2, 5).toUpperCase();
    const orderNumber = `MA-CAFE-${String(orderCount + 1).padStart(4, "0")}-${rand}`;

    // Determine payment status
    const paymentStatus =
      data.paymentMethod === "CASH" || data.paymentMethod === "UPI_QR"
        ? "PENDING"
        : "PENDING";

    // Normalize guest phone so the "91XXXXXXXXXX" form is used
    // consistently — this is what our SMS/analytics pipelines expect.
    const guestPhoneTrimmed = data.guestPhone?.trim();
    const guestPhoneNormalized = guestPhoneTrimmed
      ? normalizeIndianPhone(guestPhoneTrimmed)
      : null;

    const order = await db.cafeOrder.create({
      data: {
        orderNumber,
        userId: userId || null,
        guestName: !userId ? (data.guestName?.trim() || "Guest") : null,
        guestPhone: !userId ? (guestPhoneNormalized || null) : null,
        tableNumber: data.tableNumber || null,
        status: "PENDING",
        totalAmount,
        originalAmount,
        discountAmount,
        discountCodeId,
        note: data.note?.trim() || null,
        items: {
          create: orderItems,
        },
        payment: {
          create: {
            method: data.paymentMethod,
            status: paymentStatus,
            amount: totalAmount,
          },
        },
      },
      include: {
        items: true,
        payment: true,
      },
    });

    // Record discount usage if applied
    if (discountCodeId && discountAmount > 0) {
      await db.cafeDiscount.update({
        where: { id: discountCodeId },
        data: { usedCount: { increment: 1 } },
      });
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
  itemCategories: string[]
) {
  const session = await auth();
  const userId = session?.user?.id;

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

    // Check minimum order amount
    if (discount.minOrderAmount && amount < discount.minOrderAmount) {
      return {
        valid: false,
        error: `Minimum order of ₹${(discount.minOrderAmount / 100).toLocaleString("en-IN")} required`,
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

    // Calculate discount amount
    let discountValue: number;
    if (discount.type === "PERCENTAGE") {
      // value is in basis points (e.g., 1000 = 10%)
      discountValue = Math.round((amount * discount.value) / 10000);
    } else {
      // FLAT - value is in paise
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
