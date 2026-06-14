import { NextRequest, NextResponse, after } from "next/server";
import { getMobileUser, getMobilePlatform } from "@/lib/mobile-auth";
import { db } from "@/lib/db";
import { verifyRazorpaySignature } from "@/lib/razorpay";
import {
  sendBookingConfirmation,
  notifyAdminBookingConfirmed,
} from "@/lib/notifications";
import { createBookingFromHold } from "@/actions/booking";
import { awardBookingPoints } from "@/lib/rewards/earn";
import { AnalyticsCategory, logServerAction, resolveRequestPlatform } from "@/lib/server-log";

// POST /api/mobile/razorpay/verify — native equivalent of the web verify
// route. Validates the Razorpay signature, enforces idempotency, and turns
// the hold into a Booking. Returns { success, bookingId }.
export async function POST(request: NextRequest) {
  const user = await getMobileUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    holdId?: string;
    razorpayPaymentId?: string;
    razorpayOrderId?: string;
    razorpaySignature?: string;
    isAdvance?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const {
    holdId,
    razorpayPaymentId,
    razorpayOrderId,
    razorpaySignature,
    isAdvance,
  } = body;

  if (!holdId || !razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const hold = await db.slotHold.findUnique({ where: { id: holdId } });

  const isValid = verifyRazorpaySignature(
    razorpayOrderId,
    razorpayPaymentId,
    razorpaySignature
  );
  if (!isValid) {
    logServerAction({
      userId: user.id,
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

  // Idempotency: if this Razorpay payment already produced a Booking, return it.
  const existing = await db.payment.findFirst({
    where: { razorpayPaymentId },
  });
  if (existing) {
    logServerAction({
      userId: user.id,
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
    logServerAction({
      userId: user.id,
      category: AnalyticsCategory.PAYMENT,
      action: "payment.razorpay.verify",
      outcome: "error",
      path: request.nextUrl.pathname,
      method: "POST",
      platform: resolveRequestPlatform(request),
      metadata: { holdId, razorpayOrderId },
      error: "Hold expired",
    });
    return NextResponse.json(
      { error: "Hold expired — please try again" },
      { status: 410 }
    );
  }
  if (hold.userId !== user.id) {
    logServerAction({
      userId: user.id,
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
      userId: user.id,
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
    "CONFIRMED",
    getMobilePlatform(request)
  );

  if (!bookingId) {
    logServerAction({
      userId: user.id,
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

  // awardBookingPoints rides this `after()` block — the rewards ledger
  // insert was orphaned for every Razorpay-paid booking because none
  // of the Razorpay verify paths called it (only the cash/UPI/manual
  // admin confirm actions did). Idempotent + self-gates on
  // booking.status === "CONFIRMED", safe to call unconditionally.
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
    userId: user.id,
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
