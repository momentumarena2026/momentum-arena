import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isDqrConfigured, qrStatus } from "@/lib/phonepe-dqr";
import { confirmDqrCamp } from "@/lib/camps";

/** Client status poll for a camp-fee DQR payment. On COMPLETED it
 *  confirms the registration (idempotent — the S2S callback may have won). */
export async function GET(request: NextRequest) {
  if (!isDqrConfigured()) {
    return NextResponse.json({ error: "Not available" }, { status: 503 });
  }
  const transactionId = request.nextUrl.searchParams.get("transactionId");
  if (!transactionId) {
    return NextResponse.json({ error: "Missing transactionId" }, { status: 400 });
  }

  // Fast path: the callback already confirmed this registration.
  const reg = await db.campRegistration.findFirst({
    where: { paymentRef: transactionId },
    select: { id: true, status: true },
  });
  if (reg?.status === "CONFIRMED") {
    return NextResponse.json({ state: "COMPLETED", registrationId: reg.id });
  }

  try {
    const status = await qrStatus(transactionId);
    if (status.state === "COMPLETED") {
      const res = await confirmDqrCamp(
        transactionId,
        status.providerReferenceId,
        status.amount,
      );
      if (res.mismatch) {
        return NextResponse.json({
          state: "FAILED",
          paymentReceived: true,
          error:
            "Payment received, but we couldn't auto-confirm your spot. Do NOT pay again — our team will confirm it shortly.",
        });
      }
      return NextResponse.json({
        state: res.registrationId ? "COMPLETED" : "PENDING",
        registrationId: res.registrationId,
      });
    }
    return NextResponse.json({ state: status.state });
  } catch (error) {
    console.error("[dqr] camp status poll error", error);
    return NextResponse.json({ state: "PENDING" });
  }
}
