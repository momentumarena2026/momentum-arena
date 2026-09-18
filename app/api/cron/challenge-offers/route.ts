import { NextResponse } from "next/server";
import { sendOfferReminders, expireOffers } from "@/lib/challenge-spin";

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
