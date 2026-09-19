/**
 * Paying for an agreed challenge.
 *
 * THE VENUE'S DECISION (2026-09-18): the FIRST half paid blocks the court.
 *
 * That one choice settles the hardest question in this module. There is no
 * payment rail in India that can hold a UPI customer's money pending a
 * second stranger's decision — Razorpay auth/capture is card-only, and UPI
 * one-time mandates exclude PhonePe and GPay, which is most of Mathura. So
 * somebody's money is at risk no matter what, and the only real question is
 * whose and against what. Blocking on the first payment means the first
 * captain's money buys something real and immediate — the hour, held — and
 * the second captain is buying into a court that already exists.
 *
 * What this buys, concretely, is that `SLOT_LOST` becomes nearly
 * unreachable. The alternative design — hold nothing until both have paid —
 * has a failure mode where both captains pay and the hour has gone to a
 * walk-in in between, and then the venue owes two refunds and has no match.
 * Here the only way to lose the slot is to lose it before ANY money is
 * taken, which is a refusal, not a refund.
 *
 * What it costs is the mirror case: one side pays, the other never does,
 * and the venue is holding a blocked court against half the money. That is
 * deliberately NOT automated away. It is operationally identical to an
 * ordinary advance booking where the customer never came back — the venue
 * either collects the rest at the gate or cancels and refunds by hand, and
 * `ChallengePayment.refundedAt` exists to record that it did. Automating a
 * refund here would mean automatically releasing a court the venue may
 * already have sold on the phone.
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
import { logChallengeEvent } from "@/lib/challenges";
import {
  leadTimeRefusal,
  payRefusal,
  splitShare,
  sharesAgainstBooking,
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
  payments: { select: { id: true, side: true, userId: true, amount: true, paidAt: true, placedAt: true } },
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
): Promise<string | null> {
  const configs = await db.courtConfig.findMany({
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
    const avail = await getSlotAvailability(c.id, date);
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
    booked?.courtConfigId ?? (await freeCourtFor(c.sport, win.date, hours, win.courtConfigId));

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
        : shares;
  }
  // The lead-time gate belongs on whichever payment BLOCKS the court, not
  // only on a stranger's first one. Once a challenge is AGREED with no money
  // in it, either side's payment is the one that creates the booking — and
  // both were being issued orders two hours before the slot. The exemption
  // in the spec is for the SECOND half, where the hour is already held.
  const blocksTheCourt = paidSides.length === 0;
  const lateRefusal =
    blocksTheCourt && win && settings?.minLeadMins
      ? leadTimeRefusal(
          slotStart(win.date, win.startHour),
          new Date(),
          settings.minLeadMins,
        )
      : null;

  const refusal =
    (acceptingNow
      ? acceptGateRefusal(c, win, settings?.minLeadMins ?? 240, new Date(), settings?.enabled ?? false)
      : payRefusal(c, viewerId, new Date(), paidSides)) ??
    lateRefusal ??
    (courtId
      ? null
      : // Only reachable for the first payer: once one half is in, the
        // booking exists and the court cannot be taken from under them.
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
    return { ok: false, error: "You're not part of this match." };
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
  let row: { id: string; paidAt: Date | null };
  try {
    row = await db.challengePayment.create({
      data: {
        challengeId,
        userId,
        side: quote.yourSide,
        amount: quote.yourShare,
        acceptWindowId: acceptWindowId ?? null,
        quotedCourtConfigId: quote.courtConfigId,
      },
      select: { id: true, paidAt: true },
    });
  } catch {
    // The slot already exists. Only its owner, or a takeover of a hold that
    // has genuinely gone stale, may proceed.
    const current = await db.challengePayment.findUnique({
      where: { challengeId_side: { challengeId, side: quote.yourSide } },
      select: { id: true, userId: true, paidAt: true, createdAt: true, razorpayOrderId: true },
    });
    if (!current) return { ok: false, error: "Couldn't start that payment. Try again." };
    if (current.userId !== userId) {
      if (current.paidAt) return { ok: false, error: "Somebody else has taken this one." };
      const windowMins =
        (await db.challengeSettings.findFirst({ select: { paymentWindowMins: true } }))
          ?.paymentWindowMins ?? 120;
      if (Date.now() < current.createdAt.getTime() + windowMins * 60000) {
        return { ok: false, error: "Someone else is paying for this right now. Try again shortly." };
      }
      if (current.razorpayOrderId) {
        await logChallengeEvent({
          type: "REFUSED",
          userId: current.userId,
          challengeId,
          detail: `their payment slot went stale after ${windowMins} minutes and was reassigned — refund owed if they paid`,
        });
      }
    }
    const taken = await db.challengePayment.updateMany({
      where: { id: current.id, paidAt: null },
      data: {
        userId,
        amount: quote.yourShare,
        acceptWindowId: acceptWindowId ?? null,
        quotedCourtConfigId: quote.courtConfigId,
        // The new holder starts their OWN clock. Inheriting the previous
        // one left them instantly stale, so the slot could be ripped away
        // again immediately — and repeatedly, from whoever was mid-payment.
        createdAt: new Date(),
        // The previous holder's order must not stay attached to a row that
        // now names somebody else.
        razorpayOrderId: null,
      },
    });
    if (taken.count === 0) return { ok: false, error: "You've already paid your half." };
    row = { id: current.id, paidAt: null };
  }

  if (row.paidAt) {
    // Distinguish "done" from "mid-flight". Telling somebody whose placement
    // stalled that they have already paid their half is true and useless:
    // their money is not on the booking yet, and the sweeper is about to put
    // it there.
    const done = await db.challengePayment.findUnique({
      where: { id: row.id },
      select: { placedAt: true },
    });
    return {
      ok: false,
      error: done?.placedAt
        ? "You've already paid your half."
        : "We're still finishing your last payment. Give it a minute, then pull to refresh.",
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
};

/** Where the money ended up. Every branch is a value, not a flag. */
type Placement =
  | { kind: "blocked"; bookingId: string; status: ChallengeStatus }
  | { kind: "settled"; bookingId: string; status: ChallengeStatus }
  | { kind: "slotLost" }
  // The court was neither blocked by us nor available to settle against.
  // Distinct from slotLost, which is a real "the hour went" for the FIRST
  // half; this one means the placement could not be completed at all.
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
}): Promise<{ ok: false; error: string }> {
  if (args.rowId) await markRefundOwed(args.rowId, args.detail);
  await logChallengeEvent({
    type: "REFUSED",
    userId: args.userId,
    challengeId: args.challengeId,
    detail: args.detail,
  });
  await notifyUser(args.userId, {
    type: "CHALLENGE_REFUND_OWED",
    title: args.title,
    body: args.body,
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
async function markRefundOwed(rowId: string, reason: string): Promise<void> {
  await db.challengePayment
    .update({
      where: { id: rowId },
      data: { refundOwedAt: new Date(), refundOwedReason: reason.slice(0, 300) },
    })
    .catch(() => undefined);
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
    },
  });
  if (!row) {
    // The signature verifies, so a capture exists — but not one this module
    // ever opened. An ordinary booking receipt satisfies this branch, so the
    // old "refund owed" line here was writable on demand: anyone holding one
    // genuine capture of their own could POST it against any challenge id
    // and fill the venue's audit trail with fictional refunds. It is not a
    // refund-owed event at all — the money is honoured wherever it was
    // taken. Log it once, as what it is, and claim nothing.
    await logOnce(challengeId, userId, `a payment from elsewhere was offered here (${razorpayPaymentId})`);
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
    // This one IS stranded: the payer's money is captured and their slot now
    // names somebody else. No stamp — the row belongs to the new holder and
    // marking it would flag their perfectly good payment — but the payer
    // must be told, which an error string in an alert they may never see
    // does not do.
    return {
      kind: "refused",
      error: (
        await refundOwed({
          challengeId,
          userId,
          detail: `paid into a slot that had been reassigned (${razorpayPaymentId}) — refund owed`,
          title: "We owe you a refund",
          body: "Somebody else had taken that half by the time your payment landed. The arena will refund you in full.",
          error: "Somebody else took this one while you were paying. The arena will refund you.",
        })
      ).error,
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
  if (existing?.bookingId) return settleAgainst(ctx, existing.bookingId);

  const blocked = await tryBlockCourt(ctx);
  if (blocked.kind !== "lostRace") return blocked;

  // Somebody else blocked it in the same instant. Their booking is the one
  // that exists now; settle against it.
  const winner = await db.challenge.findUnique({
    where: { id: ctx.challengeId },
    select: { bookingId: true },
  });
  // No booking and no court: there is nothing for this money to settle
  // against, so say so rather than stamping the half placed and moving a
  // ledger that does not exist.
  if (!winner?.bookingId) return { kind: "lostRace" };
  return settleAgainst(ctx, winner.bookingId);
}

/** Create the booking and try to attach it. The attach is the serialisation. */
async function tryBlockCourt(ctx: {
  challengeId: string;
  slot: ClaimedSlot;
  challenge: { sport: string; createdByUserId: string };
  win: { date: Date; startHour: number; endHour: number; courtConfigId: string | null };
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
  platform?: string;
}): Promise<Placement | { kind: "lostRace" }> {
  const hours = windowHours(ctx.win.startHour, ctx.win.endHour);

  // ONLY the court this half was quoted against. Re-searching let the
  // booking land on a cheaper court when the quoted one went — two captains
  // charged for a full pitch and given half of one, with `amount` no longer
  // equal to `advanceAmount`. Losing the quoted court is SLOT_LOST, not a
  // downgrade nobody is told about.
  const quotedCourt = ctx.slot.quotedCourtConfigId ?? ctx.win.courtConfigId;
  const courtId = quotedCourt
    ? (await freeCourtFor(ctx.challenge.sport, ctx.win.date, hours, quotedCourt)) === quotedCourt
      ? quotedCourt
      : null
    : await freeCourtFor(ctx.challenge.sport, ctx.win.date, hours, null);
  if (!courtId) {
    // The court may be "taken" precisely because the other captain just
    // booked it. Re-ask before writing SLOT_LOST — telling two paying
    // customers their hour is gone, on a match that is booked, is the
    // costliest wrong answer this function can give.
    const now = await db.challenge.findUnique({
      where: { id: ctx.challengeId },
      select: { bookingId: true },
    });
    if (now?.bookingId) return { kind: "lostRace" };
    await db.challenge.update({
      where: { id: ctx.challengeId },
      data: { status: "SLOT_LOST" },
    });
    return { kind: "slotLost" };
  }

  const prices = await getSlotPricesForDate(courtId, ctx.win.date);
  const slots = hours.map((h) => ({
    startHour: h,
    price: prices.find((p) => p.hour === h)?.price ?? 0,
  }));
  const total = slots.reduce((s, x) => s + x.price, 0);
  const settings = await db.challengeSettings.findFirst({ select: { advancePct: true } });
  const advance = Math.round((total * (settings?.advancePct ?? 50)) / 100);

  // ONE transaction. Creating the booking and attaching it as two
  // statements left a window where the hour was occupied by a PENDING
  // booking while `challenge.bookingId` was still null — so a second
  // captain paying in that instant found the court taken, was told "that
  // hour went, your money is safe", and both captains were pushed
  // SLOT_LOST for a match that was in fact booked and confirmed. It also
  // meant any crash between the two left an orphan booking holding the hour
  // for ever, after which EVERY later payment on that challenge returned
  // SLOT_LOST against the challenge's own booking.
  //
  // Rolling the attach into the transaction makes the two facts atomic: the
  // booking either exists AND is attached, or does not exist at all.
  const placed = await db
    .$transaction(async (tx) => {
      const created = await tx.booking.create({
        data: {
          userId: ctx.challenge.createdByUserId,
          courtConfigId: courtId,
          date: ctx.win.date,
          // PENDING already occupies the slot (OCCUPYING_BOOKING_STATUSES),
          // so creating this row IS the block.
          status: "PENDING",
          totalAmount: total,
          platform: ctx.platform ?? "ios",
          slots: { create: slots },
          payment: {
            create: {
              method: "RAZORPAY",
              status: "PARTIAL",
              amount: ctx.slot.amount,
              isPartialPayment: true,
              advanceAmount: advance,
              remainingAmount: total - ctx.slot.amount,
              razorpayOrderId: ctx.razorpayOrderId,
              razorpayPaymentId: ctx.razorpayPaymentId,
              razorpaySignature: ctx.razorpaySignature,
            },
          },
        },
        select: { id: true },
      });

      // This half is PLACED now, so it counts toward the status. Conditional
      // for the same reason as the attach below: a retry racing the repair
      // sweep must not place one capture twice.
      const stamped = await tx.challengePayment.updateMany({
        where: { id: ctx.slot.rowId, placedAt: null },
        data: { placedAt: new Date() },
      });
      if (stamped.count === 0) throw new LostRace();
      const sides = await tx.challengePayment.findMany({
        where: { challengeId: ctx.challengeId, paidAt: { not: null }, placedAt: { not: null } },
        select: { side: true },
      });
      const status = statusAfterPayment(sides.map((x) => x.side as ChallengeSide));

      const attached = await tx.challenge.updateMany({
        where: { id: ctx.challengeId, bookingId: null },
        data: { status, bookingId: created.id },
      });
      // Throwing rolls the booking back rather than deleting it afterwards,
      // so there is no moment where it exists unattached.
      if (attached.count === 0) throw new LostRace();
      return { bookingId: created.id, status };
    })
    .catch((e) => {
      if (e instanceof LostRace) return null;
      throw e;
    });

  if (!placed) return { kind: "lostRace" };
  return { kind: "blocked", bookingId: placed.bookingId, status: placed.status };
}

/** Thrown to roll back a booking whose challenge was claimed by somebody else. */
class LostRace extends Error {}

/** Settle this half against a booking that already holds the hour. */
async function settleAgainst(
  ctx: { challengeId: string; slot: ClaimedSlot },
  bookingId: string,
): Promise<Placement> {
  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      payment: {
        select: { id: true, remainingAmount: true, advanceAmount: true, amount: true },
      },
    },
  });
  if (!booking) return { kind: "lostRace" };

  // Settle what the BOOKING says is outstanding, never a fresh quote. Live
  // re-pricing meant any rate or advancePct edit inside the payment window
  // overcharged the second captain, breaking the one arithmetic promise
  // this module makes: the two halves add back to exactly the advance.
  const owed = Math.max(
    0,
    (booking.payment?.advanceAmount ?? 0) - (booking.payment?.amount ?? 0),
  );
  // Nothing outstanding means nothing to move. The old fallback to
  // `ctx.slot.amount` here was a double-count waiting for a second settle
  // against an already-settled booking — two overlapping repair sweeps, for
  // instance — and it would have pushed the ledger past the advance with no
  // capture behind the excess.
  const settling = owed;
  // Computed from the POST-decrement figure: with advancePct at 100 there
  // is no venue balance, and the pre-decrement value would leave the
  // payment PARTIAL for ever with nothing left to collect.
  const venueBalanceAfter = Math.max(0, (booking.payment?.remainingAmount ?? 0) - settling);

  // `placedAt` is stamped INSIDE the transaction that moves the money, not
  // before it. Stamping first would mark this half placed even if the ledger
  // write then failed — the same class of lie as the old claimed-counts-as-
  // paid bug, just one stage further down.
  //
  // The status is computed as "the sides already placed, plus this one",
  // because this one is not placed until the transaction commits.
  const status = statusAfterPayment([...(await paidSides(ctx.challengeId)), ctx.slot.side]);

  // The stamp is the serialisation point for placement, exactly as the
  // attach is for blocking: two callers holding the same claimed row — a
  // retry racing the repair sweep — must not both move the ledger.
  const claimed = await db.challengePayment.updateMany({
    where: { id: ctx.slot.rowId, placedAt: null },
    data: { placedAt: new Date() },
  });
  if (claimed.count === 0) return { kind: "settled", bookingId, status };

  await db.$transaction([
    ...(booking.payment
      ? [
          db.payment.update({
            where: { id: booking.payment.id },
            data: {
              // PARTIAL while the gate balance is owed — marking it
              // COMPLETED would tell the collect screens there is nothing
              // to take on the day.
              status: venueBalanceAfter > 0 ? "PARTIAL" : "COMPLETED",
              amount: { increment: settling },
              remainingAmount: { decrement: settling },
              confirmedAt: new Date(),
            },
          }),
          db.booking.update({ where: { id: booking.id }, data: { status: "CONFIRMED" } }),
        ]
      : []),
    db.challenge.update({ where: { id: ctx.challengeId }, data: { status } }),
  ]);

  return { kind: "settled", bookingId, status };
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
      razorpayOrderId: true,
      razorpayPaymentId: true,
      razorpaySignature: true,
    },
    take: 50,
  });

  let finished = 0;
  for (const row of stalled) {
    const result = await placeClaimedPayment({
      challengeId: row.challengeId,
      userId: row.userId,
      slot: {
        rowId: row.id,
        side: row.side as ChallengeSide,
        amount: row.amount,
        acceptWindowId: row.acceptWindowId,
        quotedCourtConfigId: row.quotedCourtConfigId,
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
      title: "That match moved on",
      body: "Your payment went through just after somebody else took it. The arena will refund you.",
      error: "Somebody else took this one while you were paying. The arena will refund you.",
    });
  }

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
  if ((await paidSides(challengeId)).length === 0) {
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
      detail: `paid ₹${slot.amount} but the booking it should settle had gone — refund owed`,
      title: "We owe you a refund",
      body: "Your payment landed but the booking it belonged to was no longer there. The arena will refund you in full.",
      error: "Something went wrong holding that hour. Your money is safe — the arena will refund it.",
    });
  }

  if (placement.kind === "slotLost") {
    await markRefundOwed(slot.rowId, "the hour went before the first half landed");
    await logChallengeEvent({
      type: "SLOT_LOST",
      userId,
      challengeId,
      detail: "the hour went before the first half landed — refund owed",
    });
    for (const u of [c.createdBy, c.acceptedBy]) {
      if (u) {
        await notifyUser(u.id, {
          type: "CHALLENGE_SLOT_LOST",
          title: "That hour went before we could hold it",
          body: "Your payment is safe and the arena will refund it. Agree another time and we'll try again.",
          link: `/challenges/${challengeId}`,
        });
      }
    }
    return {
      ok: false,
      error: "That hour went before we could hold it. Your money is safe — the arena will refund it.",
    };
  }

  // ── 5. Tell the people it changes something for ──
  await logChallengeEvent({
    type: "PAID",
    userId,
    challengeId,
    detail: `${slot.side.toLowerCase()} paid ₹${slot.amount}${
      placement.kind === "blocked" ? " · court blocked" : " · balance settled"
    }`,
  });

  const other = slot.side === "CHALLENGER" ? c.acceptedBy : c.createdBy;
  const payer = slot.side === "CHALLENGER" ? c.createdBy : c.acceptedBy;
  if (placement.status !== "CONFIRMED" && other) {
    await notifyUser(other.id, {
      type: "CHALLENGE_PAY_YOUR_HALF",
      title: "The court is held — your half is due",
      body: `${payer?.name ?? "The other captain"} paid their half and the hour is booked. Pay yours to confirm the match.`,
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
    for (const u of announce.count === 1 ? [c.createdBy, c.acceptedBy] : []) {
      if (u) {
        await notifyUser(u.id, {
          type: "CHALLENGE_CONFIRMED",
          title: "Match confirmed",
          body: "Both halves are in and the court is booked. See you there.",
          link: placement.bookingId
            ? `/bookings/${placement.bookingId}`
            : `/challenges/${challengeId}`,
        });
      }
    }
  }

  return { ok: true, status: placement.status, bookingId: placement.bookingId };
}
