"use server";

import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";
import { Prisma } from "@prisma/client";

async function requireAnalyticsAccess() {
  await requireAdmin("VIEW_ANALYTICS");
}

// Unit normalization:
//   Payment.amount (sports)   → stored in RUPEES
//   CafePayment.amount (cafe) → stored in PAISE
//   CafeOrderItem.totalPrice  → stored in PAISE
// All analytics output is normalized to RUPEES so the dashboard can render a
// single unit without per-source math.
function paiseToRupees(paise: number): number {
  return Math.round(paise / 100);
}

// ===========================
// 1. Revenue Over Time
// ===========================

export async function getRevenueOverTime(filters: {
  dateFrom: string;
  dateTo: string;
  scope: "all" | "sports" | "cafe";
  groupBy: "day" | "week" | "month";
}) {
  await requireAnalyticsAccess();

  try {
    const { dateFrom, dateTo, scope, groupBy } = filters;
    const from = new Date(dateFrom);
    const to = new Date(dateTo);
    to.setHours(23, 59, 59, 999);

    const truncUnit = groupBy === "day" ? "day" : groupBy === "week" ? "week" : "month";

    const sportsData =
      scope === "cafe"
        ? []
        : await db.$queryRaw<
            { period: Date; revenue: bigint }[]
          >(Prisma.sql`
            SELECT DATE_TRUNC(${Prisma.raw(`'${truncUnit}'`)}, p."confirmedAt") AS period,
                   SUM(p.amount)::bigint AS revenue
            FROM "Payment" p
            WHERE p.status = 'COMPLETED'
              AND p."confirmedAt" >= ${from}
              AND p."confirmedAt" <= ${to}
            GROUP BY period
            ORDER BY period
          `);

    const cafeData =
      scope === "sports"
        ? []
        : await db.$queryRaw<
            { period: Date; revenue: bigint }[]
          >(Prisma.sql`
            SELECT DATE_TRUNC(${Prisma.raw(`'${truncUnit}'`)}, cp."confirmedAt") AS period,
                   SUM(cp.amount)::bigint AS revenue
            FROM "CafePayment" cp
            WHERE cp.status = 'COMPLETED'
              AND cp."confirmedAt" >= ${from}
              AND cp."confirmedAt" <= ${to}
            GROUP BY period
            ORDER BY period
          `);

    // Merge into a unified timeline
    const periodMap = new Map<
      string,
      { period: string; sportsRevenue: number; cafeRevenue: number; totalRevenue: number }
    >();

    for (const row of sportsData) {
      const key = row.period.toISOString().split("T")[0];
      const existing = periodMap.get(key) || {
        period: key,
        sportsRevenue: 0,
        cafeRevenue: 0,
        totalRevenue: 0,
      };
      existing.sportsRevenue = Number(row.revenue);
      existing.totalRevenue = existing.sportsRevenue + existing.cafeRevenue;
      periodMap.set(key, existing);
    }

    for (const row of cafeData) {
      const key = row.period.toISOString().split("T")[0];
      const existing = periodMap.get(key) || {
        period: key,
        sportsRevenue: 0,
        cafeRevenue: 0,
        totalRevenue: 0,
      };
      // CafePayment.amount is paise → convert to rupees for unified display
      existing.cafeRevenue = paiseToRupees(Number(row.revenue));
      existing.totalRevenue = existing.sportsRevenue + existing.cafeRevenue;
      periodMap.set(key, existing);
    }

    const result = Array.from(periodMap.values()).sort((a, b) =>
      a.period.localeCompare(b.period)
    );

    return { success: true, data: result };
  } catch (error) {
    console.error("getRevenueOverTime error:", error);
    return { success: false, error: "Failed to fetch revenue data" };
  }
}

// ===========================
// 2. Sport Revenue Breakdown
// ===========================

export async function getSportRevenueBreakdown(
  dateFrom: string,
  dateTo: string
) {
  await requireAnalyticsAccess();

  try {
    const from = new Date(dateFrom);
    const to = new Date(dateTo);
    to.setHours(23, 59, 59, 999);

    const results = await db.payment.findMany({
      where: {
        status: "COMPLETED",
        confirmedAt: { gte: from, lte: to },
      },
      select: {
        amount: true,
        booking: {
          select: {
            courtConfig: {
              select: { sport: true },
            },
          },
        },
      },
    });

    const sportMap = new Map<
      string,
      { sport: string; revenue: number; bookingCount: number }
    >();

    for (const payment of results) {
      const sport = payment.booking.courtConfig.sport;
      const existing = sportMap.get(sport) || {
        sport,
        revenue: 0,
        bookingCount: 0,
      };
      existing.revenue += payment.amount;
      existing.bookingCount += 1;
      sportMap.set(sport, existing);
    }

    return { success: true, data: Array.from(sportMap.values()) };
  } catch (error) {
    console.error("getSportRevenueBreakdown error:", error);
    return { success: false, error: "Failed to fetch sport revenue breakdown" };
  }
}

// ===========================
// 3. Cafe Category Breakdown
// ===========================

export async function getCafeCategoryBreakdown(
  dateFrom: string,
  dateTo: string
) {
  await requireAnalyticsAccess();

  try {
    const from = new Date(dateFrom);
    const to = new Date(dateTo);
    to.setHours(23, 59, 59, 999);

    const orders = await db.cafeOrder.findMany({
      where: {
        payment: {
          status: "COMPLETED",
          confirmedAt: { gte: from, lte: to },
        },
      },
      select: {
        id: true,
        items: {
          select: {
            totalPrice: true,
            cafeItem: {
              select: { category: true },
            },
          },
        },
      },
    });

    const categoryMap = new Map<
      string,
      { category: string; revenue: number; orderCount: number }
    >();

    // Track unique orders per category
    const orderSets = new Map<string, Set<string>>();

    for (const order of orders) {
      for (const item of order.items) {
        const category = item.cafeItem.category;
        const existing = categoryMap.get(category) || {
          category,
          revenue: 0,
          orderCount: 0,
        };
        // CafeOrderItem.totalPrice is paise → convert to rupees
        existing.revenue += paiseToRupees(item.totalPrice);
        categoryMap.set(category, existing);

        if (!orderSets.has(category)) {
          orderSets.set(category, new Set());
        }
        orderSets.get(category)!.add(order.id);
      }
    }

    // Set unique order counts
    for (const [category, orderIds] of orderSets) {
      const entry = categoryMap.get(category)!;
      entry.orderCount = orderIds.size;
    }

    return { success: true, data: Array.from(categoryMap.values()) };
  } catch (error) {
    console.error("getCafeCategoryBreakdown error:", error);
    return {
      success: false,
      error: "Failed to fetch cafe category breakdown",
    };
  }
}

// ===========================
// 4. Peak Hour Analysis
// ===========================

export async function getPeakHourAnalysis(dateFrom: string, dateTo: string) {
  await requireAnalyticsAccess();

  try {
    const from = new Date(dateFrom);
    const to = new Date(dateTo);
    to.setHours(23, 59, 59, 999);

    const slots = await db.bookingSlot.findMany({
      where: {
        booking: {
          status: "CONFIRMED",
          date: { gte: from, lte: to },
        },
      },
      select: {
        startHour: true,
      },
    });

    const hourMap = new Map<number, number>();

    for (const slot of slots) {
      hourMap.set(slot.startHour, (hourMap.get(slot.startHour) || 0) + 1);
    }

    const data = Array.from(hourMap.entries())
      .map(([hour, bookingCount]) => ({ hour, bookingCount }))
      .sort((a, b) => a.hour - b.hour);

    return { success: true, data };
  } catch (error) {
    console.error("getPeakHourAnalysis error:", error);
    return { success: false, error: "Failed to fetch peak hour analysis" };
  }
}

// ===========================
// 5. Top Customers
// ===========================

export async function getTopCustomers(
  dateFrom: string,
  dateTo: string,
  limit: number = 10
) {
  await requireAnalyticsAccess();

  try {
    const from = new Date(dateFrom);
    const to = new Date(dateTo);
    to.setHours(23, 59, 59, 999);

    // Get sports spending per user (limit to 5000 records to prevent memory issues)
    const sportsPayments = await db.payment.findMany({
      where: {
        status: "COMPLETED",
        confirmedAt: { gte: from, lte: to },
      },
      select: {
        amount: true,
        booking: {
          select: { userId: true },
        },
      },
      take: 5000,
    });

    // Get cafe spending per user (limit to 5000 records)
    const cafePayments = await db.cafePayment.findMany({
      where: {
        status: "COMPLETED",
        confirmedAt: { gte: from, lte: to },
      },
      select: {
        amount: true,
        order: {
          select: { userId: true },
        },
      },
      take: 5000,
    });

    const customerMap = new Map<
      string,
      { totalSpent: number; bookingCount: number; orderCount: number }
    >();

    for (const p of sportsPayments) {
      const userId = p.booking.userId;
      const existing = customerMap.get(userId) || {
        totalSpent: 0,
        bookingCount: 0,
        orderCount: 0,
      };
      existing.totalSpent += p.amount;
      existing.bookingCount += 1;
      customerMap.set(userId, existing);
    }

    for (const p of cafePayments) {
      const userId = p.order.userId;
      if (!userId) continue; // skip guest orders
      const existing = customerMap.get(userId) || {
        totalSpent: 0,
        bookingCount: 0,
        orderCount: 0,
      };
      // CafePayment.amount is paise → convert to rupees for consistent merge
      existing.totalSpent += paiseToRupees(p.amount);
      existing.orderCount += 1;
      customerMap.set(userId, existing);
    }

    // Sort by total spent and take top N
    const topUserIds = Array.from(customerMap.entries())
      .sort((a, b) => b[1].totalSpent - a[1].totalSpent)
      .slice(0, limit);

    // Fetch user details
    const userIds = topUserIds.map(([id]) => id);
    const users = await db.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, email: true },
    });

    const userLookup = new Map(users.map((u) => [u.id, u]));

    const data = topUserIds.map(([userId, stats]) => {
      const user = userLookup.get(userId);
      return {
        userId,
        name: user?.name || "Unknown",
        email: user?.email || "",
        totalSpent: stats.totalSpent,
        bookingCount: stats.bookingCount,
        orderCount: stats.orderCount,
      };
    });

    return { success: true, data };
  } catch (error) {
    console.error("getTopCustomers error:", error);
    return { success: false, error: "Failed to fetch top customers" };
  }
}

// ===========================
// 6. Payment Method Breakdown
// ===========================

export async function getPaymentMethodBreakdown(
  dateFrom: string,
  dateTo: string
) {
  await requireAnalyticsAccess();

  try {
    const from = new Date(dateFrom);
    const to = new Date(dateTo);
    to.setHours(23, 59, 59, 999);

    const sportsPayments = await db.payment.groupBy({
      by: ["method"],
      where: {
        status: "COMPLETED",
        confirmedAt: { gte: from, lte: to },
      },
      _count: { id: true },
      _sum: { amount: true },
    });

    const cafePayments = await db.cafePayment.groupBy({
      by: ["method"],
      where: {
        status: "COMPLETED",
        confirmedAt: { gte: from, lte: to },
      },
      _count: { id: true },
      _sum: { amount: true },
    });

    const methodMap = new Map<
      string,
      { method: string; count: number; amount: number }
    >();

    for (const row of sportsPayments) {
      const existing = methodMap.get(row.method) || {
        method: row.method,
        count: 0,
        amount: 0,
      };
      existing.count += row._count.id;
      existing.amount += row._sum.amount || 0;
      methodMap.set(row.method, existing);
    }

    for (const row of cafePayments) {
      const existing = methodMap.get(row.method) || {
        method: row.method,
        count: 0,
        amount: 0,
      };
      existing.count += row._count.id;
      // CafePayment.amount is paise → convert to rupees before merging with sports
      existing.amount += paiseToRupees(row._sum.amount || 0);
      methodMap.set(row.method, existing);
    }

    return { success: true, data: Array.from(methodMap.values()) };
  } catch (error) {
    console.error("getPaymentMethodBreakdown error:", error);
    return {
      success: false,
      error: "Failed to fetch payment method breakdown",
    };
  }
}

// ===========================
// 7. KPI Stats
// ===========================

export async function getKPIStats(dateFrom: string, dateTo: string) {
  await requireAnalyticsAccess();

  try {
    const from = new Date(dateFrom);
    const to = new Date(dateTo);
    to.setHours(23, 59, 59, 999);

    const [
      sportsAgg,
      cafeAgg,
      totalBookings,
      cancelledBookings,
      totalOrders,
      activeBookingUsers,
      activeCafeUsers,
    ] = await Promise.all([
      // Sports revenue
      db.payment.aggregate({
        where: {
          status: "COMPLETED",
          confirmedAt: { gte: from, lte: to },
        },
        _sum: { amount: true },
        _count: { id: true },
      }),
      // Cafe revenue
      db.cafePayment.aggregate({
        where: {
          status: "COMPLETED",
          confirmedAt: { gte: from, lte: to },
        },
        _sum: { amount: true },
        _count: { id: true },
      }),
      // Total confirmed bookings
      db.booking.count({
        where: {
          status: "CONFIRMED",
          date: { gte: from, lte: to },
        },
      }),
      // Cancelled bookings
      db.booking.count({
        where: {
          status: "CANCELLED",
          date: { gte: from, lte: to },
        },
      }),
      // Total completed cafe orders
      db.cafeOrder.count({
        where: {
          status: "COMPLETED",
          createdAt: { gte: from, lte: to },
        },
      }),
      // Distinct sports customers
      db.booking.findMany({
        where: {
          status: "CONFIRMED",
          date: { gte: from, lte: to },
        },
        select: { userId: true },
        distinct: ["userId"],
      }),
      // Distinct cafe customers
      db.cafeOrder.findMany({
        where: {
          payment: {
            status: "COMPLETED",
            confirmedAt: { gte: from, lte: to },
          },
          userId: { not: null },
        },
        select: { userId: true },
        distinct: ["userId"],
      }),
    ]);

    // Payment.amount (sports) is rupees; CafePayment.amount is paise.
    const sportsRevenue = sportsAgg._sum.amount || 0;
    const cafeRevenue = paiseToRupees(cafeAgg._sum.amount || 0);
    const totalRevenue = sportsRevenue + cafeRevenue;

    const sportsPaymentCount = sportsAgg._count.id;
    const avgBookingValue =
      sportsPaymentCount > 0
        ? Math.round(sportsRevenue / sportsPaymentCount)
        : 0;

    const totalBookingsAndCancelled = totalBookings + cancelledBookings;
    const cancellationRate =
      totalBookingsAndCancelled > 0
        ? Math.round(
            (cancelledBookings / totalBookingsAndCancelled) * 10000
          ) / 100
        : 0;

    // Merge unique customer IDs
    const uniqueCustomers = new Set<string>();
    for (const b of activeBookingUsers) {
      uniqueCustomers.add(b.userId);
    }
    for (const o of activeCafeUsers) {
      if (o.userId) uniqueCustomers.add(o.userId);
    }

    return {
      success: true,
      data: {
        totalRevenue,
        sportsRevenue,
        cafeRevenue,
        totalBookings,
        totalOrders,
        avgBookingValue,
        cancellationRate,
        activeCustomers: uniqueCustomers.size,
      },
    };
  } catch (error) {
    console.error("getKPIStats error:", error);
    return { success: false, error: "Failed to fetch KPI stats" };
  }
}
