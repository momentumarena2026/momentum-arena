import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { isDqrConfigured, qrInit, intentInit } from "@/lib/phonepe-dqr";
import { arePassesEnabled, parseStartDate } from "@/lib/passes";

const DQR_TTL_MINUTES = 15;

/**
 * Generate a PhonePe Dynamic QR for a PASS purchase. Money-first: a
 * PassPurchaseIntent row holds planId+userId+txn; the UserPass is only
 * materialised on the status poll / S2S callback. Mirrors cafe-initiate.
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Sign in to buy a pass" }, { status: 401 });
  }
  if (!isDqrConfigured()) {
    return NextResponse.json(
      { error: "UPI QR payments are not available right now" },
      { status: 503 },
    );
  }
  if (!(await arePassesEnabled())) {
    return NextResponse.json({ error: "Passes aren't available" }, { status: 403 });
  }

  const { planId, startDate } = await request.json().catch(() => ({}));
  if (!planId) {
    return NextResponse.json({ error: "Missing planId" }, { status: 400 });
  }
  const plan = await db.passPlan.findUnique({ where: { id: planId } });
  if (!plan || !plan.isActive) {
    return NextResponse.json({ error: "Plan not available" }, { status: 404 });
  }

  try {
    const intent = await db.passPurchaseIntent.create({
      data: {
        planId,
        userId: session.user.id,
        startsAt: parseStartDate(startDate),
      },
    });
    // < 35 chars: "DQRP_" (5) + 12 + "_" (1) + 13-digit ms = 31.
    const transactionId = `DQRP_${intent.id.slice(-12)}_${Date.now()}`;

    const fwdHost =
      request.headers.get("x-forwarded-host") || request.headers.get("host");
    const fwdProto = request.headers.get("x-forwarded-proto") || "https";
    const origin =
      request.headers.get("origin") ||
      (fwdHost ? `${fwdProto}://${fwdHost}` : process.env.NEXTAUTH_URL) ||
      "http://localhost:3000";

    const cfg = await db.paymentGatewayConfig.findUnique({
      where: { id: "singleton" },
      select: { intentEnabled: true },
    });
    const useIntent = !!cfg?.intentEnabled;
    const generate = useIntent ? intentInit : qrInit;
    const result = await generate({
      transactionId,
      amountPaise: plan.price * 100,
      expiresIn: DQR_TTL_MINUTES * 60,
      callbackUrl: `${origin}/api/phonepe/dqr-callback`,
      message: `Pass — ${plan.name}`,
    });

    await db.passPurchaseIntent.update({
      where: { id: intent.id },
      data: { phonePeMerchantTxnId: transactionId },
    });

    return NextResponse.json({
      qrString: result.qrString,
      qrImage: result.qrImage,
      mode: useIntent ? "intent" : "qr",
      transactionId,
      expiresIn: DQR_TTL_MINUTES * 60,
      amount: plan.price,
    });
  } catch (error) {
    console.error("[dqr] pass initiate failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to generate QR" },
      { status: 500 },
    );
  }
}
