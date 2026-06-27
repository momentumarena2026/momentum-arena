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

export interface SportsAnalyticsResponse {
  range: { from: string; to: string };
  kpi: SportsKPI;
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

function rangeQuery(filters: { from?: string; to?: string }): string {
  const sp = new URLSearchParams();
  if (filters.from) sp.set("from", filters.from);
  if (filters.to) sp.set("to", filters.to);
  const qs = sp.toString();
  return qs ? `?${qs}` : "";
}

export const adminAnalyticsApi = {
  sports(
    filters: { from?: string; to?: string } = {},
  ): Promise<SportsAnalyticsResponse> {
    return request(
      `/api/mobile/admin/analytics/sports${rangeQuery(filters)}`,
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

  push(
    filters: { from?: string; to?: string } = {},
  ): Promise<PushAnalyticsResponse> {
    return request(
      `/api/mobile/admin/analytics/push${rangeQuery(filters)}`,
      { method: "GET" },
    );
  },
};
