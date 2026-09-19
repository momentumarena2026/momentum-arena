/**
 * Paying for an agreed challenge.
 *
 * THE VENUE'S DECISION (2026-09-19): the court is bought only when BOTH
 * halves are paid. This REVERSES the 2026-09-18 decision that the first
 * payment blocked it, and the text that argued for that is gone rather than
 * left to be believed.
 *
 * There is no payment rail in India that can hold a UPI customer's money
 * pending a second stranger's decision — Razorpay auth/capture is card-only,
 * and UPI one-time mandates exclude PhonePe and GPay, which is most of
 * Mathura. So somebody's money is exposed no matter what, and the only real
 * question is against what. The venue's answer is: against nothing. Neither
 * half creates a booking; the hour stays on sale until both have paid.
 *
 * What that costs is real and was chosen anyway: an hour two captains are
 * part-way through buying CAN be sold to a walk-in, and then the arena owes
 * refunds and there is no match. What it buys is that the venue never holds a
 * court against half a payment, so "chase it or refund it" is a decision a
 * person can take calmly instead of "cancel a slot I may already have sold on
 * the phone".
 *
 * Because the cost is real, the communication is the feature, not a courtesy.
 * `discardForLostHour` tells both captains, flags every capture so the money
 * is a QUERY rather than prose, and sends the arena its own push naming who is
 * owed how much and on what number. Nothing here refunds automatically; if
 * that message does not land, the refund does not happen.
 *
 * ── How the money is modelled ──────────────────────────────────────
 *
 * Two layers, because two people pay for one court through two gateway
 * orders:
 *
 *   ChallengePayment — one row per side. The authoritative per-person
 *     record, carrying that person's own Razorpay refs and their own
 *     refund state. This is what the venue reads when somebody asks
 *     "did I pay?".
 *   Booking + Payment — the ordinary venue-facing booking, created on the
 *     first half. `Payment` starts PARTIAL (advance in, remainder owed)
 *     and becomes COMPLETED on the second half.
 *
 * The second layer is the point: a challenge booking is an ORDINARY
 * booking. It occupies the slot through the same
 * `OCCUPYING_BOOKING_STATUSES` every other booking uses, and its money
 * reaches revenue through the same `Booking`-joined queries. This module
 * therefore introduces no new revenue stream, which is the only reason it
 * escapes the four-surface analytics trap (PROJECT-CONTEXT gotcha 1) —
 * every previous stream had to be merged into four separate reports, and
 * fixing three of them is a bug that has already shipped here once.
 */

import { db } from "@/lib/db";
import { getSlotPricesForDate } from "@/lib/pricing";
import { getSlotAvailability } from "@/lib/availability";
import { createRazorpayOrder, verifyRazorpaySignature, RAZORPAY_KEY_ID } from "@/lib/razorpay";
import { notifyUser } from "@/lib/user-notifications";
import {
  renderPush,
  resolveTemplate,
  DEFAULT_LIFECYCLE_PUSHES,
  DEFAULT_OWNER_REFUND_PUSH,
} from "@/lib/challenge-push";
import { istDayLabel } from "@/lib/challenge-spin";
import { advisoryLockKey } from "@/lib/slot-hold";
import { logChallengeEvent } from "@/lib/challenges";
import {
  leadTimeRefusal,
  payRefusal,
  splitShare,
  sharesAgainstBooking,
  hourWord,
  statusAfterPayment,
  sideOf,
  type ChallengeSide,
  type ChallengeStatus,
} from "@/lib/challenge-rules";

/** The hours a window occupies: [startHour, endHour). */
export function windowHours(startHour: number, endHour: number): number[] {
  const out: number[] = [];
  for (let h = startHour; h < endHour; h++) out.push(h);
  return out;
}

const challengeForPay = {
  id: true,
  sport: true,
  status: true,
  createdByUserId: true,
  acceptedByUserId: true,
  expiresAt: true,
  counterCountChallenger: true,
  counterCountAcceptor: true,
  bookingId: true,
  teamName: true,
  agreedWindowId: true,
  createdBy: { select: { id: true, name: true, phone: true, email: true } },
  acceptedBy: { select: { id: true, name: true, phone: true, email: true } },
  windows: {
    select: { id: true, date: true, startHour: true, endHour: true, courtConfigId: true, status: true },
  },
  payments: {
    select: {
      id: true,
      side: true,
      userId: true,
      amount: true,
      paidAt: true,
      placedAt: true,
      quotedAdvance: true,
      quotedTotal: true,
      quotedCourtConfigId: true,
    },
  },
} as const;

/**
 * A court that is free for every hour of the window, or null.
 *
 * Preference order is the window's own courtConfigId if the captains named
 * one, then the biggest active court for the sport — a challenge is two
 * full sides, and the whole-ground charge is the thing they are splitting.
 */
async function freeCourtFor(
  sport: string,
  date: Date,
  hours: number[],
  preferredId: string | null,
  /** Pass a transaction client when asking under an advisory lock. */
  client: typeof db = db,
): Promise<string | null> {
  const configs = await client.courtConfig.findMany({
    where: { sport: sport as never, isActive: true },
    select: { id: true, size: true },
  });
  if (configs.length === 0) return null;

  const rank: Record<string, number> = { FULL: 0, LARGE: 1, MEDIUM: 2, XS: 3 };
  const ordered = [
    ...configs.filter((c) => c.id === preferredId),
    ...configs
      .filter((c) => c.id !== preferredId)
      .sort((a, b) => (rank[a.size] ?? 99) - (rank[b.size] ?? 99)),
  ];

  for (const c of ordered) {
    const avail = await getSlotAvailability(c.id, date, client);
    const allFree = hours.every((h) => avail.find((s) => s.hour === h)?.status === "available");
    if (allFree) return c.id;
  }
  return null;
}

/**
 * Why a stranger cannot buy into this challenge — or null.
 *
 * Separate from `payRefusal` because the two ask different questions. A
 * payer is being asked "is your half due?"; an acceptor is being asked "is
 * this still takeable, and is there enough notice left to staff it?". The
 * lead-time gate belongs here and not on the poster's own half, which is
 * chasing money for an hour that is already blocked.
 */
function acceptGateRefusal(
  c: { expiresAt: Date; status: string },
  win: { date: Date; startHour: number } | null,
  minLeadMins: number,
  now: Date,
  boardEnabled: boolean,
): string | null {
  // A switched-off board must stop NEW commitments. It must NOT stop a
  // captain paying the half they already owe — that would strand money
  // against a court already blocked, which is worse than leaving the
  // board on.
  if (!boardEnabled) return "The challenge board is currently switched off.";
  if (!win) return "That time is no longer on the table.";
  if (c.expiresAt.getTime() <= now.getTime()) return "That challenge has expired.";
  return leadTimeRefusal(slotStart(win.date, win.startHour), now, minLeadMins);
}

/**
 * The real instant a slot begins.
 *
 * `ChallengeWindow.date` is a `@db.Date` holding UTC midnight that STANDS
 * FOR an IST calendar day, and `startHour` is an IST wall-clock hour. Doing
 * this with host-local getters is gotcha 18 in PROJECT-CONTEXT: it gives a
 * different answer on Vercel (UTC) than on a developer's Mac (IST), and a
 * four-hour gate that is five and a half hours out on production is worse
 * than no gate.
 */
export function slotStart(date: Date, startHour: number): Date {
  return new Date(date.getTime() + (startHour - 5.5) * 3600000);
}

export type ChallengeQuote = {
  challengeId: string;
  courtConfigId: string | null;
  courtLabel: string | null;
  date: Date;
  hours: number[];
  /** The whole court for the window. */
  total: number;
  /** The slice taken online, from ChallengeSettings.advancePct. */
  advance: number;
  /** total − advance: collected at the venue on the day, as with any advance booking. */
  venueBalance: number;
  /** How the ADVANCE divides, not the court. */
  shares: { CHALLENGER: number; ACCEPTOR: number };
  paidSides: ChallengeSide[];
  /** Your side's outstanding amount, or null if you are not in this match. */
  yourShare: number | null;
  yourSide: ChallengeSide | null;
  youHavePaid: boolean;
  /** Null when you may pay; otherwise the sentence to show. */
  refusal: string | null;
};

/**
 * What this match costs, who owes what, and whether this viewer may pay.
 *
 * Priced live rather than snapshotted at agreement. Two captains agreeing
 * a time is not a transaction, and a rate card can change between the
 * handshake and the payment; the number a captain is shown is the number
 * they are about to be charged, computed at the same moment.
 */
export async function challengeQuote(
  challengeId: string,
  viewerId: string,
  /**
   * The window a NEW acceptor is buying into. Accepting a challenge is
   * paying for it — there is no free handshake any more — so a stranger
   * naming a window here is quoted as its prospective ACCEPTOR.
   */
  acceptWindowId?: string,
): Promise<ChallengeQuote | null> {
  const c = await db.challenge.findUnique({
    where: { id: challengeId },
    select: challengeForPay,
  });
  if (!c) return null;

  const settings = await db.challengeSettings.findFirst({
    select: { advancePct: true, minLeadMins: true, enabled: true },
  });
  // PLACED, not merely claimed. A half whose capture was claimed but never
  // landed on a booking holds no court, so treating it as paid here exempted
  // the next payment from the lead-time gate and quoted it against a booking
  // that does not exist.
  const paidSides = c.payments
    .filter((p) => p.paidAt && p.placedAt)
    .map((p) => p.side as ChallengeSide);
  const existingSide = sideOf(c, viewerId);

  // A stranger paying into an OPEN or COUNTERED challenge becomes its
  // acceptor by doing so. That is the flow now: money is the acceptance.
  // The ACCEPTOR slot must actually be vacant. A COUNTERED challenge already
  // HAS an acceptor — countering claims the slot — but it creates no payment
  // row, and its original windows stay OFFERED. Without the
  // `!c.acceptedByUserId` clause a complete stranger could pay the acceptor
  // half of somebody else's negotiation: the money banked, a court blocked,
  // the real acceptor told they had already paid, and the payer told they
  // were not part of the match.
  const acceptingNow =
    !existingSide &&
    !c.acceptedByUserId &&
    !!acceptWindowId &&
    c.status === "OPEN" &&
    c.windows.some((w) => w.id === acceptWindowId && w.status === "OFFERED");
  const side: ChallengeSide | null = existingSide ?? (acceptingNow ? "ACCEPTOR" : null);

  const win =
    c.windows.find((w) => w.id === (acceptingNow ? acceptWindowId : c.agreedWindowId)) ?? null;
  const hours = win ? windowHours(win.startHour, win.endHour) : [];

  // Before a time is settled there is nothing to price. Say so through the
  // refusal rather than inventing a zero.
  if (!win) {
    return {
      challengeId,
      courtConfigId: null,
      courtLabel: null,
      date: new Date(0),
      hours: [],
      total: 0,
      advance: 0,
      venueBalance: 0,
      shares: { CHALLENGER: 0, ACCEPTOR: 0 },
      paidSides,
      yourShare: null,
      yourSide: side,
      youHavePaid: false,
      refusal: payRefusal(c, viewerId, new Date(), paidSides) ?? "No time has been settled yet.",
    };
  }

  // Once a booking exists the court is decided; before that it is whatever
  // is still free, which is why this is re-asked on every quote.
  // Once a half is placed, the court is DECIDED — it is the one that half was
  // quoted against. Re-searching for "any free court" here is what let the
  // second captain be quoted a different court from the first.
  const placedPin = c.payments.find((p) => p.paidAt && p.placedAt)?.quotedCourtConfigId ?? null;
  const booked = c.bookingId
    ? await db.booking.findUnique({
        where: { id: c.bookingId },
        select: {
          courtConfigId: true,
          totalAmount: true,
          payment: { select: { advanceAmount: true, amount: true } },
        },
      })
    : null;
  const courtId =
    booked?.courtConfigId ??
    (placedPin
      ? // Still that court, or nothing. A downgrade the captains were never
        // told about is not an outcome this may choose on their behalf.
        (await freeCourtFor(c.sport, win.date, hours, placedPin)) === placedPin
        ? placedPin
        : null
      : await freeCourtFor(c.sport, win.date, hours, win.courtConfigId));

  let total = 0;
  let courtLabel: string | null = null;
  if (courtId) {
    const [prices, cfg] = await Promise.all([
      getSlotPricesForDate(courtId, win.date),
      db.courtConfig.findUnique({ where: { id: courtId }, select: { label: true } }),
    ]);
    total = prices.filter((p) => hours.includes(p.hour)).reduce((s, p) => s + p.price, 0);
    courtLabel = cfg?.label ?? null;
  }

  // Only the advance is collected online — the rest is taken at the gate,
  // exactly as for any other advance booking here. Charging the full court
  // would take four times the money the venue's own setting says to take.
  const advancePct = settings?.advancePct ?? 50;
  let advance = Math.round((total * advancePct) / 100);
  let shares = splitShare(advance);

  // ── Once a booking exists, the BOOKING is the contract ──
  //
  // The second captain used to be charged from a freshly-computed quote
  // while `settleAgainst` moved the ledger by the booking's outstanding.
  // Any edit to `advancePct` or to the hour's price between the two halves
  // made those two numbers disagree, in whichever direction the edit went:
  // at advancePct 50→75 a customer was charged ₹750, the ledger moved ₹500,
  // and they paid ₹2250 for a ₹2000 court; at 50→25 they were charged ₹250
  // against a ₹500 ledger move, inventing ₹250 of revenue that nobody paid.
  //
  // So once the hour is held, every number in this quote comes off the
  // booking — what the first half actually paid, and what is genuinely
  // still outstanding. The venue may re-price a court freely; it cannot
  // re-price a court it has already sold.
  if (booked?.payment) {
    total = booked.totalAmount;
    advance = booked.payment.advanceAmount ?? advance;
    const settled = booked.payment.amount;
    shares =
      paidSides.length === 1
        ? sharesAgainstBooking({ advanceAmount: advance, settled, paidSide: paidSides[0] })
        : // BOTH PAID: each side's share is what that side actually paid.
          //
          // This fell through to `splitShare(round(total × the CURRENT
          // advancePct))`, a live recomputation — so a venue editing the
          // percentage after a match confirmed gave both captains a receipt
          // that contradicted itself: "₹2000 online, split ₹800/₹800", on a
          // match where each had paid ₹1000.
          (c.payments
            .filter((p) => p.paidAt && p.placedAt)
            .reduce(
              (acc, p) => ({ ...acc, [p.side as ChallengeSide]: p.amount }),
              { ...shares },
            ) as typeof shares);
  } else if (paidSides.length === 1) {
    // ── NO BOOKING YET, BUT ONE HALF IS PAID ──
    //
    // Now that the court is only bought once both halves are in, this is the
    // normal middle state and it lasts as long as the second captain takes.
    // The first captain's capture is the contract in the booking's place:
    // their half was quoted against a particular advance, so the other half is
    // the REST OF THAT SAME ADVANCE, not a fresh percentage of a fresh price.
    //
    // Without this the same defect the booking branch above exists to prevent
    // simply moved earlier: a venue editing `advancePct` between the two
    // payments would charge the second captain a share of a different deal
    // from the one the first captain paid into, and the two halves would no
    // longer add up to anything.
    const first = c.payments.find(
      (p) => p.paidAt && p.placedAt && p.side === paidSides[0],
    );
    if (first?.quotedAdvance) {
      advance = first.quotedAdvance;
      shares = sharesAgainstBooking({
        advanceAmount: advance,
        settled: first.amount,
        paidSide: paidSides[0],
      });
    }
    // And the COURT price from the same pin when the hour has gone. Without
    // it, `freeCourtFor` returns nothing, `total` falls to 0, and the captain
    // who has already paid ₹500 is shown "₹0 for the court" — a number that is
    // not true of anything. What they agreed to is what they should see.
    if (!courtId && first?.quotedTotal) total = first.quotedTotal;
  }
  // The lead-time gate applies to the payment that BUYS the court — which is
  // now the second one, not the first. The exemption in the spec was written
  // for a world where the first half already held the hour; with the court
  // bought only once both halves are in, it is the second captain's payment
  // that commits the venue to staffing that hour, so that is the one gated.
  //
  // Gating the first half as well would be worse than pointless: it would
  // refuse a payment that holds nothing, on a challenge whose second half may
  // well land in time.
  const blocksTheCourt = paidSides.length === 1;
  const lateRefusal =
    blocksTheCourt && win && settings?.minLeadMins
      ? leadTimeRefusal(
          slotStart(win.date, win.startHour),
          new Date(),
          settings.minLeadMins,
        )
      : null;

  // The refusals `createChallengePaymentOrder` will apply belong HERE too,
  // or the app shows a Pay button the server always rejects — and in the ₹0
  // cases it showed one with no price and no reason at all.
  //
  // Only when a court was actually FOUND. With the hour gone, `courtId` is
  // null and `total` is 0 as a CONSEQUENCE — so checking the price first told
  // the second captain "that court has no price set, the venue needs to fix
  // that first", blaming the arena for a pricing mistake when the truth was
  // that somebody had booked the hour. The price is only news when there is a
  // court to price.
  const unpayable = !courtId
    ? null
    : total <= 0
      ? "That court has no price set — the venue needs to fix that first."
      : advance <= 0
        ? "Challenges aren't taking payment right now. Please tell the arena."
        : side && (shares[side] ?? 0) <= 0 && !paidSides.includes(side)
          ? "There's nothing left to pay on this one — tell the arena."
          : null;

  const refusal =
    (acceptingNow
      ? acceptGateRefusal(c, win, settings?.minLeadMins ?? 240, new Date(), settings?.enabled ?? false)
      : payRefusal(c, viewerId, new Date(), paidSides)) ??
    lateRefusal ??
    unpayable ??
    (courtId
      ? null
      : // Reachable for BOTH payers now. Until both halves are in, nothing
        // holds the hour, so the second captain can arrive to find it sold —
        // and must be told before paying, not after.
        "That hour has just gone. Nothing has been charged — agree another time.");

  return {
    challengeId,
    courtConfigId: courtId,
    courtLabel,
    date: win.date,
    hours,
    total,
    advance,
    venueBalance: total - advance,
    shares,
    paidSides,
    yourShare: side ? shares[side] : null,
    yourSide: side,
    youHavePaid: !!side && paidSides.includes(side),
    refusal,
  };
}

/**
 * Start a payment: reserve the side's ChallengePayment row and open a
 * Razorpay order for exactly their half.
 */
export async function createChallengePaymentOrder(
  challengeId: string,
  userId: string,
  acceptWindowId?: string,
): Promise<
  | { ok: true; orderId: string; keyId: string; amount: number; courtLabel: string | null }
  | { ok: false; error: string }
> {
  const quote = await challengeQuote(challengeId, userId, acceptWindowId);
  if (!quote) return { ok: false, error: "That challenge is gone." };
  if (quote.refusal) {
    await logChallengeEvent({
      type: "REFUSED",
      userId,
      challengeId,
      detail: quote.refusal,
    });
    return { ok: false, error: quote.refusal };
  }
  if (!quote.yourSide || quote.yourShare === null) {
    // Two very different situations wore the same sentence. Losing a race —
    // tapping "take it" a second after somebody else paid for it — is not
    // "you're not part of this match", which reads as a bug to the person who
    // was looking at the board a moment ago. The codebase already had the
    // right words for it a few lines down; this path did not use them.
    const taken = await db.challenge.findUnique({
      where: { id: challengeId },
      select: { acceptedByUserId: true, createdByUserId: true },
    });
    const outsider =
      taken && taken.acceptedByUserId && taken.acceptedByUserId !== userId &&
      taken.createdByUserId !== userId;
    return {
      ok: false,
      error: outsider
        ? "Somebody else has taken this one."
        : "You're not part of this match.",
    };
  }
  if (quote.total <= 0) {
    return { ok: false, error: "That court has no price set — the venue needs to fix that first." };
  }
  if (quote.advance <= 0) {
    // advancePct is zero, so there is nothing to collect online. Say that,
    // rather than blaming the court's price — which is set correctly.
    return {
      ok: false,
      error: "Challenges aren't taking payment right now. Please tell the arena.",
    };
  }
  // A missing key is a deployment fault, not a user's. Refuse before
  // creating the row, so nobody ends up with a payment record and no way
  // to pay it.
  if (!RAZORPAY_KEY_ID) {
    return { ok: false, error: "Card payments aren't configured. Please tell the arena." };
  }

  // One row per side, enforced by @@unique([challengeId, side]); re-opening
  // the sheet re-stamps the order id on the SAME row rather than making a
  // second one, so a captain who backs out and returns cannot end up owing
  // twice.

  // The create IS the lock. The previous version read `held` and then
  // upserted, so two strangers racing pay-order both passed the check and
  // both got a live Razorpay order for one ACCEPTOR slot — and the pre-
  // takeover audit line never fired, because `held` was null for both.
  // @@unique([challengeId, side]) makes exactly one create win.
  let row: { id: string; paidAt: Date | null; razorpayOrderId: string | null };
  try {
    row = await db.challengePayment.create({
      data: {
        challengeId,
        userId,
        side: quote.yourSide,
        amount: quote.yourShare,
        acceptWindowId: acceptWindowId ?? null,
        quotedCourtConfigId: quote.courtConfigId,
        quotedAdvance: quote.advance,
        quotedTotal: quote.total,
      },
      select: { id: true, paidAt: true, razorpayOrderId: true },
    });
  } catch {
    // The slot already exists. Only its owner, or a takeover of a hold that
    // has genuinely gone stale, may proceed.
    const current = await db.challengePayment.findUnique({
      where: { challengeId_side: { challengeId, side: quote.yourSide } },
      select: {
        id: true,
        userId: true,
        paidAt: true,
        placedAt: true,
        refundOwedAt: true,
        refundOwedReason: true,
        razorpayPaymentId: true,
        createdAt: true,
        razorpayOrderId: true,
      },
    });
    if (!current) return { ok: false, error: "Couldn't start that payment. Try again." };
    if (current.userId !== userId) {
      // A capture that has been written off as a refund no longer holds the
      // slot. Without this, one stranded payment left an OPEN challenge on
      // the board that no stranger could ever take and expiry would never
      // clear — a permanent dead card on a matchmaking board.
      if (current.paidAt && !current.refundOwedAt) {
        return { ok: false, error: "Somebody else has taken this one." };
      }
      const windowMins =
        (await db.challengeSettings.findFirst({ select: { paymentWindowMins: true } }))
          ?.paymentWindowMins ?? 120;
      // A WRITTEN-OFF row is not somebody mid-payment. Running the staleness
      // clock over it too turned the permanent dead card into a two-hour one:
      // an OPEN, priced, un-takeable challenge answering strangers "someone
      // else is paying for this right now" about a payment that was refunded.
      if (
        !current.refundOwedAt &&
        Date.now() < current.createdAt.getTime() + windowMins * 60000
      ) {
        return { ok: false, error: "Someone else is paying for this right now. Try again shortly." };
      }
      if (current.razorpayOrderId) {
        await logChallengeEvent({
          type: "REFUSED",
          userId: current.userId,
          challengeId,
          // No longer "refund owed if they paid" — that wrote a speculative
          // debt into the feed before anyone knew whether money had moved,
          // and the venue then read phantom debts alongside real ones. If
          // they HAVE paid, their capture lands on the order ledger and is
          // flagged there, with their name on it.
          detail: `their payment slot went stale after ${windowMins} minutes and was reassigned`,
        });
      }
    }
    // A WRITTEN-OFF capture no longer holds the slot — including here, in the
    // write.
    //
    // The read above was taught to let those through and the write was not, so
    // `paidAt: null` refused every takeover of a written-off row and the whole
    // fix was inert: an OPEN challenge stayed on the board, priced, and
    // un-takeable by anyone for ever. The capture's own record lives on the
    // order ledger, which is exactly why the row can be released: the debt
    // does not live here.
    // MOVE THE DEBT BEFORE WIPING THE ROW.
    //
    // Releasing a written-off capture clears `refundOwedAt` along with
    // everything else, and the comment justifying that said the capture's
    // record "lives on the order ledger". It does not: `strandOrder` is only
    // ever called for captures that arrive AFTER a takeover, so a capture
    // written off BEFORE one had `strandedAt` null for ever and vanished from
    // both worklists — a real ₹400, a customer told by push that a refund was
    // coming, and no record anywhere the venue looks.
    if (current.refundOwedAt && current.razorpayOrderId) {
      await strandOrder(
        current.razorpayOrderId,
        current.razorpayPaymentId ?? "",
        current.refundOwedReason ?? "this capture could not be honoured",
      );
    }
    const releasable = current.refundOwedAt
      ? { id: current.id, refundOwedAt: { not: null } }
      : { id: current.id, paidAt: null };
    const taken = await db.challengePayment.updateMany({
      where: releasable,
      data: {
        userId,
        amount: quote.yourShare,
        acceptWindowId: acceptWindowId ?? null,
        quotedCourtConfigId: quote.courtConfigId,
        quotedAdvance: quote.advance,
        quotedTotal: quote.total,
        // The new holder starts their OWN clock. Inheriting the previous
        // one left them instantly stale, so the slot could be ripped away
        // again immediately — and repeatedly, from whoever was mid-payment.
        createdAt: new Date(),
        // ONLY on a genuine takeover. Clearing this unconditionally made the
        // reuse branch below unreachable — the owner simply re-opening their
        // own sheet had their order id wiped and a fresh one minted, so five
        // taps produced five live payable Razorpay orders for one half, and
        // paying any but the last was refused as "too late" and flagged for
        // refund while the slot stayed unpaid. The previous holder's order
        // must not stay attached to a row that now names somebody else; the
        // CURRENT holder's must.
        ...(current.userId !== userId ? { razorpayOrderId: null } : {}),
        // Released for a new holder: the old capture's paid/placed/written-off
        // marks are the PREVIOUS deal's, and the ledger keeps them.
        ...(current.refundOwedAt
          ? {
              paidAt: null,
              placedAt: null,
              refundOwedAt: null,
              refundOwedReason: null,
              razorpayPaymentId: null,
              razorpaySignature: null,
            }
          : {}),
      },
    });
    // THIS is the branch a paid row reaches — the create above fails on the
    // unique constraint, so `row.paidAt` below is structurally always null and
    // the message written there never sent.
    if (taken.count === 0) {
      // And say it to the right person. "We're still finishing YOUR last
      // payment" went to strangers who had paid nothing, about a payment they
      // never made.
      if (current.userId !== userId) {
        return { ok: false, error: "Someone else is paying for this right now. Try again shortly." };
      }
      return {
        ok: false,
        error: current.placedAt
          ? "You've already paid your half."
          : "We're still finishing your last payment. Give it a minute, then pull to refresh.",
      };
    }
    // A takeover re-mints; the owner re-opening keeps the order they already
    // have, which is what makes the reuse branch below reachable at all.
    row = {
      id: current.id,
      paidAt: null,
      razorpayOrderId: current.userId === userId ? current.razorpayOrderId : null,
    };
  }

  // ── REUSE the order this row already has ──
  //
  // Re-opening the sheet used to mint a second Razorpay order and re-stamp the
  // row, which orphaned the first one: still live and payable at the gateway,
  // attached to nothing here. When that capture landed it was filed as money
  // the arena could not honour — so a customer who closed the sheet and tapped
  // Pay again could pay ₹1000 for a ₹500 half and be owed a manual refund. In
  // India the late-resolving UPI collect makes that the ordinary case, not an
  // edge case.
  //
  // It was also an unbounded write endpoint: twelve taps produced ten live
  // orders and ten rows in the ledger the venue is meant to trust.
  //
  // So the order is minted once per (row, amount) and handed back on every
  // later tap. A changed amount is a different deal and gets a new one.
  const live = row.razorpayOrderId
    ? await db.challengeOrder.findUnique({
        where: { razorpayOrderId: row.razorpayOrderId },
        select: { razorpayOrderId: true, amount: true, settledAt: true, strandedAt: true },
      })
    : null;
  if (
    live &&
    live.amount === quote.yourShare &&
    !live.settledAt &&
    !live.strandedAt
  ) {
    await logChallengeEvent({
      type: "PAY_STARTED",
      userId,
      challengeId,
      detail: `${quote.yourSide.toLowerCase()} re-opened the sheet · ₹${quote.yourShare}`,
    });
    return {
      ok: true,
      orderId: live.razorpayOrderId,
      keyId: RAZORPAY_KEY_ID,
      amount: quote.yourShare,
      courtLabel: quote.courtLabel,
    };
  }

  let order: { id: string };
  try {
    order = await createRazorpayOrder(quote.yourShare, row.id);
  } catch {
    return { ok: false, error: "Couldn't reach the payment gateway. Try again in a moment." };
  }

  await db.challengePayment.update({
    where: { id: row.id },
    data: { razorpayOrderId: order.id },
  });

  // The order ledger. Append-only and unrelated to either row above, so that
  // a capture can still be recognised as ours after the payment row has been
  // reassigned to somebody else or the challenge has been deleted outright —
  // the two ways a real capture used to vanish without a trace.
  await db.challengeOrder
    .create({
      data: {
        razorpayOrderId: order.id,
        challengeId,
        userId,
        side: quote.yourSide,
        amount: quote.yourShare,
      },
    })
    .catch(() => undefined);

  await logChallengeEvent({
    type: "PAY_STARTED",
    userId,
    challengeId,
    detail: `${quote.yourSide.toLowerCase()} · ₹${quote.yourShare} of the ₹${quote.advance} advance (court ₹${quote.total})`,
  });

  return {
    ok: true,
    orderId: order.id,
    keyId: RAZORPAY_KEY_ID,
    amount: quote.yourShare,
    courtLabel: quote.courtLabel,
  };
}

/**
 * Finish a payment.
 *
 * The first half creates the booking — which is the moment the court comes
 * off the board — and the second settles it.
 *
 * ── Why this is five stages and not one function ───────────────────
 *
 * It was one function, and it produced five separate money bugs across
 * three testing rounds — every one of them the same shape: a value read
 * before something invalidated it, or written before something else needed
 * the old version. A claim stamped before the read it corrupted, making the
 * whole booking path dead code. A status computed before a branch that
 * changed it, writing PART_PAID over a settled match. Those are not
 * careless mistakes you can review your way out of; they are what a long
 * body with reassigned locals (`isFirstHalf`, `bookingId`, `nextStatus`)
 * makes easy.
 *
 * So each stage below takes what it needs and RETURNS its result. Nothing
 * is reassigned, nothing is read twice expecting a different answer, and
 * the two orderings a payment can take — first half blocks, second half
 * settles — are two returns from one function rather than two mutations of
 * a shared flag.
 */

/** The payment slot this capture belongs to, once proven ours. */
type ClaimedSlot = {
  rowId: string;
  side: ChallengeSide;
  amount: number;
  acceptWindowId: string | null;
  quotedCourtConfigId: string | null;
  /** The advance this half was quoted against. Null only for pre-fix rows. */
  quotedAdvance: number | null;
  /** The court total it was quoted against. Null only for pre-fix rows. */
  quotedTotal: number | null;
};

/** Where the money ended up. Every branch is a value, not a flag. */
type Placement =
  // Both halves are in and the hour is bought. The match is on.
  | { kind: "booked"; bookingId: string; status: ChallengeStatus }
  // The booking already existed when we got here — a replay, or the loser of
  // two halves landing in the same instant.
  | { kind: "settled"; bookingId: string; status: ChallengeStatus }
  // One half in, nothing bought, nothing held. The normal middle state now.
  | { kind: "halfPaid"; status: ChallengeStatus }
  // The hour went before both halves could buy it. Everything captured on
  // this challenge is owed back.
  | { kind: "slotLost" }
  // The placement could not be completed at all — distinct from slotLost,
  // which is a real answer about the hour.
  | { kind: "lostRace" };

/**
 * Money captured that this system cannot honour. Always leaves a trail.
 *
 * Two trails, deliberately. The event feed is for the human reading the
 * activity tab; `refundOwedAt` on the payment row is for the QUERY — money
 * the arena owes back was previously discoverable only by reading prose,
 * which means in practice it was discoverable only by the customer ringing
 * up. Pass `rowId` whenever the stranded capture sits on a row that is
 * still ours to stamp.
 */
async function refundOwed(args: {
  challengeId: string;
  userId: string;
  detail: string;
  title: string;
  body: string;
  error: string;
  rowId?: string;
  /** For substituting the venue's own wording. Omitted only where unknown. */
  vars?: Record<string, string | number>;
}): Promise<{ ok: false; error: string }> {
  // ONE debt, one push, one audit line. `refundOwed` fired unconditionally,
  // so every replay of the payer's own triple re-notified them and wrote
  // another "paid ₹500 … refund owed" line — a human reading four of those
  // for one ₹500 capture reads it as ₹2,000 owed, and any customer could
  // spam their own device and the venue's audit trail with one repeated POST.
  // The stamp is the claim: whoever sets it does the telling.
  if (args.rowId) {
    const first = await markRefundOwed(args.rowId, args.detail);
    if (!first) return { ok: false, error: args.error };
  }
  await logChallengeEvent({
    type: "REFUSED",
    userId: args.userId,
    challengeId: args.challengeId,
    detail: args.detail,
  });
  // The venue may override these words with one message for every
  // refund-owed case. Absent that, each caller's own specific sentence is
  // kept — "that match was called off" tells the customer more than a
  // generic apology, so the default is deliberately NOT one template.
  const stored = (await db.challengeSettings.findFirst({ select: { refundOwedPush: true } }))
    ?.refundOwedPush;
  const tpl = resolveTemplate(stored, { title: args.title, body: args.body });
  // RENDER IT. This was the one lifecycle message that never substituted, so a
  // venue that edited it shipped its own template source to the customer —
  // "amount={amount}" in the single message whose job is to say that money is
  // coming back.
  const vars = args.vars ?? {};
  await notifyUser(args.userId, {
    type: "CHALLENGE_REFUND_OWED",
    title: renderPush(tpl.title, vars),
    body: renderPush(tpl.body, vars),
    link: `/challenges/${args.challengeId}`,
  });
  return { ok: false, error: args.error };
}

/**
 * Flag a captured payment as money the arena owes back.
 *
 * The stamp is the machine-readable half of the trail: before it, a stranded
 * capture was indistinguishable from a healthy paid half in every query the
 * admin screens run — `paidAt` set, `refundedAt` null — and the only record
 * that anything was owed was a sentence in the activity feed.
 */
async function markRefundOwed(rowId: string, reason: string): Promise<boolean> {
  // Conditional, so it is also the dedupe for everything that follows it. The
  // first reason wins: a row refusing on every retry should keep the reason it
  // first failed for, not the latest one.
  const done = await db.challengePayment
    .updateMany({
      where: { id: rowId, refundOwedAt: null },
      data: { refundOwedAt: new Date(), refundOwedReason: reason.slice(0, 300) },
    })
    .catch(() => ({ count: 0 }));
  return done.count > 0;
}

/**
 * Log a refusal once per (challenge, sentence).
 *
 * These branches are reachable by replaying any capture at any challenge id,
 * so without a dedupe the audit trail is an open write endpoint. The
 * payment id is inside the sentence, which is what makes one line per
 * genuine capture and no lines for a replay.
 */
async function logOnce(challengeId: string, userId: string, detail: string): Promise<void> {
  const seen = await db.challengeEvent
    .findFirst({ where: { challengeId, type: "REFUSED", detail }, select: { id: true } })
    .catch(() => null);
  if (seen) return;
  await logChallengeEvent({ type: "REFUSED", userId, challengeId, detail });
}

/** The sides that have actually paid, read fresh. Never inferred. */
async function paidSides(challengeId: string): Promise<ChallengeSide[]> {
  // PLACED, not merely claimed. `paidAt` is stamped by `claimSlot` before
  // any booking work, so counting it let a half whose placement died
  // mid-flight mark the challenge CONFIRMED — ₹800 captured against ₹400 on
  // the booking, the gate asking for the difference, and no retry able to
  // repair it because `alreadyDone` short-circuits a paid row.
  const rows = await db.challengePayment.findMany({
    where: { challengeId, paidAt: { not: null }, placedAt: { not: null } },
    select: { side: true },
  });
  return rows.map((r) => r.side as ChallengeSide);
}

/**
 * Flag an order in the ledger as money we owe back, once.
 *
 * Returns the ledger row when THIS call was the one that claimed it, so the
 * caller knows whether to do the telling. Replays then cost nothing: one
 * capture, one push, one audit line, one row on the venue's refunds queue.
 */
async function strandOrder(
  razorpayOrderId: string,
  razorpayPaymentId: string,
  reason: string,
): Promise<{ userId: string; challengeId: string; amount: number; side: string } | null> {
  const order = await db.challengeOrder.findUnique({
    where: { razorpayOrderId },
    select: { id: true, userId: true, challengeId: true, amount: true, side: true, settledAt: true },
  });
  if (!order) return null;
  // ALREADY HONOURED IS NOT STRANDED.
  //
  // The only guard here used to be `strandedAt: null`. It asked neither whether
  // the order had been settled nor whether its money was sitting healthily on a
  // live booking — so replaying somebody's capture turned their perfectly good,
  // court-holding payment into a debt on the venue's refunds queue, which the
  // panel then totalled up and offered a Mark-refunded button on. With a
  // captain's capture triple readable from a booking they could both see, that
  // was a way to be paid twice.
  if (order.settledAt) return null;
  // And ask the money, not only the order. `settledAt` is the last write of a
  // successful placement, so a crash in that final window leaves it null on a
  // capture that IS placed and booked — and nothing repairs it, because both
  // sweeps skip placed rows. Without this, replaying that triple turned a
  // live, court-holding half into a refund debt the venue would pay.
  const live = await db.challengePayment.findFirst({
    where: {
      challengeId: order.challengeId,
      side: order.side,
      placedAt: { not: null },
      refundedAt: null,
    },
    select: { id: true },
  });
  if (live) return null;
  const claimed = await db.challengeOrder.updateMany({
    // `settledAt: null` in the predicate too, so a settle landing between the
    // read and the write cannot be overtaken by a strand.
    where: { id: order.id, strandedAt: null, settledAt: null },
    data: { strandedAt: new Date(), strandedReason: reason.slice(0, 300), razorpayPaymentId },
  });
  return claimed.count > 0 ? order : null;
}

/**
 * STAGE 1 — prove the capture is real, and claim its slot exactly once.
 *
 * The claim is a conditional update, not a read followed by a write: three
 * concurrent verifies of one capture each passed a `if (row.paidAt)` read
 * and each went on to create a booking.
 */
async function claimSlot(args: {
  challengeId: string;
  userId: string;
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
}): Promise<
  | { kind: "claimed"; slot: ClaimedSlot }
  | { kind: "alreadyDone"; status: string; bookingId: string | null }
  | { kind: "refused"; error: string }
> {
  const { challengeId, userId, razorpayOrderId, razorpayPaymentId } = args;

  if (!verifyRazorpaySignature(razorpayOrderId, razorpayPaymentId, args.razorpaySignature)) {
    await logChallengeEvent({
      type: "REFUSED",
      userId,
      challengeId,
      detail: "Payment signature did not verify.",
    });
    return { kind: "refused", error: "That payment could not be verified." };
  }

  // Looked up BY THE ORDER. The signature is HMAC(order|payment) and carries
  // no amount and no receipt, so a client-supplied id would let any triple
  // the user ever received satisfy any payment.
  const row = await db.challengePayment.findUnique({
    where: { razorpayOrderId },
    select: {
      id: true,
      challengeId: true,
      userId: true,
      side: true,
      amount: true,
      paidAt: true,
      placedAt: true,
      acceptWindowId: true,
      quotedCourtConfigId: true,
      quotedAdvance: true,
      quotedTotal: true,
    },
  });
  if (!row) {
    // No payment row — but the order ledger knows whether WE opened this
    // order. That distinction is the whole point of the ledger:
    //
    //  - Ours, with no row to honour it: the payer's slot was taken over
    //    while they were paying, or the challenge was deleted underneath
    //    them. Real money, really stranded. Flag it, tell them, and put it
    //    on the venue's refunds queue.
    //  - Not ours: somebody is replaying an ordinary booking receipt at this
    //    endpoint. The money is honoured wherever it was taken, so this is
    //    not a refund at all — and treating it as one made the audit trail
    //    an open write endpoint. Log it once and claim nothing.
    const ours = await strandOrder(
      razorpayOrderId,
      razorpayPaymentId,
      "the payment slot was gone by the time this capture landed",
    );
    if (ours) {
      await logChallengeEvent({
        type: "REFUSED",
        userId: ours.userId,
        // Against the challenge the ORDER names. If that challenge is gone
        // the write fails and is swallowed — which is exactly why the ledger
        // row, and not the event, is the record that matters.
        challengeId: ours.challengeId,
        detail: `captured ₹${ours.amount} with no live slot to honour it (${razorpayPaymentId}) — refund owed`,
      });
      // The venue's own refund wording applies here too. These two ledger
      // paths are exactly what the admin screen labels "A refund is owed", and
      // they were the ones ignoring the template.
      await notifyRefundOwed(ours.userId, ours.challengeId, {
        title: "We owe you a refund",
        body: `Your ₹${ours.amount} went through but the match could no longer take it. The arena will refund you in full.`,
        amount: ours.amount,
      });
      // AND the arena. Its sibling branch below tells them; this one did not,
      // so the case the refunds panel labels "no live slot" reached the venue
      // only if somebody happened to open that panel.
      await tellTheArenaAboutARefundFor(
        ours.userId,
        ours.amount,
        ours.challengeId,
        "their payment landed with no live slot left to honour it",
      );
      return {
        kind: "refused",
        error: "That payment arrived too late to be used. The arena will refund you in full.",
      };
    }
    // Either not ours at all, or ours and already flagged. Both are quiet:
    // the first is somebody replaying an ordinary booking receipt at this
    // endpoint, and treating that as a refund made the audit trail an open
    // write endpoint.
    const known = await db.challengeOrder.findUnique({
      where: { razorpayOrderId },
      select: { id: true },
    });
    if (known) {
      return {
        kind: "refused",
        error: "That payment arrived too late to be used. The arena will refund you in full.",
      };
    }
    await logOnce(
      challengeId,
      userId,
      `a payment from elsewhere was offered here (${razorpayPaymentId})`,
    );
    return { kind: "refused", error: "That payment does not match this challenge." };
  }
  if (row.challengeId !== challengeId) {
    // Real challenge money, but the client named the wrong challenge. Its
    // own row is intact and will honour it, so this is a misroute, not a
    // loss — log against the challenge it actually belongs to.
    await logOnce(row.challengeId, userId, `a payment for another challenge was offered here (${razorpayPaymentId})`);
    return { kind: "refused", error: "That payment does not match this challenge." };
  }
  if (row.userId !== userId) {
    // Stranded: the payer's money is captured and their slot now names
    // somebody else. The ROW must not be stamped — it belongs to the new
    // holder and flagging it would mark their perfectly good payment as a
    // refund — so the debt is recorded on the order ledger instead, which is
    // both the dedupe for the telling and the reason the venue can find this
    // money as a query rather than as prose in the activity feed.
    const stranded = await strandOrder(
      razorpayOrderId,
      razorpayPaymentId,
      "paid into a slot that had been reassigned to somebody else",
    );
    if (stranded) {
      // The LEDGER says whose money this is. Telling `userId` — the caller —
      // sent "we owe you a refund" to whoever replayed the triple rather than
      // to whoever paid.
      await logChallengeEvent({
        type: "REFUSED",
        userId: stranded.userId,
        challengeId,
        detail: `paid ₹${stranded.amount} into a slot that had been reassigned (${razorpayPaymentId}) — refund owed`,
      });
      await notifyRefundOwed(stranded.userId, challengeId, {
        title: "We owe you a refund",
        body: "Somebody else had taken that half by the time your payment landed. The arena will refund you in full.",
        amount: stranded.amount,
      });
      await tellTheArenaAboutARefundFor(
        stranded.userId,
        stranded.amount,
        challengeId,
        "their payment slot had been reassigned by the time this capture landed",
      );
    }
    return {
      kind: "refused",
      error: "Somebody else took this one while you were paying. The arena will refund you.",
    };
  }

  const resume = (): { kind: "claimed"; slot: ClaimedSlot } => ({
    kind: "claimed",
    slot: {
      rowId: row.id,
      side: row.side as ChallengeSide,
      amount: row.amount,
      acceptWindowId: row.acceptWindowId,
      quotedCourtConfigId: row.quotedCourtConfigId,
      quotedAdvance: row.quotedAdvance,
      quotedTotal: row.quotedTotal,
    },
  });

  const settled = async () => {
    const c = await db.challenge.findUnique({
      where: { id: challengeId },
      select: { status: true, bookingId: true },
    });
    return {
      kind: "alreadyDone" as const,
      status: c?.status ?? "PART_PAID",
      bookingId: c?.bookingId ?? null,
    };
  };

  // A row that was CLAIMED but never PLACED is unfinished work, not a
  // completed payment. Reporting success for it stranded the money
  // permanently: the retry said ok, the pay button said "already paid", and
  // the admin's stranded panel could not see it either.
  if (row.paidAt) return row.placedAt ? settled() : resume();

  const claimed = await db.challengePayment.updateMany({
    where: { id: row.id, paidAt: null },
    data: { paidAt: new Date(), razorpayPaymentId, razorpaySignature: args.razorpaySignature },
  });
  // NOTE: `settledAt` is deliberately NOT stamped here. Stamping it at claim
  // time — before any placement work — meant every capture the system later
  // refused was ALSO recorded as "processed normally", so the same ₹400 showed
  // up on the venue's refunds queue twice, once from each source, and the panel
  // totalled it as ₹800. It is stamped when the placement actually succeeds.
  if (claimed.count === 0) {
    const now = await db.challengePayment.findUnique({
      where: { id: row.id },
      select: { placedAt: true },
    });
    return now?.placedAt ? settled() : resume();
  }

  return {
    kind: "claimed",
    slot: {
      rowId: row.id,
      side: row.side as ChallengeSide,
      amount: row.amount,
      acceptWindowId: row.acceptWindowId,
      quotedCourtConfigId: row.quotedCourtConfigId,
      quotedAdvance: row.quotedAdvance,
      quotedTotal: row.quotedTotal,
    },
  };
}

/**
 * STAGE 3 — block the court, or settle against the booking that already
 * holds it.
 *
 * Which of those happens is decided by the database, not by a flag computed
 * earlier: whoever wins the conditional attach blocked it, and everyone
 * else settles. The loser's booking is rolled back by its own transaction
 * rather than deleted afterwards — an orphan PENDING booking takes an hour
 * off sale that appears in no report and no hold expiry, and every later
 * payment on that challenge then deterministically reads as SLOT_LOST.
 */
async function placeMoney(ctx: {
  challengeId: string;
  slot: ClaimedSlot;
  challenge: { sport: string; createdByUserId: string };
  win: { id: string; date: Date; startHour: number; endHour: number; courtConfigId: string | null };
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
  platform?: string;
}): Promise<Placement> {
  const existing = await db.challenge.findUnique({
    where: { id: ctx.challengeId },
    select: { bookingId: true },
  });
  // The court is already bought and both halves are on it. Only a replay or
  // a race loser gets here; stamp this half placed and agree.
  if (existing?.bookingId) {
    await db.challengePayment.updateMany({
      where: { id: ctx.slot.rowId, placedAt: null },
      data: { placedAt: new Date() },
    });
    return { kind: "settled", bookingId: existing.bookingId, status: "CONFIRMED" };
  }

  // Stamp this half placed and read who is placed NOW, in one transaction —
  // otherwise two halves landing together both read "I am the first" and
  // neither buys the court.
  const placed = await db.$transaction(async (tx) => {
    await tx.challengePayment.updateMany({
      where: { id: ctx.slot.rowId, placedAt: null },
      data: { placedAt: new Date() },
    });
    return tx.challengePayment.findMany({
      where: { challengeId: ctx.challengeId, paidAt: { not: null }, placedAt: { not: null } },
      select: {
        id: true,
        side: true,
        amount: true,
        userId: true,
        razorpayPaymentId: true,
        quotedCourtConfigId: true,
        quotedTotal: true,
      },
      orderBy: { placedAt: "asc" },
    });
  });

  const sides = new Set(placed.map((p) => p.side as ChallengeSide));
  if (sides.size < 2) {
    // ── HALF PAID, AND THE HOUR IS NOT HELD ──
    //
    // This is the venue's decision, reversed from the earlier one: a court
    // comes off sale only when BOTH captains have paid, never on the strength
    // of one. It costs something — a walk-in can take an hour two captains are
    // halfway through buying — and that case is why every path out of here
    // tells both captains and tells the arena whose money it owes.
    //
    // What it buys is that the arena never holds a court against half a
    // payment, so it never has to decide whether to release a slot somebody
    // may already have been promised on the phone.
    await db.challenge.updateMany({
      where: { id: ctx.challengeId, bookingId: null },
      data: { status: "PART_PAID" },
    });
    return { kind: "halfPaid", status: "PART_PAID" };
  }

  // Both halves are in. NOW buy the hour.
  const bought = await buyTheHour(ctx, placed);
  if (bought.kind !== "lostRace") return bought;

  // Somebody else's request bought it in the same instant.
  const winner = await db.challenge.findUnique({
    where: { id: ctx.challengeId },
    select: { bookingId: true },
  });
  if (!winner?.bookingId) return { kind: "lostRace" };
  return { kind: "settled", bookingId: winner.bookingId, status: "CONFIRMED" };
}

/**
 * Flag every captured half on a challenge as money the arena owes back.
 *
 * The venue-initiated counterpart to `discardForLostHour`: when an admin takes
 * down a challenge that is holding money, the take-down is the decision to
 * unwind it, so the same three things have to happen — the rows are flagged so
 * they appear on the refunds queue, each payer is told, and the arena is told
 * whose money it is and how much. Before this, the action refused and pointed
 * at a panel the payment was not on, which nothing could put it on.
 *
 * Idempotent per row: `markRefundOwed` is a conditional stamp.
 */
export async function flagChallengeRefunds(
  challengeId: string,
  reason: string,
): Promise<number> {
  const owed = await db.challengePayment.findMany({
    where: { challengeId, paidAt: { not: null }, refundedAt: null, refundOwedAt: null },
    select: {
      id: true,
      amount: true,
      side: true,
      user: { select: { id: true, name: true, phone: true } },
    },
  });
  let flagged = 0;
  for (const row of owed) {
    if (!(await markRefundOwed(row.id, reason))) continue;
    flagged += 1;
    await logChallengeEvent({
      type: "REFUSED",
      userId: row.user.id,
      challengeId,
      detail: `paid ₹${row.amount} as ${row.side.toLowerCase()} — refund owed, ${reason}`,
    });
    await notifyRefundOwed(row.user.id, challengeId, {
      title: "We owe you a refund",
      body: `₹${row.amount} for that match is coming back to you in full.`,
      amount: row.amount,
    });
    await tellTheArenaAboutARefundFor(row.user.id, row.amount, challengeId, reason);
  }
  return flagged;
}

/**
 * The hour went. Close the challenge out, completely and out loud.
 *
 * Since a court is only taken off sale once BOTH captains have paid, an hour
 * somebody is halfway through buying can be sold to a walk-in. That is the
 * cost the venue accepted, and this function is the whole of what makes it
 * acceptable: nobody is left wondering, and nobody's money is left to be
 * discovered later.
 *
 * Three audiences, deliberately:
 *
 *  - Both captains hear that the hour is gone, whether they paid or not,
 *    because a match neither of them can play is news to both of them.
 *  - Whoever paid hears that their money is coming back.
 *  - The ARENA hears whose money it owes and how much, on its own admin push,
 *    with a phone number in it — because there is no automatic refund in this
 *    system and an owner who is not told will not make one.
 *
 * Idempotent: the challenge's status is the claim (conditional update), and
 * each half's `refundOwedAt` is its own claim, so a replay or a second sweep
 * re-tells nobody.
 */
async function discardForLostHour(args: {
  challengeId: string;
  reason: string;
  captains: ({ id: string; name: string | null } | null)[];
  pushVars: Record<string, string | number>;
  slotLostTemplate: { title: string; body: string };
}): Promise<boolean> {
  // One discard per challenge. Two payers racing, or a sweep landing on the
  // same challenge as a capture, must not announce it twice.
  const claimed = await db.challenge.updateMany({
    where: {
      id: args.challengeId,
      status: { notIn: ["SLOT_LOST", "WITHDRAWN", "EXPIRED"] },
      // A CHALLENGE WITH A BOOKING HAS ITS HOUR. Without this, any caller who
      // decided the hour was gone could overwrite CONFIRMED on a match whose
      // court is bought and held — and then flag both halves for refund. The
      // callers should not get that wrong, and this is the backstop for when
      // one of them does.
      bookingId: null,
    },
    data: { status: "SLOT_LOST" },
  });
  if (claimed.count === 0) return false;

  await logChallengeEvent({
    type: "SLOT_LOST",
    challengeId: args.challengeId,
    detail: args.reason,
  });

  // Every captured half on this challenge is owed back.
  const owed = await db.challengePayment.findMany({
    where: { challengeId: args.challengeId, paidAt: { not: null }, refundedAt: null },
    select: {
      id: true,
      amount: true,
      side: true,
      user: { select: { id: true, name: true, phone: true } },
    },
  });

  for (const row of owed) {
    const first = await markRefundOwed(row.id, args.reason);
    if (!first) continue;
    await logChallengeEvent({
      type: "REFUSED",
      userId: row.user.id,
      challengeId: args.challengeId,
      detail: `paid ₹${row.amount} as ${row.side.toLowerCase()} — refund owed, ${args.reason}`,
    });
    await notifyUser(row.user.id, {
      type: "CHALLENGE_REFUND_OWED",
      title: "We owe you a refund",
      body: `₹${row.amount} for that hour is coming back to you in full. It was booked by somebody else before both halves were in.`,
      link: `/challenges/${args.challengeId}`,
    }).catch(() => undefined);
    await tellTheArenaAboutARefund({
      name: row.user.name ?? "A captain",
      phone: row.user.phone ?? "",
      amount: row.amount,
      reason: args.reason,
      hour: String(args.pushVars.hour ?? ""),
      date: String(args.pushVars.date ?? ""),
      court: String(args.pushVars.court ?? ""),
    });
  }

  // Both captains, paid or not. Sent AFTER the refund notices so the refund is
  // the last thing whoever paid reads.
  for (const u of args.captains) {
    if (!u) continue;
    await notifyUser(u.id, {
      type: "CHALLENGE_SLOT_LOST",
      title: renderPush(args.slotLostTemplate.title, args.pushVars),
      body: renderPush(args.slotLostTemplate.body, args.pushVars),
      link: `/challenges/${args.challengeId}`,
    }).catch(() => undefined);
  }
  return true;
}

/**
 * One refund-owed notice, in the venue's words where it has written any.
 *
 * The stranded-order paths sent hard-coded strings while the admin screen
 * advertised an editable "A refund is owed" message covering exactly them, so
 * the control silently applied to only some of what it claimed.
 */
async function notifyRefundOwed(
  userId: string,
  challengeId: string,
  fallback: { title: string; body: string; amount: number },
): Promise<void> {
  const stored = (await db.challengeSettings.findFirst({ select: { refundOwedPush: true } }))
    ?.refundOwedPush;
  const tpl = resolveTemplate(stored, { title: fallback.title, body: fallback.body });
  const [u, c] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { name: true } }),
    db.challenge.findUnique({
      where: { id: challengeId },
      select: {
        teamName: true,
        windows: {
          where: { status: "ACCEPTED" },
          select: { date: true, startHour: true, endHour: true, courtConfigId: true },
          take: 1,
        },
        payments: {
          select: { quotedCourtConfigId: true, quotedTotal: true, quotedAdvance: true },
        },
      },
    }),
  ]);
  const w = c?.windows[0];
  // REAL values for everything the editor advertises. `court` was "" and both
  // money variables were 0, on the one message whose subject is money — a
  // venue writing "₹{total} court, ₹{balance} at the gate" shipped "₹0" twice.
  // And `{name}` was the READER, while the editor documents it as the other
  // captain, so "{name} couldn't make it" addressed people by their own name.
  const courtId =
    c?.payments.find((p) => p.quotedCourtConfigId)?.quotedCourtConfigId ??
    w?.courtConfigId ??
    null;
  const [court, other] = await Promise.all([
    courtId
      ? db.courtConfig
          .findUnique({ where: { id: courtId }, select: { label: true } })
          .then((x) => x?.label ?? "")
      : Promise.resolve(""),
    (async () => {
      const ch = await db.challenge.findUnique({
        where: { id: challengeId },
        select: {
          createdBy: { select: { id: true, name: true } },
          acceptedBy: { select: { id: true, name: true } },
        },
      });
      const them = ch?.createdBy?.id === userId ? ch?.acceptedBy : ch?.createdBy;
      return them?.name ?? "the other captain";
    })(),
  ]);
  const pinned = c?.payments.find((p) => p.quotedTotal)?.quotedTotal ?? 0;
  const pinnedAdvance = c?.payments.find((p) => p.quotedAdvance)?.quotedAdvance ?? 0;
  const vars = {
    name: other,
    team: c?.teamName ?? "",
    hour: w ? `${hourWord(w.startHour)}–${hourWord(w.endHour)}` : "",
    date: w ? istDayLabel(w.date) : "",
    court,
    amount: fallback.amount,
    total: pinned,
    balance: Math.max(0, pinned - pinnedAdvance),
  };
  await notifyUser(userId, {
    type: "CHALLENGE_REFUND_OWED",
    title: renderPush(tpl.title, vars),
    body: renderPush(tpl.body, vars),
    link: `/challenges/${challengeId}`,
  }).catch(() => undefined);
}

/** Look the payer up and tell the arena, for the paths that only have an id. */
async function tellTheArenaAboutARefundFor(
  userId: string,
  amount: number,
  challengeId: string,
  reason: string,
): Promise<void> {
  const [u, c] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { name: true, phone: true } }),
    db.challenge.findUnique({
      where: { id: challengeId },
      select: {
        windows: {
          where: { status: "ACCEPTED" },
          select: { date: true, startHour: true, endHour: true, courtConfigId: true },
          take: 1,
        },
        payments: { select: { quotedCourtConfigId: true } },
      },
    }),
  ]);
  const w = c?.windows[0];
  // The court the halves were quoted on. Hard-coding "" here put a blank into
  // the middle of the venue's own message — "on  was booked by somebody else" —
  // on the one notification whose reader has to act on it.
  const courtId =
    c?.payments.find((p) => p.quotedCourtConfigId)?.quotedCourtConfigId ?? w?.courtConfigId ?? null;
  const court = courtId
    ? ((await db.courtConfig.findUnique({ where: { id: courtId }, select: { label: true } }))
        ?.label ?? "")
    : "";
  await tellTheArenaAboutARefund({
    name: u?.name ?? "A captain",
    phone: u?.phone ?? "",
    amount,
    hour: w ? `${hourWord(w.startHour)}–${hourWord(w.endHour)}` : "",
    date: w ? istDayLabel(w.date) : "",
    court,
    reason,
  });
}

/**
 * Tell the arena it owes somebody money.
 *
 * Its own admin push, with its own configurable wording, because this is the
 * only message in the module addressed to the venue rather than to a player —
 * and the only one that may carry a phone number, which it needs: whoever
 * reads it has to ring that person and refund by hand.
 */
async function tellTheArenaAboutARefund(vars: {
  name: string;
  phone: string;
  amount: number;
  hour: string;
  date: string;
  court: string;
  reason: string;
}): Promise<void> {
  const stored = (await db.challengeSettings.findFirst({ select: { ownerRefundPush: true } }))
    ?.ownerRefundPush;
  const tpl = resolveTemplate(stored, DEFAULT_OWNER_REFUND_PUSH);
  const { sendToAdmins } = await import("@/lib/push");
  await sendToAdmins({
    title: renderPush(tpl.title, vars),
    body: renderPush(tpl.body, vars),
    data: { kind: "admin_challenge_refund_owed", amount: String(vars.amount) },
  }).catch((e) => console.error("[challenges] could not tell the arena about a refund:", e));
}

/**
 * Buy the hour, with BOTH halves' money, in one go.
 *
 * Replaces the old pair of functions — one that created a booking on the
 * first payment and one that settled the second against it. There is no
 * first-payment booking any more, so there is no half-settled booking to
 * reconcile: the court is bought once, for the sum of what both captains
 * actually paid, or it is not bought at all.
 *
 * Two things this must get right, because both have cost money before:
 *
 *  - The conditional attach is the serialisation point. Two halves landing in
 *    the same instant both reach here; exactly one wins, and the loser's
 *    booking is rolled back by its own transaction rather than deleted
 *    afterwards, so no moment exists where a booking holds an hour without
 *    being attached to the challenge that paid for it.
 *  - `advanceAmount` is the sum of the two captures, never a recomputed
 *    percentage. Whatever the venue did to `advancePct` or to the hour's
 *    price between the two payments, what was collected online is what was
 *    collected online. A repricing in between moves the GATE balance and
 *    nothing else.
 */
async function buyTheHour(
  ctx: {
    challengeId: string;
    slot: ClaimedSlot;
    challenge: { sport: string; createdByUserId: string };
    win: { date: Date; startHour: number; endHour: number; courtConfigId: string | null };
    razorpayOrderId: string;
    razorpayPaymentId: string;
    razorpaySignature: string;
    platform?: string;
  },
  placed: {
    id: string;
    side: string;
    amount: number;
    userId: string;
    razorpayPaymentId: string | null;
    quotedCourtConfigId: string | null;
    quotedTotal: number | null;
  }[],
): Promise<Placement> {
  const hours = windowHours(ctx.win.startHour, ctx.win.endHour);

  // The court both captains were quoted, or nothing. Silently moving a match
  // to a different court — cheaper, smaller, or just not the one they agreed
  // — is not a thing this may do on its own.
  // THE FIRST HALF'S PIN IS THE DEAL — not whoever happens to land last.
  //
  // Both pins are per-row, and the second row is pinned from a fresh quote. So
  // when a walk-in took one half of a ground between the two payments, the
  // second captain's quote quietly re-searched, found the other half free, and
  // `buyTheHour` booked THAT: two captains who were quoted a full pitch for an
  // eleven-a-side match were sold half a pitch, and the first was never told.
  // The same mechanism sold a court at the second half's re-priced total,
  // which is how `Payment.amount` could exceed `Booking.totalAmount`.
  //
  // `placed` is ordered by `placedAt`, so `placed[0]` is the half that was
  // quoted first and is what the other half was quoted against.
  const firstPin = placed[0];
  const quotedCourt =
    firstPin?.quotedCourtConfigId ?? ctx.slot.quotedCourtConfigId ?? ctx.win.courtConfigId;
  const courtId = quotedCourt
    ? (await freeCourtFor(ctx.challenge.sport, ctx.win.date, hours, quotedCourt)) === quotedCourt
      ? quotedCourt
      : null
    : await freeCourtFor(ctx.challenge.sport, ctx.win.date, hours, null);

  if (!courtId) {
    // THE HOUR WENT. Nothing was ever held, so this is the case the venue
    // accepted when it chose to block only on the second payment — and every
    // rupee on this challenge is now owed back.
    const now = await db.challenge.findUnique({
      where: { id: ctx.challengeId },
      select: { bookingId: true },
    });
    if (now?.bookingId) return { kind: "lostRace" };
    return { kind: "slotLost" };
  }

  const prices = await getSlotPricesForDate(courtId, ctx.win.date);
  const slots = hours.map((h) => ({
    startHour: h,
    price: prices.find((p) => p.hour === h)?.price ?? 0,
  }));
  const liveTotal = slots.reduce((s, x) => s + x.price, 0);
  // THE TOTAL THE CAPTAINS WERE QUOTED, not the rate card as it stands now.
  //
  // Pinning only the advance meant a venue editing prices between the two
  // payments handed the captains a gate balance nobody had shown them: quoted
  // "₹1600 court, ₹800 at the gate", charged correctly, then booked at ₹3000
  // with ₹2200 due. Worse in the other direction — a price cut below the
  // advance produced a NEGATIVE `remainingAmount`, which every gate-collection
  // and revenue query reads as a credit.
  const total = firstPin?.quotedTotal ?? ctx.slot.quotedTotal ?? liveTotal;
  // What was actually captured, from both sides. This IS the advance.
  const advance = placed.reduce((s, p) => s + p.amount, 0);
  const gateBalance = Math.max(0, total - advance);
  // A court now priced below what was collected online is money the arena owes
  // back. Rare, and always an admin editing the rate card mid-flight — but it
  // must not be silent, because nothing else in the system would notice.
  if (advance > total) {
    const over = advance - total;
    await logChallengeEvent({
      type: "REFUSED",
      challengeId: ctx.challengeId,
      detail: `collected ₹${advance} online for a court now priced ₹${total} — ₹${over} owed back`,
    });
    // AND tell the arena. A line in the activity feed is exactly the "money
    // discoverable only by reading prose" that `refundOwedAt` was added to end;
    // this overage has no half of its own to flag, so the notification is the
    // whole of the trail. It is split across the two captains, because that is
    // who over-paid.
    for (const p of placed) {
      const share = Math.round((over * p.amount) / Math.max(1, advance));
      if (share > 0) {
        await tellTheArenaAboutARefundFor(
          p.userId,
          share,
          ctx.challengeId,
          `the court was re-priced to ₹${total} after ₹${advance} had been collected online`,
        );
      }
    }
  }
  // Deterministic: the first half placed is the booking's primary reference
  // and the second is the secondary, so a settlement report reconciles the
  // same way every time.
  const [first, second] = placed;

  const dateStr = ctx.win.date.toISOString().slice(0, 10);
  const bought = await db
    .$transaction(async (tx) => {
      // ASK THE HOUR UNDER A LOCK, INSIDE THE TRANSACTION.
      //
      // `freeCourtFor` above is a plain read taken before this transaction
      // opens, and the conditional attach below serialises this challenge
      // against ITSELF — not the hour against the world. So between the read
      // and the insert the hour looked free to every other path, and a
      // challenge capture racing a walk-in's checkout could double-book it.
      //
      // `slot-hold.ts` has owned the answer to this all along: one advisory
      // lock per (court, date, hour), taken in sorted order. The challenge path
      // was keeping a second, unlocked copy of the question. It now takes the
      // same locks, then asks again — because the whole point of the lock is
      // that the answer may have changed.
      for (const h of [...hours].sort((a, b) => a - b)) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${advisoryLockKey(courtId, dateStr, h)}::bigint)`;
      }
      // On the TRANSACTION's client: the lock is held on this connection, and
      // asking the question on another one takes a second connection from the
      // pool for the whole time it is held.
      const stillFree = await freeCourtFor(
        ctx.challenge.sport,
        ctx.win.date,
        hours,
        courtId,
        tx as unknown as typeof db,
      );
      if (stillFree !== courtId) throw new HourGone();

      const created = await tx.booking.create({
        data: {
          userId: ctx.challenge.createdByUserId,
          courtConfigId: courtId,
          date: ctx.win.date,
          // CONFIRMED, not PENDING: both halves of the advance are in, so
          // there is nothing provisional left about it. The old PENDING row
          // existed to hold an hour against one payment, which is exactly
          // what no longer happens.
          status: "CONFIRMED",
          totalAmount: total,
          platform: ctx.platform ?? "ios",
          slots: { create: slots },
          payment: {
            create: {
              method: "RAZORPAY",
              status: gateBalance > 0 ? "PARTIAL" : "COMPLETED",
              amount: advance,
              isPartialPayment: gateBalance > 0,
              advanceAmount: advance,
              remainingAmount: gateBalance,
              confirmedAt: new Date(),
              razorpayOrderId: ctx.razorpayOrderId,
              razorpayPaymentId: first?.razorpayPaymentId ?? ctx.razorpayPaymentId,
              razorpaySignature: ctx.razorpaySignature,
              secondRazorpayPaymentId: second?.razorpayPaymentId ?? null,
            },
          },
        },
        select: { id: true },
      });

      const attached = await tx.challenge.updateMany({
        where: { id: ctx.challengeId, bookingId: null },
        data: { status: "CONFIRMED", bookingId: created.id },
      });
      // Throwing rolls the booking back rather than deleting it afterwards.
      if (attached.count === 0) throw new LostRace();
      return { bookingId: created.id };
    })
    .catch((e) => {
      if (e instanceof LostRace) return null;
      if (e instanceof HourGone) return "gone" as const;
      throw e;
    });

  if (bought === "gone") {
    // WHOSE booking took the hour?
    //
    // Two placements of the same challenge run concurrently — a double-tapped
    // verify, an app retry, or the repair sweep racing the payer. Both pass the
    // unlocked availability read; one wins the lock and books; the loser then
    // takes the lock, re-checks, and finds the hour occupied BY ITS OWN
    // CHALLENGE'S BOOKING. Reporting that as "the hour went" announced a
    // booked, paid, confirmed match as lost and put both halves on the refunds
    // queue: the venue refunds ₹1000 by hand for an hour it has sold and will
    // hand over, the hour cannot be resold, and the captains — told it was
    // cancelled — never come to pay the gate balance.
    //
    // The `!courtId` branch has always asked this. This one did not.
    const now = await db.challenge.findUnique({
      where: { id: ctx.challengeId },
      select: { bookingId: true },
    });
    if (now?.bookingId) {
      return { kind: "settled", bookingId: now.bookingId, status: "CONFIRMED" };
    }
    return { kind: "slotLost" };
  }
  if (!bought) return { kind: "lostRace" };
  return { kind: "booked", bookingId: bought.bookingId, status: "CONFIRMED" };
}

/** Thrown to roll back a booking whose challenge was claimed by somebody else. */
class LostRace extends Error {}

/** Thrown when the locked re-check finds the hour has gone after all. */
class HourGone extends Error {}

/**
 * Challenges whose hour has been sold to somebody else.
 *
 * Nothing holds a court until both captains have paid, so between a challenge
 * being posted and its second half landing, an ordinary booking can take the
 * hour. Nobody finds out from the payment path, because nobody is paying —
 * which is exactly the case the venue asked to be communicated: the captains
 * must hear that the hour is gone, and if money is in, the arena must hear
 * whose it owes.
 *
 * Runs on the per-minute cron, so "somebody else booked it" reaches both
 * captains within a minute rather than when one of them next opens the app.
 *
 * A challenge with several times offered is NOT discarded because one of them
 * went — the others are still playable, and killing a live challenge over one
 * lost option would throw away the reason for offering three. It is discarded
 * when there is nothing left to play: the agreed hour has gone, or every
 * offered hour has.
 */
export async function discardChallengesWhoseHourWent(now = new Date()): Promise<number> {
  const live = await db.challenge.findMany({
    where: {
      status: { in: ["OPEN", "COUNTERED", "AGREED", "PART_PAID"] },
      bookingId: null,
    },
    select: {
      id: true,
      sport: true,
      teamName: true,
      agreedWindowId: true,
      createdBy: { select: { id: true, name: true } },
      acceptedBy: { select: { id: true, name: true } },
      windows: {
        where: { status: { in: ["OFFERED", "ACCEPTED"] } },
        select: { id: true, date: true, startHour: true, endHour: true, courtConfigId: true },
      },
      payments: { where: { paidAt: { not: null } }, select: { quotedCourtConfigId: true } },
    },
    // OLDEST FIRST, and bounded. Unordered, a venue with more than 200 live
    // challenges could have the same page returned every tick while others were
    // never examined — and this is the sweep that tells two captains their hour
    // has gone. Ordered, every discarded challenge leaves the set, so the queue
    // drains instead of circling.
    orderBy: { createdAt: "asc" },
    take: 200,
  });

  let discarded = 0;
  for (const c of live) {
    // The agreed hour if there is one, otherwise every hour still on offer.
    const decisive = c.agreedWindowId
      ? c.windows.filter((w) => w.id === c.agreedWindowId)
      : c.windows;
    if (decisive.length === 0) continue;

    // A window is dead if the court it was quoted on is gone, or — when no
    // court was pinned — if no court of that sport is free for it any more.
    const quotedCourt = c.payments.find((p) => p.quotedCourtConfigId)?.quotedCourtConfigId ?? null;
    const alive: typeof decisive = [];
    for (const w of decisive) {
      // Only hours still in the future can be lost; a window already in the
      // past is the expiry sweep's business, not this one's.
      if (slotStart(w.date, w.startHour).getTime() <= now.getTime()) continue;
      const want = quotedCourt ?? w.courtConfigId;
      const free = await freeCourtFor(c.sport, w.date, windowHours(w.startHour, w.endHour), want);
      if (want ? free === want : !!free) alive.push(w);
    }
    if (alive.length > 0) continue;

    const gone = decisive[0];
    const court = quotedCourt ?? gone.courtConfigId;
    const label = court
      ? (await db.courtConfig.findUnique({ where: { id: court }, select: { label: true } }))?.label
      : null;
    const tpls = await db.challengeSettings.findFirst({ select: { slotLostPush: true } });
    const ok = await discardForLostHour({
      challengeId: c.id,
      reason: "the hour was booked by somebody else before both halves were in",
      captains: [c.createdBy, c.acceptedBy],
      pushVars: {
        name: "The other captain",
        team: c.teamName ?? c.createdBy?.name ?? "the other side",
        hour: `${hourWord(gone.startHour)}–${hourWord(gone.endHour)}`,
        date: istDayLabel(gone.date),
        court: label ?? "",
        amount: 0,
        total: 0,
        balance: 0,
      },
      slotLostTemplate: resolveTemplate(tpls?.slotLostPush, DEFAULT_LIFECYCLE_PUSHES.slotLost),
    });
    if (ok) discarded += 1;
  }
  return discarded;
}

/**
 * Finish halves that were claimed and then stranded.
 *
 * A capture is claimed before any booking work, so a request that dies in
 * between leaves real money on a row that holds no court. Retrying the same
 * capture repairs it — but nothing retries: the app calls verify once, and
 * the customer who comes back is shown a Pay button their own claimed row
 * then refuses. So the repair cannot depend on them returning.
 *
 * Runs on the per-minute cron. Two minutes of grace, so a request that is
 * merely slow is never competing with its own repair.
 *
 * Idempotent by construction: every row it touches is claimed-but-unplaced,
 * and the placement it runs claims the booking with the same conditional
 * attach every other payer uses. A row that has since been placed, or
 * flagged for refund, is not selected at all.
 */
export async function resumeStalledPayments(now = new Date()): Promise<number> {
  const stalled = await db.challengePayment.findMany({
    where: {
      paidAt: { not: null, lt: new Date(now.getTime() - 2 * 60000) },
      placedAt: null,
      refundOwedAt: null,
      razorpayOrderId: { not: null },
      razorpayPaymentId: { not: null },
    },
    select: {
      id: true,
      challengeId: true,
      userId: true,
      side: true,
      amount: true,
      acceptWindowId: true,
      quotedCourtConfigId: true,
      quotedAdvance: true,
      quotedTotal: true,
      razorpayOrderId: true,
      razorpayPaymentId: true,
      razorpaySignature: true,
    },
    take: 50,
  });

  // A challenge can also stall with BOTH halves placed and no booking — the
  // request that should have bought the hour died after stamping. Those rows
  // are not selected above (they are placed), so ask for them separately and
  // re-run the payer's own path, which is idempotent.
  const unbought = await db.challengePayment.findMany({
    where: {
      placedAt: { not: null, lt: new Date(now.getTime() - 2 * 60000) },
      refundOwedAt: null,
      refundedAt: null,
      razorpayOrderId: { not: null },
      razorpayPaymentId: { not: null },
      challenge: { bookingId: null, status: { in: ["AGREED", "PART_PAID"] } },
    },
    select: {
      id: true,
      challengeId: true,
      userId: true,
      side: true,
      amount: true,
      acceptWindowId: true,
      quotedCourtConfigId: true,
      quotedAdvance: true,
      quotedTotal: true,
      razorpayOrderId: true,
      razorpayPaymentId: true,
      razorpaySignature: true,
      challenge: { select: { payments: { where: { placedAt: { not: null } }, select: { side: true } } } },
    },
    take: 50,
  });
  const bothIn = unbought.filter(
    (r) => new Set(r.challenge.payments.map((p) => p.side)).size >= 2,
  );

  let finished = 0;
  for (const row of [...stalled, ...bothIn]) {
    const result = await placeClaimedPayment({
      challengeId: row.challengeId,
      userId: row.userId,
      slot: {
        rowId: row.id,
        side: row.side as ChallengeSide,
        amount: row.amount,
        acceptWindowId: row.acceptWindowId,
        quotedCourtConfigId: row.quotedCourtConfigId,
        quotedAdvance: row.quotedAdvance,
        quotedTotal: row.quotedTotal,
      },
      razorpayOrderId: row.razorpayOrderId as string,
      razorpayPaymentId: row.razorpayPaymentId as string,
      razorpaySignature: row.razorpaySignature ?? "",
    }).catch((e) => {
      console.error("[challenges] could not finish a stranded payment:", row.id, e);
      return null;
    });
    // A refusal is also a resolution: it stamps refundOwedAt, so the row
    // leaves this queue and appears on the venue's refunds panel instead of
    // being retried for ever.
    if (result?.ok) finished += 1;
  }
  return finished;
}

export async function confirmChallengePayment(args: {
  challengeId: string;
  userId: string;
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
  platform?: string;
}): Promise<{ ok: true; status: string; bookingId: string | null } | { ok: false; error: string }> {
  // ── 1. Is this capture real, and is its slot ours to process? ──
  const claim = await claimSlot(args);
  if (claim.kind === "refused") return { ok: false, error: claim.error };
  if (claim.kind === "alreadyDone") {
    return { ok: true, status: claim.status, bookingId: claim.bookingId };
  }
  return placeClaimedPayment({ ...args, slot: claim.slot });
}

/**
 * Stages 2–5: everything after a capture has been claimed.
 *
 * Separate from the claim so a half that was claimed and then stranded —
 * the request died between the two — can be finished later without a
 * signature to re-verify. The claim IS the proof the signature verified;
 * re-deciding that on a repair would mean the repair could never run.
 */
async function placeClaimedPayment(args: {
  challengeId: string;
  userId: string;
  slot: ClaimedSlot;
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
  platform?: string;
}): Promise<{ ok: true; status: string; bookingId: string | null } | { ok: false; error: string }> {
  const { challengeId, userId, slot } = args;

  // ── 2. Does the challenge still want the money? ──
  //
  // Everything from here on has CAPTURED money behind it, so no branch may
  // simply refuse: each one records the capture and says a refund is owed.
  const c = await db.challenge.findUnique({ where: { id: challengeId }, select: challengeForPay });
  if (!c) {
    return refundOwed({
      challengeId,
      userId,
      detail: `paid ₹${slot.amount} against a challenge that no longer exists — refund owed`,
      rowId: slot.rowId,
      // A minimal but TRUE set: the hour and court are unknowable here, and a
      // template rendering "court=" is better than one rendering "{court}".
      vars: { amount: slot.amount, name: "", team: "", hour: "", date: "", court: "", total: 0, balance: 0 },
      title: "That match is gone",
      body: "Your payment went through just after it was removed. The arena will refund you.",
      error: "That challenge is gone. The arena will refund you.",
    });
  }

  if (c.status === "WITHDRAWN" || c.status === "EXPIRED" || c.status === "SLOT_LOST") {
    return refundOwed({
      challengeId,
      userId,
      detail: `paid ₹${slot.amount} after the challenge was ${c.status.toLowerCase()} — refund owed`,
      rowId: slot.rowId,
      vars: {
        amount: slot.amount,
        name: "",
        team: c.teamName ?? "",
        hour: "",
        date: "",
        court: "",
        total: 0,
        balance: 0,
      },
      title: "That match was called off",
      body: "Your payment went through just after it ended. The arena will refund you.",
      error: "That match was called off just before your payment. The arena will refund you.",
    });
  }

  // When the payment IS the acceptance, the window comes off the payment
  // row — the challenge has no agreed window until this moment.
  const acceptingNow = !c.acceptedByUserId && !c.agreedWindowId && !!slot.acceptWindowId;
  const win = c.windows.find((w) => w.id === (acceptingNow ? slot.acceptWindowId : c.agreedWindowId));
  if (!win) {
    return refundOwed({
      challengeId,
      userId,
      detail: `paid ₹${slot.amount} but the match moved on before it landed — refund owed`,
      rowId: slot.rowId,
      vars: {
        amount: slot.amount,
        name: "",
        team: c.teamName ?? "",
        hour: "",
        date: "",
        court: "",
        total: 0,
        balance: 0,
      },
      title: "That match moved on",
      body: "Your payment went through just after somebody else took it. The arena will refund you.",
      error: "Somebody else took this one while you were paying. The arena will refund you.",
    });
  }

  // ── The venue's words for all of this ──
  //
  // Four of the five match-lifecycle messages are sent from this function.
  // They were hard-coded strings, which put the most-read copy in the module
  // beyond the reach of the person who knows what to say to a captain at 9pm
  // — the exact thing this module was built not to do.
  const tpls = await db.challengeSettings.findFirst({
    select: { payHalfPush: true, confirmedPush: true, slotLostPush: true },
  });
  const quoted = await challengeQuote(challengeId, userId).catch(() => null);
  const quotedCourtLabel = slot.quotedCourtConfigId
    ? (
        await db.courtConfig.findUnique({
          where: { id: slot.quotedCourtConfigId },
          select: { label: true },
        })
      )?.label
    : null;
  const pushVars = {
    // A placeholder only for the messages that go to nobody in particular.
    // Anything addressed to ONE captain must build its own vars with
    // `varsFor`, below — `{name}` hard-coded here meant a venue writing
    // "{name} has paid their half" shipped "The other captain has paid their
    // half" to both captains, for ever, while both names sat in the database.
    name: "The other captain",
    team: c.teamName ?? c.createdBy?.name ?? "the other side",
    hour: `${hourWord(win.startHour)}–${hourWord(win.endHour)}`,
    date: istDayLabel(win.date),
    // The court the halves were QUOTED on, not whatever is free now. When the
    // hour has gone `challengeQuote` finds no court and the label comes back
    // null — which is exactly the moment these messages are sent, so the arena
    // was told "Tue, 29 Sep 7pm–8pm on  was booked by somebody else".
    court: quoted?.courtLabel ?? quotedCourtLabel ?? "",
    amount: slot.amount,
    total: quoted?.total ?? 0,
    balance: quoted?.venueBalance ?? 0,
  };
  /** The same vars, but `{name}` is the OTHER captain from the reader's seat. */
  const varsFor = (reader: { id: string } | null, extra?: Record<string, string | number>) => {
    const other = reader?.id === c.createdBy?.id ? c.acceptedBy : c.createdBy;
    return { ...pushVars, name: other?.name ?? "The other captain", ...extra };
  };

  // ── 2b. Is it still early enough to hold this hour? ──
  //
  // The gate in `challengeQuote` only guards the moment the ORDER opens. A
  // captain could open the sheet at 4h01m before the slot, sit on it, and
  // press pay five minutes before the hour — and the court was blocked. It
  // also fired by accident, whenever somebody simply left the sheet open.
  //
  // Only the payment that BLOCKS the court is gated: once the hour is held,
  // the second half settling late costs the venue nothing, and refusing it
  // would strand money on a match that is already booked.
  // THE SECOND HALF. Under the both-halves rule it is the second payment that
  // commits the venue to staffing an hour, and the quote has always gated it
  // that way (`blocksTheCourt = paidSides.length === 1`). The capture gate was
  // still written for the old rule and fired on the FIRST half instead — the
  // exact opposite pair. So the first payer, whose money holds nothing, could
  // be charged and instantly refused with "your money is safe, the arena will
  // refund it", while the captain whose payment actually buys the court could
  // hold the sheet open and commit the venue with no notice at all.
  if ((await paidSides(challengeId)).length === 1) {
    const settings = await db.challengeSettings.findFirst({ select: { minLeadMins: true } });
    // A grace of ten minutes, because this gate must catch somebody holding
    // the sheet for hours and must NOT punish an honest payer whose capture
    // took a minute longer than the gateway usually does.
    const late =
      settings?.minLeadMins
        ? leadTimeRefusal(
            slotStart(win.date, win.startHour),
            new Date(Date.now() - 10 * 60000),
            settings.minLeadMins,
          )
        : null;
    if (late) {
      return refundOwed({
        challengeId,
        userId,
        rowId: slot.rowId,
        vars: pushVars,
        detail: `paid ₹${slot.amount} too close to the slot to hold it — refund owed`,
        title: "That was too close to the hour",
        body: "Your payment landed too near the slot for us to hold the court. The arena will refund you in full.",
        error: `${late} Your money is safe — the arena will refund it.`,
      });
    }
  }

  // ── 3. If this payment is the acceptance, settle the handshake ──
  if (acceptingNow) {
    await db.$transaction([
      db.challengeWindow.update({ where: { id: win.id }, data: { status: "ACCEPTED" } }),
      db.challengeWindow.updateMany({
        where: { challengeId, id: { not: win.id }, status: "OFFERED" },
        data: { status: "DECLINED" },
      }),
      db.challenge.update({
        where: { id: challengeId },
        data: { acceptedByUserId: userId, acceptedAt: new Date(), agreedWindowId: win.id },
      }),
    ]);
    await logChallengeEvent({
      type: "ACCEPTED",
      userId,
      challengeId,
      detail: "accepted by paying",
      meta: { windowId: win.id },
    });
  }

  // ── 4. Put the money somewhere ──
  const placement = await placeMoney({
    challengeId,
    slot,
    challenge: { sport: c.sport, createdByUserId: c.createdByUserId },
    win,
    razorpayOrderId: args.razorpayOrderId,
    razorpayPaymentId: args.razorpayPaymentId,
    razorpaySignature: args.razorpaySignature,
    platform: args.platform,
  });

  if (placement.kind === "lostRace") {
    // Reachable only if the winning booking vanished between the attach and
    // this read. Captured money with nowhere to go is a refund, never a
    // silent success.
    return refundOwed({
      challengeId,
      userId,
      rowId: slot.rowId,
      vars: pushVars,
      detail: `paid ₹${slot.amount} but the booking it should settle had gone — refund owed`,
      title: "We owe you a refund",
      body: "Your payment landed but the booking it belonged to was no longer there. The arena will refund you in full.",
      error: "Something went wrong holding that hour. Your money is safe — the arena will refund it.",
    });
  }

  if (placement.kind === "slotLost") {
    // THE HOUR WENT, AND BOTH CAPTAINS HAVE PAID.
    //
    // Nothing was holding the court, which is the deal the venue chose. So
    // this is the one outcome that has to be handled completely rather than
    // merely handled: every captured half is flagged, both captains are told,
    // and the arena is told whose money it owes and how much — because no
    // refund here happens by itself.
    await discardForLostHour({
      challengeId,
      reason: "the hour was booked by somebody else before both halves were in",
      captains: [c.createdBy, c.acceptedBy],
      pushVars,
      slotLostTemplate: resolveTemplate(tpls?.slotLostPush, DEFAULT_LIFECYCLE_PUSHES.slotLost),
    });
    return {
      ok: false,
      error:
        "That hour was taken before both halves were in. Nothing is held — the arena will refund you in full.",
    };
  }

  // ── 5. Tell the people it changes something for ──
  await logChallengeEvent({
    type: "PAID",
    userId,
    challengeId,
    detail: `${slot.side.toLowerCase()} paid ₹${slot.amount}${
      placement.kind === "halfPaid"
        ? " · waiting on the other half, the hour is NOT held"
        : " · both halves in, court booked"
    }`,
  });

  const other = slot.side === "CHALLENGER" ? c.acceptedBy : c.createdBy;
  const payer = slot.side === "CHALLENGER" ? c.createdBy : c.acceptedBy;
  if (placement.status !== "CONFIRMED" && other) {
    const half = resolveTemplate(tpls?.payHalfPush, DEFAULT_LIFECYCLE_PUSHES.payHalf);
    // {name} is whoever just PAID, and {amount} is what the recipient owes —
    // not what the payer paid. With a mid-window rate change those two
    // numbers differ, and the one that matters to the reader is theirs.
    const theirs = varsFor(other, {
      // {amount} is what the READER owes, not what the payer paid — with a
      // mid-window rate change those differ, and theirs is the one that
      // matters to them.
      amount: Math.max(0, (quoted?.advance ?? 0) - slot.amount) || slot.amount,
    });
    await notifyUser(other.id, {
      type: "CHALLENGE_PAY_YOUR_HALF",
      title: renderPush(half.title, theirs),
      body: renderPush(half.body, theirs),
      link: `/challenges/${challengeId}`,
    });
  }
  if (placement.status === "CONFIRMED") {
    // Claim the announcement. When both halves land in the same instant both
    // payers compute CONFIRMED and both loops ran, so each captain was told
    // "Match confirmed" twice. The conditional update is the serialisation
    // point — exactly one caller sees count 1.
    const announce = await db.challenge.updateMany({
      where: { id: challengeId, confirmedNotifiedAt: null },
      data: { confirmedNotifiedAt: new Date() },
    });
    const done = resolveTemplate(tpls?.confirmedPush, DEFAULT_LIFECYCLE_PUSHES.confirmed);
    for (const u of announce.count === 1 ? [c.createdBy, c.acceptedBy] : []) {
      if (u) {
        await notifyUser(u.id, {
          type: "CHALLENGE_CONFIRMED",
          title: renderPush(done.title, varsFor(u)),
          body: renderPush(done.body, varsFor(u)),
          link:
            placement.kind === "booked" || placement.kind === "settled"
              ? `/bookings/${placement.bookingId}`
              : `/challenges/${challengeId}`,
        });
      }
    }
  }

  // NOW the order is accounted for. Stamped here rather than at claim time,
  // because a capture the system later refuses is not "processed normally" —
  // and stamping it early put the same money on the venue's refunds queue
  // twice, once from each source, with the panel totalling it as double.
  await db.challengeOrder
    .updateMany({
      where: { razorpayOrderId: args.razorpayOrderId, settledAt: null },
      data: { settledAt: new Date(), razorpayPaymentId: args.razorpayPaymentId },
    })
    .catch(() => undefined);

  return {
    ok: true,
    status: placement.status,
    bookingId:
      placement.kind === "booked" || placement.kind === "settled" ? placement.bookingId : null,
  };
}
