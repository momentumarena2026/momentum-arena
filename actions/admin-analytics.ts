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

// Bookings that count as real, non-cancelled business. Mirrors
// EARNING_BOOKING_STATUSES in actions/admin-booking.ts.
//
// COMPLETED and ABSENT are the front desk's two closeout buttons, and
// both are terminal states a CONFIRMED booking passes into after the
// session. Filtering on CONFIRMED alone meant every closeout silently
// deleted that booking's money from the dashboard — and retroactively,
// since past dates get closed out in bulk. ABSENT belongs here for the
// same reason as COMPLETED: a no-show forfeits its advance, so the
// venue keeps the money and it must stay counted. Only CANCELLED
// (money refunded / never taken) is excluded.
//
// What keeps that honest is closeOutBooking (actions/admin-booking.ts)
// writing the UNCOLLECTED balance off Booking.totalAmount, so a no-show
// contributes only the advance it actually forfeited. Do not assume the
// Payment.status = COMPLETED join does that job — getDailyEarningsForMonth
// and getMonthlyEarningsForYear bucket on Booking.date and join no
// Payment at all.
const EARNING_BOOKING_STATUSES = ["CONFIRMED", "COMPLETED", "ABSENT"] as const;

// Same list for raw-SQL call sites: `b.status IN (...)`.
const EARNING_BOOKING_STATUSES_SQL = Prisma.join([
  ...EARNING_BOOKING_STATUSES,
]);

// Bookings that CONSUMED court time — demand, not money. Identical
// membership to EARNING_BOOKING_STATUSES today, but they answer
// different questions: a booking can stop being revenue (unpaid, fully
// written off) while still having held the court against other
// customers. Named separately so a money-side edit to the list above
// can't silently redefine what "peak hour" means.
const DEMAND_BOOKING_STATUSES = ["CONFIRMED", "COMPLETED", "ABSENT"] as const;

// ===========================
// 1. Revenue Over Time
// ===========================

// A booking may hold several pass redemptions (one per contributing
// pass) — always SUM per booking, a plain Map keeps only the last row.
function sumByBooking(
  rows: { bookingId: string; amount: number }[],
): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.bookingId, (m.get(r.bookingId) ?? 0) + r.amount);
  return m;
}

export async function getRevenueOverTime(
  filters: {
    dateFrom: string;
    dateTo: string;
    scope: "all" | "sports" | "cafe";
    groupBy: "day" | "week" | "month";
  },
) {
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
    //
    // Pass model (cash basis): money counts ONCE, when it arrives. The
    // LEFT JOIN subtracts the pass-settled portion from each booking
    // (fully pass-paid → ₹0; top-up → the gateway remainder), and pass
    // PURCHASES are merged in below keyed to their purchase date.
    const sportsData =
      scope === "cafe"
        ? []
        : await db.$queryRaw<
            { period: Date; revenue: bigint }[]
          >(Prisma.sql`
            SELECT DATE_TRUNC(${Prisma.raw(`'${truncUnit}'`)}, p."confirmedAt") AS period,
                   SUM(b."totalAmount" - COALESCE(pr.covered, 0))::bigint AS revenue
            FROM "Payment" p
            INNER JOIN "Booking" b ON b.id = p."bookingId"
            LEFT JOIN (
              SELECT "bookingId", SUM("coveredAmount") AS covered
              FROM "PassRedemption"
              WHERE "restoredAt" IS NULL
              GROUP BY "bookingId"
            ) pr ON pr."bookingId" = b.id
            WHERE p.status = 'COMPLETED'
              AND b.status IN (${EARNING_BOOKING_STATUSES_SQL})
              AND p."confirmedAt" >= ${from}
              AND p."confirmedAt" <= ${to}
            GROUP BY period
            ORDER BY period
          `);

    // Pass sales — sports money received at purchase time.
    const passSalesData =
      scope === "cafe"
        ? []
        : await db.$queryRaw<
            { period: Date; revenue: bigint }[]
          >(Prisma.sql`
            SELECT DATE_TRUNC(${Prisma.raw(`'${truncUnit}'`)}, up."purchasedAt") AS period,
                   SUM(up.price)::bigint AS revenue
            FROM "UserPass" up
            WHERE up.price > 0
              AND up."purchasedAt" >= ${from}
              AND up."purchasedAt" <= ${to}
            GROUP BY period
            ORDER BY period
          `);

    // Tournament entry fees and camp fees are sports income that never
    // passes through Booking/Payment — the money sits on the team /
    // registration row. Keyed on paidAt so it lands in the month the cash
    // actually arrived, exactly like pass sales above.
    const tournamentData =
      scope === "cafe"
        ? []
        : await db.$queryRaw<
            { period: Date; revenue: bigint }[]
          >(Prisma.sql`
            SELECT DATE_TRUNC(${Prisma.raw(`'${truncUnit}'`)}, tt."paidAt") AS period,
                   SUM(tt."paidAmount")::bigint AS revenue
            FROM "TournamentTeam" tt
            WHERE tt."paidAmount" > 0
              AND tt."archivedAt" IS NULL
              AND tt.status = 'CONFIRMED'
              AND tt."paidAt" >= ${from}
              AND tt."paidAt" <= ${to}
            GROUP BY period
            ORDER BY period
          `);

    const campData =
      scope === "cafe"
        ? []
        : await db.$queryRaw<
            { period: Date; revenue: bigint }[]
          >(Prisma.sql`
            SELECT DATE_TRUNC(${Prisma.raw(`'${truncUnit}'`)}, cr."paidAt") AS period,
                   SUM(cr."paidAmount")::bigint AS revenue
            FROM "CampRegistration" cr
            WHERE cr."paidAmount" > 0
              AND cr."archivedAt" IS NULL
              AND cr.status = 'CONFIRMED'
              AND cr."paidAt" >= ${from}
              AND cr."paidAt" <= ${to}
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

    for (const row of passSalesData) {
      const key = row.period.toISOString().split("T")[0];
      const existing = periodMap.get(key) || {
        period: key,
        sportsRevenue: 0,
        cafeRevenue: 0,
        totalRevenue: 0,
      };
      existing.sportsRevenue += Number(row.revenue);
      existing.totalRevenue = existing.sportsRevenue + existing.cafeRevenue;
      periodMap.set(key, existing);
    }

    for (const row of [...tournamentData, ...campData]) {
      const key = row.period.toISOString().split("T")[0];
      const existing = periodMap.get(key) || {
        period: key,
        sportsRevenue: 0,
        cafeRevenue: 0,
        totalRevenue: 0,
      };
      existing.sportsRevenue += Number(row.revenue);
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
  dateTo: string,
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
        status: { in: [...EARNING_BOOKING_STATUSES] },
        payment: {
          status: "COMPLETED",
          confirmedAt: { gte: from, lte: to },
        },
      },
      select: {
        id: true,
        totalAmount: true,
        courtConfig: {
          select: { sport: true },
        },
      },
    });

    // Pass-settled rupees per booking (cash basis: that money was
    // counted at pass purchase) + pass purchases in the window.
    const [redemptions, passSales] = await Promise.all([
      db.passRedemption.findMany({
        where: {
          bookingId: { in: results.map((b) => b.id) },
          restoredAt: null,
        },
        select: { bookingId: true, coveredAmount: true },
      }),
      db.userPass.findMany({
        where: {
          purchasedAt: { gte: from, lte: to },
          price: { gt: 0 },
        },
        select: { sport: true, price: true },
      }),
    ]);
    const coveredByBooking = sumByBooking(
      redemptions.map((r) => ({ bookingId: r.bookingId, amount: r.coveredAmount })),
    );

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
      existing.revenue +=
        booking.totalAmount - (coveredByBooking.get(booking.id) ?? 0);
      existing.bookingCount += 1;
      sportMap.set(sport, existing);
    }

    // Pass purchases join their sport's revenue on the purchase date.
    for (const p of passSales) {
      const sport = String(p.sport);
      const existing = sportMap.get(sport) || {
        sport,
        revenue: 0,
        bookingCount: 0,
      };
      existing.revenue += p.price;
      sportMap.set(sport, existing);
    }

    return { success: true, data: Array.from(sportMap.values()) };
  } catch (error) {
    console.error("getSportRevenueBreakdown error:", error);
    return { success: false, error: "Failed to fetch sport revenue breakdown" };
  }
}

// ===========================
// 2b. Sport Revenue × Month
// ===========================

/**
 * Sport revenue bucketed by month (YYYY-MM). Returns rows shaped
 * for a Recharts stacked / multi-line chart — one bucket per
 * month, one numeric field per sport (Cricket / Football /
 * Pickleball, etc.) carrying that sport's revenue in that month.
 *
 * Months with no bookings for a given sport report 0 (not
 * missing) so the chart line doesn't dip-to-undefined at idle
 * months. We pre-fill a row for every YYYY-MM in [dateFrom, dateTo]
 * including months with zero total revenue, so a 6-month window
 * always renders six tick-marks even when the venue had a quiet
 * month.
 *
 * Uses Booking.totalAmount keyed by Payment.confirmedAt (matching
 * the other "revenue × time" helpers) so cross-chart totals tally.
 */
export async function getSportRevenueByMonth(
  dateFrom: string,
  dateTo: string,
) {
  await requireAnalyticsAccess();

  try {
    const from = new Date(dateFrom);
    const to = new Date(dateTo);
    to.setUTCHours(23, 59, 59, 999);

    const results = await db.booking.findMany({
      where: {
        status: { in: [...EARNING_BOOKING_STATUSES] },
        payment: {
          status: "COMPLETED",
          confirmedAt: { gte: from, lte: to },
        },
      },
      select: {
        id: true,
        totalAmount: true,
        payment: { select: { confirmedAt: true } },
        courtConfig: { select: { sport: true } },
      },
    });

    // Cash-basis pass treatment: subtract what a pass settled on each
    // booking, and count pass PURCHASES under their sport in the month
    // the money arrived.
    const [redemptions, passSales] = await Promise.all([
      db.passRedemption.findMany({
        where: {
          bookingId: { in: results.map((b) => b.id) },
          restoredAt: null,
        },
        select: { bookingId: true, coveredAmount: true },
      }),
      db.userPass.findMany({
        where: {
          purchasedAt: { gte: from, lte: to },
          price: { gt: 0 },
        },
        select: { sport: true, price: true, purchasedAt: true },
      }),
    ]);
    const coveredByBooking = sumByBooking(
      redemptions.map((r) => ({ bookingId: r.bookingId, amount: r.coveredAmount })),
    );

    // Discover every sport present in the window — we'll initialise
    // each month's row with all sports → 0 so the chart's <Line>
    // dataKeys never bottom out at `undefined`.
    const sports = new Set<string>();
    for (const b of results) sports.add(b.courtConfig.sport);
    for (const p of passSales) sports.add(String(p.sport));

    // Pre-build the month axis. Iterate from the first day of
    // dateFrom's month to dateTo, stepping one month at a time.
    const monthAxis: string[] = [];
    const cursor = new Date(
      Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1),
    );
    const endCursor = new Date(
      Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1),
    );
    while (cursor.getTime() <= endCursor.getTime()) {
      const key = `${cursor.getUTCFullYear()}-${String(
        cursor.getUTCMonth() + 1,
      ).padStart(2, "0")}`;
      monthAxis.push(key);
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }

    // Initialise each month with all known sports = 0.
    const buckets = new Map<string, Record<string, number | string>>();
    for (const m of monthAxis) {
      const row: Record<string, number | string> = { period: m };
      for (const s of sports) row[titleSport(s)] = 0;
      buckets.set(m, row);
    }

    // Accumulate bookings net of the pass-settled portion.
    for (const b of results) {
      const at = b.payment?.confirmedAt;
      if (!at) continue;
      const key = `${at.getUTCFullYear()}-${String(
        at.getUTCMonth() + 1,
      ).padStart(2, "0")}`;
      const row = buckets.get(key);
      if (!row) continue;
      const sportLabel = titleSport(b.courtConfig.sport);
      row[sportLabel] =
        ((row[sportLabel] as number) ?? 0) +
        b.totalAmount -
        (coveredByBooking.get(b.id) ?? 0);
    }

    // Pass purchases land in the month the money arrived.
    for (const p of passSales) {
      const key = `${p.purchasedAt.getUTCFullYear()}-${String(
        p.purchasedAt.getUTCMonth() + 1,
      ).padStart(2, "0")}`;
      const row = buckets.get(key);
      if (!row) continue;
      const sportLabel = titleSport(String(p.sport));
      row[sportLabel] = ((row[sportLabel] as number) ?? 0) + p.price;
    }

    const data = monthAxis.map((m) => buckets.get(m)!);
    const sportLabels = Array.from(sports).map(titleSport).sort();

    return { success: true, data, sports: sportLabels };
  } catch (error) {
    console.error("getSportRevenueByMonth error:", error);
    return {
      success: false,
      error: "Failed to fetch sport revenue by month",
    };
  }
}

function titleSport(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
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

export async function getPeakHourAnalysis(
  dateFrom: string,
  dateTo: string,
) {
  await requireAnalyticsAccess();

  try {
    const from = new Date(dateFrom);
    const to = new Date(dateTo);
    to.setUTCHours(23, 59, 59, 999);

    const slots = await db.bookingSlot.findMany({
      where: {
        booking: {
          // Occupancy, not money: a closed-out session still consumed
          // that hour, and a no-show still held the court against
          // other customers. Both must count as peak-hour demand.
          status: { in: [...DEMAND_BOOKING_STATUSES] },
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
  limit: number = 10,
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
        status: { in: [...EARNING_BOOKING_STATUSES] },
        payment: {
          status: "COMPLETED",
          confirmedAt: { gte: from, lte: to },
        },
      },
      select: {
        id: true,
        totalAmount: true,
        userId: true,
      },
      take: 5000,
    });

    // Cash basis: a customer's spend counts when money moved — the pass
    // purchase itself counts; pass-settled booking portions don't.
    const [bookingRedemptions, passPurchases] = await Promise.all([
      db.passRedemption.findMany({
        where: {
          bookingId: { in: sportsBookings.map((b) => b.id) },
          restoredAt: null,
        },
        select: { bookingId: true, coveredAmount: true },
      }),
      db.userPass.findMany({
        where: {
          purchasedAt: { gte: from, lte: to },
          price: { gt: 0 },
        },
        select: { userId: true, price: true },
      }),
    ]);
    const coveredByBooking = sumByBooking(
      bookingRedemptions.map((r) => ({ bookingId: r.bookingId, amount: r.coveredAmount })),
    );

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
      existing.totalSpent +=
        b.totalAmount - (coveredByBooking.get(b.id) ?? 0);
      existing.bookingCount += 1;
      customerMap.set(userId, existing);
    }

    for (const p of passPurchases) {
      const existing = customerMap.get(p.userId) || {
        totalSpent: 0,
        bookingCount: 0,
        orderCount: 0,
      };
      existing.totalSpent += p.price;
      customerMap.set(p.userId, existing);
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
  dateTo: string,
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

export async function getKPIStats(
  dateFrom: string,
  dateTo: string,
) {
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
      passSalesAgg,
      tournamentAgg,
      campAgg,
      cafeAgg,
      totalBookings,
      cancelledBookings,
      totalOrders,
      activeBookingUsers,
      activeCafeUsers,
    ] = await Promise.all([
      // Sports booking revenue. Sums Booking.totalAmount (post-discount)
      // rather than Payment.amount — when a coupon reduces the final
      // bill, Booking.totalAmount is authoritative. The LEFT JOIN nets
      // out the pass-settled portion (cash basis: that money was
      // recognised at pass purchase, counted separately below).
      // Filter: non-cancelled bookings whose payment lands COMPLETED
      // inside the selected window.
      db.$queryRaw<{ revenue: bigint | null; cnt: bigint }[]>(Prisma.sql`
        SELECT SUM(b."totalAmount" - COALESCE(pr.covered, 0))::bigint AS revenue,
               COUNT(*)::bigint AS cnt
        FROM "Booking" b
        INNER JOIN "Payment" p ON p."bookingId" = b.id
        LEFT JOIN (
          SELECT "bookingId", SUM("coveredAmount") AS covered
          FROM "PassRedemption"
          WHERE "restoredAt" IS NULL
          GROUP BY "bookingId"
        ) pr ON pr."bookingId" = b.id
        WHERE b.status IN (${EARNING_BOOKING_STATUSES_SQL})
          AND p.status = 'COMPLETED'
          AND p."confirmedAt" >= ${from}
          AND p."confirmedAt" <= ${to}
      `),
      // Pass sales — sports money received at purchase time.
      db.userPass.aggregate({
        where: {
          purchasedAt: { gte: from, lte: to },
          price: { gt: 0 },
        },
        _sum: { price: true },
      }),
      // Tournament entry fees and camp fees — sports income that never
      // touches Booking or Payment, so the tile under-reported without
      // these. Cash basis on paidAt, same as pass sales above.
      db.tournamentTeam.aggregate({
        where: {
          status: "CONFIRMED",
          archivedAt: null,
          paidAmount: { gt: 0 },
          paidAt: { gte: from, lte: to },
        },
        _sum: { paidAmount: true },
      }),
      db.campRegistration.aggregate({
        where: {
          status: "CONFIRMED",
          archivedAt: null,
          paidAmount: { gt: 0 },
          paidAt: { gte: from, lte: to },
        },
        _sum: { paidAmount: true },
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
      // Total non-cancelled bookings. Also the cancellation-rate
      // denominator, so closeouts must stay in it — otherwise the
      // rate creeps toward 100% for past windows as the front desk
      // works through them.
      db.booking.count({
        where: {
          status: { in: [...EARNING_BOOKING_STATUSES] },
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
          status: { in: [...EARNING_BOOKING_STATUSES] },
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
    const bookingNetRevenue = Number(sportsAgg[0]?.revenue ?? 0);
    const passSalesRevenue = passSalesAgg._sum.price || 0;
    const tournamentRevenue = tournamentAgg._sum.paidAmount || 0;
    const campRevenue = campAgg._sum.paidAmount || 0;
    const sportsRevenue =
      bookingNetRevenue + passSalesRevenue + tournamentRevenue + campRevenue;
    const cafeRevenue = paiseToRupees(cafeAgg._sum.amount || 0);
    const totalRevenue = sportsRevenue + cafeRevenue;

    // Avg booking value stays a BOOKING metric — pass sales aren't
    // bookings, so they don't join the numerator or denominator.
    const sportsPaymentCount = Number(sportsAgg[0]?.cnt ?? 0);
    const avgBookingValue =
      sportsPaymentCount > 0
        ? Math.round(bookingNetRevenue / sportsPaymentCount)
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
  month: number, // 1-12
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
    // Pass purchases are timestamps; bucket them by IST calendar day.
    // Midnight IST = UTC − 5h30m.
    const IST_OFFSET_MS = 330 * 60 * 1000;
    const istStart = new Date(start.getTime() - IST_OFFSET_MS);
    const istNextStart = new Date(nextStart.getTime() - IST_OFFSET_MS);

    // Bookings net of the pass-settled portion (cash basis — the pass
    // money is counted on its purchase day below, not on play days).
    const rows = await db.$queryRaw<
      { day: number; earnings: bigint; booking_count: bigint }[]
    >(Prisma.sql`
      SELECT
        EXTRACT(DAY FROM b.date)::int AS day,
        SUM(b."totalAmount" - COALESCE(pr.covered, 0))::bigint AS earnings,
        COUNT(*)::bigint AS booking_count
      FROM "Booking" b
      LEFT JOIN (
        SELECT "bookingId", SUM("coveredAmount") AS covered
        FROM "PassRedemption"
        WHERE "restoredAt" IS NULL
        GROUP BY "bookingId"
      ) pr ON pr."bookingId" = b.id
      WHERE b.status IN (${EARNING_BOOKING_STATUSES_SQL})
        AND b.date >= ${start}
        AND b.date < ${nextStart}
      GROUP BY day
      ORDER BY day
    `);

    // Pass sales by IST purchase day.
    const passRows = await db.$queryRaw<
      { day: number; earnings: bigint; pass_count: bigint }[]
    >(Prisma.sql`
      SELECT
        EXTRACT(DAY FROM (up."purchasedAt" + interval '330 minutes'))::int AS day,
        SUM(up.price)::bigint AS earnings,
        COUNT(*)::bigint AS pass_count
      FROM "UserPass" up
      WHERE up.price > 0
        AND up."purchasedAt" >= ${istStart}
        AND up."purchasedAt" < ${istNextStart}
      GROUP BY day
      ORDER BY day
    `);

    // Tournament entry fees and camp fees never pass through Booking or
    // Payment — the money sits on the team / registration row. Keyed on
    // paidAt, bucketed by IST day like pass sales above. Without this the
    // month view silently disagrees with getRevenueOverTime, which has
    // counted them since the cash-basis work.
    const tournamentRows = await db.$queryRaw<
      { day: number; earnings: bigint }[]
    >(Prisma.sql`
      SELECT
        EXTRACT(DAY FROM (tt."paidAt" + interval '330 minutes'))::int AS day,
        SUM(tt."paidAmount")::bigint AS earnings
      FROM "TournamentTeam" tt
      WHERE tt."paidAmount" > 0
        AND tt."archivedAt" IS NULL
        AND tt.status = 'CONFIRMED'
        AND tt."paidAt" >= ${istStart}
        AND tt."paidAt" < ${istNextStart}
      GROUP BY day
      ORDER BY day
    `);

    const campRows = await db.$queryRaw<
      { day: number; earnings: bigint }[]
    >(Prisma.sql`
      SELECT
        EXTRACT(DAY FROM (cr."paidAt" + interval '330 minutes'))::int AS day,
        SUM(cr."paidAmount")::bigint AS earnings
      FROM "CampRegistration" cr
      WHERE cr."paidAmount" > 0
        AND cr."archivedAt" IS NULL
        AND cr.status = 'CONFIRMED'
        AND cr."paidAt" >= ${istStart}
        AND cr."paidAt" < ${istNextStart}
      GROUP BY day
      ORDER BY day
    `);

    const rowMap = new Map<
      number,
      { earnings: number; bookingCount: number; passCount: number }
    >();
    for (const r of rows) {
      rowMap.set(r.day, {
        earnings: Number(r.earnings),
        bookingCount: Number(r.booking_count),
        passCount: 0,
      });
    }
    for (const r of passRows) {
      const existing =
        rowMap.get(r.day) ?? { earnings: 0, bookingCount: 0, passCount: 0 };
      existing.earnings += Number(r.earnings);
      existing.passCount += Number(r.pass_count);
      rowMap.set(r.day, existing);
    }
    for (const r of [...tournamentRows, ...campRows]) {
      const existing =
        rowMap.get(r.day) ?? { earnings: 0, bookingCount: 0, passCount: 0 };
      existing.earnings += Number(r.earnings);
      rowMap.set(r.day, existing);
    }

    const data = Array.from({ length: daysInMonth }, (_, i) => {
      const day = i + 1;
      const row = rowMap.get(day);
      return {
        day,
        earnings: row?.earnings ?? 0,
        bookingCount: row?.bookingCount ?? 0,
        passCount: row?.passCount ?? 0,
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
export async function getMonthlyEarningsForYear(
  year: number,
) {
  await requireAnalyticsAccess();

  try {
    if (!Number.isInteger(year)) {
      return { success: false as const, error: "Invalid year" };
    }

    const start = new Date(Date.UTC(year, 0, 1));
    const nextStart = new Date(Date.UTC(year + 1, 0, 1));
    // Pass purchases bucket by IST calendar month (midnight IST = UTC − 5h30m).
    const IST_OFFSET_MS = 330 * 60 * 1000;
    const istStart = new Date(start.getTime() - IST_OFFSET_MS);
    const istNextStart = new Date(nextStart.getTime() - IST_OFFSET_MS);

    const rows = await db.$queryRaw<
      { month: number; earnings: bigint; booking_count: bigint }[]
    >(Prisma.sql`
      SELECT
        EXTRACT(MONTH FROM b.date)::int AS month,
        SUM(b."totalAmount" - COALESCE(pr.covered, 0))::bigint AS earnings,
        COUNT(*)::bigint AS booking_count
      FROM "Booking" b
      LEFT JOIN (
        SELECT "bookingId", SUM("coveredAmount") AS covered
        FROM "PassRedemption"
        WHERE "restoredAt" IS NULL
        GROUP BY "bookingId"
      ) pr ON pr."bookingId" = b.id
      WHERE b.status IN (${EARNING_BOOKING_STATUSES_SQL})
        AND b.date >= ${start}
        AND b.date < ${nextStart}
      GROUP BY month
      ORDER BY month
    `);

    const passRows = await db.$queryRaw<
      { month: number; earnings: bigint; pass_count: bigint }[]
    >(Prisma.sql`
      SELECT
        EXTRACT(MONTH FROM (up."purchasedAt" + interval '330 minutes'))::int AS month,
        SUM(up.price)::bigint AS earnings,
        COUNT(*)::bigint AS pass_count
      FROM "UserPass" up
      WHERE up.price > 0
        AND up."purchasedAt" >= ${istStart}
        AND up."purchasedAt" < ${istNextStart}
      GROUP BY month
      ORDER BY month
    `);

    // Tournament entry fees and camp fees never pass through Booking or
    // Payment — the money sits on the team / registration row. Keyed on
    // paidAt, bucketed by IST month like pass sales above, so the year
    // total reconciles with the KPI tile and the month view.
    const tournamentRows = await db.$queryRaw<
      { month: number; earnings: bigint }[]
    >(Prisma.sql`
      SELECT
        EXTRACT(MONTH FROM (tt."paidAt" + interval '330 minutes'))::int AS month,
        SUM(tt."paidAmount")::bigint AS earnings
      FROM "TournamentTeam" tt
      WHERE tt."paidAmount" > 0
        AND tt."archivedAt" IS NULL
        AND tt.status = 'CONFIRMED'
        AND tt."paidAt" >= ${istStart}
        AND tt."paidAt" < ${istNextStart}
      GROUP BY month
      ORDER BY month
    `);

    const campRows = await db.$queryRaw<
      { month: number; earnings: bigint }[]
    >(Prisma.sql`
      SELECT
        EXTRACT(MONTH FROM (cr."paidAt" + interval '330 minutes'))::int AS month,
        SUM(cr."paidAmount")::bigint AS earnings
      FROM "CampRegistration" cr
      WHERE cr."paidAmount" > 0
        AND cr."archivedAt" IS NULL
        AND cr.status = 'CONFIRMED'
        AND cr."paidAt" >= ${istStart}
        AND cr."paidAt" < ${istNextStart}
      GROUP BY month
      ORDER BY month
    `);

    const rowMap = new Map<
      number,
      { earnings: number; bookingCount: number; passCount: number }
    >();
    for (const r of rows) {
      rowMap.set(r.month, {
        earnings: Number(r.earnings),
        bookingCount: Number(r.booking_count),
        passCount: 0,
      });
    }
    for (const r of passRows) {
      const existing =
        rowMap.get(r.month) ?? { earnings: 0, bookingCount: 0, passCount: 0 };
      existing.earnings += Number(r.earnings);
      existing.passCount += Number(r.pass_count);
      rowMap.set(r.month, existing);
    }
    for (const r of [...tournamentRows, ...campRows]) {
      const existing =
        rowMap.get(r.month) ?? { earnings: 0, bookingCount: 0, passCount: 0 };
      existing.earnings += Number(r.earnings);
      rowMap.set(r.month, existing);
    }

    const data = Array.from({ length: 12 }, (_, i) => {
      const month = i + 1;
      const row = rowMap.get(month);
      return {
        month,
        earnings: row?.earnings ?? 0,
        bookingCount: row?.bookingCount ?? 0,
        passCount: row?.passCount ?? 0,
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
