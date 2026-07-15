import { NextRequest, NextResponse } from "next/server";
import {
  verifyDqrCallback,
  decodeDqrCallback,
  type DqrCallbackData,
} from "@/lib/phonepe-dqr";
import { confirmDqrBooking, confirmDqrCafe } from "@/lib/dqr-confirm";
import { confirmDqrPass } from "@/lib/passes";

/**
 * PhonePe Dynamic QR S2S callback — the authoritative confirmation
 * path. PhonePe POSTs `{ response: base64 }` with an X-VERIFY header
 * (V1 scheme). We verify, then match the transactionId against a
 * booking hold first, then a cafe intent, then a pass intent, and
 * materialise the order.
 *
 * Always returns 200 (mirrors static-qr-callback) so PhonePe doesn't
 * hammer retries on our own transient errors. Idempotent — safe to
 * race with the client status poll.
 *
 * Endpoint: POST /api/phonepe/dqr-callback
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const base64Response = body.response as string;
    if (!base64Response) {
      console.error("[dqr-callback] missing response payload");
      return NextResponse.json({ success: true });
    }

    // Verify FIRST so a forged payload never reaches confirm logic.
    const xVerify = request.headers.get("X-VERIFY") || "";
    if (!verifyDqrCallback(xVerify, base64Response)) {
      console.error("[dqr-callback] checksum verification failed");
      return NextResponse.json({ success: true });
    }

    let decoded: DqrCallbackData;
    try {
      decoded = decodeDqrCallback(base64Response);
    } catch (err) {
      console.error("[dqr-callback] malformed base64/JSON payload", err);
      return NextResponse.json({ success: true });
    }

    const data = decoded?.data;
    if (!data?.transactionId) {
      console.error("[dqr-callback] missing transactionId in payload");
      return NextResponse.json({ success: true });
    }

    if (decoded.code !== "PAYMENT_SUCCESS" || data.paymentState !== "COMPLETED") {
      console.log(
        `[dqr-callback] non-success — code=${decoded.code}, state=${data.paymentState}, txn=${data.transactionId}`,
      );
      return NextResponse.json({ success: true });
    }

    const transactionId = data.transactionId;
    const providerRef = data.providerReferenceId;

    // Booking first (hold-based), then cafe (intent-based). Each is
    // idempotent and a no-op for the surface that doesn't own the txn.
    const booking = await confirmDqrBooking(transactionId, providerRef);
    if (booking.bookingId) {
      console.log(
        `[dqr-callback] booking ${booking.bookingId} confirmed (txn ${transactionId})`,
      );
      return NextResponse.json({ success: true });
    }

    const cafe = await confirmDqrCafe(transactionId, providerRef);
    if (cafe.orderId) {
      console.log(
        `[dqr-callback] cafe order ${cafe.orderId} confirmed (txn ${transactionId})`,
      );
      return NextResponse.json({ success: true });
    }

    const pass = await confirmDqrPass(transactionId, providerRef);
    if (pass.userPassId) {
      console.log(
        `[dqr-callback] pass ${pass.userPassId} confirmed (txn ${transactionId})`,
      );
      return NextResponse.json({ success: true });
    }

    console.log(
      `[dqr-callback] no matching hold/intent for txn ${transactionId}, amount ${data.amount}`,
    );
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[dqr-callback] error", error);
    return NextResponse.json({ success: true }); // always 200 to PhonePe
  }
}
