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
  payments: { select: { id: true, side: true, userId: true, amount: true, paidAt: true } },
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
  const paidSides = c.payments.filter((p) => p.paidAt).map((p) => p.side as ChallengeSide);
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
  const courtId =
    (c.bookingId
      ? (await db.booking.findUnique({ where: { id: c.bookingId }, select: { courtConfigId: true } }))
          ?.courtConfigId
      : null) ?? (await freeCourtFor(c.sport, win.date, hours, win.courtConfigId));

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
  const advance = Math.round((total * advancePct) / 100);
  const shares = splitShare(advance);
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

  if (row.paidAt) return { ok: false, error: "You've already paid your half." };

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
  | { kind: "settled"; bookingId: string | null; status: ChallengeStatus }
  | { kind: "slotLost" };

/** Money captured that this system cannot honour. Always leaves a trail. */
async function refundOwed(args: {
  challengeId: string;
  userId: string;
  detail: string;
  title: string;
  body: string;
  error: string;
}): Promise<{ ok: false; error: string }> {
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

/** The sides that have actually paid, read fresh. Never inferred. */
async function paidSides(challengeId: string): Promise<ChallengeSide[]> {
  const rows = await db.challengePayment.findMany({
    where: { challengeId, paidAt: { not: null } },
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
      acceptWindowId: true,
      quotedCourtConfigId: true,
    },
  });
  if (!row || row.challengeId !== challengeId) {
    await logChallengeEvent({
      type: "REFUSED",
      userId,
      challengeId,
      detail: "a captured payment matched no live slot on this challenge — refund owed",
    });
    return { kind: "refused", error: "That payment does not match this challenge." };
  }
  if (row.userId !== userId) {
    await logChallengeEvent({
      type: "REFUSED",
      userId,
      challengeId,
      detail: "paid into a slot that had been reassigned — refund owed",
    });
    return {
      kind: "refused",
      error: "Somebody else took this one while you were paying. The arena will refund you.",
    };
  }

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

  if (row.paidAt) return settled();

  const claimed = await db.challengePayment.updateMany({
    where: { id: row.id, paidAt: null },
    data: { paidAt: new Date(), razorpayPaymentId },
  });
  if (claimed.count === 0) return settled();

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
 * else settles. The loser deletes the booking it speculatively created —
 * leaving it would take an hour off sale that appears in no report and no
 * hold expiry.
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
  return settleAgainst(ctx, winner?.bookingId ?? null);
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

  const booking = await db.booking.create({
    data: {
      userId: ctx.challenge.createdByUserId,
      courtConfigId: courtId,
      date: ctx.win.date,
      // PENDING already occupies the slot (OCCUPYING_BOOKING_STATUSES), so
      // creating this row IS the block. No separate hold is needed.
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

  const status = statusAfterPayment(await paidSides(ctx.challengeId));
  const attached = await db.challenge.updateMany({
    where: { id: ctx.challengeId, bookingId: null },
    data: { status, bookingId: booking.id },
  });
  if (attached.count === 0) {
    await db.payment.deleteMany({ where: { bookingId: booking.id } });
    await db.bookingSlot.deleteMany({ where: { bookingId: booking.id } });
    await db.booking.delete({ where: { id: booking.id } }).catch(() => undefined);
    return { kind: "lostRace" };
  }
  return { kind: "blocked", bookingId: booking.id, status };
}

/** Settle this half against a booking that already holds the hour. */
async function settleAgainst(
  ctx: { challengeId: string; slot: ClaimedSlot },
  bookingId: string | null,
): Promise<Placement> {
  const booking = bookingId
    ? await db.booking.findUnique({
        where: { id: bookingId },
        select: {
          id: true,
          payment: {
            select: { id: true, remainingAmount: true, advanceAmount: true, amount: true },
          },
        },
      })
    : null;

  // Settle what the BOOKING says is outstanding, never a fresh quote. Live
  // re-pricing meant any rate or advancePct edit inside the payment window
  // overcharged the second captain, breaking the one arithmetic promise
  // this module makes: the two halves add back to exactly the advance.
  const owed = Math.max(
    0,
    (booking?.payment?.advanceAmount ?? 0) - (booking?.payment?.amount ?? 0),
  );
  const settling = owed > 0 ? owed : ctx.slot.amount;
  // Computed from the POST-decrement figure: with advancePct at 100 there
  // is no venue balance, and the pre-decrement value would leave the
  // payment PARTIAL for ever with nothing left to collect.
  const venueBalanceAfter = Math.max(0, (booking?.payment?.remainingAmount ?? 0) - settling);

  const status = statusAfterPayment(await paidSides(ctx.challengeId));

  await db.$transaction([
    ...(booking?.payment
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

export async function confirmChallengePayment(args: {
  challengeId: string;
  userId: string;
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
  platform?: string;
}): Promise<{ ok: true; status: string; bookingId: string | null } | { ok: false; error: string }> {
  const { challengeId, userId } = args;

  // ── 1. Is this capture real, and is its slot ours to process? ──
  const claim = await claimSlot(args);
  if (claim.kind === "refused") return { ok: false, error: claim.error };
  if (claim.kind === "alreadyDone") {
    return { ok: true, status: claim.status, bookingId: claim.bookingId };
  }
  const { slot } = claim;

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
      title: "That match moved on",
      body: "Your payment went through just after somebody else took it. The arena will refund you.",
      error: "Somebody else took this one while you were paying. The arena will refund you.",
    });
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

  if (placement.kind === "slotLost") {
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
    for (const u of [c.createdBy, c.acceptedBy]) {
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
