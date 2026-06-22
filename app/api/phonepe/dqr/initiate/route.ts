import { NextRequest, NextResponse } from "next/server";
import { getAuthUserId } from "@/lib/auth-unified";
import { db } from "@/lib/db";
import { getValidHold } from "@/lib/slot-hold";
import { verifyBowlingHoldStillBookable } from "@/lib/bowling-availability";
import { isDqrConfigured, qrInit } from "@/lib/phonepe-dqr";
import { AnalyticsCategory, logServerAction, resolveRequestPlatform } from "@/lib/server-log";

// QR validity / hold extension. 15 min comfortably covers scanning +
// approving a UPI collect without letting an abandoned hold linger.
const DQR_TTL_MINUTES = 15;

/**
 * Generate a PhonePe Dynamic QR for a sports booking. Mirrors
 * /api/phonepe/initiate (gateway) but returns a `qrString` the client
 * renders in-app instead of a hosted-page redirect. The booking is
 * NOT created here — confirmation (callback or status poll) creates it
 * from the hold via lib/dqr-confirm.
 */
export async function POST(request: NextRequest) {
  const userId = await getAuthUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isDqrConfigured()) {
    return NextResponse.json(
      { error: "UPI QR payments are not available right now" },
      { status: 503 },
    );
  }

  const { holdId, isAdvance, overrideAmount } = await request.json();
  if (!holdId) {
    return NextResponse.json({ error: "Missing holdId" }, { status: 400 });
  }

  const hold = await getValidHold(holdId, userId);
  if (!hold) {
    return NextResponse.json(
      { error: "Hold not found or expired" },
      { status: 404 },
    );
  }

  // Same bowling-zone re-check as the gateway initiate routes.
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
    let advanceAmount: number | undefined;
    let remainingAmount: number | undefined;
    if (isAdvance) {
      advanceAmount = Math.ceil(paymentAmount * 0.5);
      remainingAmount = paymentAmount - advanceAmount;
      orderAmount = advanceAmount;
    }

    // < 35 chars per DQR spec: "DQR_" (4) + 12 + "_" (1) + 13-digit ms = 30.
    const transactionId = `DQR_${holdId.slice(-12)}_${Date.now()}`;
    const origin =
      request.headers.get("origin") ||
      process.env.NEXTAUTH_URL ||
      "http://localhost:3000";

    // Hold amounts are rupees (same convention as the gateway routes);
    // DQR wants paise.
    const orderAmountPaise = orderAmount * 100;

    const result = await qrInit({
      transactionId,
      amountPaise: orderAmountPaise,
      expiresIn: DQR_TTL_MINUTES * 60,
      callbackUrl: `${origin}/api/phonepe/dqr-callback`,
      message: `Booking — ₹${orderAmount.toLocaleString("en-IN")}`,
    });

    // Store the txn id on the hold so the callback/status path can find
    // it. paymentMethod === "CASH" is the advance flag the confirm step
    // reads; full UPI uses UPI_QR. paymentAmount stores what was charged
    // (the 50% advance when applicable).
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
      action: "payment.dqr.initiate",
      outcome: "success",
      path: request.nextUrl.pathname,
      method: "POST",
      platform: resolveRequestPlatform(request),
      metadata: { holdId, transactionId, amount: orderAmount, isAdvance: !!isAdvance },
    });

    return NextResponse.json({
      qrString: result.qrString,
      transactionId,
      expiresIn: DQR_TTL_MINUTES * 60,
      amount: orderAmount,
      isAdvance: !!isAdvance,
      advanceAmount: advanceAmount ?? null,
      remainingAmount: remainingAmount ?? null,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to generate QR";
    logServerAction({
      userId,
      category: AnalyticsCategory.PAYMENT,
      action: "payment.dqr.initiate",
      outcome: "error",
      path: request.nextUrl.pathname,
      method: "POST",
      platform: resolveRequestPlatform(request),
      metadata: { holdId },
      error: message,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
