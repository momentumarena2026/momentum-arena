import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkPhonePeStatus } from "@/lib/phonepe";
import {
  finalizePaidCafeOrder,
  cancelPendingPaymentOrder,
} from "@/lib/cafe-finalize";

/**
 * PhonePe redirect-back endpoint. Customer comes back here from
 * the PhonePe payment page; we re-check the server-side payment
 * state (defence in depth — don't trust the redirect itself) and
 * either:
 *   - finalize the order (decrement stock + flip status) and send
 *     the customer to the confirmation page, OR
 *   - cancel the order (so it doesn't sit in PENDING_PAYMENT
 *     forever and pollute the admin tab on the next sweep) and
 *     send them back to /cafe with an error query.
 *
 * Mirrors the sports-booking redirect handler's pattern of
 * "trust the verified server response, not the client URL."
 */
export async function GET(request: NextRequest) {
  const orderId = request.nextUrl.searchParams.get("orderId");
  const origin =
    request.headers.get("origin") ||
    process.env.NEXTAUTH_URL ||
    "http://localhost:3000";

  if (!orderId) {
    return NextResponse.redirect(`${origin}/cafe?error=missing_order`);
  }

  try {
    const payment = await db.cafePayment.findUnique({
      where: { orderId },
    });

    if (!payment?.phonePeMerchantTxnId) {
      return NextResponse.redirect(`${origin}/cafe?error=payment_not_found`);
    }

    // Already completed (callback got here first) — just send the
    // customer to confirmation; the finaliser is idempotent and
    // would no-op anyway.
    if (payment.status === "COMPLETED") {
      return NextResponse.redirect(`${origin}/cafe/confirmation/${orderId}`);
    }

    const status = await checkPhonePeStatus(payment.phonePeMerchantTxnId);

    if (status.success) {
      await db.cafePayment.update({
        where: { id: payment.id },
        data: {
          status: "COMPLETED",
          phonePeTransactionId: status.transactionId,
          confirmedAt: new Date(),
        },
      });

      const finalizeResult = await finalizePaidCafeOrder(orderId);
      if (!finalizeResult.ok) {
        // Sold-out race after payment landed — order is now
        // CANCELLED and the customer is owed a refund. Land them
        // somewhere informative rather than the confirmation page.
        return NextResponse.redirect(
          `${origin}/cafe?error=sold_out_refund_required`,
        );
      }

      return NextResponse.redirect(`${origin}/cafe/confirmation/${orderId}`);
    }

    // Payment failed at PhonePe — cancel the PENDING_PAYMENT order
    // so it doesn't linger. Stock wasn't decremented, so cancel is
    // a clean status flip + payment FAILED.
    await cancelPendingPaymentOrder(
      orderId,
      `PhonePe payment ${status.state.toLowerCase()}`,
    );

    return NextResponse.redirect(
      `${origin}/cafe?error=payment_${status.state.toLowerCase()}`,
    );
  } catch (error) {
    console.error("PhonePe cafe redirect error:", error);
    return NextResponse.redirect(`${origin}/cafe?error=payment_failed`);
  }
}
