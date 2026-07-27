import { NextRequest, NextResponse } from "next/server";
import { getAuthUserId } from "@/lib/auth-unified";
import { db } from "@/lib/db";
import { isDqrConfigured, qrInit, intentInit } from "@/lib/phonepe-dqr";
import { onlinePayable } from "@/lib/tournament-config";

const DQR_TTL_MINUTES = 15;

/**
 * Generate a PhonePe Dynamic QR for a tournament entry fee. The
 * PENDING_PAYMENT TournamentTeam row (created by /api/tournaments/register)
 * is the money-first anchor: its paymentRef carries the merchant txn until
 * the status poll / S2S callback confirms it. Mirrors pass-initiate.
 * Unified auth (web cookie or mobile bearer); captain-only.
 */
export async function POST(request: NextRequest) {
  const userId = await getAuthUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  }
  if (!isDqrConfigured()) {
    return NextResponse.json(
      { error: "UPI QR payments are not available right now" },
      { status: 503 }
    );
  }
  const { teamId } = await request.json().catch(() => ({}));
  if (!teamId) return NextResponse.json({ error: "Missing teamId" }, { status: 400 });

  const team = await db.tournamentTeam.findUnique({
    where: { id: teamId },
    select: {
      id: true,
      status: true,
      captainUserId: true,
      discount: true,
      tournament: {
        select: { name: true, entryFee: true, feeMode: true, advancePct: true },
      },
    },
  });
  if (!team || team.captainUserId !== userId) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }
  if (team.status !== "PENDING_PAYMENT") {
    return NextResponse.json({ error: "This registration isn't awaiting payment" }, { status: 400 });
  }

  // Server-side amount — never from the client.
  const netFee = Math.max(0, team.tournament.entryFee - team.discount);
  const payable = onlinePayable(netFee, team.tournament.feeMode, team.tournament.advancePct);
  if (payable <= 0) {
    return NextResponse.json({ error: "Nothing to pay" }, { status: 400 });
  }

  try {
    // < 35 chars: "DQRT_" (5) + 12 + "_" (1) + 13-digit ms = 31.
    const transactionId = `DQRT_${team.id.slice(-12)}_${Date.now()}`;

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
      message: `Tournament — ${team.tournament.name}`,
    });

    await db.tournamentTeam.update({
      where: { id: team.id },
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
    console.error("[dqr] tournament initiate failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to generate QR" },
      { status: 500 }
    );
  }
}
