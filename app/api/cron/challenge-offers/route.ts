import { NextResponse } from "next/server";
import { sendOfferReminders, expireOffers } from "@/lib/challenge-spin";
import { announceNewChallenges } from "@/lib/challenges";

/**
 * Cron worker — nudges live prize offers and closes out the dead ones.
 *
 * The money sweeps used to run here too. They were split into
 * `/api/cron/challenge-money` because sharing one route meant one pass doing
 * all five, taking 46–177 seconds, and quietly overrunning the caller's
 * 90-second timeout on a busy board.
 *
 * ── THIS WANTS A FINE SCHEDULE AND IS DELIBERATELY NOT GETTING ONE ───
 * A prize offer's last-call nudge is the one that converts, and offers
 * expire in MINUTES, so this route genuinely wants the finest tick it can
 * get. It ran `* * * * *` from 2026-09-20 for exactly that reason.
 *
 * It is hourly now, on purpose, because the feature has never been used:
 * `ChallengeOffer` has had ZERO rows in its entire life, and no Challenge
 * has been created in thirty days. So 43,200 runs a month found nothing,
 * every time — and because Neon suspends an idle compute only after five
 * minutes, a query every sixty seconds meant the production database never
 * slept. That was most of a doubled Neon bill, paid entirely for a table
 * that is empty.
 *
 * Note this is still EIGHT TIMES more often than the schedule actually
 * delivered before 2026-09-20, when it sat on GitHub Actions getting ~7
 * runs a day. Nobody noticed, because there was nothing to find.
 *
 * ⚠ WHEN CHALLENGES ACTUALLY LAUNCH, PUT THIS BACK TO A FIVE-MINUTE TICK
 * (or finer) in vercel.json and accept the compute cost — an offer that expires
 * in ten minutes cannot be nudged by an hourly sweep. The cost is roughly
 * £/$20 a month; the trade is a real one, and it should be made knowingly
 * rather than inherited. docs/NEON-COMPUTE-COST.md has the arithmetic.
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

  // The board broadcast rides this tick rather than the post itself, so a
  // fan-out to every phone with the app can never slow down — or fail —
  // the customer tapping "Post". It claims each challenge before sending,
  // so an overlapping run cannot announce the same match twice.
  const announced = await announceNewChallenges(now).catch((e) => {
    console.error("[challenge-offers] announce failed:", e);
    return 0;
  });

  // Logged, not just returned. A broadcast that reached nobody and a sweep
  // that never ran are the same empty response otherwise, and this module
  // has already been bitten once by a silent sender.
  if (announced > 0) console.log(`[challenge-offers] announced=${announced}`);

  return NextResponse.json({ ok: true, nudged, lapsed, announced });
}

export const GET = handle;
export const POST = handle;
