/**
 * Shared payment-bifurcation helpers.
 *
 * Used by both the full sales-revenue workbook (lib/admin-export.ts)
 * and the trimmed CA report (lib/reports/workers/ca.ts) so the two
 * exports always agree on what counts as cash / UPI QR / online /
 * discount-at-venue.
 */

export type BookingPaymentForSplit = {
  method: string;
  amount: number;
  isPartialPayment: boolean;
  advanceAmount: number | null;
  remainingAmount: number | null;
  remainderMethod: string | null;
  remainderCashAmount: number | null;
  remainderUpiAmount: number | null;
  remainderDiscountAmount: number | null;
};

/**
 * Bifurcate a booking's Payment row into Cash / UPI QR / Online
 * (Razorpay + PhonePe) / Discount-at-venue components.
 *
 * For partial-payment bookings, the advance is paid via
 * `payment.method` (one of CASH / UPI_QR / RAZORPAY / PHONEPE) and
 * the venue-side remainder is split across `remainderCashAmount`,
 * `remainderUpiAmount`, `remainderDiscountAmount`. We add the two
 * legs together. For non-partial bookings, the whole `amount` lands
 * in the column matching `method`.
 *
 * Legacy rows that predate the split-collection feature have only
 * `remainderMethod` populated (no per-method amounts) — we fall
 * back to that and bucket the whole `remainingAmount`.
 *
 * cash + upiQr + online === payment.amount in every case.
 * venueDiscount is shown separately because it's NOT money in —
 * it's money the venue wrote off at collection time.
 */
export function splitBookingPayment(
  p: BookingPaymentForSplit | null | undefined,
) {
  if (!p) return { cash: 0, upiQr: 0, online: 0, venueDiscount: 0 };

  const advance = p.isPartialPayment ? (p.advanceAmount ?? 0) : p.amount;
  const cashAdv = p.method === "CASH" ? advance : 0;
  const upiAdv = p.method === "UPI_QR" ? advance : 0;
  const onlineAdv =
    p.method === "RAZORPAY" || p.method === "PHONEPE" ? advance : 0;

  const remCash =
    p.remainderCashAmount ??
    (p.remainderMethod === "CASH" ? (p.remainingAmount ?? 0) : 0);
  const remUpi =
    p.remainderUpiAmount ??
    (p.remainderMethod === "UPI_QR" ? (p.remainingAmount ?? 0) : 0);
  const remDiscount = p.remainderDiscountAmount ?? 0;

  return {
    cash: cashAdv + remCash,
    upiQr: upiAdv + remUpi,
    online: onlineAdv,
    venueDiscount: remDiscount,
  };
}

/**
 * Cafe payments are simpler — no partial-payment flow, so each
 * order's amount lives entirely in one bucket (Cash / UPI QR /
 * Online).
 */
export type CafePaymentForSplit =
  | { method: string; amount: number }
  | null
  | undefined;

export function splitCafePayment(p: CafePaymentForSplit) {
  if (!p) return { cash: 0, upiQr: 0, online: 0 };
  return {
    cash: p.method === "CASH" ? p.amount : 0,
    upiQr: p.method === "UPI_QR" ? p.amount : 0,
    online:
      p.method === "RAZORPAY" || p.method === "PHONEPE" ? p.amount : 0,
  };
}
