import { api } from "./api";
import type { CourtConfig, Sport } from "./types";

// Mirrors the server's SlotStatus exactly. "closed" lands on
// past slots for today's date — the customer picker dims those
// tiles + labels them "Past" so it's clear they can't be tapped.
export type SlotStatus =
  | "available"
  | "booked"
  | "locked"
  | "blocked"
  | "closed";

export interface SlotAvailability {
  hour: number;
  status: SlotStatus;
  price: number;
}

// Bowling-machine 30-minute slot — `minute` is 0 or 30, `price` is rupees.
export interface BowlingSlotAvailability {
  hour: number;
  minute: 0 | 30;
  status: SlotStatus;
  price: number;
}

export interface LockResult {
  success: boolean;
  holdId?: string;
  error?: string;
  conflicts?: number[];
}

export interface EquipmentOption {
  id: string;
  name: string;
  pricePaise: number;
  imageUrl: string | null;
}

export interface ApplyEquipmentResult {
  success: boolean;
  totalPaise?: number;
  error?: string;
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
  // Bowling-machine holds carry per-slot start minutes (0 or 30) parallel
  // to `hours`. Hourly holds omit this or send all zeros.
  startMinutes?: number[];
  slotPrices: SlotPriceEntry[];
  totalAmount: number;
  expiresAt: string;
  wasBookedAsHalfCourt: boolean;
  couponId: string | null;
  couponCode: string | null;
  discountAmount: number | null;
  pointsToRedeem: number | null;
  pointsRedeemPaiseSaved: number | null;
  // Bowling-machine equipment selection snapshot, written by
  // /api/mobile/booking/apply-equipment. Stays null when no rentals
  // picked or for non-bowling holds.
  equipmentSelection?: Array<{
    equipmentId: string;
    name: string;
    quantity: number;
    priceEach: number;
    totalPrice: number;
  }> | null;
  equipmentTotalAmount?: number | null;
  courtConfig: CourtConfig;
}

export interface ApplyPointsResult {
  success: boolean;
  pointsToRedeem?: number;
  paiseSaved?: number;
  error?: string;
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
  /**
   * Active auto-apply promo for this sport, or null if no live coupon
   * qualifies. Lets the slot screen decorate tiles with strike-through
   * prices + a launch-offer banner that mirrors what the checkout will
   * actually charge — same source of truth (Coupon table) the web slot
   * page reads via getActiveSportPromo.
   */
  sportPromo: (sport: Sport, bookingCategory?: string | null) => {
    const q = new URLSearchParams();
    q.set("sport", sport);
    if (bookingCategory) q.set("bookingCategory", bookingCategory);
    return api.get<{
      promo: import("./auto-apply-promo").ActiveSportPromo | null;
    }>(`/api/mobile/sport-promo?${q.toString()}`, { auth: false });
  },

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
      | {
          mode: "bowling-machine";
          courtConfigId: string;
          date: string;
          slots: Array<{ hour: number; minute: 0 | 30 }>;
        }
  ) => api.post<LockResult>("/api/mobile/booking/lock", body),

  /** Bowling-machine availability — 30-minute slot grid for the given
   *  config + date. Mirrors `availability` shape but with `minute`.
   *  Hits the public web endpoint (no auth header) so anonymous
   *  browsing works the same way it does for the cricket / football
   *  slot pickers — the customer signs in only at the "Continue"
   *  step on the picker footer. */
  bowlingAvailability: (configId: string, date: string) =>
    api.get<{ slots: BowlingSlotAvailability[] }>(
      `/api/availability/bowling-machine?configId=${encodeURIComponent(
        configId,
      )}&date=${encodeURIComponent(date)}`,
      { auth: false },
    ),

  /** Customer-facing equipment options for a sport/category. */
  listEquipment: (params: { sport: Sport; category?: string | null }) => {
    const q = new URLSearchParams();
    q.set("sport", params.sport);
    if (params.category) q.set("category", params.category);
    return api.get<{ equipment: EquipmentOption[] }>(
      `/api/mobile/equipment?${q.toString()}`,
      { auth: false }
    );
  },

  /** Snapshot a set of equipment rentals onto a SlotHold. Empty
   *  picks[] clears the selection. */
  applyEquipment: (body: {
    holdId: string;
    picks: Array<{ equipmentId: string; quantity: number }>;
  }) =>
    api.post<ApplyEquipmentResult>("/api/mobile/booking/apply-equipment", body),

  /** Checkout: load the SlotHold + courtConfig. */
  hold: (holdId: string) =>
    api.get<Hold>(`/api/mobile/booking/hold/${holdId}`),

  /** New-user automatic discount, if any. Pass `category` for cricket
   *  sub-flows so categoryExclude (e.g. bowling-machine) is honoured. */
  newUserDiscount: (
    sport: Sport,
    amount: number,
    category?: string | null,
  ) => {
    const q = new URLSearchParams();
    q.set("sport", sport);
    q.set("amount", String(amount));
    if (category) q.set("category", category);
    return api.get<{ discount: NewUserDiscount | null }>(
      `/api/mobile/coupons/new-user?${q.toString()}`,
    );
  },

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

  /** Persist a Momentum-Points redemption pick onto the hold so the
   *  booking-creation transaction picks it up and writes the
   *  REDEEMED_BOOKING ledger row atomically. */
  applyPoints: (body: { holdId: string; points: number }) =>
    api.post<ApplyPointsResult>("/api/mobile/booking/apply-points", body),

  /** Clear any previously-applied points redemption. */
  clearPoints: (holdId: string) =>
    api
      .delete<{ success: boolean }>(
        `/api/mobile/booking/apply-points?holdId=${encodeURIComponent(holdId)}`,
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
