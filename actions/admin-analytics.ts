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
    to.setUTCHours(23, 59, 59, 999);

    const truncUnit = groupBy === "day" ? "day" : groupBy === "week" ? "week" : "month";

    // Join Payment → Booking so we sum Booking.totalAmount (post-discount)
    // rather than Payment.amount. Keeps the chart consistent with the KPI
    // cards, which also use Booking.totalAmount for revenue recognition.
    const sportsData =
      scope === "cafe"
        ? []
        : await db.$queryRaw<
            { period: Date; revenue: bigint }[]
          >(Prisma.sql`
            SELECT DATE_TRUNC(${Prisma.raw(`'${truncUnit}'`)}, p."confirmedAt") AS period,
                   SUM(b."totalAmount")::bigint AS revenue
            FROM "Payment" p
            INNER JOIN "Booking" b ON b.id = p."bookingId"
            WHERE p.status = 'COMPLETED'
              AND b.status = 'CONFIRMED'
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
    to.setUTCHours(23, 59, 59, 999);

    // Use Booking.totalAmount (post-discount) instead of Payment.amount
    // so the per-sport breakdown matches the KPI totals when coupons /
    // admin price negotiations reduce the final bill.
    const results = await db.booking.findMany({
      where: {
        status: "CONFIRMED",
        payment: {
          status: "COMPLETED",
          confirmedAt: { gte: from, lte: to },
        },
      },
      select: {
        totalAmount: true,
        courtConfig: {
          select: { sport: true },
        },
      },
    });

    const sportMap = new Map<
      string,
      { sport: string; revenue: number; bookingCount: number }
    >();

    for (const booking of results) {
      const sport = booking.courtConfig.sport;
      const existing = sportMap.get(sport) || {
        sport,
        revenue: 0,
        bookingCount: 0,
      };
      existing.revenue += booking.totalAmount;
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
    to.setUTCHours(23, 59, 59, 999);

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
    to.setUTCHours(23, 59, 59, 999);

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
    to.setUTCHours(23, 59, 59, 999);

    // Sports spending per user. Read totalAmount off Booking (post-
    // discount) so the "total spent" column matches the customer's
    // actual bill after any coupons applied. Limit 5000 to keep memory
    // bounded on large windows.
    const sportsBookings = await db.booking.findMany({
      where: {
        status: "CONFIRMED",
        payment: {
          status: "COMPLETED",
          confirmedAt: { gte: from, lte: to },
        },
      },
      select: {
        totalAmount: true,
        userId: true,
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

    for (const b of sportsBookings) {
      const userId = b.userId;
      const existing = customerMap.get(userId) || {
        totalSpent: 0,
        bookingCount: 0,
        orderCount: 0,
      };
      existing.totalSpent += b.totalAmount;
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
    to.setUTCHours(23, 59, 59, 999);

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
    // setUTCHours so the inclusive end-of-day boundary is anchored in UTC
    // regardless of server timezone. With plain setHours and an IST-tz
    // server, "today" would cut off at 18:29:59Z and miss the last 5.5
    // hours of same-day payments, which made this page's lifetime totals
    // drift below /admin/bookings' unfiltered total.
    to.setUTCHours(23, 59, 59, 999);

    const [
      sportsAgg,
      cafeAgg,
      totalBookings,
      cancelledBookings,
      totalOrders,
      activeBookingUsers,
      activeCafeUsers,
    ] = await Promise.all([
      // Sports revenue. Sums Booking.totalAmount (post-discount) rather
      // than Payment.amount — when a coupon reduces the final bill,
      // Booking.totalAmount is authoritative, whereas Payment.amount
      // can reflect the gateway-charged figure before the reduction.
      // Filter: CONFIRMED bookings whose payment lands COMPLETED inside
      // the selected window.
      db.booking.aggregate({
        where: {
          status: "CONFIRMED",
          payment: {
            status: "COMPLETED",
            confirmedAt: { gte: from, lte: to },
          },
        },
        _sum: { totalAmount: true },
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

    // Booking.totalAmount (sports) is rupees; CafePayment.amount is paise.
    const sportsRevenue = sportsAgg._sum.totalAmount || 0;
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

// ===========================
// 8. Daily earnings for a month (day-of-month bars)
// ===========================
//
// Keyed on Booking.date (the day the slot is played), NOT
// payment.confirmedAt — admins want "what did we earn for bookings on
// that day" irrespective of when the money hit.
//
// Earnings use Booking.totalAmount (post-discount) so the reported
// figure equals the money actually taken, matching the "Total/Sports
// Revenue" KPI tile. Earlier this used COALESCE(originalAmount,
// totalAmount) to show pre-discount; that made the chart totals
// exceed the KPI by the sum of coupon discounts, which confused
// admins comparing the two surfaces.
//
// Returns 28–31 rows, one per day in the selected month, filling
// zero-earning days explicitly so the chart has a stable x-axis.
export async function getDailyEarningsForMonth(
  year: number,
  month: number // 1-12
) {
  await requireAnalyticsAccess();

  try {
    if (
      !Number.isInteger(year) ||
      !Number.isInteger(month) ||
      month < 1 ||
      month > 12
    ) {
      return { success: false as const, error: "Invalid year/month" };
    }

    // Use UTC to match Booking.date which is stored as a Date column
    // (midnight UTC). Ranges are [start, next) so the last day is fully
    // included without off-by-one.
    const start = new Date(Date.UTC(year, month - 1, 1));
    const nextStart = new Date(Date.UTC(year, month, 1));
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

    const rows = await db.$queryRaw<
      { day: number; earnings: bigint; booking_count: bigint }[]
    >(Prisma.sql`
      SELECT
        EXTRACT(DAY FROM b.date)::int AS day,
        SUM(b."totalAmount")::bigint AS earnings,
        COUNT(*)::bigint AS booking_count
      FROM "Booking" b
      WHERE b.status = 'CONFIRMED'
        AND b.date >= ${start}
        AND b.date < ${nextStart}
      GROUP BY day
      ORDER BY day
    `);

    const rowMap = new Map<number, { earnings: number; bookingCount: number }>();
    for (const r of rows) {
      rowMap.set(r.day, {
        earnings: Number(r.earnings),
        bookingCount: Number(r.booking_count),
      });
    }

    const data = Array.from({ length: daysInMonth }, (_, i) => {
      const day = i + 1;
      const row = rowMap.get(day);
      return {
        day,
        earnings: row?.earnings ?? 0,
        bookingCount: row?.bookingCount ?? 0,
      };
    });

    return { success: true as const, data };
  } catch (error) {
    console.error("getDailyEarningsForMonth error:", error);
    return { success: false as const, error: "Failed to fetch daily earnings" };
  }
}

// ===========================
// 9. Monthly earnings for a year (month bars)
// ===========================
//
// Same grouping philosophy as getDailyEarningsForMonth — bucket on
// Booking.date and sum post-discount Booking.totalAmount so the year
// total matches the KPI Sports Revenue tile. Returns 12 rows, one per
// month, padding months with no bookings to zero.
export async function getMonthlyEarningsForYear(year: number) {
  await requireAnalyticsAccess();

  try {
    if (!Number.isInteger(year)) {
      return { success: false as const, error: "Invalid year" };
    }

    const start = new Date(Date.UTC(year, 0, 1));
    const nextStart = new Date(Date.UTC(year + 1, 0, 1));

    const rows = await db.$queryRaw<
      { month: number; earnings: bigint; booking_count: bigint }[]
    >(Prisma.sql`
      SELECT
        EXTRACT(MONTH FROM b.date)::int AS month,
        SUM(b."totalAmount")::bigint AS earnings,
        COUNT(*)::bigint AS booking_count
      FROM "Booking" b
      WHERE b.status = 'CONFIRMED'
        AND b.date >= ${start}
        AND b.date < ${nextStart}
      GROUP BY month
      ORDER BY month
    `);

    const rowMap = new Map<number, { earnings: number; bookingCount: number }>();
    for (const r of rows) {
      rowMap.set(r.month, {
        earnings: Number(r.earnings),
        bookingCount: Number(r.booking_count),
      });
    }

    const data = Array.from({ length: 12 }, (_, i) => {
      const month = i + 1;
      const row = rowMap.get(month);
      return {
        month,
        earnings: row?.earnings ?? 0,
        bookingCount: row?.bookingCount ?? 0,
      };
    });

    return { success: true as const, data };
  } catch (error) {
    console.error("getMonthlyEarningsForYear error:", error);
    return {
      success: false as const,
      error: "Failed to fetch monthly earnings",
    };
  }
}
