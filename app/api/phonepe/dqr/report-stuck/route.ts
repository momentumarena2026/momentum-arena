import { NextRequest, NextResponse } from "next/server";
import { getAuthUserId } from "@/lib/auth-unified";
import { qrStatus } from "@/lib/phonepe-dqr";
import { recordOrphanPayment } from "@/lib/payment-orphan";

/**
 * A customer reached a dead end with money possibly gone.
 *
 * The DQR sheet calls this when a payment window closes while the
 * customer had already opened a UPI app (or told us they'd paid) and
 * PhonePe still hasn't reported the transaction. That is exactly the
 * 2026-07-11 intent-replication shape: third-party UPI apps debit the
 * customer against an Open-Intent txn that PhonePe never matches, so
 * the status probe stays PENDING forever and no S2S callback arrives.
 *
 * We can't confirm the booking from here — PhonePe genuinely doesn't
 * know about the payment yet. What we CAN do is make sure it stops
 * being invisible: one orphan record per transaction, so it lands on
 * the admin worklist next to captured-but-unbooked gateway payments
 * instead of living only in the customer's WhatsApp message.
 *
 * Deliberately best-effort: it never fails the caller, because the
 * customer-facing message ("do NOT pay again") matters more than the
 * bookkeeping succeeding.
 */
export async function POST(request: NextRequest) {
  const userId = await getAuthUserId(request);
  const body = await request.json().catch(() => ({}));
  const transactionId =
    typeof body?.transactionId === "string" ? body.transactionId : null;
  if (!transactionId) {
    return NextResponse.json({ ok: true, reason: "no-transaction" });
  }

  // Probe once more before filing: if PhonePe has caught up in the
  // meantime, the status route's own path will confirm the booking and
  // this was a false alarm.
  let state = "UNKNOWN";
  try {
    const status = await qrStatus(transactionId);
    state = status.state;
    if (status.state === "COMPLETED") {
      return NextResponse.json({ ok: true, reason: "completed-on-recheck" });
    }
  } catch {
    /* PhonePe unreachable — file it anyway, that's the point */
  }

  console.error(
    `[dqr] customer reported a stuck payment txn=${transactionId} state=${state} surface=${
      typeof body?.surface === "string" ? body.surface : "?"
    } user=${userId ?? "anon"}`,
  );
  recordOrphanPayment({
    gateway: "PHONEPE_DQR",
    reason: "create-failed",
    userId,
    phonePeMerchantTxnId: transactionId,
    path: request.nextUrl.pathname,
  });
  return NextResponse.json({ ok: true });
}
