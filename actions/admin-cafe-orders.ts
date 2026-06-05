"use server";

import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";
import { CafeOrderStatus, PaymentMethod } from "@prisma/client";
import { normalizeIndianPhone } from "@/lib/phone";
import { sendToUser } from "@/lib/push";

async function requireCafeAdmin() {
  const user = await requireAdmin("MANAGE_CAFE_ORDERS");
  return user.id;
}

async function requireCafeAdminWithDetails() {
  const user = await requireAdmin("MANAGE_CAFE_ORDERS");
  const adminUser = await db.adminUser.findUnique({
    where: { id: user.id },
    select: { id: true, username: true },
  });
  if (!adminUser) throw new Error("Admin user not found");
  return adminUser;
}

/**
 * Mobile admin routes pre-authenticate via JWT. Reads accept
 * `skipAuth: true` and writes that need an admin identity accept
 * `adminOverride: { id, username }` so the mobile JWT identity flows
 * through to the audit log + push-notification author.
 */

export async function getCafeOrders(
  filters?: {
    date?: string;
    status?: CafeOrderStatus;
    search?: string;
    page?: number;
  },
  skipAuth?: boolean,
) {
  if (!skipAuth) await requireCafeAdmin();

  const page = filters?.page ?? 1;
  const limit = 20;
  const skip = (page - 1) * limit;

  // Default — hide PENDING_PAYMENT from every admin list. These
  // are mid-checkout intents that haven't been paid for and
  // haven't decremented stock yet; they're not real orders to the
  // operator. An explicit `filters.status === "PENDING_PAYMENT"`
  // can still surface them (for ops debugging), but the default
  // tab views never do.
  const where: Record<string, unknown> = {
    status: { not: "PENDING_PAYMENT" },
  };

  if (filters?.date) {
    const start = new Date(filters.date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(filters.date);
    end.setHours(23, 59, 59, 999);
    where.createdAt = { gte: start, lte: end };
  }

  if (filters?.status) {
    // Explicit status filter overrides the PENDING_PAYMENT
    // exclusion above — useful for an "orphaned payments" view.
    where.status = filters.status;
  }

  if (filters?.search) {
    where.OR = [
      { orderNumber: { contains: filters.search, mode: "insensitive" } },
      { guestName: { contains: filters.search, mode: "insensitive" } },
      { guestPhone: { contains: filters.search, mode: "insensitive" } },
      { user: { name: { contains: filters.search, mode: "insensitive" } } },
      { user: { phone: { contains: filters.search, mode: "insensitive" } } },
    ];
  }

  const [orders, total] = await Promise.all([
    db.cafeOrder.findMany({
      where,
      include: {
        items: { include: { cafeItem: { select: { name: true, isVeg: true } } } },
        user: { select: { id: true, name: true, email: true, phone: true } },
        payment: true,
        createdByAdmin: { select: { username: true } },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    db.cafeOrder.count({ where }),
  ]);

  return { orders, total, page, totalPages: Math.ceil(total / limit) };
}

export async function getCafeOrderStats(skipAuth?: boolean) {
  if (!skipAuth) await requireCafeAdmin();

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  // Exclude both CANCELLED (the original rule) and PENDING_PAYMENT
  // (new — these are mid-checkout intents, not real orders). Stats
  // should reflect only orders that actually transacted.
  const excludedStatuses: CafeOrderStatus[] = ["CANCELLED", "PENDING_PAYMENT"];

  const [todayOrders, todayRevenue, pendingCount, popularItems] =
    await Promise.all([
      db.cafeOrder.count({
        where: {
          createdAt: { gte: today, lt: tomorrow },
          status: { notIn: excludedStatuses },
        },
      }),
      db.cafeOrder.aggregate({
        where: {
          createdAt: { gte: today, lt: tomorrow },
          status: { notIn: excludedStatuses },
        },
        _sum: { totalAmount: true },
      }),
      db.cafeOrder.count({
        where: { status: "PENDING" },
      }),
      db.cafeOrderItem.groupBy({
        by: ["itemName"],
        where: {
          order: {
            createdAt: { gte: today, lt: tomorrow },
            status: { notIn: excludedStatuses },
          },
        },
        _sum: { quantity: true },
        orderBy: { _sum: { quantity: "desc" } },
        take: 5,
      }),
    ]);

  return {
    todayOrders,
    todayRevenue: todayRevenue._sum.totalAmount ?? 0,
    pendingCount,
    popularItems: popularItems.map((p) => ({
      name: p.itemName,
      quantity: p._sum.quantity ?? 0,
    })),
  };
}

export async function getLiveCafeOrders(skipAuth?: boolean) {
  if (!skipAuth) await requireCafeAdmin();

  // Bound the result so a runaway queue can't OOM the serverless worker.
  // A kitchen realistically never has more than ~50 open orders; 200 is a
  // safety margin before the page should switch to paginating.
  const orders = await db.cafeOrder.findMany({
    where: {
      status: { in: ["PENDING", "PREPARING", "READY"] },
    },
    include: {
      items: { include: { cafeItem: { select: { name: true, isVeg: true } } } },
      user: { select: { id: true, name: true, email: true, phone: true } },
      payment: true,
    },
    orderBy: { createdAt: "asc" },
    take: 200,
  });

  const grouped = {
    PENDING: orders.filter((o) => o.status === "PENDING"),
    PREPARING: orders.filter((o) => o.status === "PREPARING"),
    READY: orders.filter((o) => o.status === "READY"),
  };

  return grouped;
}

const STATUS_PIPELINE: Record<CafeOrderStatus, CafeOrderStatus[]> = {
  // PENDING_PAYMENT is a checkout intent that only flips via the
  // payment-verify route (→ PENDING/COMPLETED) or the cafe-cancel
  // path (→ CANCELLED). No admin manual transitions allowed — the
  // gateway owns this state. The empty array enforces that
  // `updateCafeOrderStatus` rejects any attempt to move out of it.
  PENDING_PAYMENT: [],
  PENDING: ["PREPARING", "CANCELLED"],
  PREPARING: ["READY", "CANCELLED"],
  READY: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

export async function updateCafeOrderStatus(
  orderId: string,
  newStatus: CafeOrderStatus,
  adminOverride?: { id: string; username: string },
) {
  const admin = adminOverride ?? (await requireCafeAdminWithDetails());

  try {
    const order = await db.cafeOrder.findUnique({
      where: { id: orderId },
      select: { id: true, status: true, orderNumber: true, userId: true },
    });

    if (!order) return { success: false, error: "Order not found" };

    const allowedTransitions = STATUS_PIPELINE[order.status];
    if (!allowedTransitions.includes(newStatus)) {
      return {
        success: false,
        error: `Cannot transition from ${order.status} to ${newStatus}`,
      };
    }

    await db.$transaction([
      db.cafeOrder.update({
        where: { id: orderId },
        data: { status: newStatus },
      }),
      db.cafeOrderEditHistory.create({
        data: {
          orderId,
          adminId: admin.id,
          adminUsername: admin.username,
          editType: "STATUS_CHANGED",
          note: `Status changed from ${order.status} to ${newStatus}`,
        },
      }),
    ]);

    // Customer-facing push for the meaningful status flips. PREPARING
    // ("we're cooking your order") and READY ("come pick it up") are
    // the two the customer cares about; COMPLETED and CANCELLED happen
    // after the customer is already at the venue (or the order died for
    // a reason they already know about), so no push for those.
    if (order.userId && (newStatus === "PREPARING" || newStatus === "READY")) {
      const isReady = newStatus === "READY";
      void sendToUser(order.userId, {
        title: isReady ? "Your cafe order is ready" : "Your cafe order is being prepared",
        body: isReady
          ? `Order #${order.orderNumber} — head to the cafe counter for pickup.`
          : `Order #${order.orderNumber} is in the kitchen. We'll ping you when it's ready.`,
        data: { kind: "cafe_order_status", cafeOrderId: orderId, status: newStatus },
      }).catch((err) => console.error("Cafe order push failed:", err));
    }

    // Award reward points when the order is COMPLETED (food delivered).
    // Idempotent at the lib layer — safe even if the order toggles
    // backwards through COMPLETED.
    if (newStatus === "COMPLETED" && order.userId) {
      const { awardCafePoints } = await import("@/lib/rewards/earn");
      void awardCafePoints(orderId).catch((err) =>
        console.error("[rewards] cafe award failed for", orderId, err),
      );
    }

    return { success: true };
  } catch (error) {
    console.error("Failed to update order status:", error);
    return { success: false, error: "Failed to update status" };
  }
}

export async function adminCreateCafeOrder(data: {
  items: { cafeItemId: string; quantity: number }[];
  userId?: string;
  guestName?: string;
  guestPhone?: string;
  paymentMethod: PaymentMethod;
  note?: string;
}) {
  const admin = await requireCafeAdminWithDetails();

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
      return {
        success: false,
        error: "Some items are unavailable or not found",
      };
    }

    const itemMap = new Map(cafeItems.map((i) => [i.id, i]));

    // Stock guard — mirror of the customer path in
    // actions/cafe-orders.ts. NULL quantity = unlimited /
    // kitchen-prepared; non-null = trackable stock that must
    // cover the requested line.
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

    // Calculate totals
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

    // Generate order number with random suffix to prevent race condition
    const orderCount = await db.cafeOrder.count();
    const rand = Math.random().toString(36).substring(2, 5).toUpperCase();
    const orderNumber = `MA-CAFE-${String(orderCount + 1).padStart(4, "0")}-${rand}`;

    // Determine payment status
    const paymentStatus =
      data.paymentMethod === "FREE" || data.paymentMethod === "RAZORPAY"
        ? "COMPLETED"
        : "PENDING";

    // Order-status routing: ready-to-serve items (CafeItem.quantity
    // is a non-null integer — drinks, ice-cream, packaged snacks)
    // are handed over at the counter the moment the order is rung
    // up, so they skip the kitchen pipeline entirely and land
    // straight in COMPLETED. Kitchen-prepared items (quantity is
    // NULL — sandwiches, hot meals) need PREPARING → READY →
    // COMPLETED, so the order starts at PENDING and the kitchen
    // kanban takes over. Mixed orders (some of each) stay PENDING
    // — the kitchen sees the whole ticket so the ready items get
    // handed over alongside the prepared ones, not separately.
    const allReady = data.items.every(
      (line) => itemMap.get(line.cafeItemId)?.quantity != null,
    );
    const orderStatus: "PENDING" | "COMPLETED" = allReady
      ? "COMPLETED"
      : "PENDING";

    const guestPhoneTrimmed = data.guestPhone?.trim();
    const guestPhoneNormalized = guestPhoneTrimmed
      ? normalizeIndianPhone(guestPhoneTrimmed)
      : null;

    const order = await db.cafeOrder.create({
      data: {
        orderNumber,
        userId: data.userId || null,
        guestName: data.guestName?.trim() || null,
        guestPhone: guestPhoneNormalized,
        status: orderStatus,
        totalAmount,
        originalAmount: totalAmount,
        note: data.note?.trim() || null,
        createdByAdminId: admin.id,
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
        editHistory: {
          create: {
            adminId: admin.id,
            adminUsername: admin.username,
            editType: "ORDER_CREATED",
            newAmount: totalAmount,
            note: allReady
              ? `Order created by ${admin.username} — all items ready-to-serve, handed over at counter (status: COMPLETED)`
              : `Order created by ${admin.username}`,
          },
        },
      },
      include: {
        items: true,
        payment: true,
      },
    });

    // Atomic stock decrement for trackable items. Same race-safe
    // pattern as the customer order path — `updateMany` with a
    // gte guard so two simultaneous orders can't drive stock
    // negative. NULL-quantity items (kitchen-prepared) skip the
    // update entirely.
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

    return { success: true, order };
  } catch (error) {
    console.error("Failed to create cafe order:", error);
    return { success: false, error: "Failed to create order" };
  }
}

export async function cancelCafeOrder(
  orderId: string,
  reason: string,
  adminOverride?: { id: string; username: string },
) {
  const admin = adminOverride ?? (await requireCafeAdminWithDetails());

  try {
    const order = await db.cafeOrder.findUnique({
      where: { id: orderId },
      include: { payment: true, items: true },
    });

    if (!order) return { success: false, error: "Order not found" };
    if (order.status === "CANCELLED") {
      return { success: false, error: "Order is already cancelled" };
    }
    if (order.status === "COMPLETED") {
      return { success: false, error: "Cannot cancel a completed order" };
    }

    // Stock restoration. Orders past PENDING_PAYMENT had their
    // Ready-line stock decremented at order-create time (in-person)
    // or at payment-verify time (online). When the admin cancels,
    // return that stock to the shelf so the items become available
    // again to other customers.
    //
    // PENDING_PAYMENT orders never decremented inventory — they
    // were waiting for the gateway to confirm — so they get no
    // stock restoration and no refund (no payment was captured).
    const shouldRestoreStock = order.status !== "PENDING_PAYMENT";
    let stockToRestore: { id: string; quantity: number }[] = [];
    if (shouldRestoreStock) {
      const cafeItemIds = order.items.map((i) => i.cafeItemId);
      const currentItems = await db.cafeItem.findMany({
        where: { id: { in: cafeItemIds } },
        select: { id: true, quantity: true },
      });
      const currentMap = new Map(currentItems.map((c) => [c.id, c]));
      // Only restore lines whose item still tracks stock. If the
      // admin flipped an item from Ready → Prepare since the order
      // was placed, quantity is now null (untracked) and there's
      // nothing meaningful to increment.
      stockToRestore = order.items
        .filter((line) => currentMap.get(line.cafeItemId)?.quantity !== null)
        .map((line) => ({
          id: line.cafeItemId,
          quantity: line.quantity,
        }));
    }

    await db.$transaction(async (tx) => {
      await tx.cafeOrder.update({
        where: { id: orderId },
        data: { status: "CANCELLED" },
      });
      await tx.cafeOrderEditHistory.create({
        data: {
          orderId,
          adminId: admin.id,
          adminUsername: admin.username,
          editType: "ORDER_CANCELLED",
          previousAmount: order.totalAmount,
          note: reason || "Order cancelled",
        },
      });
      if (order.payment) {
        await tx.cafePayment.update({
          where: { id: order.payment.id },
          data: {
            // PENDING_PAYMENT cancellation never captured the
            // funds; mark FAILED instead of REFUNDED so the
            // refund-due reports don't surface a phantom liability.
            status:
              order.status === "PENDING_PAYMENT" ? "FAILED" : "REFUNDED",
            refundedBy:
              order.status === "PENDING_PAYMENT" ? null : admin.id,
            refundedAt:
              order.status === "PENDING_PAYMENT" ? null : new Date(),
            refundReason: reason,
          },
        });
      }
      // Atomic restore inside the same transaction so a cancel
      // either fully reverts (status + stock + payment together)
      // or none of it lands.
      for (const item of stockToRestore) {
        await tx.cafeItem.update({
          where: { id: item.id },
          data: { quantity: { increment: item.quantity } },
        });
      }
    });
    return { success: true };
  } catch (error) {
    console.error("Failed to cancel order:", error);
    return { success: false, error: "Failed to cancel order" };
  }
}

export async function searchCafeCustomers(query: string) {
  await requireCafeAdmin();

  if (!query || query.length < 2) return { customers: [] };

  const customers = await db.user.findMany({
    where: {
      OR: [
        { name: { contains: query, mode: "insensitive" } },
        { email: { contains: query, mode: "insensitive" } },
        { phone: { contains: query, mode: "insensitive" } },
      ],
    },
    select: { id: true, name: true, email: true, phone: true },
    take: 10,
  });

  return { customers };
}

export async function addItemsToCafeOrder(
  orderId: string,
  items: { cafeItemId: string; quantity: number }[]
) {
  const admin = await requireCafeAdminWithDetails();

  try {
    const order = await db.cafeOrder.findUnique({
      where: { id: orderId },
      include: { items: true },
    });

    if (!order) return { success: false, error: "Order not found" };
    if (order.status !== "PENDING" && order.status !== "PREPARING") {
      return { success: false, error: "Can only add items to PENDING or PREPARING orders" };
    }

    const cafeItemIds = items.map((i) => i.cafeItemId);
    const cafeItems = await db.cafeItem.findMany({
      where: { id: { in: cafeItemIds }, isAvailable: true },
    });

    if (cafeItems.length !== cafeItemIds.length) {
      return { success: false, error: "Some items are unavailable" };
    }

    const itemMap = new Map(cafeItems.map((i) => [i.id, i]));
    let addedAmount = 0;
    const newItems = items.map((item) => {
      const cafeItem = itemMap.get(item.cafeItemId)!;
      const totalPrice = cafeItem.price * item.quantity;
      addedAmount += totalPrice;
      return {
        orderId,
        cafeItemId: item.cafeItemId,
        itemName: cafeItem.name,
        quantity: item.quantity,
        unitPrice: cafeItem.price,
        totalPrice,
      };
    });

    const newTotal = order.totalAmount + addedAmount;

    // Pre-flight stock check + reservation. Add-on items must be
    // stocked the same way createCafeOrder reserves them — gte
    // guard so a concurrent order can't push us negative. Items
    // with quantity===null (kitchen-prepared) skip the check.
    // We attempt every decrement BEFORE writing anything else, and
    // roll back on race-loss so the add-items operation is
    // atomic.
    const decremented: { id: string; quantity: number }[] = [];
    for (const line of items) {
      const ci = itemMap.get(line.cafeItemId)!;
      if (ci.quantity === null) continue;
      const updated = await db.cafeItem.updateMany({
        where: { id: line.cafeItemId, quantity: { gte: line.quantity } },
        data: { quantity: { decrement: line.quantity } },
      });
      if (updated.count === 0) {
        for (const rb of decremented) {
          await db.cafeItem.update({
            where: { id: rb.id },
            data: { quantity: { increment: rb.quantity } },
          });
        }
        return {
          success: false,
          error:
            ci.quantity === 0
              ? `${ci.name} is out of stock`
              : `Only ${ci.quantity} ${ci.name} left — try a smaller quantity`,
        };
      }
      decremented.push({ id: line.cafeItemId, quantity: line.quantity });
    }

    await db.$transaction([
      db.cafeOrderItem.createMany({ data: newItems }),
      db.cafeOrder.update({
        where: { id: orderId },
        data: { totalAmount: newTotal },
      }),
      db.cafePayment.updateMany({
        where: { orderId },
        data: { amount: newTotal },
      }),
      db.cafeOrderEditHistory.create({
        data: {
          orderId,
          adminId: admin.id,
          adminUsername: admin.username,
          editType: "ITEMS_ADDED",
          previousAmount: order.totalAmount,
          newAmount: newTotal,
          newItems: items.map((i) => ({
            name: itemMap.get(i.cafeItemId)!.name,
            quantity: i.quantity,
          })),
          note: `Added ${items.length} item(s)`,
        },
      }),
    ]);

    return { success: true };
  } catch (error) {
    console.error("Failed to add items:", error);
    return { success: false, error: "Failed to add items" };
  }
}

export async function cancelItemsFromCafeOrder(
  orderId: string,
  orderItemIds: string[]
) {
  const admin = await requireCafeAdminWithDetails();

  try {
    const order = await db.cafeOrder.findUnique({
      where: { id: orderId },
      include: { items: true },
    });

    if (!order) return { success: false, error: "Order not found" };
    if (order.status !== "PENDING" && order.status !== "PREPARING") {
      return { success: false, error: "Can only remove items from PENDING or PREPARING orders" };
    }

    const itemsToRemove = order.items.filter((i) =>
      orderItemIds.includes(i.id)
    );
    if (itemsToRemove.length === 0) {
      return { success: false, error: "No matching items found" };
    }

    const removedAmount = itemsToRemove.reduce(
      (sum, i) => sum + i.totalPrice,
      0
    );
    const remainingCount = order.items.length - itemsToRemove.length;

    if (remainingCount === 0) {
      // Cancel the entire order
      return cancelCafeOrder(orderId, "All items removed");
    }

    const newTotal = order.totalAmount - removedAmount;

    // Stock restore for removed lines. Only restore lines whose
    // CafeItem still tracks stock (quantity != null currently). If
    // the admin flipped an item from Ready → Prepare since the
    // order was placed, quantity is now null and nothing meaningful
    // can be incremented.
    const removedCafeItemIds = itemsToRemove.map((i) => i.cafeItemId);
    const currentItems = await db.cafeItem.findMany({
      where: { id: { in: removedCafeItemIds } },
      select: { id: true, quantity: true },
    });
    const currentMap = new Map(currentItems.map((c) => [c.id, c]));
    const stockToRestore = itemsToRemove
      .filter((line) => currentMap.get(line.cafeItemId)?.quantity !== null)
      .map((line) => ({ id: line.cafeItemId, quantity: line.quantity }));

    await db.$transaction(async (tx) => {
      await tx.cafeOrderItem.deleteMany({
        where: { id: { in: orderItemIds }, orderId },
      });
      await tx.cafeOrder.update({
        where: { id: orderId },
        data: { totalAmount: newTotal },
      });
      await tx.cafePayment.updateMany({
        where: { orderId },
        data: { amount: newTotal },
      });
      await tx.cafeOrderEditHistory.create({
        data: {
          orderId,
          adminId: admin.id,
          adminUsername: admin.username,
          editType: "ITEMS_REMOVED",
          previousAmount: order.totalAmount,
          newAmount: newTotal,
          previousItems: itemsToRemove.map((i) => ({
            name: i.itemName,
            quantity: i.quantity,
          })),
          note: `Removed ${itemsToRemove.length} item(s)`,
        },
      });
      for (const item of stockToRestore) {
        await tx.cafeItem.update({
          where: { id: item.id },
          data: { quantity: { increment: item.quantity } },
        });
      }
    });

    return { success: true };
  } catch (error) {
    console.error("Failed to remove items:", error);
    return { success: false, error: "Failed to remove items" };
  }
}

export async function updateCafeItemQuantity(
  orderId: string,
  orderItemId: string,
  newQuantity: number
) {
  const admin = await requireCafeAdminWithDetails();

  try {
    if (newQuantity < 1) {
      return { success: false, error: "Quantity must be at least 1" };
    }

    const order = await db.cafeOrder.findUnique({
      where: { id: orderId },
      include: { items: true },
    });

    if (!order) return { success: false, error: "Order not found" };
    if (order.status !== "PENDING" && order.status !== "PREPARING") {
      return { success: false, error: "Can only edit PENDING or PREPARING orders" };
    }

    const item = order.items.find((i) => i.id === orderItemId);
    if (!item) return { success: false, error: "Item not found in order" };

    const newItemTotal = item.unitPrice * newQuantity;
    const priceDiff = newItemTotal - item.totalPrice;
    const newOrderTotal = order.totalAmount + priceDiff;

    // Stock delta. If qty went up, we need to decrement the
    // CafeItem.quantity by the increase (with gte race guard so a
    // concurrent buyer can't take the last one out from under us).
    // If qty went down, we restore the freed units. quantity=null
    // on the live CafeItem means "kitchen-prepared / untracked" —
    // skip both decrement and restore.
    const qtyDelta = newQuantity - item.quantity;
    let stockOp: "increment" | "decrement" | null = null;
    let stockAmount = 0;
    if (qtyDelta !== 0) {
      const live = await db.cafeItem.findUnique({
        where: { id: item.cafeItemId },
        select: { name: true, quantity: true },
      });
      if (live && live.quantity !== null) {
        if (qtyDelta > 0) {
          // Reserve more — use gte guard so we don't oversell.
          const reserved = await db.cafeItem.updateMany({
            where: {
              id: item.cafeItemId,
              quantity: { gte: qtyDelta },
            },
            data: { quantity: { decrement: qtyDelta } },
          });
          if (reserved.count === 0) {
            return {
              success: false,
              error:
                live.quantity === 0
                  ? `${live.name} is out of stock — can't increase quantity`
                  : `Only ${live.quantity} ${live.name} left — try a smaller increase`,
            };
          }
          stockOp = "decrement";
          stockAmount = qtyDelta;
        } else {
          // Free units back to stock.
          stockOp = "increment";
          stockAmount = -qtyDelta;
        }
      }
    }

    try {
      await db.$transaction([
        db.cafeOrderItem.update({
          where: { id: orderItemId },
          data: { quantity: newQuantity, totalPrice: newItemTotal },
        }),
        db.cafeOrder.update({
          where: { id: orderId },
          data: { totalAmount: newOrderTotal },
        }),
        db.cafePayment.updateMany({
          where: { orderId },
          data: { amount: newOrderTotal },
        }),
        db.cafeOrderEditHistory.create({
          data: {
            orderId,
            adminId: admin.id,
            adminUsername: admin.username,
            editType: "QUANTITY_CHANGED",
            previousAmount: order.totalAmount,
            newAmount: newOrderTotal,
            note: `Changed ${item.itemName} quantity from ${item.quantity} to ${newQuantity}`,
          },
        }),
        ...(stockOp === "increment"
          ? [
              db.cafeItem.update({
                where: { id: item.cafeItemId },
                data: { quantity: { increment: stockAmount } },
              }),
            ]
          : []),
      ]);
    } catch (transactionErr) {
      // If the order-side write fails AFTER we already reserved
      // stock above, return the units to the shelf so the counter
      // stays honest.
      if (stockOp === "decrement") {
        await db.cafeItem.update({
          where: { id: item.cafeItemId },
          data: { quantity: { increment: stockAmount } },
        });
      }
      throw transactionErr;
    }

    return { success: true };
  } catch (error) {
    console.error("Failed to update quantity:", error);
    return { success: false, error: "Failed to update quantity" };
  }
}

export async function getCafeOrderEditHistory(orderId: string) {
  await requireCafeAdmin();

  const history = await db.cafeOrderEditHistory.findMany({
    where: { orderId },
    orderBy: { createdAt: "desc" },
  });

  return { history };
}

/**
 * Edit the primary CafePayment row on an order — method, status,
 * amount, UTR, optional refund metadata. Lets the admin reconcile
 * a payment when the customer hands them something different from
 * what was selected at checkout (e.g. customer chose UPI_QR but
 * ended up paying cash). Logs PAYMENT_EDITED in edit history.
 *
 * Amount changes do NOT propagate to the order total — the order
 * total is driven by items; CafePayment.amount tracks how much
 * has been settled. To reconcile a discrepancy use addCafePayment
 * Split instead (see below).
 */
export async function updateCafePayment(
  orderId: string,
  data: {
    method?: PaymentMethod;
    // PARTIAL is the sports-booking advance-payment status; cafe
    // doesn't use it but the enum is shared, so accept the full
    // PaymentStatus union here to match Prisma's type.
    status?:
      | "PENDING"
      | "PARTIAL"
      | "COMPLETED"
      | "FAILED"
      | "REFUNDED";
    amount?: number;
    utrNumber?: string | null;
    refundReason?: string | null;
  },
) {
  const admin = await requireCafeAdminWithDetails();
  try {
    const order = await db.cafeOrder.findUnique({
      where: { id: orderId },
      include: { payment: true },
    });
    if (!order) return { success: false, error: "Order not found" };
    if (!order.payment) {
      return { success: false, error: "Order has no payment record" };
    }

    if (data.amount !== undefined && data.amount < 0) {
      return { success: false, error: "Payment amount cannot be negative" };
    }

    const prev = order.payment;
    const next: Record<string, unknown> = {};
    if (data.method !== undefined) next.method = data.method;
    if (data.status !== undefined) {
      next.status = data.status;
      if (data.status === "COMPLETED" && !prev.confirmedAt) {
        next.confirmedAt = new Date();
        next.confirmedBy = admin.id;
      }
      if (data.status === "REFUNDED" && !prev.refundedAt) {
        next.refundedAt = new Date();
        next.refundedBy = admin.id;
      }
    }
    if (data.amount !== undefined) next.amount = data.amount;
    if (data.utrNumber !== undefined) next.utrNumber = data.utrNumber;
    if (data.refundReason !== undefined) next.refundReason = data.refundReason;

    // Composable note describing what changed — surfaces in the
    // edit-history timeline so the staff can audit who flipped a
    // payment and from what to what.
    const changeNote = [
      data.method && prev.method !== data.method
        ? `method ${prev.method} → ${data.method}`
        : null,
      data.status && prev.status !== data.status
        ? `status ${prev.status} → ${data.status}`
        : null,
      data.amount !== undefined && prev.amount !== data.amount
        ? `amount ${prev.amount} → ${data.amount}`
        : null,
      data.utrNumber !== undefined && (prev.utrNumber ?? null) !== data.utrNumber
        ? `UTR ${prev.utrNumber ?? "(blank)"} → ${data.utrNumber ?? "(blank)"}`
        : null,
    ]
      .filter(Boolean)
      .join(", ");

    if (!changeNote) {
      return { success: true, noop: true };
    }

    await db.$transaction([
      db.cafePayment.update({ where: { id: prev.id }, data: next }),
      db.cafeOrderEditHistory.create({
        data: {
          orderId,
          adminId: admin.id,
          adminUsername: admin.username,
          editType: "PAYMENT_EDITED",
          previousAmount: prev.amount,
          newAmount: data.amount ?? prev.amount,
          note: `Payment edit — ${changeNote}`,
        },
      }),
    ]);

    return { success: true };
  } catch (error) {
    console.error("Failed to update payment:", error);
    return { success: false, error: "Failed to update payment" };
  }
}

/**
 * Add a split-payment row to an order — the customer settled part
 * of the bill via one method and the rest via another. The parent
 * CafePayment row stays as the "summary" record (its `amount`
 * tracks total expected, `status` flips to COMPLETED once splits
 * sum to ≥ total). Each split carries its own method + amount +
 * optional UTR + per-row note.
 *
 * Refuses to overshoot — if sum(existing splits) + amount > total
 * the row is rejected (use cancelCafeOrder/editPayment if the
 * total itself is wrong).
 */
export async function addCafePaymentSplit(
  orderId: string,
  data: {
    method: PaymentMethod;
    amount: number;
    utrNumber?: string;
    note?: string;
  },
) {
  const admin = await requireCafeAdminWithDetails();
  try {
    if (data.amount <= 0) {
      return { success: false, error: "Split amount must be positive" };
    }
    const order = await db.cafeOrder.findUnique({
      where: { id: orderId },
      include: { payment: { include: { splits: true } } },
    });
    if (!order) return { success: false, error: "Order not found" };
    if (!order.payment) {
      return { success: false, error: "Order has no payment record" };
    }

    const existingSum = order.payment.splits.reduce(
      (s, sp) => s + sp.amount,
      0,
    );
    const totalDue = order.totalAmount;
    const newSum = existingSum + data.amount;
    if (newSum > totalDue + 0.01) {
      return {
        success: false,
        error: `Splits would total ₹${newSum} — exceeds order total ₹${totalDue}`,
      };
    }

    const status: "PENDING" | "COMPLETED" =
      newSum >= totalDue - 0.01 ? "COMPLETED" : "PENDING";

    await db.$transaction([
      db.cafePaymentSplit.create({
        data: {
          paymentId: order.payment.id,
          method: data.method,
          amount: data.amount,
          utrNumber: data.utrNumber || null,
          note: data.note || null,
          createdById: admin.id,
        },
      }),
      db.cafePayment.update({
        where: { id: order.payment.id },
        data: {
          status,
          confirmedAt:
            status === "COMPLETED" && !order.payment.confirmedAt
              ? new Date()
              : undefined,
          confirmedBy:
            status === "COMPLETED" && !order.payment.confirmedAt
              ? admin.id
              : undefined,
        },
      }),
      db.cafeOrderEditHistory.create({
        data: {
          orderId,
          adminId: admin.id,
          adminUsername: admin.username,
          editType: "PAYMENT_SPLIT_ADDED",
          previousAmount: existingSum,
          newAmount: newSum,
          note: `Split ${data.method} ₹${data.amount}${
            data.utrNumber ? ` (UTR ${data.utrNumber})` : ""
          }${data.note ? ` — ${data.note}` : ""}`,
        },
      }),
    ]);

    return { success: true, status, paidSoFar: newSum, totalDue };
  } catch (error) {
    console.error("Failed to add payment split:", error);
    return { success: false, error: "Failed to add payment split" };
  }
}

/**
 * Remove a split-payment row. The parent CafePayment.status flips
 * back to PENDING if removing the split drops the captured sum
 * below the order total.
 */
export async function removeCafePaymentSplit(
  orderId: string,
  splitId: string,
) {
  const admin = await requireCafeAdminWithDetails();
  try {
    const order = await db.cafeOrder.findUnique({
      where: { id: orderId },
      include: { payment: { include: { splits: true } } },
    });
    if (!order || !order.payment) {
      return { success: false, error: "Order or payment not found" };
    }
    const split = order.payment.splits.find((s) => s.id === splitId);
    if (!split) {
      return { success: false, error: "Split not found on this order" };
    }
    const remainingSum = order.payment.splits
      .filter((s) => s.id !== splitId)
      .reduce((sum, s) => sum + s.amount, 0);
    const totalDue = order.totalAmount;
    const newStatus: "PENDING" | "COMPLETED" =
      remainingSum >= totalDue - 0.01 ? "COMPLETED" : "PENDING";

    await db.$transaction([
      db.cafePaymentSplit.delete({ where: { id: splitId } }),
      db.cafePayment.update({
        where: { id: order.payment.id },
        data: { status: newStatus },
      }),
      db.cafeOrderEditHistory.create({
        data: {
          orderId,
          adminId: admin.id,
          adminUsername: admin.username,
          editType: "PAYMENT_SPLIT_REMOVED",
          previousAmount: order.payment.amount,
          newAmount: remainingSum,
          note: `Removed split ${split.method} ₹${split.amount}`,
        },
      }),
    ]);

    return { success: true };
  } catch (error) {
    console.error("Failed to remove payment split:", error);
    return { success: false, error: "Failed to remove payment split" };
  }
}
