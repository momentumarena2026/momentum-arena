import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { initiatePhonePePayment } from "@/lib/phonepe";

/**
 * Initiate a PhonePe payment for a CafePaymentIntent. The intent
 * id arrives as `orderId` for client backwards-compat — it's the
 * intent id from createCafeOrder's online-path response. We stamp
 * the PhonePe merchantOrderId on the intent so callback / redirect
 * can look it up.
 *
 * No CafeOrder + no CafePayment row are created yet. The order +
 * payment rows are materialised by the cafe-callback / cafe-redirect
 * handler once PhonePe confirms.
 */
export async function POST(request: NextRequest) {
  const { orderId } = await request.json();
  if (!orderId) {
    return NextResponse.json({ error: "Missing orderId" }, { status: 400 });
  }

  const intent = await db.cafePaymentIntent.findUnique({
    where: { id: orderId },
  });
  if (!intent) {
    return NextResponse.json(
      { error: "Checkout session expired — please start again" },
      { status: 404 },
    );
  }
  if (intent.consumedAt) {
    return NextResponse.json(
      { error: "This checkout was already completed" },
      { status: 409 },
    );
  }

  try {
    // v2 merchantOrderId — same shape as the booking initiate
    // route. CAFE_ prefix so PhonePe's dashboard separates the
    // two streams.
    const merchantOrderId = `CAFE_${intent.id.slice(-12)}_${Date.now()}`;
    const origin =
      request.headers.get("origin") ||
      process.env.NEXTAUTH_URL ||
      "http://localhost:3000";

    // PhonePe wants paise; CafePaymentIntent.totalAmount is rupees
    // (Float). Round at the gateway boundary so 99.50 → 9950, never
    // a non-integer paise value PhonePe would reject.
    const amountPaise = Math.round(intent.totalAmount * 100);

    const result = await initiatePhonePePayment({
      merchantOrderId,
      amount: amountPaise,
      // Redirect carries the intent id so the handler can
      // materialise the order once we know the gateway state.
      redirectUrl: `${origin}/api/phonepe/cafe-redirect?intentId=${intent.id}`,
      message: `Café order — ₹${intent.totalAmount.toLocaleString("en-IN")}`,
    });

    await db.cafePaymentIntent.update({
      where: { id: intent.id },
      data: { phonePeMerchantTxnId: merchantOrderId },
    });

    return NextResponse.json({ redirectUrl: result.redirectUrl });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to initiate payment",
      },
      { status: 500 },
    );
  }
}
