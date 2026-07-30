import { NextRequest, NextResponse } from "next/server";
import { qrStatus } from "@/lib/phonepe-dqr";
import { confirmDqrBooking } from "@/lib/dqr-confirm";
import {
  AnalyticsCategory,
  logServerAction,
  resolveRequestPlatform,
} from "@/lib/server-log";

/**
 * Ask PhonePe a few times before concluding a payment hasn't settled.
 *
 * A single probe races the gateway: UPI settlement commonly lands a few
 * seconds after the customer returns to the browser, so one PENDING
 * answer is weak evidence. Polling briefly resolves most "stuck"
 * payments outright, which is always better than parking one in a queue
 * for a human — the manual path should be the last resort, not the
 * first response.
 *
 * Bounded deliberately: the customer is watching a spinner, so this
 * trades a few seconds for a large share of claims that never need to
 * be reviewed at all.
 */
export async function probeUntilSettled(
  transactionId: string,
  attempts = 4,
  delayMs = 1800,
): Promise<{ state: string; providerReferenceId?: string; amount?: number }> {
  // `amount` (paise) is carried through because the price-check callers —
  // confirmDqrPass in particular — need it, and dropping it forced them
  // into a second qrStatus round trip on top of this one.
  let last: { state: string; providerReferenceId?: string; amount?: number } = {
    state: "UNKNOWN",
  };
  for (let i = 0; i < attempts; i++) {
    try {
      const status = await qrStatus(transactionId);
      last = {
        state: status.state,
        providerReferenceId: status.providerReferenceId,
        amount: status.amount,
      };
      // COMPLETED and FAILED are both terminal — no point waiting.
      if (status.state !== "PENDING") return last;
    } catch {
      // Transient gateway error; keep trying within the budget.
    }
    if (i < attempts - 1) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return last;
}

/**
 * Decide what to do about a DQR transaction already attached to a hold,
 * BEFORE minting another one.
 *
 * `SlotHold.phonePeMerchantTxnId` is the only pointer from a PhonePe
 * transaction back to its hold — `confirmDqrBooking` resolves by it.
 * Overwriting it therefore doesn't just risk a duplicate charge, it
 * makes the earlier payment **unrecoverable**: no booking, no Payment
 * row, and not even an orphan record, because the orphan net itself
 * runs inside confirmDqrBooking and can no longer find the hold. The
 * money survives only in a server-action log line.
 *
 * That is the shape of the 2026-07-11 intent incident, where PhonePe
 * leaves a genuinely-paid intent transaction PENDING indefinitely: the
 * customer retries, we overwrite, and their money goes dark.
 *
 * So:
 *  - COMPLETED → confirm THAT booking and hand it back (never a second QR).
 *  - PENDING   → refuse to mint. Return the existing transaction so the
 *                client resumes polling it; the pointer stays intact.
 *  - FAILED / EXPIRED / unreachable → caller may safely mint a new one.
 *
 * Returns a response to send, or null to continue with a fresh mint.
 */
export async function settlePriorDqrTxn(args: {
  transactionId: string;
  holdId: string;
  userId: string;
  request: NextRequest;
}): Promise<NextResponse | null> {
  const { transactionId, holdId, userId, request } = args;
  let state: string;
  let providerReferenceId: string | undefined;
  try {
    const prior = await qrStatus(transactionId);
    state = prior.state;
    providerReferenceId = prior.providerReferenceId;
  } catch {
    // PhonePe unreachable — don't strand the customer; minting again is
    // the lesser risk when we can't read the prior state at all.
    return null;
  }

  if (state === "COMPLETED") {
    const confirmed = await confirmDqrBooking(transactionId, providerReferenceId);
    if (confirmed.bookingId) {
      logServerAction({
        userId,
        category: AnalyticsCategory.PAYMENT,
        action: "payment.dqr.already-paid",
        outcome: "success",
        path: request.nextUrl.pathname,
        method: "POST",
        platform: resolveRequestPlatform(request),
        metadata: { holdId, transactionId, bookingId: confirmed.bookingId },
      });
      return NextResponse.json({
        alreadyPaid: true,
        bookingId: confirmed.bookingId,
      });
    }
    // COMPLETED but unbookable (slot gone) — confirmDqrBooking has
    // already filed the orphan. Say so rather than selling it again.
    return NextResponse.json(
      {
        error:
          "We received your payment but couldn't confirm this booking. Please do NOT pay again — our team will confirm or refund you shortly.",
        paymentReceived: true,
      },
      { status: 409 },
    );
  }

  if (state === "PENDING") {
    // Keep the pointer. PhonePe may still settle this, and if it does,
    // the callback/poll needs the hold to still be reachable from it.
    logServerAction({
      userId,
      category: AnalyticsCategory.PAYMENT,
      action: "payment.dqr.in-flight",
      outcome: "success",
      path: request.nextUrl.pathname,
      method: "POST",
      platform: resolveRequestPlatform(request),
      metadata: { holdId, transactionId },
    });
    return NextResponse.json({
      pendingTxn: true,
      transactionId,
      error:
        "A payment on this booking is still being confirmed. If you've already paid, please do NOT pay again — we're checking with your bank.",
    });
  }

  return null; // FAILED / EXPIRED — safe to mint a fresh transaction.
}

/**
 * Tournament-entry twin of settlePriorDqrTxn.
 *
 * `TournamentTeam.paymentRef` is the ONLY pointer from a PhonePe
 * transaction back to the team — confirmDqrTournament resolves by it.
 * Overwriting it on a re-initiate makes an earlier payment unrecoverable
 * for exactly the reasons documented above for bookings, so the same
 * rules apply before minting a second QR for one team:
 *
 *  - COMPLETED → confirm THAT entry and hand it back (never a second QR).
 *  - PENDING   → refuse to mint; keep the pointer and let the client
 *                resume polling the existing transaction.
 *  - FAILED / EXPIRED / unreachable → caller may mint a fresh one.
 */
export async function settlePriorTournamentDqrTxn(args: {
  transactionId: string;
  teamId: string;
  userId: string;
  request: NextRequest;
}): Promise<NextResponse | null> {
  const { transactionId, teamId, userId, request } = args;
  let state: string;
  let providerReferenceId: string | undefined;
  let amount: number | undefined;
  try {
    const prior = await qrStatus(transactionId);
    state = prior.state;
    providerReferenceId = prior.providerReferenceId;
    amount = prior.amount;
  } catch {
    return null; // gateway unreachable — minting again is the lesser risk
  }

  if (state === "COMPLETED") {
    const { confirmDqrTournament } = await import("@/lib/tournaments");
    const confirmed = await confirmDqrTournament(transactionId, providerReferenceId, amount);
    logServerAction({
      userId,
      category: AnalyticsCategory.PAYMENT,
      action: "payment.dqr.already-paid",
      outcome: "success",
      path: request.nextUrl.pathname,
      method: "POST",
      platform: resolveRequestPlatform(request),
      metadata: { teamId, transactionId, confirmedTeamId: confirmed.teamId },
    });
    if (confirmed.teamId) {
      return NextResponse.json({ alreadyPaid: true, teamId: confirmed.teamId });
    }
    // Paid but unconfirmable — confirmDqrTournament has filed the orphan.
    return NextResponse.json(
      {
        error:
          "We received your payment but couldn't confirm this entry. Please do NOT pay again — our team will confirm or refund you shortly.",
        paymentReceived: true,
      },
      { status: 409 }
    );
  }

  if (state === "PENDING") {
    logServerAction({
      userId,
      category: AnalyticsCategory.PAYMENT,
      action: "payment.dqr.in-flight",
      outcome: "success",
      path: request.nextUrl.pathname,
      method: "POST",
      platform: resolveRequestPlatform(request),
      metadata: { teamId, transactionId },
    });
    return NextResponse.json({
      pendingTxn: true,
      transactionId,
      error:
        "A payment on this registration is still being confirmed. If you've already paid, please do NOT pay again — we're checking with your bank.",
    });
  }

  return null; // FAILED / EXPIRED — safe to mint a fresh transaction.
}
