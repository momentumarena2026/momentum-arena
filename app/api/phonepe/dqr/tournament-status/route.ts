import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isDqrConfigured, qrStatus } from "@/lib/phonepe-dqr";
import { confirmDqrTournament } from "@/lib/tournaments";

/** Client status poll for a tournament-entry DQR payment. On COMPLETED it
 *  confirms the team (idempotent — the S2S callback may have won). */
export async function GET(request: NextRequest) {
  if (!isDqrConfigured()) {
    return NextResponse.json({ error: "Not available" }, { status: 503 });
  }
  const transactionId = request.nextUrl.searchParams.get("transactionId");
  if (!transactionId) {
    return NextResponse.json({ error: "Missing transactionId" }, { status: 400 });
  }

  // Fast path: callback already confirmed the team.
  const team = await db.tournamentTeam.findFirst({
    where: { paymentRef: transactionId },
    select: { id: true, status: true },
  });
  if (team?.status === "CONFIRMED") {
    return NextResponse.json({ state: "COMPLETED", teamId: team.id });
  }

  try {
    const status = await qrStatus(transactionId);
    if (status.state === "COMPLETED") {
      const res = await confirmDqrTournament(
        transactionId,
        status.providerReferenceId,
        status.amount
      );
      if (res.mismatch) {
        return NextResponse.json({
          state: "FAILED",
          paymentReceived: true,
          error:
            "Payment received, but we couldn't auto-confirm your team. Do NOT pay again — our team will confirm your spot shortly.",
        });
      }
      return NextResponse.json({
        state: res.teamId ? "COMPLETED" : "PENDING",
        teamId: res.teamId,
      });
    }
    return NextResponse.json({ state: status.state });
  } catch (error) {
    console.error("[dqr] tournament status poll error", error);
    return NextResponse.json({ state: "PENDING" });
  }
}
