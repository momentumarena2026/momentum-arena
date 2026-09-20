import { NextResponse } from "next/server";
import { sendOfferReminders, expireOffers } from "@/lib/challenge-spin";

/**
 * Cron worker — nudges live prize offers and closes out the dead ones.
 *
 * The money sweeps used to run here too. They were split into
 * `/api/cron/challenge-money` because the two halves want different clocks:
 * the money sweeps have grace periods measured in minutes and are happy on a
 * coarse tick, while a prize offer's last-call nudge is the one that
 * converts and wants the finest schedule it can get. Sharing one route meant
 * one pass doing all five, taking 46–177 seconds, and quietly overrunning
 * the caller's 90-second timeout on a busy board.
 *
 * Both halves here are idempotent by construction: each nudge records its
 * marker on the offer, and expiry only touches offers already past their
 * deadline. An overlapping run, a retry or a manual dispatch cannot
 * double-send or double-close.
 *
 * Auth: Bearer CRON_SECRET, and it REFUSES when the secret is unset rather
 * than running open, like every other cron route here.
 */

// Runs EVERY MINUTE, and the reason is arithmetic rather than taste: the
// last-call nudge fires at 5 minutes left, so on a five-minute tick it can
// fall between ticks and never be sent at all — the previous tick sees 5.x
// minutes remaining and the next sees an offer already expired. A one-minute
// tick is what this half was separated out to get; it costs about a second a
// run because it is two narrow queries over live offers.
//
// The ceiling below is insurance against a backlog after an outage.
export const maxDuration = 120;

async function handle(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();

  // Nudge BEFORE expiring, so an offer in its final minute still gets its
  // last call rather than being closed out in the same tick.
  const nudged = await sendOfferReminders(now).catch((e) => {
    console.error("[challenge-offers] reminders failed:", e);
    return 0;
  });
  const lapsed = await expireOffers(now).catch((e) => {
    console.error("[challenge-offers] expiry failed:", e);
    return 0;
  });

  return NextResponse.json({ ok: true, nudged, lapsed });
}

export const GET = handle;
export const POST = handle;
