import { NextRequest, NextResponse, after } from "next/server";
import { getMobileUser, getMobilePlatform } from "@/lib/mobile-auth";
import { getValidHold } from "@/lib/slot-hold";
import { createBookingFromHold } from "@/actions/booking";
import { deriveHoldCharge, splitAdvancePayment } from "@/lib/booking-amounts";
import { notifyAdminPendingBooking } from "@/lib/notifications";
import {
  AnalyticsCategory,
  logServerAction,
  resolveRequestPlatform,
} from "@/lib/server-log";

// POST /api/mobile/booking/select-payment — native wrapper around the web
// server actions `selectUpiPayment` and `selectCashPayment`. The web actions
// depend on NextAuth's session, so we re-implement them here under mobile JWT
// auth. Body:
//   { holdId, method: "UPI_QR" | "CASH", overrideAmount?: number,
//     isAdvance?: boolean }
// Returns { success, bookingId } matching the action return shape.
export async function POST(request: NextRequest) {
  const platform = resolveRequestPlatform(request);
  const path = request.nextUrl.pathname;

  const user = await getMobileUser(request);
  if (!user) {
    logServerAction({
      action: "payment.select_payment",
      category: AnalyticsCategory.PAYMENT,
      outcome: "error",
      path,
      method: "POST",
      platform,
      error: "Unauthorized",
    });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    holdId?: string;
    method?: "UPI_QR" | "CASH";
    overrideAmount?: number;
    isAdvance?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    logServerAction({
      userId: user.id,
      action: "payment.select_payment",
      category: AnalyticsCategory.PAYMENT,
      outcome: "error",
      path,
      method: "POST",
      platform,
      error: "Invalid body",
    });
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const { holdId, method, overrideAmount, isAdvance } = body;
  const advance = !!isAdvance;
  const action =
    method === "UPI_QR"
      ? "payment.upi_qr.commit"
      : advance
        ? "payment.cash.advance_commit"
        : "payment.cash.commit";

  if (!holdId || !method) {
    logServerAction({
      userId: user.id,
      action,
      category: AnalyticsCategory.PAYMENT,
      outcome: "error",
      path,
      method: "POST",
      platform,
      metadata: { holdId, method, isAdvance: advance },
      error: "Missing holdId or method",
    });
    return NextResponse.json(
      { error: "Missing holdId or method" },
      { status: 400 }
    );
  }
  if (method !== "UPI_QR" && method !== "CASH") {
    logServerAction({
      userId: user.id,
      action,
      category: AnalyticsCategory.PAYMENT,
      outcome: "error",
      path,
      method: "POST",
      platform,
      metadata: { holdId, method, isAdvance: advance },
      error: "Unsupported method",
    });
    return NextResponse.json(
      { error: "Unsupported method" },
      { status: 400 }
    );
  }

  const hold = await getValidHold(holdId, user.id);
  if (!hold) {
    logServerAction({
      userId: user.id,
      action,
      category: AnalyticsCategory.PAYMENT,
      outcome: "error",
      path,
      method: "POST",
      platform,
      metadata: { holdId, method, isAdvance: advance },
      error: "Hold not found or expired",
    });
    return NextResponse.json(
      { success: false, error: "Hold not found or expired" },
      { status: 404 }
    );
  }

  // Payment.amount is derived server-side, never read off the request:
  // this route sets it directly, so `overrideAmount: 1` used to buy a
  // full-price booking for ₹1. The client figure survives only as a
  // recurring-series hint — see lib/booking-amounts for the whole rule.
  // On the advance flow the client sends the HALF it collected by QR, so
  // it is matched against the halves rather than the full totals.
  const charge = await deriveHoldCharge(hold, {
    clientAmount: overrideAmount,
    clientAmountIsAdvance: advance,
  });
  // The remainder is computed against the post-discount + post-redemption
  // total so neither the coupon nor the points are clawed back at the venue.
  const effectiveTotal = charge.payableAmount;
  const split = splitAdvancePayment(effectiveTotal);
  const amount = advance ? split.advanceAmount : effectiveTotal;
  const advanceAmount = advance ? amount : undefined;
  const remainingAmount = advance ? split.remainingAmount : undefined;

  // method === "CASH" + isAdvance: the customer paid the advance via QR, so we
  // record UPI_QR as the payment method (admin confirms on the WhatsApp
  // screenshot). Plain "CASH" is "pay full at venue" — not used from the
  // mobile UI but kept here for completeness.
  const paymentMethod =
    method === "UPI_QR" ? "UPI_QR" : advance ? "UPI_QR" : "CASH";

  const bookingId = await createBookingFromHold(
    holdId,
    {
      method: paymentMethod,
      status: "PENDING",
      amount,
      isPartialPayment: advance,
      advanceAmount,
      remainingAmount,
    },
    "PENDING",
    getMobilePlatform(request)
  );

  if (!bookingId) {
    logServerAction({
      userId: user.id,
      action,
      category: AnalyticsCategory.PAYMENT,
      outcome: "error",
      path,
      method: "POST",
      platform,
      metadata: {
        holdId,
        method,
        isAdvance: advance,
        amount,
        advanceAmount,
        remainingAmount,
        paymentMethod,
      },
      error: "Failed to create booking",
    });
    return NextResponse.json(
      { success: false, error: "Failed to create booking" },
      { status: 500 }
    );
  }

  // Fire-and-forget — same behaviour as the web actions.
  // after(): the app's equivalent of the web static-QR path — same
  // freeze-on-response race that lost admin alerts at random.
  after(async () => {
    await notifyAdminPendingBooking(bookingId).catch((err) =>
      console.error("[notify] admin pending booking failed", err),
    );
  });

  logServerAction({
    userId: user.id,
    action,
    category: AnalyticsCategory.PAYMENT,
    outcome: "success",
    path,
    method: "POST",
    platform,
    metadata: {
      holdId,
      bookingId,
      paymentMethod: method,
      method,
      isAdvance: advance,
      amount,
      advanceAmount,
      remainingAmount,
      sport: hold.courtConfig.sport,
    },
  });

  return NextResponse.json({ success: true, bookingId });
}
