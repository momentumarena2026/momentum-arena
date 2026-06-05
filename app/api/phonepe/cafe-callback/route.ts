import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  checkPhonePeStatus,
  verifyPhonePeWebhook,
  type PhonePeWebhookBody,
} from "@/lib/phonepe";
import { materializeOrderFromIntent } from "@/lib/cafe-intent";

/**
 * PhonePe v2 server-to-server webhook for cafe orders. Same wire
 * format as the booking-side counterpart (see
 * app/api/phonepe/callback/route.ts for the long-form auth
 * rationale).
 *
 * The intent-flow shape: we don't have a CafeOrder yet when this
 * fires — only a CafePaymentIntent. Look up the intent by the
 * phonePeMerchantTxnId, materialise the order, mark intent
 * consumed. The redirect handler runs the same logic for the
 * user-facing return path; one will win the race and the other
 * idempotently no-ops via the `consumedAt` check inside the
 * materialise helper.
 */
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    if (!verifyPhonePeWebhook(authHeader)) {
      console.warn("PhonePe cafe webhook: auth header mismatch");
      return NextResponse.json({ success: false }, { status: 401 });
    }

    const body = (await request.json()) as PhonePeWebhookBody;
    const merchantOrderId = body.payload?.merchantOrderId;
    if (!merchantOrderId) {
      return NextResponse.json({ success: false }, { status: 400 });
    }

    // Defence-in-depth: re-check status server-side rather than
    // trusting the webhook body verbatim.
    const status = await checkPhonePeStatus(merchantOrderId);
    if (!status.success) {
      return NextResponse.json({ success: true });
    }

    const intent = await db.cafePaymentIntent.findUnique({
      where: { phonePeMerchantTxnId: merchantOrderId },
    });
    if (!intent || intent.consumedAt) {
      // Either no matching intent (sweeper cleaned up an abandoned
      // checkout) or already consumed (redirect handler beat us
      // here). Both are no-ops.
      return NextResponse.json({ success: true });
    }

    try {
      await materializeOrderFromIntent(intent.id, {
        phonePeMerchantTxnId: merchantOrderId,
        phonePeTransactionId: status.transactionId,
      });
    } catch (materialiseErr) {
      console.error(
        "[phonepe-cafe-callback] materialise failed for",
        intent.id,
        materialiseErr,
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("PhonePe cafe callback error:", error);
    return NextResponse.json({ success: true });
  }
}
