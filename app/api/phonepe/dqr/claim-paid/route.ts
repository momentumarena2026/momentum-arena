import { NextRequest, NextResponse } from "next/server";
import { getAuthUserId } from "@/lib/auth-unified";
import { getValidHold } from "@/lib/slot-hold";
import { createBookingFromHold } from "@/actions/booking";
import { notifyAdminPendingBooking } from "@/lib/notifications";
import { qrStatus } from "@/lib/phonepe-dqr";
import { confirmDqrBooking } from "@/lib/dqr-confirm";
import {
  AnalyticsCategory,
  logServerAction,
  resolveRequestPlatform,
} from "@/lib/server-log";

/**
 * "I've paid" — reserve the slot while PhonePe catches up.
 *
 * PhonePe can leave a genuinely-paid intent transaction PENDING
 * indefinitely (the intent-replication gap). The customer's money is
 * gone, but we can't prove it, so we can't confirm the booking. Doing
 * nothing loses them the slot AND the money's trail.
 *
 * This mirrors the static-QR flow that predates DQR: create the booking
 * UNCONFIRMED (Booking PENDING + Payment PENDING) so the slot is held
 * and the admin's existing unconfirmed-bookings queue and notifications
 * pick it up for manual verification.
 *
 * Two things make it safer than the static-QR version it copies:
 *
 *  1. It is NOT a bare trust button. We only accept the claim when this
 *     hold actually carries an in-flight DQR transaction that PhonePe
 *     reports as PENDING. Nobody can mint an unconfirmed booking by
 *     tapping "I've paid" without a real payment attempt behind it, and
 *     if PhonePe says COMPLETED we confirm properly instead.
 *  2. The transaction id is stamped on the Payment row, so a late
 *     settlement (callback or poll) upgrades the booking to CONFIRMED
 *     automatically — see confirmDqrBooking — and an admin can verify
 *     it against the PhonePe dashboard by id rather than a screenshot.
 */
export async function POST(request: NextRequest) {
  const userId = await getAuthUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { holdId, overrideAmount } = await request.json().catch(() => ({}));
  if (!holdId) {
    return NextResponse.json({ error: "Missing holdId" }, { status: 400 });
  }

  const hold = await getValidHold(holdId, userId);
  if (!hold) {
    return NextResponse.json(
      { error: "This reservation has expired. Please contact us — do NOT pay again." },
      { status: 404 },
    );
  }
  const txn = hold.phonePeMerchantTxnId;
  if (!txn?.startsWith("DQR_")) {
    return NextResponse.json(
      { error: "No UPI payment was started for this booking." },
      { status: 409 },
    );
  }

  // If PhonePe has actually settled it, take the real path — a confirmed
  // booking beats an unconfirmed one every time.
  try {
    const status = await qrStatus(txn);
    if (status.state === "COMPLETED") {
      const confirmed = await confirmDqrBooking(txn, status.providerReferenceId);
      if (confirmed.bookingId) {
        return NextResponse.json({
          bookingId: confirmed.bookingId,
          confirmed: true,
        });
      }
    }
    if (status.state === "FAILED") {
      return NextResponse.json(
        {
          error:
            "Your bank reported this payment as failed. If money did leave your account, please contact us instead of paying again.",
        },
        { status: 409 },
      );
    }
  } catch {
    // PhonePe unreachable — the claim path below is exactly what that
    // situation is for.
  }

  const amount =
    overrideAmount && overrideAmount > 0
      ? overrideAmount
      : (hold.paymentAmount ?? hold.totalAmount);
  const isAdvance = hold.paymentMethod === "CASH";

  const bookingId = await createBookingFromHold(
    holdId,
    {
      method: "UPI_QR",
      status: "PENDING",
      amount,
      phonePeMerchantTxnId: txn,
      ...(isAdvance
        ? {
            isPartialPayment: true,
            advanceAmount: amount,
            remainingAmount: hold.totalAmount - amount,
          }
        : {}),
    },
    "PENDING",
  );
  if (!bookingId) {
    return NextResponse.json(
      {
        error:
          "We couldn't reserve this slot — it may have just been taken. Please do NOT pay again; contact us and we'll sort it out.",
      },
      { status: 409 },
    );
  }

  notifyAdminPendingBooking(bookingId).catch(() => {});
  logServerAction({
    userId,
    category: AnalyticsCategory.PAYMENT,
    action: "payment.dqr.claimed-paid",
    outcome: "success",
    path: request.nextUrl.pathname,
    method: "POST",
    platform: resolveRequestPlatform(request),
    metadata: { holdId, bookingId, transactionId: txn, amount },
  });

  return NextResponse.json({ bookingId, confirmed: false });
}
