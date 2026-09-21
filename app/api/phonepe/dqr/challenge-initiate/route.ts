import { NextRequest, NextResponse } from "next/server";
import { getAuthUserId } from "@/lib/auth-unified";
import { db } from "@/lib/db";
import { isDqrConfigured, qrInit, intentInit } from "@/lib/phonepe-dqr";
import {
  createChallengePaymentOrder,
  CHALLENGE_DQR_PREFIX,
} from "@/lib/challenge-payments";

const DQR_TTL_MINUTES = 15;

/**
 * Generate a PhonePe Dynamic QR for one HALF of a challenge.
 *
 * Slot-first, not money-first, and that is the difference from every other
 * DQR surface here. A pass or a cafe order creates an intent row and lets
 * the money decide; a challenge half is a CLAIM on a side of a match that
 * somebody else may be trying to take at the same instant. So this reserves
 * the `ChallengePayment` row through the ordinary pay path — the same
 * quote, the same refusals, the same create-or-take-over race — and only
 * then mints a QR against it. Showing a QR for a slot we do not hold would
 * take the customer's money for a half that was already gone.
 *
 * `intent: "slot"` is what stops that path short of a Razorpay order, so
 * switching methods cannot leave a live order behind.
 *
 * Unified auth: web session cookie or mobile bearer token.
 */
export async function POST(request: NextRequest) {
  const userId = await getAuthUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Sign in to pay" }, { status: 401 });
  }
  if (!isDqrConfigured()) {
    return NextResponse.json(
      { error: "UPI QR payments are not available right now" },
      { status: 503 },
    );
  }

  const { challengeId, windowId } = await request.json().catch(() => ({}));
  if (!challengeId) {
    return NextResponse.json({ error: "Missing challengeId" }, { status: 400 });
  }

  // Claim the side. Every refusal the card path can give — the board is
  // closed, the hour is too close, somebody else is mid-payment — comes
  // back here in the customer's own words rather than as a QR they cannot
  // use.
  const claim = await createChallengePaymentOrder(
    challengeId,
    userId,
    windowId || undefined,
    "slot",
  );
  if (!claim.ok) {
    return NextResponse.json({ error: claim.error }, { status: 400 });
  }
  if (!("slotOnly" in claim)) {
    // Unreachable: "slot" always returns the slot shape. Guarded rather
    // than cast, because a silent mis-shape here would mint a QR with no
    // row behind it and that is exactly the money-with-nowhere-to-go case.
    return NextResponse.json({ error: "Couldn't start that payment." }, { status: 500 });
  }

  try {
    // < 35 chars: "DQRH_" (5) + 12 + "_" (1) + 13-digit ms = 31.
    const transactionId = `${CHALLENGE_DQR_PREFIX}${claim.rowId.slice(-12)}_${Date.now()}`;

    const fwdHost =
      request.headers.get("x-forwarded-host") || request.headers.get("host");
    const fwdProto = request.headers.get("x-forwarded-proto") || "https";
    const origin =
      request.headers.get("origin") ||
      (fwdHost ? `${fwdProto}://${fwdHost}` : process.env.NEXTAUTH_URL) ||
      "http://localhost:3000";

    const cfg = await db.paymentGatewayConfig.findUnique({
      where: { id: "singleton" },
      select: { intentEnabled: true },
    });
    const useIntent = !!cfg?.intentEnabled;
    const generate = useIntent ? intentInit : qrInit;
    const result = await generate({
      transactionId,
      amountPaise: claim.amount * 100,
      expiresIn: DQR_TTL_MINUTES * 60,
      callbackUrl: `${origin}/api/phonepe/dqr-callback`,
      message: `Challenge — your half`,
    });

    // STAMPED AFTER the QR exists. The other order round this way and a
    // failed mint leaves the row pointing at a transaction PhonePe has
    // never heard of, which the status poll then asks about for ever.
    await db.challengePayment.update({
      where: { id: claim.rowId },
      data: { phonePeMerchantTxnId: transactionId },
    });

    return NextResponse.json({
      qrString: result.qrString,
      qrImage: result.qrImage,
      mode: useIntent ? "intent" : "qr",
      transactionId,
      expiresIn: DQR_TTL_MINUTES * 60,
      amount: claim.amount,
    });
  } catch (error) {
    console.error("[dqr] challenge initiate failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to generate QR" },
      { status: 500 },
    );
  }
}
