import { request } from "./admin-api";

/**
 * Mobile admin PhonePe dashboard client (LIVE PhonePe API, read-only).
 *
 * Reads static + Dynamic QR transactions straight from PhonePe via the web
 * action behind `/api/mobile/admin/phonepe`. Standard-checkout payments are
 * not included. All monetary fields are in RUPEES already (no paise
 * conversion — unlike the Razorpay client).
 *
 * Mirrors the shapes returned by the mobile GET endpoint.
 */

export type PhonePeChannel = "STATIC" | "DQR";
export type PhonePeStatus = "COMPLETED" | "PENDING" | "FAILED";

export interface PhonePeTxn {
  id: string;
  channel: PhonePeChannel;
  merchantTxnId: string | null;
  providerReferenceId: string | null;
  amount: number; // rupees (no /100)
  status: PhonePeStatus;
  customerName: string | null;
  customerPhone: string | null; // masked
  utr: string | null;
  terminalId: string | null;
  createdAt: string | null; // ISO or null
}

export interface PhonePeOverview {
  configured: boolean;
  truncated: boolean;
  totalCount: number;
  completedCount: number;
  pendingCount: number;
  failedCount: number;
  totalVolume: number; // rupees, completed
  byChannel: { STATIC: number; DQR: number };
  range: { from: string; to: string };
}

export interface PhonePeTxnPage {
  configured: boolean;
  truncated: boolean;
  items: PhonePeTxn[];
  total: number;
  page: number;
  totalPages: number;
}

/**
 * One PhonePe store (single merchantId, many stores). Returned by the
 * endpoint already in tab order: Online, Offline, Gym, Yoga, Cafe.
 */
export interface PhonePeStore {
  key: string;
  label: string;
}

export interface PhonePeDashboard {
  stores: PhonePeStore[];
  defaultStore: string | null; // = first store (Online)
  configured: boolean;
  overview: PhonePeOverview;
  transactions: PhonePeTxnPage;
}

export const adminPhonePeApi = {
  // Overview + a page of transactions in one fetch. `store` selects which
  // store to query (server falls back to defaultStore when omitted).
  // `from`/`to` are YYYY-MM-DD; `status` is a PhonePeStatus; `channel` is
  // STATIC | DQR.
  dashboard: (params: {
    store?: string;
    page?: number;
    from?: string;
    to?: string;
    status?: PhonePeStatus;
    channel?: PhonePeChannel;
  }) => {
    const qs = new URLSearchParams();
    if (params.store) qs.set("store", params.store);
    if (params.page) qs.set("page", String(params.page));
    if (params.from) qs.set("from", params.from);
    if (params.to) qs.set("to", params.to);
    if (params.status) qs.set("status", params.status);
    if (params.channel) qs.set("channel", params.channel);
    const q = qs.toString();
    return request<PhonePeDashboard>(
      `/api/mobile/admin/phonepe${q ? `?${q}` : ""}`,
      { method: "GET" },
    );
  },
};
