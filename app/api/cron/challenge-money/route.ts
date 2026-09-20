import { NextResponse } from "next/server";
import {
  resumeStalledPayments,
  discardChallengesWhoseHourWent,
  renotifyUntoldHalves,
} from "@/lib/challenge-payments";

/**
 * Cron worker — the three sweeps that look after CUSTOMERS' MONEY.
 *
 * Split out from the offer sweeps because the two halves want different
 * clocks and had been sharing the wrong one. This half's own grace periods
 * are two and five minutes, so a five-minute tick loses nothing real; the
 * offer half genuinely wants finer granularity, and forcing both onto a
 * once-a-minute schedule is what made the combined pass too slow to finish
 * inside the caller's timeout.
 *
 * Nothing else in the product does any of this. If this stops running:
 *
 *  - a payment captured whose request then died stays captured with no
 *    court, and the customer's own retry is refused by their claimed row;
 *  - two captains are never told that a walk-in bought the hour they were
 *    halfway through paying for, and the refund is never flagged;
 *  - a captain who was never asked for their half is never asked again.
 *
 * Every sweep is idempotent by construction — conditional claims, not reads
 * followed by writes — so overlapping runs, retries and manual dispatches
 * cannot double-book, double-flag or double-send.
 *
 * Auth: Bearer CRON_SECRET, and it REFUSES when the secret is unset rather
 * than running open. This endpoint moves money; an environment that forgot
 * to configure it should fail loudly, not quietly expose the sweeps.
 */

// Long enough for a busy board. The pass has been measured at 46–177s
// against 176 live challenges, and the default 60s would cut it off partway
// — which is survivable, because each sweep is idempotent, but it means the
// tail of the work never runs.
export const maxDuration = 300;

async function handle(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const started = Date.now();

  // A capture is claimed before any booking work, so a request that died in
  // between left real money holding no court — and nothing else retries it.
  const finished = await resumeStalledPayments(now).catch((e) => {
    console.error("[challenge-money] stranded-payment sweep failed:", e);
    return 0;
  });
  // Then the hours somebody else has bought out from under a live challenge.
  // Nothing holds a court until both captains have paid, so this is the only
  // path by which "somebody booked your hour" reaches two captains who are
  // not currently paying — and the only one that tells the arena whose money
  // it owes when one half is already in.
  const discarded = await discardChallengesWhoseHourWent(now).catch((e) => {
    console.error("[challenge-money] lost-hour sweep failed:", e);
    return 0;
  });
  // A captain who was never told they owe a half cannot pay it.
  const renotified = await renotifyUntoldHalves(now).catch((e) => {
    console.error("[challenge-money] re-nudge sweep failed:", e);
    return 0;
  });

  // Reported so a slow pass is visible in the logs before it becomes a
  // timeout. The combined pass used to exceed its caller's 90s limit with
  // nobody noticing, because the caller reported success either way.
  const ms = Date.now() - started;
  if (ms > 60_000) console.warn(`[challenge-money] slow pass: ${ms}ms`);

  return NextResponse.json({ ok: true, finished, discarded, renotified, ms });
}

export const GET = handle;
export const POST = handle;
