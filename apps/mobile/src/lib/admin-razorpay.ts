import { request } from "./admin-api";

/**
 * Mobile admin Razorpay dashboard client (read-only overview). All monetary
 * fields are in PAISE — divide by 100 before formatting as rupees.
 */
export interface AdminRazorpayOverview {
  totalCollected: number;
  totalRefunded: number;
  netRevenue: number;
  pendingSettlements: number;
  paymentMethodBreakdown: Record<string, number>;
  error?: string;
}

export const adminRazorpayApi = {
  overview: () =>
    request<{ overview: AdminRazorpayOverview }>("/api/mobile/admin/razorpay", {
      method: "GET",
    }),
};
