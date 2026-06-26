import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isDqrConfigured, qrStatus } from "@/lib/phonepe-dqr";
import { confirmDqrCafe } from "@/lib/dqr-confirm";

/**
 * Client status poll for a cafe DQR payment. On COMPLETED it
 * materialises the order from the intent (idempotent) and returns the
 * orderId so the client can route to /cafe/confirmation/[orderId].
 *
 * GET /api/phonepe/dqr/cafe-status?transactionId=...
 */
export async function GET(request: NextRequest) {
  if (!isDqrConfigured()) {
    return NextResponse.json({ error: "Not available" }, { status: 503 });
  }

  const transactionId = request.nextUrl.searchParams.get("transactionId");
  if (!transactionId) {
    return NextResponse.json({ error: "Missing transactionId" }, { status: 400 });
  }

  // Fast path: callback already materialised the order.
  const intent = await db.cafePaymentIntent.findUnique({
    where: { phonePeMerchantTxnId: transactionId },
    select: { consumedOrderId: true },
  });
  if (intent?.consumedOrderId) {
    return NextResponse.json({
      state: "COMPLETED",
      orderId: intent.consumedOrderId,
    });
  }

  try {
    const status = await qrStatus(transactionId);
    if (status.state === "COMPLETED") {
      const result = await confirmDqrCafe(
        transactionId,
        status.providerReferenceId,
      );
      return NextResponse.json({
        state: result.orderId ? "COMPLETED" : "PENDING",
        orderId: result.orderId,
        error: result.error,
      });
    }
    return NextResponse.json({ state: status.state });
  } catch (error) {
    console.error("[dqr] cafe status poll error", error);
    return NextResponse.json({ state: "PENDING" });
  }
}
