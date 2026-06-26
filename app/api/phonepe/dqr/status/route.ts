import { NextRequest, NextResponse } from "next/server";
import { getAuthUserId } from "@/lib/auth-unified";
import { db } from "@/lib/db";
import { isDqrConfigured, qrStatus } from "@/lib/phonepe-dqr";
import { confirmDqrBooking } from "@/lib/dqr-confirm";

/**
 * Client status poll for a booking DQR payment. The S2S callback is
 * authoritative; this is the UX backup so the customer's screen flips
 * to "confirmed" promptly. On COMPLETED it confirms the booking
 * idempotently and returns the bookingId.
 *
 * GET /api/phonepe/dqr/status?transactionId=...
 */
export async function GET(request: NextRequest) {
  const userId = await getAuthUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isDqrConfigured()) {
    return NextResponse.json({ error: "Not available" }, { status: 503 });
  }

  const transactionId = request.nextUrl.searchParams.get("transactionId");
  if (!transactionId) {
    return NextResponse.json({ error: "Missing transactionId" }, { status: 400 });
  }

  // Fast path: callback already created the booking.
  const existing = await db.payment.findFirst({
    where: { phonePeMerchantTxnId: transactionId },
    select: { bookingId: true },
  });
  if (existing) {
    return NextResponse.json({ state: "COMPLETED", bookingId: existing.bookingId });
  }

  try {
    const status = await qrStatus(transactionId);
    if (status.state === "COMPLETED") {
      const result = await confirmDqrBooking(
        transactionId,
        status.providerReferenceId,
      );
      return NextResponse.json({
        state: "COMPLETED",
        bookingId: result.bookingId,
      });
    }
    return NextResponse.json({ state: status.state });
  } catch (error) {
    // Don't fail the poll loop on a transient status error — report
    // PENDING so the client keeps polling (or the callback lands).
    console.error("[dqr] status poll error", error);
    return NextResponse.json({ state: "PENDING" });
  }
}
