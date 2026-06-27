import { request } from "./admin-api";

/**
 * UPI UTR verification queue. Mirrors web /admin/utr-verify.
 * Amounts (`amount`, `advanceAmount`) are in rupees (Payment.amount).
 */
export interface UtrBookingPayment {
  id: string;
  utrNumber: string | null;
  amount: number;
  isPartialPayment: boolean;
  advanceAmount: number | null;
  utrSubmittedAt: string | null;
  utrExpiresAt: string | null;
  createdAt: string;
  booking: {
    id: string;
    date: string;
    userName: string;
    userEmail: string;
    userPhone: string;
    sport: string;
    courtLabel: string;
    courtSize: string;
    slots: number[];
  };
}

export interface UtrCafePayment {
  id: string;
  utrNumber: string;
  amount: number;
  utrSubmittedAt: string | null;
  utrExpiresAt: string | null;
  order: {
    id: string;
    orderNumber: string;
    guestName: string | null;
    guestPhone: string | null;
    userName: string;
    userEmail: string;
    userPhone: string;
    items: { name: string; quantity: number; price: number }[];
  };
}

export interface PendingUtrPayments {
  bookingPayments: UtrBookingPayment[];
  cafePayments: UtrCafePayment[];
  stats: {
    totalPending: number;
    verifiedToday: number;
    rejectedToday: number;
  };
}

export type UtrType = "booking" | "cafe";

export const adminUtrApi = {
  pending: () =>
    request<PendingUtrPayments>("/api/mobile/admin/utr-verify", {
      method: "GET",
    }),
  verify: (paymentId: string, type: UtrType) =>
    request<{ ok: true }>("/api/mobile/admin/utr-verify", {
      method: "POST",
      body: { paymentId, action: "verify", type },
    }),
  reject: (paymentId: string, type: UtrType, reason?: string) =>
    request<{ ok: true }>("/api/mobile/admin/utr-verify", {
      method: "POST",
      body: { paymentId, action: "reject", type, reason },
    }),
};
