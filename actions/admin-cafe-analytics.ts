"use server";

import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";

/**
 * Cafe analytics fetchers. All values are returned in RUPEES
 * (Float) — the cafe-prices-to-float-rupees migration converted
 * every cafe price column to rupees, so no /100 conversion is
 * needed anywhere on the server boundary.
 *
 * Time-bucketing uses `CafeOrder.createdAt` (when the customer
 * actually placed/paid), NOT a hypothetical "served at" — the
 * sports side has the same convention for confirmedAt.
 *
 * Cancelled and PENDING_PAYMENT orders are excluded everywhere
 * EXCEPT the cancellation-rate metric on the KPI card, which
 * needs them by definition.
 */

const VALID_STATUSES = ["PENDING", "PREPARING", "READY", "COMPLETED"] as const;

function rangeBounds(dateFrom: string, dateTo: string) {
  const from = new Date(`${dateFrom}T00:00:00`);
  const to = new Date(`${dateTo}T23:59:59.999`);
  return { from, to };
}

// ─────────── KPIs ───────────

export interface CafeKPI {
  totalRevenue: number;
  totalCost: number;
  totalProfit: number;
  profitMargin: number; // %
  totalOrders: number;
  totalItemsSold: number;
  avgOrderValue: number;
  cancellationRate: number; // %
  discountGiven: number;
  uniqueCustomers: number;
  refundsDue: number; // count of CANCELLED orders with COMPLETED payments
}

export async function getCafeKPIStats(
  dateFrom: string,
  dateTo: string,
): Promise<{ success: boolean; data?: CafeKPI; error?: string }> {
  try {
    await requireAdmin("VIEW_ANALYTICS");
    const { from, to } = rangeBounds(dateFrom, dateTo);

    // Pull live items so we can join their costPrice for profit.
    // Snapshot unitPrice on CafeOrderItem is the source of truth
    // for revenue (price could change between order and now); but
    // CafeItem.costPrice is the only place cost lives, so we
    // accept that re-pricing the cost retroactively skews older
    // months a little. Acceptable tradeoff vs adding a cost
    // snapshot column.
    const orders = await db.cafeOrder.findMany({
      where: {
        createdAt: { gte: from, lte: to },
        status: { in: [...VALID_STATUSES] },
      },
      select: {
        id: true,
        totalAmount: true,
        discountAmount: true,
        userId: true,
        items: {
          select: {
            quantity: true,
            unitPrice: true,
            totalPrice: true,
            cafeItem: { select: { costPrice: true } },
          },
        },
      },
    });

    const totalRevenue = orders.reduce((s, o) => s + o.totalAmount, 0);
    const discountGiven = orders.reduce((s, o) => s + (o.discountAmount ?? 0), 0);
    let totalCost = 0;
    let totalItemsSold = 0;
    for (const o of orders) {
      for (const line of o.items) {
        totalItemsSold += line.quantity;
        if (line.cafeItem.costPrice != null) {
          totalCost += line.cafeItem.costPrice * line.quantity;
        }
      }
    }
    const totalProfit = totalRevenue - totalCost;
    const profitMargin =
      totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;
    const totalOrders = orders.length;
    const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
    const uniqueCustomers = new Set(
      orders.filter((o) => o.userId).map((o) => o.userId!),
    ).size;

    // Cancellation rate needs ALL orders in the window including
    // CANCELLED — but exclude PENDING_PAYMENT (those are abandoned
    // checkouts, not real cancels).
    const [cancelledCount, totalIncludingCancelled] = await Promise.all([
      db.cafeOrder.count({
        where: {
          createdAt: { gte: from, lte: to },
          status: "CANCELLED",
        },
      }),
      db.cafeOrder.count({
        where: {
          createdAt: { gte: from, lte: to },
          status: { not: "PENDING_PAYMENT" },
        },
      }),
    ]);
    const cancellationRate =
      totalIncludingCancelled > 0
        ? (cancelledCount / totalIncludingCancelled) * 100
        : 0;

    // Refund-due = CANCELLED orders carrying a COMPLETED payment
    // (sold-out-after-payment audit rows, plus any admin cancels
    // post-capture).
    const refundsDue = await db.cafeOrder.count({
      where: {
        createdAt: { gte: from, lte: to },
        status: "CANCELLED",
        payment: { status: "COMPLETED" },
      },
    });

    return {
      success: true,
      data: {
        totalRevenue,
        totalCost,
        totalProfit,
        profitMargin: Math.round(profitMargin * 10) / 10,
        totalOrders,
        totalItemsSold,
        avgOrderValue: Math.round(avgOrderValue * 100) / 100,
        cancellationRate: Math.round(cancellationRate * 10) / 10,
        discountGiven,
        uniqueCustomers,
        refundsDue,
      },
    };
  } catch (err) {
    console.error("[cafe-analytics] getCafeKPIStats failed", err);
    return { success: false, error: "Failed to load KPIs" };
  }
}

// ─────────── Revenue over time ───────────

export type CafeGroupBy = "day" | "week" | "month";

export interface CafeTimeBucket {
  period: string; // YYYY-MM-DD (day/week) or YYYY-MM (month)
  revenue: number;
  cost: number;
  profit: number;
  orders: number;
}

function bucketKey(d: Date, groupBy: CafeGroupBy): string {
  if (groupBy === "month") {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }
  if (groupBy === "week") {
    // Week starts Monday — ISO-ish, simple. Anchor on the Monday
    // date so the period is a real calendar day, not a week number.
    const monday = new Date(d);
    const day = monday.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    monday.setDate(monday.getDate() + diff);
    monday.setHours(0, 0, 0, 0);
    return monday.toISOString().split("T")[0];
  }
  return d.toISOString().split("T")[0];
}

export async function getCafeRevenueOverTime(
  dateFrom: string,
  dateTo: string,
  groupBy: CafeGroupBy = "day",
): Promise<{ success: boolean; data?: CafeTimeBucket[]; error?: string }> {
  try {
    await requireAdmin("VIEW_ANALYTICS");
    const { from, to } = rangeBounds(dateFrom, dateTo);

    const orders = await db.cafeOrder.findMany({
      where: {
        createdAt: { gte: from, lte: to },
        status: { in: [...VALID_STATUSES] },
      },
      select: {
        createdAt: true,
        totalAmount: true,
        items: {
          select: {
            quantity: true,
            cafeItem: { select: { costPrice: true } },
          },
        },
      },
    });

    const buckets = new Map<string, CafeTimeBucket>();
    for (const o of orders) {
      const key = bucketKey(o.createdAt, groupBy);
      const existing = buckets.get(key) ?? {
        period: key,
        revenue: 0,
        cost: 0,
        profit: 0,
        orders: 0,
      };
      existing.revenue += o.totalAmount;
      for (const line of o.items) {
        if (line.cafeItem.costPrice != null) {
          existing.cost += line.cafeItem.costPrice * line.quantity;
        }
      }
      existing.profit = existing.revenue - existing.cost;
      existing.orders += 1;
      buckets.set(key, existing);
    }

    const data = Array.from(buckets.values()).sort((a, b) =>
      a.period.localeCompare(b.period),
    );
    return { success: true, data };
  } catch (err) {
    console.error("[cafe-analytics] getCafeRevenueOverTime failed", err);
    return { success: false, error: "Failed to load revenue series" };
  }
}

// ─────────── Category breakdown ───────────

export interface CafeCategoryRow {
  category: string;
  revenue: number;
  profit: number;
  orderCount: number; // distinct orders touching this category
  unitsSold: number;
}

export async function getCafeCategoryBreakdown(
  dateFrom: string,
  dateTo: string,
): Promise<{ success: boolean; data?: CafeCategoryRow[]; error?: string }> {
  try {
    await requireAdmin("VIEW_ANALYTICS");
    const { from, to } = rangeBounds(dateFrom, dateTo);

    const orders = await db.cafeOrder.findMany({
      where: {
        createdAt: { gte: from, lte: to },
        status: { in: [...VALID_STATUSES] },
      },
      select: {
        id: true,
        items: {
          select: {
            quantity: true,
            totalPrice: true,
            cafeItem: { select: { category: true, costPrice: true } },
          },
        },
      },
    });

    const map = new Map<
      string,
      { revenue: number; profit: number; unitsSold: number; orderIds: Set<string> }
    >();
    for (const o of orders) {
      for (const line of o.items) {
        const cat = line.cafeItem.category;
        const bucket = map.get(cat) ?? {
          revenue: 0,
          profit: 0,
          unitsSold: 0,
          orderIds: new Set<string>(),
        };
        bucket.revenue += line.totalPrice;
        if (line.cafeItem.costPrice != null) {
          bucket.profit +=
            line.totalPrice - line.cafeItem.costPrice * line.quantity;
        } else {
          // Unknown cost — count revenue as profit; reporting copy
          // notes this is a floor, not an exact margin.
          bucket.profit += line.totalPrice;
        }
        bucket.unitsSold += line.quantity;
        bucket.orderIds.add(o.id);
        map.set(cat, bucket);
      }
    }

    const data = Array.from(map.entries())
      .map(([category, b]) => ({
        category,
        revenue: b.revenue,
        profit: b.profit,
        unitsSold: b.unitsSold,
        orderCount: b.orderIds.size,
      }))
      .sort((a, b) => b.revenue - a.revenue);
    return { success: true, data };
  } catch (err) {
    console.error("[cafe-analytics] getCafeCategoryBreakdown failed", err);
    return { success: false, error: "Failed to load category breakdown" };
  }
}

// ─────────── Top selling items ───────────

export interface CafeTopItem {
  itemName: string;
  category: string | null;
  unitsSold: number;
  revenue: number;
  profit: number;
}

export async function getCafeTopItems(
  dateFrom: string,
  dateTo: string,
  limit = 10,
): Promise<{ success: boolean; data?: CafeTopItem[]; error?: string }> {
  try {
    await requireAdmin("VIEW_ANALYTICS");
    const { from, to } = rangeBounds(dateFrom, dateTo);

    const lines = await db.cafeOrderItem.findMany({
      where: {
        order: {
          createdAt: { gte: from, lte: to },
          status: { in: [...VALID_STATUSES] },
        },
      },
      select: {
        itemName: true,
        quantity: true,
        totalPrice: true,
        cafeItem: { select: { category: true, costPrice: true } },
      },
    });

    const map = new Map<
      string,
      { category: string | null; unitsSold: number; revenue: number; profit: number }
    >();
    for (const l of lines) {
      const bucket = map.get(l.itemName) ?? {
        category: l.cafeItem.category ?? null,
        unitsSold: 0,
        revenue: 0,
        profit: 0,
      };
      bucket.unitsSold += l.quantity;
      bucket.revenue += l.totalPrice;
      if (l.cafeItem.costPrice != null) {
        bucket.profit += l.totalPrice - l.cafeItem.costPrice * l.quantity;
      } else {
        bucket.profit += l.totalPrice;
      }
      map.set(l.itemName, bucket);
    }

    const data = Array.from(map.entries())
      .map(([itemName, b]) => ({ itemName, ...b }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, limit);
    return { success: true, data };
  } catch (err) {
    console.error("[cafe-analytics] getCafeTopItems failed", err);
    return { success: false, error: "Failed to load top items" };
  }
}

// ─────────── Payment methods ───────────

export interface CafePaymentMethodRow {
  method: string;
  count: number;
  amount: number;
}

export async function getCafePaymentMethodBreakdown(
  dateFrom: string,
  dateTo: string,
): Promise<{
  success: boolean;
  data?: CafePaymentMethodRow[];
  error?: string;
}> {
  try {
    await requireAdmin("VIEW_ANALYTICS");
    const { from, to } = rangeBounds(dateFrom, dateTo);

    const payments = await db.cafePayment.findMany({
      where: {
        order: {
          createdAt: { gte: from, lte: to },
          status: { in: [...VALID_STATUSES] },
        },
      },
      select: { method: true, amount: true },
    });

    const map = new Map<string, { count: number; amount: number }>();
    for (const p of payments) {
      const key = p.method;
      const b = map.get(key) ?? { count: 0, amount: 0 };
      b.count += 1;
      b.amount += p.amount;
      map.set(key, b);
    }

    const data = Array.from(map.entries())
      .map(([method, b]) => ({ method, ...b }))
      .sort((a, b) => b.amount - a.amount);
    return { success: true, data };
  } catch (err) {
    console.error("[cafe-analytics] getCafePaymentMethodBreakdown failed", err);
    return { success: false, error: "Failed to load payment breakdown" };
  }
}

// ─────────── Peak hours ───────────

export interface CafeHourBucket {
  hour: number;
  orderCount: number;
  revenue: number;
}

export async function getCafePeakHours(
  dateFrom: string,
  dateTo: string,
): Promise<{ success: boolean; data?: CafeHourBucket[]; error?: string }> {
  try {
    await requireAdmin("VIEW_ANALYTICS");
    const { from, to } = rangeBounds(dateFrom, dateTo);

    const orders = await db.cafeOrder.findMany({
      where: {
        createdAt: { gte: from, lte: to },
        status: { in: [...VALID_STATUSES] },
      },
      select: { createdAt: true, totalAmount: true },
    });

    const buckets = new Map<number, CafeHourBucket>();
    for (let h = 0; h < 24; h++) {
      buckets.set(h, { hour: h, orderCount: 0, revenue: 0 });
    }
    for (const o of orders) {
      const hour = o.createdAt.getHours();
      const b = buckets.get(hour)!;
      b.orderCount += 1;
      b.revenue += o.totalAmount;
    }

    return { success: true, data: Array.from(buckets.values()) };
  } catch (err) {
    console.error("[cafe-analytics] getCafePeakHours failed", err);
    return { success: false, error: "Failed to load peak hours" };
  }
}

// ─────────── Status breakdown ───────────

export interface CafeStatusRow {
  status: string;
  count: number;
  revenue: number;
}

export async function getCafeStatusBreakdown(
  dateFrom: string,
  dateTo: string,
): Promise<{ success: boolean; data?: CafeStatusRow[]; error?: string }> {
  try {
    await requireAdmin("VIEW_ANALYTICS");
    const { from, to } = rangeBounds(dateFrom, dateTo);

    const orders = await db.cafeOrder.findMany({
      where: {
        createdAt: { gte: from, lte: to },
        status: { not: "PENDING_PAYMENT" },
      },
      select: { status: true, totalAmount: true },
    });

    const map = new Map<string, CafeStatusRow>();
    for (const o of orders) {
      const b = map.get(o.status) ?? {
        status: o.status,
        count: 0,
        revenue: 0,
      };
      b.count += 1;
      b.revenue += o.totalAmount;
      map.set(o.status, b);
    }
    return {
      success: true,
      data: Array.from(map.values()).sort((a, b) => b.count - a.count),
    };
  } catch (err) {
    console.error("[cafe-analytics] getCafeStatusBreakdown failed", err);
    return { success: false, error: "Failed to load status breakdown" };
  }
}

// ─────────── Veg vs Non-Veg ───────────

export interface VegRow {
  type: "Veg" | "Non-Veg";
  unitsSold: number;
  revenue: number;
}

export async function getCafeVegBreakdown(
  dateFrom: string,
  dateTo: string,
): Promise<{ success: boolean; data?: VegRow[]; error?: string }> {
  try {
    await requireAdmin("VIEW_ANALYTICS");
    const { from, to } = rangeBounds(dateFrom, dateTo);

    const lines = await db.cafeOrderItem.findMany({
      where: {
        order: {
          createdAt: { gte: from, lte: to },
          status: { in: [...VALID_STATUSES] },
        },
      },
      select: {
        quantity: true,
        totalPrice: true,
        cafeItem: { select: { isVeg: true } },
      },
    });

    const buckets: Record<"Veg" | "Non-Veg", VegRow> = {
      Veg: { type: "Veg", unitsSold: 0, revenue: 0 },
      "Non-Veg": { type: "Non-Veg", unitsSold: 0, revenue: 0 },
    };
    for (const l of lines) {
      const k = l.cafeItem.isVeg ? "Veg" : "Non-Veg";
      buckets[k].unitsSold += l.quantity;
      buckets[k].revenue += l.totalPrice;
    }
    return { success: true, data: [buckets.Veg, buckets["Non-Veg"]] };
  } catch (err) {
    console.error("[cafe-analytics] getCafeVegBreakdown failed", err);
    return { success: false, error: "Failed to load veg breakdown" };
  }
}

// ─────────── Ready vs Prepare fulfilment ───────────

export interface FulfilmentRow {
  fulfilment: "Ready" | "Kitchen";
  unitsSold: number;
  revenue: number;
}

export async function getCafeFulfilmentBreakdown(
  dateFrom: string,
  dateTo: string,
): Promise<{
  success: boolean;
  data?: FulfilmentRow[];
  error?: string;
}> {
  try {
    await requireAdmin("VIEW_ANALYTICS");
    const { from, to } = rangeBounds(dateFrom, dateTo);

    const lines = await db.cafeOrderItem.findMany({
      where: {
        order: {
          createdAt: { gte: from, lte: to },
          status: { in: [...VALID_STATUSES] },
        },
      },
      select: {
        quantity: true,
        totalPrice: true,
        cafeItem: { select: { quantity: true } },
      },
    });

    const buckets: Record<"Ready" | "Kitchen", FulfilmentRow> = {
      Ready: { fulfilment: "Ready", unitsSold: 0, revenue: 0 },
      Kitchen: { fulfilment: "Kitchen", unitsSold: 0, revenue: 0 },
    };
    for (const l of lines) {
      const k = l.cafeItem.quantity != null ? "Ready" : "Kitchen";
      buckets[k].unitsSold += l.quantity;
      buckets[k].revenue += l.totalPrice;
    }
    return { success: true, data: [buckets.Ready, buckets.Kitchen] };
  } catch (err) {
    console.error("[cafe-analytics] getCafeFulfilmentBreakdown failed", err);
    return { success: false, error: "Failed to load fulfilment breakdown" };
  }
}

// ─────────── Top customers ───────────

export interface CafeTopCustomer {
  userId: string;
  name: string;
  email: string;
  totalSpent: number;
  orderCount: number;
}

export async function getCafeTopCustomers(
  dateFrom: string,
  dateTo: string,
  limit = 10,
): Promise<{ success: boolean; data?: CafeTopCustomer[]; error?: string }> {
  try {
    await requireAdmin("VIEW_ANALYTICS");
    const { from, to } = rangeBounds(dateFrom, dateTo);

    const orders = await db.cafeOrder.findMany({
      where: {
        createdAt: { gte: from, lte: to },
        status: { in: [...VALID_STATUSES] },
        userId: { not: null },
      },
      select: {
        userId: true,
        totalAmount: true,
        user: { select: { name: true, email: true } },
      },
    });

    const map = new Map<
      string,
      {
        userId: string;
        name: string;
        email: string;
        totalSpent: number;
        orderCount: number;
      }
    >();
    for (const o of orders) {
      if (!o.userId) continue;
      const b = map.get(o.userId) ?? {
        userId: o.userId,
        name: o.user?.name ?? "Guest",
        email: o.user?.email ?? "",
        totalSpent: 0,
        orderCount: 0,
      };
      b.totalSpent += o.totalAmount;
      b.orderCount += 1;
      map.set(o.userId, b);
    }
    const data = Array.from(map.values())
      .sort((a, b) => b.totalSpent - a.totalSpent)
      .slice(0, limit);
    return { success: true, data };
  } catch (err) {
    console.error("[cafe-analytics] getCafeTopCustomers failed", err);
    return { success: false, error: "Failed to load top customers" };
  }
}

// ─────────── Day-of-week breakdown ───────────

export interface DayOfWeekRow {
  day: string; // Mon, Tue, ...
  dayIndex: number; // 0 = Sun, 1 = Mon, ...
  orderCount: number;
  revenue: number;
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export async function getCafeDayOfWeekBreakdown(
  dateFrom: string,
  dateTo: string,
): Promise<{ success: boolean; data?: DayOfWeekRow[]; error?: string }> {
  try {
    await requireAdmin("VIEW_ANALYTICS");
    const { from, to } = rangeBounds(dateFrom, dateTo);

    const orders = await db.cafeOrder.findMany({
      where: {
        createdAt: { gte: from, lte: to },
        status: { in: [...VALID_STATUSES] },
      },
      select: { createdAt: true, totalAmount: true },
    });

    const buckets: DayOfWeekRow[] = DAY_LABELS.map((label, i) => ({
      day: label,
      dayIndex: i,
      orderCount: 0,
      revenue: 0,
    }));
    for (const o of orders) {
      const idx = o.createdAt.getDay();
      buckets[idx].orderCount += 1;
      buckets[idx].revenue += o.totalAmount;
    }
    // Reorder Mon..Sun so the chart reads like a working week.
    const reordered = [...buckets.slice(1), buckets[0]];
    return { success: true, data: reordered };
  } catch (err) {
    console.error("[cafe-analytics] getCafeDayOfWeekBreakdown failed", err);
    return { success: false, error: "Failed to load day-of-week breakdown" };
  }
}

// ─────────── Inventory × sales table ───────────

export interface CafeItemInventoryRow {
  id: string;
  name: string;
  description: string | null;
  category: string;
  unitsSold: number;
  /** Units sold via CASH (parent CafePayment.method === "CASH"). */
  cashUnits: number;
  /** Units sold via any digital method — UPI_QR, RAZORPAY, PHONEPE.
   *  FREE / null methods are intentionally counted in unitsSold but
   *  not in cash or online (they're comp / promo lines, not a
   *  payment channel). cashUnits + onlineUnits may therefore total
   *  less than unitsSold. */
  onlineUnits: number;
  /** null = kitchen-prepared / unlimited; integer = on-hand count. */
  stockLeft: number | null;
}

export interface CafeItemInventoryPage {
  rows: CafeItemInventoryRow[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/**
 * Paginated table of every cafe item with units sold (within the
 * selected date window) and current on-hand stock. Returned in
 * units-sold DESC order so the bestsellers float to the top of
 * page 1.
 *
 * Sold count: sum of CafeOrderItem.quantity across orders whose
 * status is in VALID_STATUSES (excludes CANCELLED + PENDING_PAYMENT)
 * and whose createdAt falls within [dateFrom, dateTo]. Items with
 * zero sales in the window still appear (with unitsSold=0) so the
 * admin sees their full menu and stock state in one view, not a
 * truncated bestseller list.
 *
 * Stock: pulled from the live CafeItem.quantity column. Kitchen
 * items (quantity=null) surface as null and render as "—" on the
 * client.
 */
export async function getCafeItemInventoryTable(
  dateFrom: string,
  dateTo: string,
  page = 1,
  pageSize = 20,
): Promise<{
  success: boolean;
  data?: CafeItemInventoryPage;
  error?: string;
}> {
  try {
    await requireAdmin("VIEW_ANALYTICS");
    const { from, to } = rangeBounds(dateFrom, dateTo);
    const safePage = Math.max(1, Math.trunc(page));
    const safeSize = Math.min(100, Math.max(1, Math.trunc(pageSize)));

    // Aggregate sold-units per cafeItemId across the window, with
    // a breakdown by payment channel (cash vs online). Prisma's
    // groupBy can't group by a relation field, so we fetch the raw
    // lines + parent payment.method in one query and bucket in
    // memory. Item-line cardinality is small (one row per line, not
    // per order item × quantity) so this stays cheap.
    const lines = await db.cafeOrderItem.findMany({
      where: {
        order: {
          createdAt: { gte: from, lte: to },
          status: { in: [...VALID_STATUSES] },
        },
      },
      select: {
        cafeItemId: true,
        quantity: true,
        order: {
          select: { payment: { select: { method: true } } },
        },
      },
    });

    const soldMap = new Map<string, number>();
    const cashMap = new Map<string, number>();
    const onlineMap = new Map<string, number>();
    for (const l of lines) {
      const id = l.cafeItemId;
      const q = l.quantity;
      soldMap.set(id, (soldMap.get(id) ?? 0) + q);
      const method = l.order.payment?.method;
      if (method === "CASH") {
        cashMap.set(id, (cashMap.get(id) ?? 0) + q);
      } else if (
        method === "UPI_QR" ||
        method === "RAZORPAY" ||
        method === "PHONEPE"
      ) {
        onlineMap.set(id, (onlineMap.get(id) ?? 0) + q);
      }
      // FREE / null payment.method intentionally falls through —
      // counted in total but not in either channel.
    }

    // Pull every item — we list the full menu so the admin can
    // also spot zero-sale items. Ordered by sold-DESC at the
    // application layer because we can't ORDER BY an aggregated
    // join in a single Prisma call without raw SQL.
    const items = await db.cafeItem.findMany({
      select: {
        id: true,
        name: true,
        description: true,
        category: true,
        quantity: true,
      },
    });

    const rows: CafeItemInventoryRow[] = items
      .map((i) => ({
        id: i.id,
        name: i.name,
        description: i.description,
        category: String(i.category),
        unitsSold: soldMap.get(i.id) ?? 0,
        cashUnits: cashMap.get(i.id) ?? 0,
        onlineUnits: onlineMap.get(i.id) ?? 0,
        stockLeft: i.quantity,
      }))
      .sort((a, b) => {
        // Primary: units sold DESC; tiebreaker: name ASC so the
        // ordering is deterministic across pages.
        if (b.unitsSold !== a.unitsSold) return b.unitsSold - a.unitsSold;
        return a.name.localeCompare(b.name);
      });

    const total = rows.length;
    const totalPages = Math.max(1, Math.ceil(total / safeSize));
    const start = (safePage - 1) * safeSize;
    const sliced = rows.slice(start, start + safeSize);

    return {
      success: true,
      data: {
        rows: sliced,
        page: safePage,
        pageSize: safeSize,
        total,
        totalPages,
      },
    };
  } catch (err) {
    console.error("[cafe-analytics] getCafeItemInventoryTable failed", err);
    return { success: false, error: "Failed to load inventory table" };
  }
}
