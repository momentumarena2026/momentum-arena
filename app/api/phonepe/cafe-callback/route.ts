import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  checkPhonePeStatus,
  verifyPhonePeWebhook,
  type PhonePeWebhookBody,
} from "@/lib/phonepe";

/**
 * PhonePe v2 server-to-server webhook for cafe orders.
 * See app/api/phonepe/callback/route.ts for the booking-side
 * counterpart and a longer comment on the auth/payload shape — this
 * route is the same wire format with cafe-specific persistence.
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

    // Server-side status verification (defense in depth — see
    // booking callback for the longer rationale).
    const status = await checkPhonePeStatus(merchantOrderId);
    if (!status.success) {
      return NextResponse.json({ success: true });
    }

    const payment = await db.cafePayment.findFirst({
      where: { phonePeMerchantTxnId: merchantOrderId },
    });
    if (!payment || payment.status === "COMPLETED") {
      // Either the cafe payment is missing (stale webhook) or
      // already completed (PhonePe retry). Both are no-ops.
      return NextResponse.json({ success: true });
    }

    await db.cafePayment.update({
      where: { id: payment.id },
      data: {
        status: "COMPLETED",
        phonePeTransactionId: status.transactionId,
        confirmedAt: new Date(),
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("PhonePe cafe callback error:", error);
    return NextResponse.json({ success: true });
  }
}
