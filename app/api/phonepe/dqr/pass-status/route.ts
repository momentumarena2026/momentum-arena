import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isDqrConfigured, qrStatus } from "@/lib/phonepe-dqr";
import { confirmDqrPass } from "@/lib/passes";

/** Client status poll for a pass DQR purchase. On COMPLETED it
 *  materialises the UserPass (idempotent) and returns userPassId. */
export async function GET(request: NextRequest) {
  if (!isDqrConfigured()) {
    return NextResponse.json({ error: "Not available" }, { status: 503 });
  }
  const transactionId = request.nextUrl.searchParams.get("transactionId");
  if (!transactionId) {
    return NextResponse.json({ error: "Missing transactionId" }, { status: 400 });
  }

  // Fast path: callback already materialised the pass.
  const intent = await db.passPurchaseIntent.findUnique({
    where: { phonePeMerchantTxnId: transactionId },
    select: { consumedUserPassId: true },
  });
  if (intent?.consumedUserPassId) {
    return NextResponse.json({ state: "COMPLETED", userPassId: intent.consumedUserPassId });
  }

  try {
    const status = await qrStatus(transactionId);
    if (status.state === "COMPLETED") {
      const res = await confirmDqrPass(
        transactionId,
        status.providerReferenceId,
        status.amount,
      );
      return NextResponse.json({
        state: res.userPassId ? "COMPLETED" : "PENDING",
        userPassId: res.userPassId,
      });
    }
    return NextResponse.json({ state: status.state });
  } catch (error) {
    console.error("[dqr] pass status poll error", error);
    return NextResponse.json({ state: "PENDING" });
  }
}
