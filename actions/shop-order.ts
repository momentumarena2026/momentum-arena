"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { requireAdmin as requireAdminBase } from "@/lib/admin-auth";
import { buildOrderNumber, decrementStock, incrementStock, recordStockMovement } from "@/lib/product";
import { getCartForUser } from "@/lib/cart";
import { isCheckoutMethodEnabled } from "@/actions/admin-payment-settings";
import { Prisma, type PaymentMethod, type ProductOrderStatus } from "@prisma/client";

/**
 * Order-side server actions for the shop. Sit on top of the cart
 * helpers in lib/cart and the stock helpers in lib/product. Three
 * surfaces hit these:
 *
 *   1. Customer checkout (online / UPI QR / cash-at-pickup) — calls
 *      placeCustomerOrder which reads the live cart, decrements
 *      stock, and writes the ProductOrder + ProductOrderPayment +
 *      ProductOrderItem rows atomically.
 *   2. Admin walk-in POS (Phase 5) — calls placeAdminOrder with an
 *      explicit line-item list (no cart involved).
 *   3. Admin orders dashboard — confirmPayment / markFulfilled /
 *      cancelOrder.
 *
 * Stock is decremented at order creation, NOT at payment verify.
 * That means PENDING orders are holding inventory; admins can
 * `cancelOrder` to release it. Decrement is atomic via the
 * conditional updateMany in lib/product — concurrent checkouts for
 * the same last unit cannot both succeed.
 */

interface OrderResult {
  success: boolean;
  error?: string;
  orderId?: string;
  orderNumber?: string;
}

interface OrderForRazorpay {
  orderId: string;
  totalPaise: number;
}

// ─── Customer: place order from cart ─────────────────────────────────

/**
 * Convert the user's live cart into a ProductOrder + Payment.
 *
 * Method semantics:
 *   - RAZORPAY: order created PENDING, payment row PENDING. The
 *     /api/shop/razorpay/create-order route reads this and kicks
 *     off the gateway flow. Verify flips both to CONFIRMED.
 *   - UPI_QR:   order created PENDING, payment PENDING — admin
 *     reconciles UTR later.
 *   - CASH:     order created PENDING, payment PENDING — customer
 *     pays at venue pickup.
 */
export async function placeCustomerOrder(
  method: "RAZORPAY" | "UPI_QR" | "CASH",
  userIdOverride?: string,
): Promise<OrderResult> {
  let userId: string | undefined = userIdOverride;
  if (!userId) {
    const session = await auth();
    userId = session?.user?.id;
  }
  if (!userId) {
    return { success: false, error: "Please sign in to place an order." };
  }

  // Server-side enforcement of the admin payment-method config — the client
  // hides disabled methods, but never trust the client.
  if (!(await isCheckoutMethodEnabled(method))) {
    return {
      success: false,
      error: "That payment method isn't available right now.",
    };
  }

  const cart = await getCartForUser(userId);
  const availableLines = cart.lines.filter((l) => !l.unavailable && l.quantity > 0);
  if (availableLines.length === 0) {
    return { success: false, error: "Cart is empty" };
  }
  if (cart.totalPaise <= 0) {
    return { success: false, error: "Cart total is zero" };
  }

  try {
    const result = await db.$transaction(async (tx) => {
      // Atomic stock decrement per line — if any one fails we throw
      // and the whole transaction rolls back (no partial reserves).
      // Pre-fetch every product's cost in one round-trip so each line
      // can snapshot the cost-of-goods at sale time (used by the
      // analytics tab to compute gross profit).
      const productRows = await tx.product.findMany({
        where: { id: { in: availableLines.map((l) => l.productId) } },
        select: { id: true, costPaise: true },
      });
      const costById = new Map(productRows.map((p) => [p.id, p.costPaise]));

      const productSnapshots: Array<{
        productId: string;
        name: string;
        pricePaise: number;
        costPaise: number;
        quantity: number;
      }> = [];
      for (const line of availableLines) {
        const ok = await decrementStock(tx, line.productId, line.quantity);
        if (!ok) {
          throw new Error(`Not enough stock for "${line.name}"`);
        }
        productSnapshots.push({
          productId: line.productId,
          name: line.name,
          pricePaise: line.pricePaise,
          costPaise: costById.get(line.productId) ?? 0,
          quantity: line.quantity,
        });
      }

      const totalPaise = productSnapshots.reduce(
        (s, p) => s + p.pricePaise * p.quantity,
        0,
      );

      // Create order shell first to get the id, then patch the
      // order-number derived from it. Two writes is cleaner than
      // trying to predict a cuid up-front.
      const order = await tx.productOrder.create({
        data: {
          userId,
          status: "PENDING",
          totalPaise,
          items: {
            create: productSnapshots.map((s) => ({
              productId: s.productId,
              nameSnapshot: s.name,
              priceEachPaise: s.pricePaise,
              costEachPaise: s.costPaise,
              quantity: s.quantity,
            })),
          },
          payment: {
            create: {
              method,
              status: "PENDING",
              amount: totalPaise,
            },
          },
        },
      });

      const orderNumber = buildOrderNumber(order.id, order.createdAt);
      await tx.productOrder.update({
        where: { id: order.id },
        data: { orderNumber },
      });

      // Audit trail for each line.
      for (const s of productSnapshots) {
        await recordStockMovement(tx, {
          productId: s.productId,
          delta: -s.quantity,
          reason: "SALE",
          orderId: order.id,
          note: `Order ${orderNumber}`,
        });
      }

      // Empty the cart — the checkout contract is closed.
      await tx.cartItem.deleteMany({
        where: { cart: { userId } },
      });

      return { orderId: order.id, orderNumber };
    });

    revalidatePath("/shop");
    revalidatePath("/shop/cart");
    revalidatePath("/shop/orders");
    return { success: true, orderId: result.orderId, orderNumber: result.orderNumber };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Order creation failed",
    };
  }
}

/** Read-side helper — used by /api/shop/razorpay/create-order. */
export async function getOrderForRazorpay(
  orderId: string,
  userIdOverride?: string,
): Promise<OrderForRazorpay | null> {
  let userId: string | undefined = userIdOverride;
  if (!userId) {
    const session = await auth();
    userId = session?.user?.id;
  }
  if (!userId) return null;

  const order = await db.productOrder.findFirst({
    where: { id: orderId, userId, status: "PENDING" },
    select: { id: true, totalPaise: true },
  });
  if (!order) return null;
  return { orderId: order.id, totalPaise: order.totalPaise };
}

/**
 * Flip a PENDING order to CONFIRMED + payment to COMPLETED after a
 * verified Razorpay signature. Idempotent — re-calling on an
 * already-confirmed order is a no-op.
 */
export async function confirmOrderAfterRazorpay(
  orderId: string,
  razorpayPaymentId: string,
  razorpayOrderId: string,
  razorpaySignature: string,
  userIdOverride?: string,
): Promise<{ success: boolean; error?: string }> {
  let userId: string | undefined = userIdOverride;
  if (!userId) {
    const session = await auth();
    userId = session?.user?.id;
  }
  if (!userId) {
    return { success: false, error: "Unauthorized" };
  }
  const order = await db.productOrder.findFirst({
    where: { id: orderId, userId },
    include: { payment: true },
  });
  if (!order) return { success: false, error: "Order not found" };
  if (order.status === "CONFIRMED" || order.status === "FULFILLED") {
    return { success: true };
  }
  if (order.status !== "PENDING") {
    return { success: false, error: `Order is ${order.status.toLowerCase()}` };
  }
  // A valid signature only proves Razorpay captured SOME payment — it says
  // nothing about WHICH order was paid for. Without this bind the triple from
  // a ₹49 order confirms (and re-confirms) any other PENDING order of the
  // same user. razorpayOrderId is stamped on the payment row by
  // /api/shop/razorpay/create-order; mirrors the hold check in
  // /api/razorpay/verify.
  if (
    !order.payment?.razorpayOrderId ||
    order.payment.razorpayOrderId !== razorpayOrderId
  ) {
    return { success: false, error: "Order mismatch" };
  }

  await db.$transaction(async (tx) => {
    await tx.productOrder.update({
      where: { id: orderId },
      data: { status: "CONFIRMED" },
    });
    if (order.payment) {
      await tx.productOrderPayment.update({
        where: { id: order.payment.id },
        data: {
          status: "COMPLETED",
          razorpayPaymentId,
          razorpayOrderId,
          razorpaySignature,
          confirmedAt: new Date(),
        },
      });
    }
  });

  revalidatePath(`/shop/orders/${orderId}`);
  revalidatePath("/admin/product-orders");
  return { success: true };
}

// ─── Customer / admin: cancel + release stock ────────────────────────

export async function cancelOrder(
  orderId: string,
  reason: string,
  userIdOverride?: string,
): Promise<{ success: boolean; error?: string }> {
  let userId: string | undefined = userIdOverride;
  if (!userId) {
    const session = await auth();
    userId = session?.user?.id;
  }
  if (!userId) return { success: false, error: "Unauthorized" };

  // Customer can only cancel their own PENDING orders. Admins use
  // the separate admin path which calls this same logic via
  // adminCancelOrder so the actor-id is captured in the audit.
  const order = await db.productOrder.findFirst({
    where: { id: orderId, userId },
    include: { items: true },
  });
  if (!order) return { success: false, error: "Order not found" };
  if (order.status !== "PENDING") {
    return { success: false, error: "Only pending orders can be cancelled" };
  }

  await db.$transaction(async (tx) => {
    for (const item of order.items) {
      await incrementStock(tx, item.productId, item.quantity);
      await recordStockMovement(tx, {
        productId: item.productId,
        delta: item.quantity,
        reason: "RELEASE",
        orderId: order.id,
        note: `Customer cancelled: ${reason}`,
      });
    }
    await tx.productOrder.update({
      where: { id: orderId },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelReason: reason,
      },
    });
  });

  revalidatePath(`/shop/orders/${orderId}`);
  revalidatePath("/admin/product-orders");
  return { success: true };
}

// ─── Admin: confirm payment / mark fulfilled / cancel ────────────────

/**
 * Resolve the acting admin id. The web surface authenticates via
 * NextAuth (requireAdminBase); the mobile-admin routes authenticate
 * via a bearer JWT and pass the already-verified admin identity
 * through `adminOverride` so the full action logic is shared rather
 * than re-implemented. Mirrors the adminOverride pattern in
 * actions/admin-cafe-orders.ts.
 */
async function requireOrdersAdmin(adminOverride?: { id: string; username: string }) {
  if (adminOverride) return adminOverride.id;
  const user = await requireAdminBase("MANAGE_SHOP_ORDERS");
  return user.id;
}

/**
 * For UPI-QR / Cash flows the admin manually confirms the payment.
 * Flips order PENDING → CONFIRMED + payment PENDING → COMPLETED,
 * storing the optional UTR for the UPI path.
 */
export async function adminConfirmOrderPayment(args: {
  orderId: string;
  utrNumber?: string;
}, adminOverride?: { id: string; username: string }): Promise<{ success: boolean; error?: string }> {
  const adminId = await requireOrdersAdmin(adminOverride);
  const order = await db.productOrder.findUnique({
    where: { id: args.orderId },
    include: { payment: true },
  });
  if (!order) return { success: false, error: "Order not found" };
  if (order.status !== "PENDING") {
    return { success: false, error: `Order is ${order.status.toLowerCase()}` };
  }

  await db.$transaction(async (tx) => {
    await tx.productOrder.update({
      where: { id: order.id },
      data: { status: "CONFIRMED" },
    });
    if (order.payment) {
      await tx.productOrderPayment.update({
        where: { id: order.payment.id },
        data: {
          status: "COMPLETED",
          utrNumber: args.utrNumber || null,
          confirmedAt: new Date(),
          confirmedById: adminId,
        },
      });
    }
  });

  revalidatePath(`/admin/product-orders`);
  revalidatePath(`/admin/product-orders/${order.id}`);
  return { success: true };
}

export async function adminMarkFulfilled(
  orderId: string,
  adminOverride?: { id: string; username: string },
): Promise<{ success: boolean; error?: string }> {
  const adminId = await requireOrdersAdmin(adminOverride);
  const order = await db.productOrder.findUnique({ where: { id: orderId } });
  if (!order) return { success: false, error: "Order not found" };
  if (order.status !== "CONFIRMED") {
    return { success: false, error: "Only confirmed orders can be fulfilled" };
  }
  await db.productOrder.update({
    where: { id: orderId },
    data: {
      status: "FULFILLED",
      fulfilledAt: new Date(),
      fulfilledById: adminId,
    },
  });
  revalidatePath(`/admin/product-orders`);
  revalidatePath(`/admin/product-orders/${orderId}`);
  return { success: true };
}

export async function adminCancelOrder(
  orderId: string,
  reason: string,
  adminOverride?: { id: string; username: string },
): Promise<{ success: boolean; error?: string }> {
  const adminId = await requireOrdersAdmin(adminOverride);
  const order = await db.productOrder.findUnique({
    where: { id: orderId },
    include: { items: true },
  });
  if (!order) return { success: false, error: "Order not found" };
  if (order.status === "CANCELLED" || order.status === "REFUNDED") {
    return { success: false, error: `Order already ${order.status.toLowerCase()}` };
  }

  await db.$transaction(async (tx) => {
    // Stock release only for orders that aren't yet fulfilled —
    // a fulfilled order means inventory left the building, so
    // cancelling it later becomes a REFUND (no inventory restore).
    if (order.status !== "FULFILLED") {
      for (const item of order.items) {
        await incrementStock(tx, item.productId, item.quantity);
        await recordStockMovement(tx, {
          productId: item.productId,
          delta: item.quantity,
          reason: "RELEASE",
          orderId: order.id,
          note: `Admin cancelled: ${reason}`,
          adminId,
        });
      }
    }
    await tx.productOrder.update({
      where: { id: orderId },
      data: {
        status: order.status === "FULFILLED" ? "REFUNDED" : "CANCELLED",
        cancelledAt: new Date(),
        cancelReason: reason,
      },
    });
  });

  revalidatePath(`/admin/product-orders`);
  revalidatePath(`/admin/product-orders/${orderId}`);
  return { success: true };
}

// ─── Admin: walk-in POS (Phase 5) ────────────────────────────────────

/**
 * Create an order directly from an admin-built line-item list. Used
 * by /admin/pos for in-person sales — typically paid in cash on the
 * spot, so the default is method=CASH + immediate CONFIRMED.
 */
export async function placeAdminOrder(args: {
  customerUserId: string;
  items: Array<{ productId: string; quantity: number }>;
  method: PaymentMethod;
  markPaid?: boolean;
  utrNumber?: string;
}, adminOverride?: { id: string; username: string }): Promise<OrderResult> {
  const adminId = await requireOrdersAdmin(adminOverride);
  if (args.items.length === 0) {
    return { success: false, error: "Add at least one item" };
  }
  for (const i of args.items) {
    if (!i.productId || !Number.isInteger(i.quantity) || i.quantity <= 0) {
      return { success: false, error: "Invalid item entry" };
    }
  }

  try {
    const result = await db.$transaction(async (tx) => {
      const productIds = args.items.map((i) => i.productId);
      const products = await tx.product.findMany({
        where: { id: { in: productIds }, isActive: true },
      });
      const byId = new Map(products.map((p) => [p.id, p]));

      const snapshots: Array<{
        productId: string;
        name: string;
        pricePaise: number;
        costPaise: number;
        quantity: number;
      }> = [];

      for (const item of args.items) {
        const product = byId.get(item.productId);
        if (!product) throw new Error("One or more products are unavailable");
        const ok = await decrementStock(tx, product.id, item.quantity);
        if (!ok) throw new Error(`Not enough stock for "${product.name}"`);
        snapshots.push({
          productId: product.id,
          name: product.name,
          pricePaise: product.pricePaise,
          costPaise: product.costPaise,
          quantity: item.quantity,
        });
      }

      const totalPaise = snapshots.reduce(
        (s, p) => s + p.pricePaise * p.quantity,
        0,
      );
      const status: ProductOrderStatus = args.markPaid ? "CONFIRMED" : "PENDING";

      const order = await tx.productOrder.create({
        data: {
          userId: args.customerUserId,
          status,
          totalPaise,
          createdByAdminId: adminId,
          items: {
            create: snapshots.map((s) => ({
              productId: s.productId,
              nameSnapshot: s.name,
              priceEachPaise: s.pricePaise,
              costEachPaise: s.costPaise,
              quantity: s.quantity,
            })),
          },
          payment: {
            create: {
              method: args.method,
              status: args.markPaid ? "COMPLETED" : "PENDING",
              amount: totalPaise,
              utrNumber: args.utrNumber || null,
              confirmedAt: args.markPaid ? new Date() : null,
              confirmedById: args.markPaid ? adminId : null,
            },
          },
        },
      });

      const orderNumber = buildOrderNumber(order.id, order.createdAt);
      await tx.productOrder.update({
        where: { id: order.id },
        data: { orderNumber },
      });

      for (const s of snapshots) {
        await recordStockMovement(tx, {
          productId: s.productId,
          delta: -s.quantity,
          reason: "SALE",
          orderId: order.id,
          note: `Walk-in order ${orderNumber}`,
          adminId,
        });
      }

      return { orderId: order.id, orderNumber };
    });

    revalidatePath("/admin/product-orders");
    revalidatePath("/admin/pos");
    return { success: true, orderId: result.orderId, orderNumber: result.orderNumber };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Order creation failed",
    };
  }
}

// ─── Read helpers ─────────────────────────────────────────────────────

export async function getOrderForCustomer(
  orderId: string,
  userIdOverride?: string,
) {
  let userId: string | undefined = userIdOverride;
  if (!userId) {
    const session = await auth();
    userId = session?.user?.id;
  }
  if (!userId) return null;
  return db.productOrder.findFirst({
    where: { id: orderId, userId },
    include: {
      items: { include: { product: true } },
      payment: true,
    },
  });
}

export async function listMyOrders(userIdOverride?: string) {
  let userId: string | undefined = userIdOverride;
  if (!userId) {
    const session = await auth();
    userId = session?.user?.id;
  }
  if (!userId) return [];
  return db.productOrder.findMany({
    where: { userId },
    include: { items: true, payment: true },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}

export async function listOrdersForAdmin(filters?: {
  status?: ProductOrderStatus;
  search?: string;
  page?: number;
}, adminOverride?: { id: string; username: string }) {
  await requireOrdersAdmin(adminOverride);
  const page = filters?.page ?? 1;
  const limit = 50;
  const where: Prisma.ProductOrderWhereInput = {};
  if (filters?.status) where.status = filters.status;
  if (filters?.search) {
    where.OR = [
      { orderNumber: { contains: filters.search, mode: "insensitive" } },
      { user: { name: { contains: filters.search, mode: "insensitive" } } },
      { user: { phone: { contains: filters.search } } },
    ];
  }
  const [rows, total] = await Promise.all([
    db.productOrder.findMany({
      where,
      include: {
        user: { select: { name: true, phone: true } },
        items: true,
        payment: true,
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.productOrder.count({ where }),
  ]);
  return { orders: rows, total, page, totalPages: Math.ceil(total / limit) };
}

// ─── Shop analytics summary ──────────────────────────────────────────
//
// Revenue / cost / profit roll-up across CONFIRMED + FULFILLED orders.
// Cancelled / refunded orders are excluded so the numbers match what
// actually settled. Each line item's snapshotted `priceEachPaise` +
// `costEachPaise` is the source of truth — admin edits to live
// Product rows don't retroactively change reported profit.
//
// Returns paise; callers convert to ₹ for display.

export interface ShopAnalyticsSummary {
  /** Orders included in the roll-up (CONFIRMED or FULFILLED). */
  orderCount: number;
  /** Sum of every line's price × qty across counted orders. */
  revenuePaise: number;
  /** Sum of every line's cost × qty across counted orders. */
  costPaise: number;
  /** revenue − cost. Can be negative if cost > price (admin typo). */
  profitPaise: number;
  /** Margin as integer percent. 0 when revenue is 0. */
  marginPct: number;
  /** Same fields restricted to orders created in the last 30 days. */
  last30d: {
    orderCount: number;
    revenuePaise: number;
    costPaise: number;
    profitPaise: number;
  };
}

export async function getShopAnalyticsSummary(
  adminOverride?: { id: string; username: string },
): Promise<ShopAnalyticsSummary> {
  await requireOrdersAdmin(adminOverride);

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);

  const items = await db.productOrderItem.findMany({
    where: {
      order: {
        status: { in: ["CONFIRMED", "FULFILLED"] },
      },
    },
    select: {
      priceEachPaise: true,
      costEachPaise: true,
      quantity: true,
      orderId: true,
      order: { select: { createdAt: true } },
    },
  });

  let revenuePaise = 0;
  let costPaise = 0;
  let revenue30 = 0;
  let cost30 = 0;
  const orderIds = new Set<string>();
  const orderIds30 = new Set<string>();
  for (const it of items) {
    const r = it.priceEachPaise * it.quantity;
    const c = it.costEachPaise * it.quantity;
    revenuePaise += r;
    costPaise += c;
    orderIds.add(it.orderId);
    if (it.order.createdAt >= cutoff) {
      revenue30 += r;
      cost30 += c;
      orderIds30.add(it.orderId);
    }
  }

  const profitPaise = revenuePaise - costPaise;
  const marginPct =
    revenuePaise > 0 ? Math.round((profitPaise / revenuePaise) * 100) : 0;

  return {
    orderCount: orderIds.size,
    revenuePaise,
    costPaise,
    profitPaise,
    marginPct,
    last30d: {
      orderCount: orderIds30.size,
      revenuePaise: revenue30,
      costPaise: cost30,
      profitPaise: revenue30 - cost30,
    },
  };
}
