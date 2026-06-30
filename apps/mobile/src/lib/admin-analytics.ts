import { request } from "./admin-api";

/**
 * API client for the mobile-admin read-only analytics surface. Mirrors
 * the web /admin/analytics/{sports,cafe,push} dashboards, collapsed to
 * KPI cards + a couple of simple breakdowns per screen.
 *
 * Money is in RUPEES across all three payloads — the routes/actions
 * normalize cafe paise → rupees server-side, so the screens just render
 * with formatRupees and never divide by 100.
 */

// ─────────── Sports ───────────

export interface SportsKPI {
  totalRevenue: number;
  sportsRevenue: number;
  cafeRevenue: number;
  totalBookings: number;
  totalOrders: number;
  avgBookingValue: number;
  cancellationRate: number; // %
  activeCustomers: number;
}

export type SportsGroupBy = "day" | "week" | "month";

/** Earnings-over-time point — one bucket per day/week/month. */
export interface RevenueOverTimePoint {
  period: string; // YYYY-MM-DD (day/week start) or YYYY-MM-DD for month
  sportsRevenue: number;
  cafeRevenue: number;
  totalRevenue: number;
}

/** Per-sport revenue + booking count over the selected window. */
export interface SportRevenueRow {
  sport: string; // uppercase enum, e.g. "CRICKET"
  revenue: number;
  bookingCount: number;
}

/**
 * One month bucket for the per-sport multi-line chart. `period` is
 * "YYYY-MM"; every other key is a title-cased sport name carrying that
 * sport's revenue in that month (0-filled for idle months). Labels come
 * back separately as `sportMonthlyLabels`.
 */
export type SportMonthlyRow = Record<string, number | string>;

export interface PeakHourRow {
  hour: number; // 0-23
  bookingCount: number;
}

export interface TopCustomerRow {
  userId: string;
  name: string;
  email: string;
  totalSpent: number;
  bookingCount: number;
  orderCount: number;
}

export interface PaymentMethodRow {
  method: string; // RAZORPAY | UPI_QR | CASH | FREE | ...
  count: number;
  amount: number;
}

/** Day-of-month earnings row (keyed on Booking.date, post-discount). */
export interface DailyEarningsRow {
  day: number; // 1-31
  earnings: number;
  bookingCount: number;
}

/** Month-of-year earnings row (keyed on Booking.date, post-discount). */
export interface MonthlyEarningsRow {
  month: number; // 1-12
  earnings: number;
  bookingCount: number;
}

export interface SportsAnalyticsResponse {
  range: { from: string; to: string };
  groupBy: SportsGroupBy;
  kpi: SportsKPI;
  revenueOverTime: RevenueOverTimePoint[];
  sportBreakdown: SportRevenueRow[];
  sportMonthly: SportMonthlyRow[];
  sportMonthlyLabels: string[];
  peakHours: PeakHourRow[];
  topCustomers: TopCustomerRow[];
  paymentMethods: PaymentMethodRow[];
  dailyEarnings: {
    year: number;
    month: number;
    data: DailyEarningsRow[];
  };
  monthlyEarnings: {
    year: number;
    data: MonthlyEarningsRow[];
  };
}

// ─────────── Cafe ───────────

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
  refundsDue: number;
}

export interface CafeAnalyticsResponse {
  range: { from: string; to: string };
  kpi: CafeKPI;
}

// ─────────── Push ───────────

export interface PushAnalytics {
  range: { from: string; to: string };
  totals: {
    dispatches: number;
    attempted: number;
    succeeded: number;
    failed: number;
    cleanedUp: number;
    deliveryRate: number | null;
    broadcasts: number;
  };
  byKind: {
    kind: string;
    dispatches: number;
    attempted: number;
    succeeded: number;
    failed: number;
    deliveryRate: number | null;
  }[];
  bySource: {
    source: string;
    dispatches: number;
    attempted: number;
    succeeded: number;
  }[];
  timeSeries: {
    date: string;
    dispatches: number;
    attempted: number;
    succeeded: number;
    failed: number;
  }[];
  recent: {
    id: string;
    kind: string;
    scope: string;
    source: string;
    audience: string | null;
    title: string;
    body: string;
    attempted: number;
    succeeded: number;
    failed: number;
    cleanedUp: number;
    createdAt: string;
  }[];
  fleet: {
    totalDevices: number;
    iosDevices: number;
    androidDevices: number;
    adminDevices: number;
    reachUsers: number;
    activeDevices: number;
    staleDevices: number;
    byAppVersion: { version: string; count: number }[];
    registrations: { date: string; count: number }[];
  };
}

export interface PushAnalyticsResponse {
  analytics: PushAnalytics;
  kinds: string[];
}

/** Filters accepted by the push analytics endpoint. */
export interface PushAnalyticsFilters {
  from?: string;
  to?: string;
  /** Restrict to these dispatch kinds (empty = all). */
  kinds?: string[];
  /** Restrict to these sources: event | broadcast | test (empty = all). */
  sources?: string[];
  /** Audience scope. Defaults to "all" server-side. */
  scope?: "all" | "customer" | "admin";
}

function rangeQuery(filters: { from?: string; to?: string }): string {
  const sp = new URLSearchParams();
  if (filters.from) sp.set("from", filters.from);
  if (filters.to) sp.set("to", filters.to);
  const qs = sp.toString();
  return qs ? `?${qs}` : "";
}

function pushQuery(filters: PushAnalyticsFilters): string {
  const sp = new URLSearchParams();
  if (filters.from) sp.set("from", filters.from);
  if (filters.to) sp.set("to", filters.to);
  if (filters.kinds?.length) sp.set("kinds", filters.kinds.join(","));
  if (filters.sources?.length) sp.set("sources", filters.sources.join(","));
  if (filters.scope && filters.scope !== "all") sp.set("scope", filters.scope);
  const qs = sp.toString();
  return qs ? `?${qs}` : "";
}

/** Filters accepted by the sports analytics endpoint. */
export interface SportsAnalyticsFilters {
  from?: string;
  to?: string;
  /** Earnings-over-time bucketing. Defaults to "day" server-side. */
  groupBy?: SportsGroupBy;
  /** Daily-earnings chart selector (1-12). Defaults to current month. */
  month?: number;
  /** Daily-earnings chart year. Defaults to current year. */
  year?: number;
  /** Monthly-earnings chart year. Defaults to current year. */
  monthlyYear?: number;
}

function sportsQuery(filters: SportsAnalyticsFilters): string {
  const sp = new URLSearchParams();
  if (filters.from) sp.set("from", filters.from);
  if (filters.to) sp.set("to", filters.to);
  if (filters.groupBy) sp.set("groupBy", filters.groupBy);
  if (filters.month != null) sp.set("month", String(filters.month));
  if (filters.year != null) sp.set("year", String(filters.year));
  if (filters.monthlyYear != null)
    sp.set("monthlyYear", String(filters.monthlyYear));
  const qs = sp.toString();
  return qs ? `?${qs}` : "";
}

export const adminAnalyticsApi = {
  sports(
    filters: SportsAnalyticsFilters = {},
  ): Promise<SportsAnalyticsResponse> {
    return request(
      `/api/mobile/admin/analytics/sports${sportsQuery(filters)}`,
      { method: "GET" },
    );
  },

  cafe(
    filters: { from?: string; to?: string } = {},
  ): Promise<CafeAnalyticsResponse> {
    return request(
      `/api/mobile/admin/analytics/cafe${rangeQuery(filters)}`,
      { method: "GET" },
    );
  },

  push(filters: PushAnalyticsFilters = {}): Promise<PushAnalyticsResponse> {
    return request(
      `/api/mobile/admin/analytics/push${pushQuery(filters)}`,
      { method: "GET" },
    );
  },
};
