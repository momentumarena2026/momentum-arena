import { api } from "./api";
import type { CourtConfig, Sport } from "./types";

export type SlotStatus = "available" | "booked" | "locked" | "blocked";

export interface SlotAvailability {
  hour: number;
  status: SlotStatus;
  price: number;
}

export interface LockResult {
  success: boolean;
  holdId?: string;
  error?: string;
  conflicts?: number[];
}

export interface SlotPriceEntry {
  hour: number;
  price: number;
}

export interface Hold {
  id: string;
  courtConfigId: string;
  date: string;
  hours: number[];
  slotPrices: SlotPriceEntry[];
  totalAmount: number;
  expiresAt: string;
  wasBookedAsHalfCourt: boolean;
  couponId: string | null;
  couponCode: string | null;
  discountAmount: number | null;
  courtConfig: CourtConfig;
}

export interface NewUserDiscount {
  codeId: string;
  code: string;
  type: "PERCENTAGE" | "FLAT";
  value: number;
  discountAmount: number;
}

export interface CouponValidationResult {
  valid: boolean;
  discountAmount?: number;
  couponId?: string;
  error?: string;
}

export interface ApplyCouponResult {
  success: boolean;
  discountAmount?: number;
  code?: string;
  error?: string;
}

export interface RazorpayOrder {
  orderId: string;
  keyId: string;
  amount: number; // rupees
  currency: "INR";
  holdId: string;
  isAdvance: boolean;
  advanceAmount: number | null;
  remainingAmount: number | null;
}

export interface VerifyResult {
  success: boolean;
  bookingId: string;
}

export interface PaymentConfig {
  activeGateway: "PHONEPE" | "RAZORPAY";
  onlineEnabled: boolean;
  upiQrEnabled: boolean;
  advanceEnabled: boolean;
}

export interface SelectPaymentResult {
  success: boolean;
  bookingId?: string;
  error?: string;
}

/** Public coupon shape returned by /api/mobile/coupons/available.
 *  Mirrors web's `PublicCoupon` from actions/customer-coupons.ts. */
export interface PublicCoupon {
  id: string;
  code: string;
  description: string | null;
  scope: "SPORTS" | "CAFE" | "BOTH";
  type: "PERCENTAGE" | "FLAT";
  /** For PERCENTAGE this is percent * 100 (e.g. 10% = 1000). For FLAT it's paise. */
  value: number;
  maxDiscount: number | null;
  minAmount: number | null;
  sportFilter: string[];
  categoryFilter: string[];
  validFrom: string;
  validUntil: string;
}

/**
 * Slot + checkout + payment APIs used by the native booking flow.
 * Everything is JSON — no FormData, no WebView — the native stack calls
 * these endpoints directly under a mobile JWT.
 */
export const bookingApi = {
  /** Slot availability for a specific court config on a given date. */
  availability: (
    params:
      | { configId: string; date: string }
      | { mode: "medium"; sport: Sport; date: string }
  ) => {
    const q = new URLSearchParams();
    q.set("date", params.date);
    if ("mode" in params) {
      q.set("mode", params.mode);
      q.set("sport", params.sport);
    } else {
      q.set("configId", params.configId);
    }
    return api.get<{ slots: SlotAvailability[] }>(
      `/api/availability?${q.toString()}`,
      { auth: false }
    );
  },

  /** Creates a SlotHold (5-min TTL). Returns holdId or conflicts. */
  lock: (
    body:
      | { courtConfigId: string; date: string; hours: number[] }
      | { mode: "medium"; sport: Sport; date: string; hours: number[] }
  ) => api.post<LockResult>("/api/mobile/booking/lock", body),

  /** Checkout: load the SlotHold + courtConfig. */
  hold: (holdId: string) =>
    api.get<Hold>(`/api/mobile/booking/hold/${holdId}`),

  /** New-user automatic discount, if any. */
  newUserDiscount: (sport: Sport, amount: number) =>
    api.get<{ discount: NewUserDiscount | null }>(
      `/api/mobile/coupons/new-user?sport=${sport}&amount=${amount}`
    ),

  /** Public list of currently-valid, isPublic coupons for a given scope.
   *  Populates the "View available coupons" drawer on the checkout screen.
   *  Mirrors web's `getAvailableCoupons`. */
  availableCoupons: (scope: "SPORTS" | "CAFE" | "BOTH" = "SPORTS") =>
    api.get<{ coupons: PublicCoupon[] }>(
      `/api/mobile/coupons/available?scope=${scope}`,
      { auth: false }
    ),

  /** Validate a coupon against a hold amount (dry-run). */
  validateCoupon: (body: {
    code: string;
    amount: number;
    sport?: Sport;
  }) =>
    api.post<CouponValidationResult>("/api/mobile/coupons/validate", {
      scope: "SPORTS",
      ...body,
    }),

  /** Persist the coupon onto the hold (what the verify step will honour). */
  applyCoupon: (body: { holdId: string; code: string }) =>
    api.post<ApplyCouponResult>("/api/mobile/booking/apply-coupon", body),

  /** Clear any previously applied coupon. */
  clearCoupon: (holdId: string) =>
    api
      .delete<{ success: boolean }>(
        `/api/mobile/booking/apply-coupon?holdId=${encodeURIComponent(holdId)}`
      )
      .catch(() => ({ success: false })),

  /** Create a Razorpay order tied to the hold. */
  createOrder: (body: {
    holdId: string;
    isAdvance?: boolean;
    overrideAmount?: number;
  }) => api.post<RazorpayOrder>("/api/mobile/razorpay/create-order", body),

  /** Verify the signature and convert the hold into a Booking. */
  verifyOrder: (body: {
    holdId: string;
    razorpayPaymentId: string;
    razorpayOrderId: string;
    razorpaySignature: string;
    isAdvance?: boolean;
  }) => api.post<VerifyResult>("/api/mobile/razorpay/verify", body),

  /**
   * Public payment-gateway config. Tells the native checkout which
   * payment-method tiles to render and which gateway (PhonePe/Razorpay) is
   * active so the "Online Payment" tile can show the right subtitle/icon.
   * Mirror of web's getCheckoutPaymentConfig.
   */
  paymentConfig: () =>
    api.get<PaymentConfig>("/api/mobile/settings/payment-config", {
      auth: false,
    }),

  /**
   * Commit a UPI-QR or 50%-advance payment on a SlotHold. Mirrors web's
   * selectUpiPayment + selectCashPayment server actions under mobile JWT
   * auth. Creates Booking(PENDING) + Payment(PENDING, UPI_QR|CASH) and
   * returns the new bookingId so the client can navigate to its detail page.
   */
  selectPayment: (body: {
    holdId: string;
    method: "UPI_QR" | "CASH";
    overrideAmount?: number;
    isAdvance?: boolean;
  }) =>
    api.post<SelectPaymentResult>("/api/mobile/booking/select-payment", body),
};
