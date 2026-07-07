import { NextRequest, NextResponse } from "next/server";
import { getAuthUserId } from "@/lib/auth-unified";
import { db } from "@/lib/db";
import { getValidHold } from "@/lib/slot-hold";
import { verifyBowlingHoldStillBookable } from "@/lib/bowling-availability";
import { isDqrConfigured, collectInit } from "@/lib/phonepe-dqr";
import { AnalyticsCategory, logServerAction, resolveRequestPlatform } from "@/lib/server-log";

const DQR_TTL_MINUTES = 15;

/** UPI VPA shape: handle@psp (NPCI allows . - _ in the handle). */
const VPA_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{1,}@[a-zA-Z]{2,}$/;

/**
 * "Pay with UPI ID" for a sports booking: send a UPI COLLECT request to
 * the customer's VPA. Mirrors /api/phonepe/dqr/initiate — same
 * transactionId conventions and hold stamping, so the existing status
 * poll + S2S callback confirm the payment and create the booking.
 */
export async function POST(request: NextRequest) {
  const userId = await getAuthUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isDqrConfigured()) {
    return NextResponse.json(
      { error: "UPI payments are not available right now" },
      { status: 503 },
    );
  }

  const { holdId, vpa, isAdvance, overrideAmount } = await request.json();
  if (!holdId) {
    return NextResponse.json({ error: "Missing holdId" }, { status: 400 });
  }
  const cleanVpa = typeof vpa === "string" ? vpa.trim().toLowerCase() : "";
  if (!VPA_RE.test(cleanVpa)) {
    return NextResponse.json(
      { error: "That doesn't look like a valid UPI ID (e.g. name@bank)" },
      { status: 400 },
    );
  }

  const hold = await getValidHold(holdId, userId);
  if (!hold) {
    return NextResponse.json(
      { error: "Hold not found or expired" },
      { status: 404 },
    );
  }

  const stillOk = await verifyBowlingHoldStillBookable(holdId);
  if (!stillOk.ok) {
    return NextResponse.json(
      { error: stillOk.reason, conflicts: stillOk.conflicts },
      { status: 409 },
    );
  }

  try {
    const paymentAmount =
      overrideAmount && overrideAmount > 0 ? overrideAmount : hold.totalAmount;

    let orderAmount = paymentAmount;
    if (isAdvance) {
      orderAmount = Math.ceil(paymentAmount * 0.5);
    }

    // Same shape as initiate; "DQR_" prefix keeps callback/status handling
    // identical for collect-paid bookings.
    const transactionId = `DQR_${holdId.slice(-12)}_${Date.now()}`;
    const fwdHost =
      request.headers.get("x-forwarded-host") || request.headers.get("host");
    const fwdProto = request.headers.get("x-forwarded-proto") || "https";
    const origin =
      request.headers.get("origin") ||
      (fwdHost ? `${fwdProto}://${fwdHost}` : process.env.NEXTAUTH_URL) ||
      "http://localhost:3000";

    await collectInit({
      transactionId,
      amountPaise: orderAmount * 100,
      expiresIn: DQR_TTL_MINUTES * 60,
      callbackUrl: `${origin}/api/phonepe/dqr-callback`,
      vpa: cleanVpa,
      message: `Booking-${orderAmount}`,
    });

    await db.slotHold.update({
      where: { id: holdId },
      data: {
        phonePeMerchantTxnId: transactionId,
        paymentMethod: isAdvance ? "CASH" : "UPI_QR",
        paymentAmount: orderAmount,
        paymentInitiatedAt: new Date(),
        expiresAt: new Date(Date.now() + DQR_TTL_MINUTES * 60 * 1000),
      },
    });

    logServerAction({
      userId,
      category: AnalyticsCategory.PAYMENT,
      action: "payment.dqr.collect",
      outcome: "success",
      path: request.nextUrl.pathname,
      method: "POST",
      platform: resolveRequestPlatform(request),
      metadata: { holdId, transactionId, amount: orderAmount, isAdvance: !!isAdvance },
    });

    return NextResponse.json({
      transactionId,
      expiresIn: DQR_TTL_MINUTES * 60,
      amount: orderAmount,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to send payment request";
    logServerAction({
      userId,
      category: AnalyticsCategory.PAYMENT,
      action: "payment.dqr.collect",
      outcome: "error",
      path: request.nextUrl.pathname,
      method: "POST",
      platform: resolveRequestPlatform(request),
      metadata: { holdId },
      error: message,
    });
    // Friendly error — the raw PhonePe message leaks env/host detail.
    return NextResponse.json(
      {
        error:
          "Couldn't send a payment request to that UPI ID — check the ID, or pay via an app / scan the QR instead.",
      },
      { status: 502 },
    );
  }
}
