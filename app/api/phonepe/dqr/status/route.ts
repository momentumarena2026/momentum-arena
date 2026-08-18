import { NextRequest, NextResponse } from "next/server";
import { getAuthUserId } from "@/lib/auth-unified";
import { db } from "@/lib/db";
import { isDqrConfigured, qrStatus } from "@/lib/phonepe-dqr";
import { confirmDqrBooking } from "@/lib/dqr-confirm";
import { AnalyticsCategory, logServerAction, resolveRequestPlatform } from "@/lib/server-log";

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

  // The poll runs every couple of seconds, so logging every call would
  // bury the log in PENDINGs and tell us nothing. Only TERMINAL and
  // unexpected outcomes are recorded — which is what a payment
  // investigation actually needs: when it settled, by which route, and
  // whether the gateway ever errored on us.
  const audit = (
    action: string,
    outcome: "success" | "error",
    metadata: Record<string, unknown>,
    error?: string,
  ) =>
    logServerAction({
      userId,
      action,
      category: AnalyticsCategory.PAYMENT,
      outcome,
      path: request.nextUrl.pathname,
      method: "GET",
      platform: resolveRequestPlatform(request),
      metadata: { transactionId, ...metadata },
      error,
    });

  // Fast path: callback already created the booking.
  const existing = await db.payment.findFirst({
    where: { phonePeMerchantTxnId: transactionId },
    select: { bookingId: true },
  });
  if (existing) {
    // Settled by the S2S callback before the customer's poll caught up —
    // the healthy path, and worth being able to count against the poll
    // path below when judging whether callbacks are arriving.
    audit("payment.dqr.status", "success", {
      state: "COMPLETED",
      settledBy: "callback",
      bookingId: existing.bookingId,
    });
    return NextResponse.json({ state: "COMPLETED", bookingId: existing.bookingId });
  }

  try {
    const status = await qrStatus(transactionId);
    if (status.state === "COMPLETED") {
      const result = await confirmDqrBooking(
        transactionId,
        status.providerReferenceId,
      );
      // Settled by the POLL, meaning the callback hadn't landed yet. A
      // rising share of these is the early warning that S2S callbacks are
      // failing and we are only getting paid because the customer's phone
      // happened to still be open.
      audit("payment.dqr.status", "success", {
        state: "COMPLETED",
        settledBy: "poll",
        bookingId: result.bookingId,
        providerReferenceId: status.providerReferenceId ?? null,
      });
      return NextResponse.json({
        state: "COMPLETED",
        bookingId: result.bookingId,
      });
    }
    if (status.state !== "PENDING") {
      audit("payment.dqr.status", "error", { state: status.state });
    }
    return NextResponse.json({ state: status.state });
  } catch (error) {
    // Don't fail the poll loop on a transient status error — report
    // PENDING so the client keeps polling (or the callback lands).
    console.error("[dqr] status poll error", error);
    audit(
      "payment.dqr.status_error",
      "error",
      { state: "PENDING" },
      error instanceof Error ? error.message : "status lookup failed",
    );
    return NextResponse.json({ state: "PENDING" });
  }
}
