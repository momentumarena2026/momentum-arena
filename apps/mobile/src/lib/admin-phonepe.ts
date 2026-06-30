import { request } from "./admin-api";

/**
 * Mobile admin PhonePe dashboard client (DB-backed, read-only).
 *
 * PhonePe has no list/settlement/dispute API — this reads our own PhonePe
 * Payment / CafePayment rows via the web action, plus the one live merchant
 * call: per-transaction status refresh. All monetary fields are in RUPEES
 * (no paise conversion — unlike the Razorpay client).
 *
 * Mirrors the shapes returned by actions/admin-phonepe.ts.
 */

export type PhonePeTxnType = "booking" | "cafe";
export type PhonePeChannel = "CHECKOUT" | "DQR";

export interface PhonePeTxn {
  id: string;
  type: PhonePeTxnType;
  channel: PhonePeChannel;
  merchantTxnId: string | null;
  phonePeTransactionId: string | null;
  amount: number; // rupees
  status: string;
  customerName: string | null;
  customerPhone: string | null;
  bookingId: string | null;
  cafeOrderId: string | null;
  refundedAt: string | null;
  refundReason: string | null;
  createdAt: string;
}

export interface PhonePeOverview {
  totalCount: number;
  completedCount: number;
  pendingCount: number;
  failedCount: number;
  totalVolume: number; // rupees
  refundedCount: number;
  refundedAmount: number; // rupees
  byChannel: { CHECKOUT: number; DQR: number };
  byType: { booking: number; cafe: number };
  range: { from: string; to: string };
}

export interface PhonePeTxnPage {
  items: PhonePeTxn[];
  total: number;
  page: number;
  totalPages: number;
}

/** Live PhonePe status for a single merchant txn (the one merchant API). */
export interface PhonePeStatusResult {
  ok: boolean;
  state?: string;
  success?: boolean;
  phonePeTransactionId?: string;
  amount?: number; // paise, as returned by PhonePe
  error?: string;
}

export interface PhonePeDashboard {
  overview: PhonePeOverview;
  transactions: PhonePeTxnPage;
}

export const adminPhonePeApi = {
  // Overview + a page of transactions in one fetch. `from`/`to` are
  // YYYY-MM-DD; `status` is a PaymentStatus; `type` is booking | cafe.
  dashboard: (params: {
    page?: number;
    from?: string;
    to?: string;
    status?: string;
    type?: PhonePeTxnType;
  }) => {
    const qs = new URLSearchParams();
    if (params.page) qs.set("page", String(params.page));
    if (params.from) qs.set("from", params.from);
    if (params.to) qs.set("to", params.to);
    if (params.status) qs.set("status", params.status);
    if (params.type) qs.set("type", params.type);
    const q = qs.toString();
    return request<PhonePeDashboard>(
      `/api/mobile/admin/phonepe${q ? `?${q}` : ""}`,
      { method: "GET" },
    );
  },
  // Live per-transaction status from PhonePe (read-only).
  refreshStatus: (merchantTxnId: string) =>
    request<{ status: PhonePeStatusResult }>("/api/mobile/admin/phonepe", {
      method: "POST",
      body: { merchantTxnId },
    }),
};
