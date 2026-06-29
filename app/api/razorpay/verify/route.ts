import { NextRequest, NextResponse, after } from "next/server";
import { getAuthUserId } from "@/lib/auth-unified";
import { db } from "@/lib/db";
import { verifyRazorpaySignature } from "@/lib/razorpay";
import {
  sendBookingConfirmation,
  notifyAdminBookingConfirmed,
} from "@/lib/notifications";
import { createBookingFromHold } from "@/actions/booking";
import { awardBookingPoints } from "@/lib/rewards/earn";
import { AnalyticsCategory, logServerAction, resolveRequestPlatform } from "@/lib/server-log";
import { recordOrphanPayment } from "@/lib/payment-orphan";

export async function POST(request: NextRequest) {
  const userId = await getAuthUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const {
    holdId,
    razorpayPaymentId,
    razorpayOrderId,
    razorpaySignature,
    isAdvance,
  } = await request.json();

  if (!holdId || !razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  // Look up the hold; tolerate a missing hold if this is a retry (idempotency in createBookingFromHold)
  const hold = await db.slotHold.findUnique({ where: { id: holdId } });

  // Signature verification always runs — defence in depth even if hold is gone
  const isValid = verifyRazorpaySignature(
    razorpayOrderId,
    razorpayPaymentId,
    razorpaySignature
  );
  if (!isValid) {
    logServerAction({
      userId,
      category: AnalyticsCategory.PAYMENT,
      action: "payment.razorpay.verify",
      outcome: "error",
      path: request.nextUrl.pathname,
      method: "POST",
      platform: resolveRequestPlatform(request),
      metadata: { holdId, razorpayOrderId },
      error: "Invalid payment signature",
    });
    return NextResponse.json(
      { error: "Invalid payment signature" },
      { status: 400 }
    );
  }

  // Idempotency: if this payment already resulted in a Booking, return it.
  const existing = await db.payment.findFirst({
    where: { razorpayPaymentId },
  });
  if (existing) {
    logServerAction({
      userId,
      category: AnalyticsCategory.PAYMENT,
      action: "payment.razorpay.verify",
      outcome: "success",
      path: request.nextUrl.pathname,
      method: "POST",
      platform: resolveRequestPlatform(request),
      metadata: {
        holdId,
        bookingId: existing.bookingId,
        razorpayOrderId,
        razorpayPaymentId,
        idempotent: true,
      },
    });
    return NextResponse.json({ success: true, bookingId: existing.bookingId });
  }

  if (!hold) {
    // The signature was already verified above, so Razorpay captured real
    // money — but the hold blueprint is gone (expired + swept past the 24h
    // grace window, or already consumed without a Payment row). This is an
    // ORPHANED payment. Record it loudly so an admin honours or refunds it,
    // and DO NOT tell the customer to "try again" — that would charge them
    // a second time.
    recordOrphanPayment({
      gateway: "RAZORPAY",
      reason: "no-hold",
      userId,
      razorpayOrderId,
      razorpayPaymentId,
      holdId,
      path: request.nextUrl.pathname,
      platform: resolveRequestPlatform(request),
    });
    logServerAction({
      userId,
      category: AnalyticsCategory.PAYMENT,
      action: "payment.razorpay.verify",
      outcome: "error",
      path: request.nextUrl.pathname,
      method: "POST",
      platform: resolveRequestPlatform(request),
      metadata: { holdId, razorpayOrderId, razorpayPaymentId, orphan: true },
      error: "Hold expired (payment captured — orphaned)",
    });
    return NextResponse.json(
      {
        error:
          "Payment received, but your slot reservation had expired. Please do NOT pay again — our team will confirm your booking or refund you shortly.",
        paymentReceived: true,
      },
      { status: 410 }
    );
  }
  if (hold.userId !== userId) {
    logServerAction({
      userId,
      category: AnalyticsCategory.PAYMENT,
      action: "payment.razorpay.verify",
      outcome: "error",
      path: request.nextUrl.pathname,
      method: "POST",
      platform: resolveRequestPlatform(request),
      metadata: { holdId, razorpayOrderId },
      error: "Forbidden",
    });
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (hold.razorpayOrderId !== razorpayOrderId) {
    logServerAction({
      userId,
      category: AnalyticsCategory.PAYMENT,
      action: "payment.razorpay.verify",
      outcome: "error",
      path: request.nextUrl.pathname,
      method: "POST",
      platform: resolveRequestPlatform(request),
      metadata: {
        holdId,
        razorpayOrderId,
        expectedOrderId: hold.razorpayOrderId,
      },
      error: "Order mismatch",
    });
    return NextResponse.json({ error: "Order mismatch" }, { status: 400 });
  }

  const paymentAmount = hold.paymentAmount ?? hold.totalAmount;
  // fullAmount is the POST-discount total so remainingAmount == what the
  // customer still owes at the venue. hold.totalAmount is pre-discount; we
  // have to subtract any coupon AND any points-redemption that was applied
  // on the hold (mirrors the `combinedDiscount` used inside
  // createBookingFromHold). Using pre-discount here makes the venue
  // collect the discount back, e.g. charges ₹1,050 instead of ₹950 when
  // FLAT100 brought ₹2,000 → ₹1,900 and the advance was ₹950.
  const appliedDiscount =
    hold.couponId && hold.discountAmount && hold.discountAmount > 0
      ? hold.discountAmount
      : 0;
  const pointsRedeemRupees =
    hold.pointsToRedeem && hold.pointsRedeemPaiseSaved
      ? Math.floor(hold.pointsRedeemPaiseSaved / 100)
      : 0;
  const fullAmount = hold.totalAmount - appliedDiscount - pointsRedeemRupees;
  const advanceAmount = isAdvance ? paymentAmount : undefined;
  const remainingAmount = isAdvance ? fullAmount - paymentAmount : undefined;

  const bookingId = await createBookingFromHold(
    holdId,
    {
      // Advance method reflects HOW the advance was paid, not how the
      // remainder will be collected at the venue. Status lands on PARTIAL
      // when this is an advance (flips to COMPLETED via
      // markRemainderCollected) or COMPLETED for full-pay bookings.
      method: "RAZORPAY",
      status: isAdvance ? "PARTIAL" : "COMPLETED",
      amount: paymentAmount,
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature,
      confirmedAt: new Date(),
      isPartialPayment: !!isAdvance,
      advanceAmount,
      remainingAmount,
    },
    "CONFIRMED"
  );

  if (!bookingId) {
    logServerAction({
      userId,
      category: AnalyticsCategory.PAYMENT,
      action: "payment.razorpay.verify",
      outcome: "error",
      path: request.nextUrl.pathname,
      method: "POST",
      platform: resolveRequestPlatform(request),
      metadata: { holdId, razorpayOrderId, razorpayPaymentId, isAdvance: !!isAdvance },
      error: "Failed to create booking",
    });
    return NextResponse.json(
      { error: "Failed to create booking" },
      { status: 500 }
    );
  }

  // Defer SMS dispatch via `after()` so the Vercel serverless function stays
  // alive until MSG91 responds. Fire-and-forget `.catch()` would be killed
  // the moment NextResponse.json returns, which is why the admin notification
  // never reached MSG91 for Razorpay-confirmed bookings.
  //
  // awardBookingPoints rides the same `after()` window for the same
  // reason — the rewards ledger insert was being orphaned for every
  // Razorpay-paid booking because no one called it on this path
  // (only the cash / UPI / manual-confirm admin actions did). The
  // function is idempotent (@@unique([type, bookingId])) and gates
  // internally on booking.status === "CONFIRMED", so it's safe to
  // call here unconditionally.
  after(async () => {
    await Promise.allSettled([
      sendBookingConfirmation(bookingId).catch((err) =>
        console.error("Notification dispatch failed:", err)
      ),
      notifyAdminBookingConfirmed(bookingId).catch((err) =>
        console.error("Notification dispatch failed:", err)
      ),
      awardBookingPoints(bookingId).catch((err) =>
        console.error("[rewards] award failed for", bookingId, err)
      ),
    ]);
  });

  logServerAction({
    userId,
    category: AnalyticsCategory.PAYMENT,
    action: "payment.razorpay.verify",
    outcome: "success",
    path: request.nextUrl.pathname,
    method: "POST",
    platform: resolveRequestPlatform(request),
    metadata: {
      holdId,
      bookingId,
      razorpayOrderId,
      razorpayPaymentId,
      amount: paymentAmount,
      isAdvance: !!isAdvance,
    },
  });

  return NextResponse.json({ success: true, bookingId });
}
