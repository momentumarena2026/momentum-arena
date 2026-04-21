"use server";

import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";
import { CafeOrderStatus, PaymentMethod } from "@prisma/client";
import { normalizeIndianPhone } from "@/lib/phone";

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

export async function getCafeOrders(filters?: {
  date?: string;
  status?: CafeOrderStatus;
  search?: string;
  page?: number;
}) {
  await requireCafeAdmin();

  const page = filters?.page ?? 1;
  const limit = 20;
  const skip = (page - 1) * limit;

  const where: Record<string, unknown> = {};

  if (filters?.date) {
    const start = new Date(filters.date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(filters.date);
    end.setHours(23, 59, 59, 999);
    where.createdAt = { gte: start, lte: end };
  }

  if (filters?.status) {
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

export async function getCafeOrderStats() {
  await requireCafeAdmin();

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const [todayOrders, todayRevenue, pendingCount, popularItems] =
    await Promise.all([
      db.cafeOrder.count({
        where: {
          createdAt: { gte: today, lt: tomorrow },
          status: { not: "CANCELLED" },
        },
      }),
      db.cafeOrder.aggregate({
        where: {
          createdAt: { gte: today, lt: tomorrow },
          status: { not: "CANCELLED" },
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
            status: { not: "CANCELLED" },
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

export async function getLiveCafeOrders() {
  await requireCafeAdmin();

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
  PENDING: ["PREPARING", "CANCELLED"],
  PREPARING: ["READY", "CANCELLED"],
  READY: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

export async function updateCafeOrderStatus(
  orderId: string,
  newStatus: CafeOrderStatus
) {
  const admin = await requireCafeAdminWithDetails();

  try {
    const order = await db.cafeOrder.findUnique({
      where: { id: orderId },
      select: { id: true, status: true, orderNumber: true },
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
        status: "PENDING",
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
            note: `Order created by ${admin.username}`,
          },
        },
      },
      include: {
        items: true,
        payment: true,
      },
    });

    return { success: true, order };
  } catch (error) {
    console.error("Failed to create cafe order:", error);
    return { success: false, error: "Failed to create order" };
  }
}

export async function cancelCafeOrder(orderId: string, reason: string) {
  const admin = await requireCafeAdminWithDetails();

  try {
    const order = await db.cafeOrder.findUnique({
      where: { id: orderId },
      include: { payment: true },
    });

    if (!order) return { success: false, error: "Order not found" };
    if (order.status === "CANCELLED") {
      return { success: false, error: "Order is already cancelled" };
    }
    if (order.status === "COMPLETED") {
      return { success: false, error: "Cannot cancel a completed order" };
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
            status: "REFUNDED",
            refundedBy: admin.id,
            refundedAt: new Date(),
            refundReason: reason,
          },
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

    await db.$transaction([
      db.cafeOrderItem.deleteMany({
        where: { id: { in: orderItemIds }, orderId },
      }),
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
          editType: "ITEMS_REMOVED",
          previousAmount: order.totalAmount,
          newAmount: newTotal,
          previousItems: itemsToRemove.map((i) => ({
            name: i.itemName,
            quantity: i.quantity,
          })),
          note: `Removed ${itemsToRemove.length} item(s)`,
        },
      }),
    ]);

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
    ]);

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
