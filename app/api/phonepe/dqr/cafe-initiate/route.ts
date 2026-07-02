import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isDqrConfigured, qrInit, intentInit, isOpenIntentMode } from "@/lib/phonepe-dqr";

const DQR_TTL_MINUTES = 15;

/**
 * Generate a PhonePe Dynamic QR for a cafe order. Mirrors
 * /api/phonepe/cafe-initiate (gateway): operates on a CafePaymentIntent
 * (no CafeOrder yet) and stamps the DQR transactionId on it so the
 * callback/status path can materialise the order. `orderId` in the
 * body is the intent id (kept named for client parity with cafe-initiate).
 */
export async function POST(request: NextRequest) {
  if (!isDqrConfigured()) {
    return NextResponse.json(
      { error: "UPI QR payments are not available right now" },
      { status: 503 },
    );
  }

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
    // < 35 chars: "DQRC_" (5) + 12 + "_" (1) + 13-digit ms = 31.
    const transactionId = `DQRC_${intent.id.slice(-12)}_${Date.now()}`;
    // Callback base from the domain THIS request hit — dev→dev, prod→prod,
    // never a shared env that could cross-wire environments. Web sends
    // Origin; mobile doesn't, so fall back to the forwarded host Vercel
    // sets to the public domain (then NEXTAUTH_URL, then local).
    const fwdHost =
      request.headers.get("x-forwarded-host") || request.headers.get("host");
    const fwdProto = request.headers.get("x-forwarded-proto") || "https";
    const origin =
      request.headers.get("origin") ||
      (fwdHost ? `${fwdProto}://${fwdHost}` : process.env.NEXTAUTH_URL) ||
      "http://localhost:3000";

    // CafePaymentIntent.totalAmount is rupees (Float); round at the
    // gateway boundary so 99.50 → 9950 paise.
    const amountPaise = Math.round(intent.totalAmount * 100);

    const generate = isOpenIntentMode() ? intentInit : qrInit;
    const result = await generate({
      transactionId,
      amountPaise,
      expiresIn: DQR_TTL_MINUTES * 60,
      callbackUrl: `${origin}/api/phonepe/dqr-callback`,
      message: `Café order — ₹${intent.totalAmount.toLocaleString("en-IN")}`,
    });

    await db.cafePaymentIntent.update({
      where: { id: intent.id },
      data: { phonePeMerchantTxnId: transactionId },
    });

    return NextResponse.json({
      qrString: result.qrString,
      qrImage: result.qrImage,
      // "intent" -> qrString is a TAPPABLE upi:// link (Open Intent product);
      // the client shows a "Pay with UPI app" button on mobile browsers.
      // "qr" -> scan-only string; the client renders the QR alone.
      mode: isOpenIntentMode() ? "intent" : "qr",
      transactionId,
      expiresIn: DQR_TTL_MINUTES * 60,
      amount: intent.totalAmount,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to generate QR",
      },
      { status: 500 },
    );
  }
}
