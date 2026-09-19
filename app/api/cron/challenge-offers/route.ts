import { NextResponse } from "next/server";
import { sendOfferReminders, expireOffers } from "@/lib/challenge-spin";
import { resumeStalledPayments, discardChallengesWhoseHourWent } from "@/lib/challenge-payments";

/**
 * Cron worker — nudges live discount offers and closes out dead ones.
 *
 * Fired every minute, because the shortest offer the venue can configure is
 * measured in minutes and its last-call nudge is the one that converts. A
 * coarser tick would quietly turn "10 minutes left" into "we told you at
 * some point".
 *
 * Both halves are idempotent by construction: each nudge records its marker
 * on the offer, and expiry only touches offers already past their deadline.
 * So an overlapping run, a retry, or a manual dispatch cannot double-send
 * or double-close.
 *
 * Auth: the same Bearer CRON_SECRET as every other cron here.
 */
async function handle(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  // Money first. A capture is claimed before any booking work, so a request
  // that died in between left real money holding no court — and nothing else
  // retries it, because the app verifies once and the customer who returns is
  // refused by their own claimed row.
  const finished = await resumeStalledPayments(now).catch((e) => {
    console.error("[challenge-offers] stranded-payment sweep failed:", e);
    return 0;
  });
  // Then the hours somebody else has bought out from under a live challenge.
  // Nothing holds a court until both captains have paid, so this is the only
  // path by which "somebody booked your hour" reaches two captains who are not
  // currently paying — and the only one that tells the arena whose money it
  // owes when one half is already in.
  const discarded = await discardChallengesWhoseHourWent(now).catch((e) => {
    console.error("[challenge-offers] lost-hour sweep failed:", e);
    return 0;
  });
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

  return NextResponse.json({ ok: true, finished, discarded, nudged, lapsed });
}

export const GET = handle;
export const POST = handle;
