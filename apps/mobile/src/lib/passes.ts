import { api } from "./api";

/** Mirrors lib/passes.listUserPasses on the server — one shape for web
 *  and mobile so the surfaces never drift. */
export interface MyPassSummary {
  id: string;
  name: string;
  sport: string;
  totalMinutes: number;
  remainingMinutes: number;
  bandsSummary: string;
  purchasedAt: string;
  startsAt: string;
  expiresAt: string;
  status: "ACTIVE" | "UPCOMING" | "EXHAUSTED" | "EXPIRED" | "CANCELLED";
  role: "owner" | "member";
  ownerName: string | null;
  redemptions: { minutes: number; createdAt: string; restored: boolean }[];
}

/** Mirrors lib/passes.getPassDetailForUser — the web /passes/[id] shape. */
export interface PassDetail {
  id: string;
  name: string;
  sport: string;
  courtLabel: string;
  bandsSummary: string;
  totalMinutes: number;
  remainingMinutes: number;
  price: number;
  validityDays: number;
  purchasedAt: string;
  startsAt: string;
  expiresAt: string;
  status: "ACTIVE" | "UPCOMING" | "EXHAUSTED" | "EXPIRED" | "CANCELLED";
  role: "owner" | "member";
  maxMembers: number;
  owner: { name: string | null; phone: string | null };
  members: {
    userId: string;
    name: string | null;
    phone: string | null;
    addedAt: string;
  }[];
  bookings: {
    bookingId: string;
    date: string | null;
    timeLabel: string;
    bookingStatus: string;
    bookedBy: string | null;
    minutes: number;
    value: number;
    restored: boolean;
    redeemedAt: string;
  }[];
}

export type AddMemberResult =
  | { ok: true; member: { userId: string; name: string | null; phone: string | null } }
  | { ok: false; error: string; notRegistered?: boolean; phone?: string };

/** Mirrors actions/passes.getActivePassPlans — the storefront card shape. */
export interface PassPlanCard {
  id: string;
  name: string;
  sport: string;
  courtLabel: string;
  isBowling: boolean;
  hours: number;
  baseAmount: number;
  price: number;
  discountPercent: number;
  anchorPricePerHour: number | null;
  effectiveHourly: number;
  validityDays: number;
  bandsSummary: string;
}

export const passesApi = {
  myPasses: () =>
    api.get<{ passes: MyPassSummary[]; storefrontEnabled: boolean }>(
      "/api/mobile/passes",
    ),
  detail: (passId: string) =>
    api.get<{ pass: PassDetail }>(`/api/mobile/passes/${passId}`),
  addMember: (passId: string, phone: string) =>
    api.post<AddMemberResult>(`/api/mobile/passes/${passId}/members`, {
      phone,
    }),
  removeMember: (passId: string, userId: string) =>
    api.post<{ ok: boolean; error?: string }>(
      `/api/mobile/passes/${passId}/members`,
      { remove: userId },
    ),
  plans: () =>
    api.get<{ plans: PassPlanCard[] }>("/api/mobile/passes/plans"),

  // ── Purchase (shared web routes; unified auth accepts the bearer) ──
  /** UPI (PhonePe DQR) — money-first; the UserPass materialises on the
   *  status poll / S2S callback. */
  dqrInitiate: (planId: string, startDate?: string | null) =>
    api.post<{
      qrString?: string;
      qrImage?: string;
      mode?: "intent" | "qr";
      transactionId?: string;
      expiresIn?: number;
      amount?: number;
      error?: string;
    }>("/api/phonepe/dqr/pass-initiate", { planId, startDate }),
  dqrStatus: (transactionId: string) =>
    api.get<{
      state: "PENDING" | "COMPLETED" | "FAILED";
      userPassId?: string | null;
    }>(
      `/api/phonepe/dqr/pass-status?transactionId=${encodeURIComponent(transactionId)}`,
    ),
  /** Razorpay — order first, native checkout, then signature verify. */
  createOrder: (planId: string, startDate?: string | null) =>
    api.post<{
      orderId: string;
      keyId: string;
      amount: number;
      planName: string;
    }>("/api/passes/create-order", { planId, startDate }),
  verifyPayment: (body: {
    planId: string;
    razorpayOrderId: string;
    razorpayPaymentId: string;
    razorpaySignature: string;
    startDate?: string | null;
  }) =>
    api.post<{ success: boolean; userPassId: string }>(
      "/api/passes/verify",
      body,
    ),

  // ── Redemption at booking checkout (shared web routes) ─────────────
  /** Full coverage → { bookingId }; partial → { topup } for the
   *  pro-rata remainder via Razorpay, completed by redeemVerify. */
  redeem: (holdId: string) =>
    api.post<{
      bookingId?: string;
      topup?: { orderId: string; keyId: string; amount: number };
      error?: string;
    }>("/api/passes/redeem", { holdId }),
  redeemVerify: (body: {
    holdId: string;
    razorpayOrderId: string;
    razorpayPaymentId: string;
    razorpaySignature: string;
  }) =>
    api.post<{ bookingId?: string; error?: string }>(
      "/api/passes/redeem-verify",
      body,
    ),
};
