import { request } from "./admin-api";

/**
 * Mobile admin Razorpay dashboard client (read-only). All monetary fields are
 * in PAISE — divide by 100 before formatting as rupees.
 */
export interface AdminRazorpayOverview {
  totalCollected: number;
  totalRefunded: number;
  netRevenue: number;
  pendingSettlements: number;
  paymentMethodBreakdown: Record<string, number>;
  error?: string;
}

export type RazorpayTxnType =
  | "payments"
  | "orders"
  | "refunds"
  | "settlements"
  | "disputes";

/** Raw Razorpay entity rows are loosely typed — fields vary per type. */
export type RazorpayTxn = Record<string, unknown>;

export interface RazorpayTxnPage {
  items: RazorpayTxn[];
  count: number;
  page: number;
  totalPages: number;
  error?: string;
}

export const adminRazorpayApi = {
  overview: () =>
    request<{ overview: AdminRazorpayOverview }>("/api/mobile/admin/razorpay", {
      method: "GET",
    }),
  // Paginated drill-down list. `from`/`to` are YYYY-MM-DD (ignored for
  // disputes). Amounts in PAISE.
  transactions: (params: {
    type: RazorpayTxnType;
    page?: number;
    from?: string;
    to?: string;
  }) => {
    const qs = new URLSearchParams({ type: params.type });
    if (params.page) qs.set("page", String(params.page));
    if (params.from) qs.set("from", params.from);
    if (params.to) qs.set("to", params.to);
    return request<RazorpayTxnPage>(
      `/api/mobile/admin/razorpay/transactions?${qs.toString()}`,
      { method: "GET" },
    );
  },
};
