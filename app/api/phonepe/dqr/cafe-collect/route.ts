import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isDqrConfigured, collectInit } from "@/lib/phonepe-dqr";

const DQR_TTL_MINUTES = 15;

/** UPI VPA shape: handle@psp (NPCI allows . - _ in the handle). */
const VPA_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{1,}@[a-zA-Z]{2,}$/;

/**
 * "Pay with UPI ID" for a cafe order: send a UPI COLLECT request to the
 * customer's VPA. Mirrors /api/phonepe/dqr/cafe-initiate — stamps the
 * CafePaymentIntent with the transactionId so the existing cafe-status
 * poll + S2S callback materialise the order on approval.
 */
export async function POST(request: NextRequest) {
  if (!isDqrConfigured()) {
    return NextResponse.json(
      { error: "UPI payments are not available right now" },
      { status: 503 },
    );
  }

  const { orderId, vpa } = await request.json();
  if (!orderId) {
    return NextResponse.json({ error: "Missing orderId" }, { status: 400 });
  }
  const cleanVpa = typeof vpa === "string" ? vpa.trim().toLowerCase() : "";
  if (!VPA_RE.test(cleanVpa)) {
    return NextResponse.json(
      { error: "That doesn't look like a valid UPI ID (e.g. name@bank)" },
      { status: 400 },
    );
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
    const transactionId = `DQRC_${intent.id.slice(-12)}_${Date.now()}`;
    const fwdHost =
      request.headers.get("x-forwarded-host") || request.headers.get("host");
    const fwdProto = request.headers.get("x-forwarded-proto") || "https";
    const origin =
      request.headers.get("origin") ||
      (fwdHost ? `${fwdProto}://${fwdHost}` : process.env.NEXTAUTH_URL) ||
      "http://localhost:3000";

    await collectInit({
      transactionId,
      amountPaise: Math.round(intent.totalAmount * 100),
      expiresIn: DQR_TTL_MINUTES * 60,
      callbackUrl: `${origin}/api/phonepe/dqr-callback`,
      vpa: cleanVpa,
      message: `CafeOrder-${Math.round(intent.totalAmount)}`,
    });

    await db.cafePaymentIntent.update({
      where: { id: intent.id },
      data: { phonePeMerchantTxnId: transactionId },
    });

    return NextResponse.json({
      transactionId,
      expiresIn: DQR_TTL_MINUTES * 60,
      amount: intent.totalAmount,
    });
  } catch {
    return NextResponse.json(
      {
        error:
          "Couldn't send a payment request to that UPI ID — check the ID, or pay via an app / scan the QR instead.",
      },
      { status: 502 },
    );
  }
}
