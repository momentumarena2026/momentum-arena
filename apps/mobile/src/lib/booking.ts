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

/**
 * Lightweight snapshot of a court config used in `blockedReason`.
 * Carries just enough for the slot tile + alternatives sheet to
 * render labels ("Right half booked" / "Switch to Half Left")
 * without an extra fetch. Mirrors lib/availability.ts on the
 * server.
 */
export interface BlockingConfig {
  configId: string;
  label: string;
  size: string;
  position: string;
  category: string | null;
}

export interface BlockedReason {
  blockedBy: BlockingConfig[];
  alternativesAtThisHour: BlockingConfig[];
}

export interface SlotAvailability {
  hour: number;
  status: SlotStatus;
  price: number;
  blockedReason?: BlockedReason;
  /**
   * Canonical storage coordinates this displayed slot maps to. Set
   * only by the display-shifted server variant for the late-night
   * 12am-1am tile shifted onto the next calendar date's grid — for
   * that slot, `lockDate` is the prior date and `lockHour` is 24.
   * Slot-grid clients MUST forward `lockDate` to the lock endpoint
   * when present so the booking lands on the correct storage date.
   * Mirror of lib/availability.ts on the server.
   */
  lockDate?: string; // "YYYY-MM-DD"
  lockHour?: number;
}

// ---------------------------------------------------------------------------
// Slot-tile label helpers — mirror lib/court-config.ts on the
// server. Kept inline (rather than imported across the workspace)
// because the mobile app's TS config is isolated from the Next
// app's path-aliased "@/lib/*". If you change the wording here,
// change it in lib/court-config.ts too — the tile/sheet copy is
// expected to match between web and mobile.
// ---------------------------------------------------------------------------

export function blockerShortLabel(b: {
  size: string;
  position: string;
  category: string | null;
}): string {
  if (b.category === "BOWLING_MACHINE") return "Bowling busy";
  if (b.size === "FULL") return "Full court booked";
  if (b.size === "LARGE") return "Center area booked";
  if (b.size === "MEDIUM") {
    if (b.position === "LEFT") return "Left half booked";
    if (b.position === "RIGHT") return "Right half booked";
    return "Half court booked";
  }
  if (b.size === "XS") {
    if (b.position === "LP1") return "Left leather corner booked";
    if (b.position === "LP2") return "Right leather corner booked";
    return "Leather corner booked";
  }
  return "Booked";
}

export function alternativeShortLabel(a: {
  size: string;
  position: string;
  category: string | null;
}): string {
  if (a.category === "BOWLING_MACHINE") return "Bowling machine free";
  if (a.size === "FULL") return "Full court free";
  if (a.size === "LARGE") return "Center area free";
  if (a.size === "MEDIUM") return "Half court free";
  if (a.size === "XS") return "Leather corner free";
  return "Available";
}

/**
 * Bold CTA on each alternatives-sheet row. Action-oriented +
 * generic by SIZE so we don't surface "Right Half" / "Left Half"
 * to the customer (venue assigns the side at game time). Mirror
 * of lib/court-config.ts on the server.
 */
export function alternativeActionLabel(a: {
  size: string;
  position: string;
  category: string | null;
}): string {
  if (a.category === "BOWLING_MACHINE") return "Book bowling machine";
  if (a.size === "FULL") return "Book full court";
  if (a.size === "LARGE") return "Book center area";
  if (a.size === "MEDIUM") return "Book half court";
  if (a.size === "XS") return "Book leather corner";
  return "Book this option";
}

export function summarizeBlockers(blockers: BlockingConfig[]): string {
  if (blockers.length === 0) return "Booked";
  const uniq = new Set(blockers.map(blockerShortLabel));
  if (uniq.size === 1) return Array.from(uniq)[0];
  return "Multiple bookings";
}

/**
 * Positive-framed tag for the AMBER tile — derived from what's
 * STILL bookable, not from the blocker. Customer reads "Half
 * Available" whether a half-court booking or the bowling machine
 * triggered it. Mirror of lib/court-config.ts on the server side.
 */
export function summarizeAvailability(
  alternatives: BlockingConfig[],
): string {
  if (alternatives.length === 0) return "Booked";
  if (alternatives.some((a) => a.size === "FULL")) return "Full Court Available";
  if (alternatives.some((a) => a.size === "MEDIUM")) return "Half Available";
  if (alternatives.some((a) => a.size === "LARGE")) return "Center Available";
  if (alternatives.some((a) => a.size === "XS")) return "Corner Available";
  return "Alternative Available";
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
  /** When true, "Pay by UPI" uses PhonePe Dynamic QR (auto-confirm). */
  dqrEnabled: boolean;
}

export interface DqrInitResult {
  qrString: string;
  qrImage: string;
  /**
   * "intent" → qrString is a tappable `upi://pay?...` link (PhonePe Open
   * Intent product); the client shows the pick-a-UPI-app sheet.
   * "qr" → scan-only string; the client renders the QR alone.
   * Optional so older server deploys (no mode field) fall back to "qr".
   */
  mode?: "intent" | "qr";
  transactionId: string;
  expiresIn: number;
  amount: number;
  isAdvance?: boolean;
  advanceAmount?: number | null;
  remainingAmount?: number | null;
  error?: string;
}

export interface DqrStatusResult {
  state: "PENDING" | "COMPLETED" | "FAILED";
  bookingId?: string | null;
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

  /** Creates a SlotHold (5-min TTL). Returns holdId or conflicts.
   *
   *  Optional `equipmentSelection` snapshots the customer's rental
   *  picks onto the fresh hold so the checkout screen can render a
   *  read-only line item — replaces the old in-checkout selector.
   *  Soft-fails on stale items (see web/mobile lock route comments).
   */
  lock: (
    body:
      | {
          courtConfigId: string;
          date: string;
          hours: number[];
          equipmentSelection?: Array<{ equipmentId: string; quantity?: number }>;
        }
      | {
          mode: "medium";
          sport: Sport;
          date: string;
          hours: number[];
          equipmentSelection?: Array<{ equipmentId: string; quantity?: number }>;
        }
      | {
          mode: "bowling-machine";
          courtConfigId: string;
          date: string;
          slots: Array<{ hour: number; minute: 0 | 30 }>;
          equipmentSelection?: Array<{ equipmentId: string; quantity?: number }>;
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

  /**
   * Generate a PhonePe Dynamic QR for this hold. Authed (bearer) — the
   * shared /api/phonepe/dqr/* routes resolve mobile vs web automatically.
   */
  dqrInitiate: (body: {
    holdId: string;
    isAdvance?: boolean;
    /** Full net payable (post coupon + points); route halves it for advance. */
    overrideAmount?: number;
  }) => api.post<DqrInitResult>("/api/phonepe/dqr/initiate", body),

  /** Poll a DQR transaction; on COMPLETED the booking is created server-side. */
  dqrStatus: (transactionId: string) =>
    api.get<DqrStatusResult>(
      `/api/phonepe/dqr/status?transactionId=${encodeURIComponent(transactionId)}`,
    ),

  /**
   * "Pay with UPI ID": send a UPI COLLECT request to the customer's VPA.
   * Same status-poll/callback confirmation path as dqrInitiate.
   */
  dqrCollect: (body: {
    holdId: string;
    vpa: string;
    isAdvance?: boolean;
    overrideAmount?: number;
  }) =>
    api.post<{ transactionId: string; expiresIn: number; amount: number }>(
      "/api/phonepe/dqr/collect",
      body,
    ),

  /** Audit log when the customer taps a payment tile (no booking created). */
  logPaymentMethod: (body: { holdId: string; paymentMethod: string }) =>
    api.post<{ ok: boolean }>("/api/mobile/booking/payment-method", body),

  /** Audit log when the customer taps a court-size tile (no slots reserved). */
  logCourtSelection: (body: {
    sport: Sport;
    courtConfigId?: string;
    mode?: "medium" | "bowling";
    label: string;
    size?: string;
  }) => api.post<{ ok: boolean }>("/api/booking/select-court", body),
};
