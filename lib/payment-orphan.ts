import { AnalyticsCategory, logServerAction } from "@/lib/server-log";

export type OrphanReason =
  | "no-hold"
  | "slot-taken"
  | "create-failed"
  | "pass-price-mismatch"
  // Tournament entry fees: captured money whose team couldn't be
  // auto-confirmed (amount mismatch, deleted team, …) — the suffix
  // carries the specific cause for the admin worklist.
  | `tournament-${string}`;
export type OrphanGateway = "RAZORPAY" | "PHONEPE" | "PHONEPE_DQR";

/**
 * Record a captured-but-unbooked payment ("orphan") to the durable
 * server-action log under the distinct `payment.orphan` action so admins
 * can filter for it as a worklist (web Action Log → filter by action) and
 * recover it (honour the booking) or refund it.
 *
 * An orphan means the gateway captured money but no Booking exists, because:
 *   - "no-hold"      → the SlotHold blueprint was gone by the time the
 *                      confirmation landed (only happens past the 24h
 *                      payment grace window now — see lib/slot-hold
 *                      cleanupExpiredHolds);
 *   - "slot-taken"   → the slot was re-booked by someone else while this
 *                      payment was in flight, so we refused to double-book;
 *   - "create-failed"→ booking creation failed for another reason;
 *   - "pass-price-mismatch" → a pass purchase captured an amount that
 *                      doesn't match the plan's price (repriced plan or
 *                      a tampered flow), so no UserPass was issued.
 *
 * This NEVER throws — recording an orphan must not break the (already
 * failed) payment path further. The actual refund is an admin action
 * (Razorpay/PhonePe dashboard or the bookings recovery tool); we only make
 * the orphan loud + durable here.
 */
export function recordOrphanPayment(args: {
  gateway: OrphanGateway;
  reason: OrphanReason;
  userId?: string | null;
  amountRupees?: number | null;
  razorpayOrderId?: string | null;
  razorpayPaymentId?: string | null;
  phonePeMerchantTxnId?: string | null;
  holdId?: string | null;
  path?: string;
  platform?: "web" | "android" | "ios";
}): void {
  logServerAction({
    userId: args.userId ?? null,
    category: AnalyticsCategory.PAYMENT,
    action: "payment.orphan",
    outcome: "error",
    path: args.path,
    method: "POST",
    platform: args.platform ?? "web",
    metadata: {
      gateway: args.gateway,
      reason: args.reason,
      amountRupees: args.amountRupees ?? null,
      razorpayOrderId: args.razorpayOrderId ?? null,
      razorpayPaymentId: args.razorpayPaymentId ?? null,
      phonePeMerchantTxnId: args.phonePeMerchantTxnId ?? null,
      holdId: args.holdId ?? null,
      needsAction:
        "Captured payment with no booking — honour via Bookings → Recovery, or refund in the gateway dashboard.",
    },
    error: `Orphaned ${args.gateway} payment (${args.reason}) — money captured, no booking created.`,
  });
}
