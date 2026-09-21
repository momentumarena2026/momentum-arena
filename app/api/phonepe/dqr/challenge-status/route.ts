import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isDqrConfigured, qrStatus } from "@/lib/phonepe-dqr";
import { confirmDqrChallenge } from "@/lib/challenge-payments";

/**
 * Client status poll for a challenge half paid by UPI DQR.
 *
 * On COMPLETED it runs the SAME settlement the S2S callback runs, which is
 * the same placement the card path runs. The two routinely race — PhonePe
 * calls back while the phone is still polling — and that is fine: the
 * capture stamp is a conditional update and the placement resumes rather
 * than double-spending.
 *
 * `confirmedId` is the challenge id, because that is what the app
 * navigates to. The sheet shipped by `DqrCheckout` calls whatever comes
 * back `confirmedId`; for a booking it is a booking, for a pass a pass,
 * and here it is the match the half belongs to.
 */
export async function GET(request: NextRequest) {
  if (!isDqrConfigured()) {
    return NextResponse.json({ error: "Not available" }, { status: 503 });
  }
  const transactionId = request.nextUrl.searchParams.get("transactionId");
  if (!transactionId) {
    return NextResponse.json({ error: "Missing transactionId" }, { status: 400 });
  }

  // Fast path: the callback already settled it. Asking PhonePe again would
  // be a round trip to learn what the database already knows, on a poll
  // that runs every couple of seconds.
  const row = await db.challengePayment.findUnique({
    where: { phonePeMerchantTxnId: transactionId },
    select: { challengeId: true, placedAt: true },
  });
  if (row?.placedAt) {
    return NextResponse.json({ state: "COMPLETED", confirmedId: row.challengeId });
  }

  try {
    const status = await qrStatus(transactionId);
    if (status.state === "COMPLETED") {
      const res = await confirmDqrChallenge(
        transactionId,
        status.providerReferenceId,
        status.amount,
      );
      if (res.mismatch || res.error) {
        // Terminal, and the money IS captured — the half was reassigned
        // while they scanned, or repriced under them. Stop the client
        // polling and say so, rather than spinning against a settlement
        // that will never happen.
        return NextResponse.json({
          state: "FAILED",
          confirmedId: null,
          paymentReceived: true,
          error:
            res.error ??
            "That payment could not be applied. The arena will refund you in full.",
        });
      }
      return NextResponse.json({
        state: res.challengeId ? "COMPLETED" : "PENDING",
        confirmedId: res.challengeId ?? null,
      });
    }
    return NextResponse.json({ state: status.state });
  } catch (error) {
    // PENDING rather than FAILED: a flaky lookup must not tell a customer
    // whose money has left their account that the payment failed.
    console.error("[dqr] challenge status poll error", error);
    return NextResponse.json({ state: "PENDING" });
  }
}
