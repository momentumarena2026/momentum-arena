import { NextRequest, NextResponse } from "next/server";
import { getAuthUserId } from "@/lib/auth-unified";
import { db } from "@/lib/db";
import { isDqrConfigured, qrInit, intentInit } from "@/lib/phonepe-dqr";
import { areCampsEnabled } from "@/lib/camps";

const DQR_TTL_MINUTES = 15;

/**
 * Generate a PhonePe Dynamic QR for a camp fee. The PENDING_PAYMENT
 * CampRegistration is the money-first anchor: its paymentRef carries the
 * merchant txn until the status poll / S2S callback confirms it. Mirrors
 * tournament-initiate. Unified auth (web cookie or mobile bearer).
 */
export async function POST(request: NextRequest) {
  const userId = await getAuthUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  }
  if (!isDqrConfigured() || !(await areCampsEnabled())) {
    return NextResponse.json(
      { error: "UPI QR payments are not available right now" },
      { status: 503 },
    );
  }
  const { registrationId } = await request.json().catch(() => ({}));
  if (!registrationId) {
    return NextResponse.json({ error: "Missing registrationId" }, { status: 400 });
  }

  const reg = await db.campRegistration.findUnique({
    where: { id: registrationId },
    select: {
      id: true,
      status: true,
      userId: true,
      dueAmount: true,
      paidAmount: true,
      camp: { select: { name: true, fee: true, feeMode: true, advancePct: true } },
    },
  });
  if (!reg || (reg.userId && reg.userId !== userId)) {
    return NextResponse.json({ error: "Registration not found" }, { status: 404 });
  }
  if (reg.status !== "PENDING_PAYMENT") {
    return NextResponse.json(
      { error: "This registration isn't awaiting payment" },
      { status: 400 },
    );
  }

  // Server-side amount — never from the client. The advance split is
  // whatever the camp is configured for; anything already paid is
  // deducted so a retry never re-charges the same money.
  const gross =
    reg.camp.feeMode === "ADVANCE"
      ? Math.round((reg.camp.fee * reg.camp.advancePct) / 100)
      : reg.camp.fee;
  const payable = Math.max(0, gross - reg.paidAmount);
  if (payable <= 0) {
    return NextResponse.json({ error: "Nothing to pay" }, { status: 400 });
  }

  try {
    // < 35 chars: "DQRC_" (5) + 12 + "_" (1) + 13-digit ms = 31.
    const transactionId = `DQRC_${reg.id.slice(-12)}_${Date.now()}`;

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
      amountPaise: payable * 100,
      expiresIn: DQR_TTL_MINUTES * 60,
      callbackUrl: `${origin}/api/phonepe/dqr-callback`,
      message: `Camp — ${reg.camp.name}`,
    });

    await db.campRegistration.update({
      where: { id: reg.id },
      data: { paymentRef: transactionId },
    });

    return NextResponse.json({
      qrString: result.qrString,
      qrImage: result.qrImage,
      mode: useIntent ? "intent" : "qr",
      transactionId,
      expiresIn: DQR_TTL_MINUTES * 60,
      amount: payable,
    });
  } catch (error) {
    console.error("[dqr] camp initiate failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to generate QR" },
      { status: 500 },
    );
  }
}
