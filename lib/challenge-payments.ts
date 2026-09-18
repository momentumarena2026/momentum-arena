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
  payRefusal,
  splitShare,
  statusAfterPayment,
  sideOf,
  type ChallengeSide,
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
): Promise<ChallengeQuote | null> {
  const c = await db.challenge.findUnique({
    where: { id: challengeId },
    select: challengeForPay,
  });
  if (!c) return null;

  const win = c.windows.find((w) => w.id === c.agreedWindowId) ?? null;
  const hours = win ? windowHours(win.startHour, win.endHour) : [];
  const paidSides = c.payments.filter((p) => p.paidAt).map((p) => p.side as ChallengeSide);
  const side = sideOf(c, viewerId);

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
  const settings = await db.challengeSettings.findFirst({ select: { advancePct: true } });
  const advancePct = settings?.advancePct ?? 50;
  const advance = Math.round((total * advancePct) / 100);
  const shares = splitShare(advance);
  const refusal =
    payRefusal(c, viewerId, new Date(), paidSides) ??
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
): Promise<
  | { ok: true; orderId: string; keyId: string; amount: number; courtLabel: string | null }
  | { ok: false; error: string }
> {
  const quote = await challengeQuote(challengeId, userId);
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
  if (quote.total <= 0 || quote.advance <= 0) {
    return { ok: false, error: "That court has no price set — the venue needs to fix that first." };
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
  const row = await db.challengePayment.upsert({
    where: { challengeId_side: { challengeId, side: quote.yourSide } },
    create: { challengeId, userId, side: quote.yourSide, amount: quote.yourShare },
    update: { amount: quote.yourShare },
    select: { id: true, paidAt: true },
  });
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
 * off the board — and the second settles it. Both halves land through this
 * one function so the two orderings cannot drift apart.
 */
export async function confirmChallengePayment(args: {
  challengeId: string;
  userId: string;
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
  platform?: string;
}): Promise<{ ok: true; status: string; bookingId: string | null } | { ok: false; error: string }> {
  const { challengeId, userId, razorpayOrderId, razorpayPaymentId, razorpaySignature } = args;

  if (!verifyRazorpaySignature(razorpayOrderId, razorpayPaymentId, razorpaySignature)) {
    await logChallengeEvent({
      type: "REFUSED",
      userId,
      challengeId,
      detail: "Payment signature did not verify.",
    });
    return { ok: false, error: "That payment could not be verified." };
  }

  const row = await db.challengePayment.findUnique({
    where: { razorpayOrderId },
    select: { id: true, challengeId: true, userId: true, side: true, amount: true, paidAt: true },
  });
  if (!row || row.challengeId !== challengeId) {
    return { ok: false, error: "That payment does not match this challenge." };
  }
  if (row.userId !== userId) return { ok: false, error: "That payment belongs to somebody else." };
  // Idempotent: a retried verify (double tap, flaky network) must not
  // create a second booking or re-notify anybody.
  if (row.paidAt) {
    const c = await db.challenge.findUnique({
      where: { id: challengeId },
      select: { status: true, bookingId: true },
    });
    return { ok: true, status: c?.status ?? "PART_PAID", bookingId: c?.bookingId ?? null };
  }

  const c = await db.challenge.findUnique({ where: { id: challengeId }, select: challengeForPay });
  if (!c) return { ok: false, error: "That challenge is gone." };

  const win = c.windows.find((w) => w.id === c.agreedWindowId);
  if (!win) return { ok: false, error: "That challenge has no settled time." };
  const hours = windowHours(win.startHour, win.endHour);

  const alreadyPaid = c.payments.filter((p) => p.paidAt).map((p) => p.side as ChallengeSide);
  const paidAfter = [...alreadyPaid, row.side as ChallengeSide];
  const nextStatus = statusAfterPayment(paidAfter);
  const isFirstHalf = alreadyPaid.length === 0;

  let bookingId = c.bookingId;

  if (isFirstHalf) {
    // THE BLOCKING MOMENT. Availability is re-asked here, after the money
    // has been taken but before anything is promised, because the gap
    // between the quote and the charge is exactly where a walk-in books
    // the hour. If it has gone, the money is already captured, so say so
    // plainly and leave the payment recorded and refundable rather than
    // pretending the court exists.
    const courtId = await freeCourtFor(c.sport, win.date, hours, win.courtConfigId);
    if (!courtId) {
      await db.$transaction([
        db.challengePayment.update({
          where: { id: row.id },
          data: { paidAt: new Date(), razorpayPaymentId },
        }),
        db.challenge.update({ where: { id: challengeId }, data: { status: "SLOT_LOST" } }),
      ]);
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
      return { ok: false, error: "That hour went before we could hold it. Your money is safe — the arena will refund it." };
    }

    const prices = await getSlotPricesForDate(courtId, win.date);
    const slots = hours.map((h) => ({
      startHour: h,
      price: prices.find((p) => p.hour === h)?.price ?? 0,
    }));
    const total = slots.reduce((s, x) => s + x.price, 0);
    const settings = await db.challengeSettings.findFirst({ select: { advancePct: true } });
    const advance = Math.round((total * (settings?.advancePct ?? 50)) / 100);

    const booking = await db.booking.create({
      data: {
        userId: c.createdByUserId,
        courtConfigId: courtId,
        date: win.date,
        // PENDING already occupies the slot (OCCUPYING_BOOKING_STATUSES),
        // so creating this row IS the block. No separate hold is needed
        // and none should be added.
        status: "PENDING",
        totalAmount: total,
        platform: args.platform ?? "ios",
        slots: { create: slots },
        payment: {
          create: {
            method: "RAZORPAY",
            status: "PARTIAL",
            amount: row.amount,
            // The booking's own advance is the FULL online slice, of which
            // this captain has paid half. `amount` is what is actually in
            // the bank; `remainingAmount` is everything still owed —
            // the other captain's half plus the venue balance — which is
            // what the collect screens read.
            isPartialPayment: true,
            advanceAmount: advance,
            remainingAmount: total - row.amount,
            razorpayOrderId,
            razorpayPaymentId,
            razorpaySignature,
          },
        },
      },
      select: { id: true },
    });
    bookingId = booking.id;

    await db.$transaction([
      db.challengePayment.update({
        where: { id: row.id },
        data: { paidAt: new Date(), razorpayPaymentId },
      }),
      db.challenge.update({
        where: { id: challengeId },
        data: { status: nextStatus, bookingId },
      }),
    ]);
  } else {
    // The balance. The booking already holds the hour; this only settles it.
    const booking = bookingId
      ? await db.booking.findUnique({
          where: { id: bookingId },
          select: {
            id: true,
            totalAmount: true,
            payment: { select: { id: true, remainingAmount: true } },
          },
        })
      : null;

    // What is still owed AFTER this half lands. Computed from the
    // post-decrement figure, not the pre-decrement one: with advancePct at
    // 100 there is no venue balance, and reading the old value would leave
    // the payment PARTIAL forever with nothing left to collect.
    const venueBalanceAfter = Math.max(0, (booking?.payment?.remainingAmount ?? 0) - row.amount);

    await db.$transaction([
      db.challengePayment.update({
        where: { id: row.id },
        data: { paidAt: new Date(), razorpayPaymentId },
      }),
      ...(booking?.payment
        ? [
            db.payment.update({
              where: { id: booking.payment.id },
              data: {
                // Both online halves are in, so the ADVANCE is settled —
                // but the venue balance is still owed on the day, which is
                // precisely what PARTIAL means here and everywhere else in
                // this codebase. Marking it COMPLETED would tell the collect
                // screens there is nothing to take at the gate.
                status: venueBalanceAfter > 0 ? "PARTIAL" : "COMPLETED",
                amount: { increment: row.amount },
                remainingAmount: { decrement: row.amount },
                confirmedAt: new Date(),
              },
            }),
            db.booking.update({ where: { id: booking.id }, data: { status: "CONFIRMED" } }),
          ]
        : []),
      db.challenge.update({ where: { id: challengeId }, data: { status: nextStatus } }),
    ]);
  }

  await logChallengeEvent({
    type: "PAID",
    userId,
    challengeId,
    detail: `${row.side.toLowerCase()} paid ₹${row.amount}${isFirstHalf ? " · court blocked" : " · match confirmed"}`,
  });

  // Tell the other captain something true and actionable. The first half
  // is the message that matters: their half is now the only thing between
  // the match and a refund.
  const other = row.side === "CHALLENGER" ? c.acceptedBy : c.createdBy;
  const payer = row.side === "CHALLENGER" ? c.createdBy : c.acceptedBy;
  if (isFirstHalf && other) {
    await notifyUser(other.id, {
      type: "CHALLENGE_PAY_YOUR_HALF",
      title: "The court is held — your half is due",
      body: `${payer?.name ?? "The other captain"} paid their half and the hour is booked. Pay yours to confirm the match.`,
      link: `/challenges/${challengeId}`,
    });
  }
  if (nextStatus === "CONFIRMED") {
    for (const u of [c.createdBy, c.acceptedBy]) {
      if (u) {
        await notifyUser(u.id, {
          type: "CHALLENGE_CONFIRMED",
          title: "Match confirmed",
          body: "Both halves are in and the court is booked. See you there.",
          link: bookingId ? `/bookings/${bookingId}` : `/challenges/${challengeId}`,
        });
      }
    }
  }

  return { ok: true, status: nextStatus, bookingId };
}
