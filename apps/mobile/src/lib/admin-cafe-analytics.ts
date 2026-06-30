import { request } from "./admin-api";

/**
 * API client for the mobile-admin Cafe Analytics screen — full parity
 * with the web /admin/analytics/cafe dashboard. The single
 * /api/mobile/admin/analytics/cafe endpoint returns every KPI and every
 * chart dataset plus one page of the inventory table in one payload.
 *
 * Money is in RUPEES across the whole payload — the cafe migration
 * converted every cafe price column to rupees, so the screen renders
 * with formatRupees and never divides by 100.
 *
 * Types are re-declared here (not imported from admin-analytics.ts) so
 * the cafe surface owns its own contract.
 */

export type CafeGroupBy = "day" | "week" | "month";

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

// ─────────── Chart datasets ───────────

export interface CafeTimeBucket {
  period: string; // YYYY-MM-DD (day/week) or YYYY-MM (month)
  revenue: number;
  cost: number;
  profit: number;
  orders: number;
}

export interface CafeCategoryRow {
  category: string;
  revenue: number;
  profit: number;
  orderCount: number;
  unitsSold: number;
}

export interface CafeTopItem {
  itemName: string;
  category: string | null;
  unitsSold: number;
  revenue: number;
  profit: number;
}

export interface CafePaymentMethodRow {
  method: string;
  count: number;
  amount: number;
}

export interface CafeHourBucket {
  hour: number;
  orderCount: number;
  revenue: number;
}

export interface CafeStatusRow {
  status: string;
  count: number;
  revenue: number;
}

export interface CafeVegRow {
  type: "Veg" | "Non-Veg";
  unitsSold: number;
  revenue: number;
}

export interface CafeFulfilmentRow {
  fulfilment: "Ready" | "Kitchen";
  unitsSold: number;
  revenue: number;
}

export interface CafeTopCustomer {
  userId: string;
  name: string;
  email: string;
  totalSpent: number;
  orderCount: number;
}

export interface CafeDayOfWeekRow {
  day: string; // Mon, Tue, ...
  dayIndex: number; // 0 = Sun, 1 = Mon, ...
  orderCount: number;
  revenue: number;
}

export interface CafeItemInventoryRow {
  id: string;
  name: string;
  description: string | null;
  category: string;
  unitsSold: number;
  cashUnits: number;
  onlineUnits: number;
  stockLeft: number | null; // null = kitchen-prepared / unlimited
}

export interface CafeItemInventoryPage {
  rows: CafeItemInventoryRow[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

// ─────────── Full response ───────────

export interface CafeAnalyticsResponse {
  range: { from: string; to: string };
  groupBy: CafeGroupBy;
  kpi: CafeKPI;
  revenueOverTime: CafeTimeBucket[];
  categoryBreakdown: CafeCategoryRow[];
  topItems: CafeTopItem[];
  paymentMethods: CafePaymentMethodRow[];
  peakHours: CafeHourBucket[];
  statusBreakdown: CafeStatusRow[];
  vegBreakdown: CafeVegRow[];
  fulfilmentBreakdown: CafeFulfilmentRow[];
  topCustomers: CafeTopCustomer[];
  dayOfWeekBreakdown: CafeDayOfWeekRow[];
  inventory: CafeItemInventoryPage;
}

export interface CafeAnalyticsFilters {
  from?: string;
  to?: string;
  groupBy?: CafeGroupBy;
  invPage?: number;
  invPageSize?: number;
}

function buildQuery(filters: CafeAnalyticsFilters): string {
  const sp = new URLSearchParams();
  if (filters.from) sp.set("from", filters.from);
  if (filters.to) sp.set("to", filters.to);
  if (filters.groupBy) sp.set("groupBy", filters.groupBy);
  if (filters.invPage) sp.set("invPage", String(filters.invPage));
  if (filters.invPageSize) sp.set("invPageSize", String(filters.invPageSize));
  const qs = sp.toString();
  return qs ? `?${qs}` : "";
}

export const adminCafeAnalyticsApi = {
  /** Full cafe analytics payload — every KPI + chart + inventory page. */
  get(filters: CafeAnalyticsFilters = {}): Promise<CafeAnalyticsResponse> {
    return request(`/api/mobile/admin/analytics/cafe${buildQuery(filters)}`, {
      method: "GET",
    });
  },
};
