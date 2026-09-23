import { db } from "@/lib/db";
import {
  getChallenge,
  challengeSettings,
  challengeLimits,
  logChallengeEvent,
} from "@/lib/challenges";
import { suggestRefusal, windowIsTakeable } from "@/lib/challenge-rules";
import { getOperatingHours } from "@/lib/court-config";
import { challengeQuote, paymentHoldFor } from "@/lib/challenge-payments";
import { liveOfferFor, spinOutcomeFor, spinConfig } from "@/lib/challenge-spin";

/**
 * EXACTLY what the app is handed for one challenge, for one viewer.
 *
 * Lifted out of `GET /api/mobile/challenges?id=` so that route and the
 * admin's challenge PREVIEW cannot answer differently. The preview renders
 * the app's own screen component against this payload, so "what is the
 * poster seeing right now" is answered by running the same query and the
 * same component rather than by somebody re-describing both.
 *
 * That is the whole design, and it is the part worth protecting: if this
 * function and the screen stay the single source, the preview cannot drift
 * when either changes. A second copy of either — a hand-written admin
 * mock-up, a parallel query — is what would make it drift, and is what this
 * replaces.
 *
 * `track` exists because the preview must not write to the customer's
 * funnel. An admin looking at a challenge is not a DETAIL_VIEWED by the
 * captain, and counting it as one corrupts the one feed that says whether
 * anybody is actually using the board.
 */
export async function challengeDetailPayload(
  id: string,
  viewerId: string,
  { track = true }: { track?: boolean } = {},
) {
    const one = await getChallenge(id);
    if (!one) return { notFound: true as const };
    // ONCE IT IS MATCHED, IT IS PRIVATE.
    //
    // `getChallenge` fetches by id with no viewer check, and the board hands
    // out ids for everything on it — so anyone who saved an id while a
    // challenge was OPEN could keep reading it afterwards and see both
    // captains' real names, the court price, the 50/50 split, and
    // `paidSides`: exactly who has paid and who is still owing. Reproduced
    // against this handler; a stranger's payload was byte-for-byte the
    // captain's. The per-viewer fields around it (`spin`, `offer`) were
    // already scoped by userId, which is what made this stand out as an
    // oversight rather than a decision.
    //
    // The rule is the one the board already applies: a non-participant may
    // read a challenge exactly while it is still on the board. After that it
    // is two named people and their money. Answered as "Not found" rather
    // than "Forbidden", because confirming that a particular id matched is
    // itself worth something to somebody enumerating.
    const viewerIsIn =
      one.createdByUserId === viewerId || one.acceptedByUserId === viewerId;
    if (!viewerIsIn && !["OPEN", "COUNTERED"].includes(one.status)) {
      return { notFound: true as const };
    }
    if (track) {
      void logChallengeEvent({ type: "DETAIL_VIEWED", userId: viewerId, challengeId: id });
    }
    // Answer "can this viewer still counter?" here, with the same rule the
    // write path enforces, so the screen can hide an affordance that would
    // only be refused. Computing it again in the client would be a second
    // copy of the rule, free to drift; letting the screen offer the button
    // and find out on tap walks the user into a dead end.
    // The SAME rule the write path enforces. This used to be
    // `counterRefusal`, which told the second interested captain "someone
    // else is already negotiating this one" — true under the old model,
    // where a counter claimed the acceptor slot, and wrong now that any
    // number of people may each ask about a different evening.
    const myAsks = await db.challengeWindow.findMany({
      where: { challengeId: id, proposedByUserId: viewerId, status: { not: "SUPERSEDED" } },
      select: { status: true, approvedAt: true },
    });
    const counterBlock = suggestRefusal(
      one,
      viewerId,
      {
        total: myAsks.length,
        pending: myAsks.filter((w) => w.status === "OFFERED" && !w.approvedAt).length,
      },
      await challengeLimits(),
      new Date(),
    );
    // The quote is priced live on every read rather than snapshotted at
    // agreement: the number the captain sees has to be the number they are
    // about to be charged, and the court that backs it can be taken by a
    // walk-in right up until the first half is paid.
    // Price the FIRST takeable window for a prospective acceptor, so the
    // take button can show the number before the payment sheet does.
    // Without the window argument every stranger got shares of zero and the
    // Razorpay sheet was the first place they saw a price.
    // Everything a stranger could actually buy: the poster's own times, and
    // the suggested ones the poster has agreed to. `windowIsTakeable` is the
    // single rule — pricing a window the server would then refuse is how the
    // board grew live-looking buttons that only ever produced an alert.
    const offered = one.windows.filter(windowIsTakeable);
    // EVERY window, priced on its own. One quote from the first window was
    // stamped on every button, so a 1-hour slot's ₹500 appeared on a 3-hour
    // slot costing ₹1,300 and the payment sheet was the first place anyone
    // saw the real number.
    // PRICED FOR THE POSTER TOO. This was gated on being a stranger, so the
    // one person who could not see what their own match costs was the
    // captain who put it up. They get no Pay button — `challengeQuote`
    // still refuses a payment nobody has taken yet — but they get the
    // numbers, which is what the screen was missing.
    const windowQuotes = (
          await Promise.all(
            offered.map(async (w) => {
              const q = await challengeQuote(id, viewerId, w.id).catch(() => null);
              // The COURT price and the gate balance travel with the share.
              // Showing a stranger only "pay ₹500" let them believe ₹500 was
              // the cost of the game; the ₹1000 still due at the gate
              // appeared for the first time after their money was taken.
              return q
                ? {
                    windowId: w.id,
                    share: q.yourShare,
                    total: q.total,
                    venueBalance: q.venueBalance,
                    refusal: q.refusal,
                  }
                : null;
            }),
          )
        ).filter(
          (
            x,
          ): x is {
            windowId: string;
            share: number | null;
            total: number;
            venueBalance: number;
            refusal: string | null;
          } => !!x,
        );
    // A window is named whenever there is no settled one yet — for the
    // POSTER as much as a stranger. Passing undefined for a participant is
    // what left the poster's panel with a zero quote and no money shape at
    // all. Once a time IS settled, `agreedWindowId` wins on its own and no
    // OFFERED window survives to override it.
    const quote = await challengeQuote(
      id,
      viewerId,
      one.agreedWindowId ? undefined : offered[0]?.id,
    ).catch(() => null);
    // Who is holding a payment slot, if anyone. Without this the hold was
    // invisible until somebody tapped Pay and was refused — a dead end
    // dressed up as a live button.
    const hold = await paymentHoldFor(id, viewerId).catch(() => null);
    const offer = await liveOfferFor(id, viewerId).catch(() => null);
    const spin = await spinOutcomeFor(id, viewerId).catch(() => null);
    const liveSettings = await challengeSettings();
    return {
      challenge: one,
      viewerId: viewerId,
      counterBlock,
      quote,
      // So the screen can hide an affordance the server would only refuse.
      spinEnabled: liveSettings.spinEnabled,
      boardEnabled: liveSettings.enabled,
      offer,
      spin,
      hold,
      windowQuotes,
      // The counter picker needs the same real hours the post form does — and
      // the same notice period, or it offers times the server then refuses.
      hours: await getOperatingHours(),
      minLeadMins: (await challengeSettings()).minLeadMins,
      // The REAL segments, so the wheel on screen is the wheel that spun.
      // Drawing a decorative one and landing it on a number from elsewhere is
      // the kind of thing a player eventually notices. Once a spin EXISTS its
      // own snapshot wins: the venue may retune the wheel, but it may not
      // retune a wheel somebody has already spun.
      wheel: spin?.segments?.length ? spin.segments : (await spinConfig()).segments,
    };
}
