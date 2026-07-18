import { NextRequest, NextResponse } from "next/server";
import { getAuthUserId } from "@/lib/auth-unified";
import { db } from "@/lib/db";
import { getValidHold } from "@/lib/slot-hold";
import { verifyBowlingHoldStillBookable } from "@/lib/bowling-availability";
import { isDqrConfigured, qrInit, intentInit, qrStatus } from "@/lib/phonepe-dqr";
import { confirmDqrBooking } from "@/lib/dqr-confirm";
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

  // In-flight payment guard. Re-initiating on a hold that already carries a
  // DQR transaction happens when the customer retries — or when an in-app
  // browser silently RELOADS the checkout on return from the UPI app
  // (real incident: two ₹1,600 captures on one hold, 2026-07-11). Minting a
  // new txn here would overwrite the hold's pointer, so the payment the
  // customer just made could never find its hold again (orphan). Probe the
  // prior txn first: if PhonePe says it COMPLETED, confirm THAT booking and
  // return it — never issue a second QR for money already taken.
  if (hold.phonePeMerchantTxnId?.startsWith("DQR_")) {
    try {
      const prior = await qrStatus(hold.phonePeMerchantTxnId);
      if (prior.state === "COMPLETED") {
        const confirmed = await confirmDqrBooking(
          hold.phonePeMerchantTxnId,
          prior.providerReferenceId,
        );
        if (confirmed.bookingId) {
          logServerAction({
            userId,
            category: AnalyticsCategory.PAYMENT,
            action: "payment.dqr.already-paid",
            outcome: "success",
            path: request.nextUrl.pathname,
            method: "POST",
            platform: resolveRequestPlatform(request),
            metadata: {
              holdId,
              transactionId: hold.phonePeMerchantTxnId,
              bookingId: confirmed.bookingId,
            },
          });
          return NextResponse.json({
            alreadyPaid: true,
            bookingId: confirmed.bookingId,
          });
        }
      }
      // PENDING/FAILED → fall through and mint a fresh txn. A PENDING
      // payment that completes AFTER the overwrite is caught by the
      // orphan net (recordOrphanPayment) for admin recovery.
    } catch {
      // Status probe failed (PhonePe hiccup) — don't block the customer
      // from paying; the orphan net remains the backstop.
    }
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
    // Build the callback base from the domain THIS request actually hit so
    // the dev deploy always registers a dev callback and prod a prod one —
    // never a shared env that could cross-wire environments. Web fetches
    // send Origin; the mobile app doesn't, so fall back to the forwarded
    // host Vercel sets to the public domain (then NEXTAUTH_URL, then local).
    const fwdHost =
      request.headers.get("x-forwarded-host") || request.headers.get("host");
    const fwdProto = request.headers.get("x-forwarded-proto") || "https";
    const origin =
      request.headers.get("origin") ||
      (fwdHost ? `${fwdProto}://${fwdHost}` : process.env.NEXTAUTH_URL) ||
      "http://localhost:3000";

    // Hold amounts are rupees (same convention as the gateway routes);
    // DQR wants paise.
    const orderAmountPaise = orderAmount * 100;

    // Intent (tap-to-pay app picker) vs scan-only QR is an ADMIN toggle now
    // (PaymentGatewayConfig.intentEnabled) - no redeploy needed to flip it.
    const cfg = await db.paymentGatewayConfig.findUnique({
      where: { id: "singleton" },
      select: { intentEnabled: true },
    });
    const useIntent = !!cfg?.intentEnabled;
    const generate = useIntent ? intentInit : qrInit;
    const result = await generate({
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
        // Abandoned pass top-up → paying the full way; drop the
        // attachment so no callback treats this as a top-up.
        redeemPassId: null,
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
      qrImage: result.qrImage,
      // "intent" -> qrString is a TAPPABLE upi:// link (Open Intent product);
      // the client shows a "Pay with UPI app" button on mobile browsers.
      // "qr" -> scan-only string; the client renders the QR alone.
      mode: useIntent ? "intent" : "qr",
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
