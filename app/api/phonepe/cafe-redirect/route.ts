import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkPhonePeStatus } from "@/lib/phonepe";
import {
  materializeOrderFromIntent,
  deleteCafePaymentIntent,
} from "@/lib/cafe-intent";

/**
 * PhonePe redirect-back endpoint. Customer returns here after the
 * gateway page; we re-check server-side payment status (don't
 * trust the redirect URL itself) and either:
 *
 *   - Materialise the CafeOrder from the intent → redirect to the
 *     real /cafe/confirmation/[orderId].
 *   - Or delete the intent (gateway reported failure) → redirect
 *     back to /cafe with an error code.
 *
 * The intent id arrives as `intentId` in the query. Legacy URLs
 * carrying `orderId` are still tolerated (treated identically) so
 * any in-flight gateway sessions from before this deploy still
 * round-trip cleanly.
 */
export async function GET(request: NextRequest) {
  const intentId =
    request.nextUrl.searchParams.get("intentId") ??
    request.nextUrl.searchParams.get("orderId");
  const origin =
    request.headers.get("origin") ||
    process.env.NEXTAUTH_URL ||
    "http://localhost:3000";

  if (!intentId) {
    return NextResponse.redirect(`${origin}/cafe?error=missing_intent`);
  }

  try {
    const intent = await db.cafePaymentIntent.findUnique({
      where: { id: intentId },
    });

    // Intent already consumed (callback won the race) — pull the
    // materialised order id and land the user on confirmation.
    if (intent?.consumedOrderId) {
      return NextResponse.redirect(
        `${origin}/cafe/confirmation/${intent.consumedOrderId}`,
      );
    }

    if (!intent?.phonePeMerchantTxnId) {
      return NextResponse.redirect(`${origin}/cafe?error=payment_not_found`);
    }

    const status = await checkPhonePeStatus(intent.phonePeMerchantTxnId);

    if (status.success) {
      const result = await materializeOrderFromIntent(intent.id, {
        phonePeMerchantTxnId: intent.phonePeMerchantTxnId,
        phonePeTransactionId: status.transactionId,
      });

      if (!result.ok) {
        // Sold-out race after payment captured. The helper has
        // materialised a CANCELLED audit row carrying the captured
        // payment info; land the customer on a page that surfaces
        // the refund-required state.
        return NextResponse.redirect(
          `${origin}/cafe?error=sold_out_refund_required`,
        );
      }

      return NextResponse.redirect(
        `${origin}/cafe/confirmation/${result.orderId}`,
      );
    }

    // Payment failed at PhonePe — drop the intent so it doesn't
    // linger and bounce the customer back to /cafe with a status
    // code.
    await deleteCafePaymentIntent(intent.id);
    return NextResponse.redirect(
      `${origin}/cafe?error=payment_${status.state.toLowerCase()}`,
    );
  } catch (error) {
    console.error("PhonePe cafe redirect error:", error);
    return NextResponse.redirect(`${origin}/cafe?error=payment_failed`);
  }
}
