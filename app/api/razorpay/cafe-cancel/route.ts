import { NextRequest, NextResponse } from "next/server";
import { getAuthUserId } from "@/lib/auth-unified";
import { db } from "@/lib/db";
import { deleteCafePaymentIntent } from "@/lib/cafe-intent";

/**
 * Cancel a checkout intent — called when the customer dismisses
 * the Razorpay modal without paying, or when the gateway reports
 * payment.failed. No CafeOrder exists yet at this point (the new
 * flow only creates one on verified payment), so cancellation is
 * just an intent delete. The CafeOrder table never sees these
 * abandoned checkouts.
 *
 * Idempotent + safe: tolerates a missing intent (already deleted
 * by sweeper, duplicate cancel call, etc).
 */
export async function POST(request: NextRequest) {
  const userId = await getAuthUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { orderId } = await request.json();
  if (!orderId) {
    return NextResponse.json({ error: "Missing orderId" }, { status: 400 });
  }

  // Ownership check before deletion. A missing intent → no-op
  // success (already gone).
  const intent = await db.cafePaymentIntent.findUnique({
    where: { id: orderId },
    select: { userId: true, consumedAt: true },
  });
  if (!intent) {
    return NextResponse.json({ success: true, alreadyGone: true });
  }
  if (intent.userId && intent.userId !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (intent.consumedAt) {
    // Payment already verified between dismiss and this call —
    // refuse the cancel; the order is real now.
    return NextResponse.json(
      { error: "Payment already completed — contact venue for refund" },
      { status: 409 },
    );
  }

  await deleteCafePaymentIntent(orderId);
  return NextResponse.json({ success: true });
}
