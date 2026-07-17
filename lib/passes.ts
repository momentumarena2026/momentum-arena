import { db } from "@/lib/db";
import { RAZORPAY_KEY_ID } from "@/lib/razorpay";
import { getSlotPricesForDate } from "@/lib/pricing";
import { parseBands, slotInBands, bandsSummary } from "@/lib/pass-bands";

/**
 * Monthly Passes — purchase plumbing (money-first). No UserPass row
 * exists until Razorpay confirms capture (verify endpoint or the
 * payment.captured webhook); both paths call materializeUserPass,
 * which is idempotent on razorpayOrderId.
 */

const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || "";

/** Furthest ahead a pass may be scheduled to start. */
const MAX_START_AHEAD_DAYS = 90;

/**
 * Resolve a user/admin-supplied start date (YYYY-MM-DD, IST) into a
 * concrete activation timestamp at IST MIDNIGHT of that day: defaults to
 * today, never earlier than today, capped at +90 days.
 *
 * Midnight (not "now") matters: pass validity is judged against a
 * booking's play DATE (stored at calendar-date midnight), so a pass
 * bought mid-day with "start today" must still cover a booking for
 * today.
 */
export function parseStartDate(dateStr?: string | null): Date {
  const todayIst = new Date(
    `${new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" })}T00:00:00+05:30`,
  );
  if (!dateStr) return todayIst;
  const d = new Date(`${dateStr}T00:00:00+05:30`);
  if (Number.isNaN(d.getTime())) return todayIst;
  if (d.getTime() <= todayIst.getTime()) return todayIst;
  const max = new Date(todayIst.getTime() + MAX_START_AHEAD_DAYS * 86_400_000);
  return d.getTime() > max.getTime() ? max : d;
}

/** Create a Razorpay order for a pass purchase. Notes carry the
 *  routing info the webhook needs to materialize without a DB
 *  intent row (including the scheduled start). */
export async function createPassOrder(
  planId: string,
  userId: string,
  startsAt?: Date,
) {
  const plan = await db.passPlan.findUnique({ where: { id: planId } });
  if (!plan || !plan.isActive) return null;

  const auth = Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString(
    "base64",
  );
  const res = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    signal: AbortSignal.timeout(8000),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${auth}`,
    },
    body: JSON.stringify({
      amount: Math.round(plan.price * 100),
      currency: "INR",
      receipt: `pass_${planId.slice(-12)}`,
      notes: {
        type: "PASS",
        planId,
        userId,
        ...(startsAt ? { startsAt: startsAt.toISOString() } : {}),
      },
    }),
  });
  if (!res.ok) {
    throw new Error(`Razorpay pass order failed: ${await res.text()}`);
  }
  const order = (await res.json()) as { id: string; amount: number };
  return { plan, orderId: order.id, amount: plan.price };
}

/** Idempotently convert a captured payment into a UserPass. Works for
 *  both gateways: pass either a razorpayOrderId or a
 *  phonePeMerchantTxnId as the idempotency key. */
export async function materializeUserPass(args: {
  planId: string;
  userId: string;
  startsAt?: Date;
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  phonePeMerchantTxnId?: string;
  phonePeTransactionId?: string;
}): Promise<{ userPassId: string; alreadyDone: boolean } | null> {
  const existing = await db.userPass.findFirst({
    where: {
      OR: [
        args.razorpayOrderId ? { razorpayOrderId: args.razorpayOrderId } : {},
        args.phonePeMerchantTxnId
          ? { phonePeMerchantTxnId: args.phonePeMerchantTxnId }
          : {},
      ].filter((o) => Object.keys(o).length > 0),
    },
    select: { id: true },
  });
  if (existing) return { userPassId: existing.id, alreadyDone: true };

  const plan = await db.passPlan.findUnique({ where: { id: args.planId } });
  if (!plan) return null;

  // Validity counts from the (possibly future) start date. Fallback
  // (e.g. a legacy order with no startsAt note) = today at IST midnight
  // so a same-day booking is still covered.
  const startsAt = args.startsAt ?? parseStartDate();
  const expiresAt = new Date(
    startsAt.getTime() + plan.validityDays * 24 * 60 * 60 * 1000,
  );
  const created = await db.userPass.create({
    data: {
      planId: plan.id,
      userId: args.userId,
      name: plan.name,
      sport: plan.sport,
      courtConfigId: plan.courtConfigId,
      totalMinutes: plan.totalMinutes,
      price: plan.price,
      validityDays: plan.validityDays,
      remainingMinutes: plan.totalMinutes,
      startsAt,
      expiresAt,
      bands: plan.bands ?? [],
      anchorPrice: plan.anchorPrice,
      razorpayOrderId: args.razorpayOrderId ?? null,
      razorpayPaymentId: args.razorpayPaymentId ?? null,
      phonePeMerchantTxnId: args.phonePeMerchantTxnId ?? null,
    },
  });
  return { userPassId: created.id, alreadyDone: false };
}

/** DQR pass confirm — look up the intent by txn, materialise the pass,
 *  stamp the intent. Called by the status poll + S2S callback; both
 *  idempotent. */
export async function confirmDqrPass(
  transactionId: string,
  providerReferenceId?: string,
): Promise<{ userPassId: string | null; alreadyDone: boolean }> {
  const intent = await db.passPurchaseIntent.findUnique({
    where: { phonePeMerchantTxnId: transactionId },
    select: {
      id: true,
      planId: true,
      userId: true,
      startsAt: true,
      consumedUserPassId: true,
    },
  });
  if (!intent) return { userPassId: null, alreadyDone: false };
  if (intent.consumedUserPassId) {
    return { userPassId: intent.consumedUserPassId, alreadyDone: true };
  }

  const result = await materializeUserPass({
    planId: intent.planId,
    userId: intent.userId,
    startsAt: intent.startsAt,
    phonePeMerchantTxnId: transactionId,
    phonePeTransactionId: providerReferenceId,
  });
  if (!result) return { userPassId: null, alreadyDone: false };

  await db.passPurchaseIntent
    .update({
      where: { id: intent.id },
      data: { consumedUserPassId: result.userPassId },
    })
    .catch(() => {});
  return { userPassId: result.userPassId, alreadyDone: result.alreadyDone };
}

/** Live status for display + eligibility (lazy expiry). A pass whose
 *  start date is still in the future reads as UPCOMING. */
export function passLiveStatus(p: {
  status: string;
  remainingMinutes: number;
  startsAt: Date;
  expiresAt: Date;
}): "ACTIVE" | "EXHAUSTED" | "EXPIRED" | "CANCELLED" | "UPCOMING" {
  if (p.status === "CANCELLED") return "CANCELLED";
  const now = Date.now();
  if (p.startsAt.getTime() > now) return "UPCOMING";
  if (p.expiresAt.getTime() < now) return "EXPIRED";
  if (p.remainingMinutes <= 0) return "EXHAUSTED";
  return "ACTIVE";
}

// ─── Redemption (Phase 3) ────────────────────────────────────────────

/** Eligible pass + coverage math for a hold. Coupons/points don't
 *  combine with passes (v1) — holds carrying either are ineligible. */
export async function getPassOfferForHold(hold: {
  userId: string;
  courtConfigId: string | null;
  date: Date;
  hours: number[];
  totalAmount: number;
  couponId?: string | null;
  pointsToRedeem?: number | null;
  courtConfig?: { slotDurationMinutes: number } | null;
}) {
  if (!hold.courtConfigId) return null;
  if (hold.couponId || (hold.pointsToRedeem ?? 0) > 0) return null;

  const slotMinutes = hold.courtConfig?.slotDurationMinutes ?? 60;
  const neededMinutes = hold.hours.length * slotMinutes;

  // Classify every booked slot (dayType + timeType + price) for the date
  // so we can match slots against each pass's bands and price the
  // uncovered remainder from the actual slot prices.
  const slotPrices = await getSlotPricesForDate(
    hold.courtConfigId,
    hold.date,
  ).catch(() => []);
  const byHour = new Map(slotPrices.map((s) => [s.hour, s]));
  const bookedSlots = hold.hours
    .map((h) => byHour.get(h))
    .filter((s): s is NonNullable<typeof s> => !!s);
  if (bookedSlots.length === 0) return null;

  // Interchangeable court group — a pass bought for the cricket LEFT half
  // must also cover a booking that landed on the RIGHT half (same size,
  // same price). Match any pass whose court is in the same group.
  const holdCfg = await db.courtConfig.findUnique({
    where: { id: hold.courtConfigId },
    select: { sport: true, size: true, category: true },
  });
  if (!holdCfg) return null;
  const groupConfigs = await db.courtConfig.findMany({
    where: {
      sport: holdCfg.sport,
      size: holdCfg.size,
      category: holdCfg.category,
    },
    select: { id: true },
  });
  const groupIds = groupConfigs.map((c) => c.id);

  // Validity is judged against the BOOKING's play date, not the moment
  // of checkout: a pass starting 1 Aug covers a booking made today FOR
  // 2 Aug (and never one for 31 Jul), and a pass can't pay for play
  // scheduled after its expiry. (startsAt/expiresAt sit at IST midnight
  // boundaries; hold.date is the calendar date at UTC midnight, which
  // falls inside the corresponding IST day — the comparisons line up.)
  const passes = await db.userPass.findMany({
    where: {
      // The booker may be the pass OWNER or an added MEMBER — shared
      // passes redeem identically for both.
      OR: [
        { userId: hold.userId },
        { members: { some: { userId: hold.userId } } },
      ],
      courtConfigId: { in: groupIds },
      status: "ACTIVE",
      remainingMinutes: { gt: 0 },
      startsAt: { lte: hold.date }, // pass must have started by play date
      expiresAt: { gt: hold.date }, // …and still be valid on it
    },
    orderBy: { expiresAt: "asc" }, // burn the soonest-expiring first
  });

  // Slot-level coverage: a pass covers the booked slots whose band it
  // carries (sold passes honour their band snapshot — never re-checked
  // against current price). Pick the pass that covers the MOST booked
  // minutes, then the soonest-expiring (already ordered).
  let best:
    | { pass: (typeof passes)[number]; matching: typeof bookedSlots }
    | null = null;
  for (const pass of passes) {
    const bands = parseBands(pass.bands);
    const matching = bookedSlots.filter((s) => slotInBands(bands, s));
    if (matching.length === 0) continue;
    if (!best || matching.length > best.matching.length) {
      best = { pass, matching };
    }
  }
  if (!best) return null;

  const { pass, matching } = best;
  const coverableMinutes = matching.length * slotMinutes;
  const coveredMinutes = Math.min(pass.remainingMinutes, coverableMinutes);
  const coveredSlots = Math.floor(coveredMinutes / slotMinutes);
  // When the balance can't cover every matching slot, cover the priciest
  // ones first so the customer pays the least on the remainder.
  const coveredSet = new Set(
    [...matching]
      .sort((a, b) => b.price - a.price)
      .slice(0, coveredSlots),
  );
  const remainderAmount = bookedSlots
    .filter((s) => !coveredSet.has(s))
    .reduce((sum, s) => sum + s.price, 0);
  const fullCoverage =
    matching.length === bookedSlots.length &&
    coveredMinutes >= coverableMinutes;

  return {
    passId: pass.id,
    passName: pass.name,
    remainingMinutes: pass.remainingMinutes,
    neededMinutes,
    coveredMinutes,
    fullCoverage,
    remainderAmount,
  };
}

/** Rupee worth of `minutes` at a pass's effective rate — the value
 *  attribution recorded per redemption (revenue itself is recognised
 *  once, at purchase). */
export function passMinutesValue(
  pass: { price: number; totalMinutes: number },
  minutes: number,
): number {
  if (pass.totalMinutes <= 0) return 0;
  return Math.round((pass.price * minutes) / pass.totalMinutes);
}

/** Atomic debit — fails (returns false) if the balance moved.
 *  `coveredAmount` = list-price rupees these minutes settle on the
 *  booking (drives owed-at-venue math). */
export async function debitPass(
  passId: string,
  minutes: number,
  bookingId: string,
  coveredAmount = 0,
) {
  const updated = await db.userPass.updateMany({
    where: {
      id: passId,
      remainingMinutes: { gte: minutes },
      status: "ACTIVE",
      expiresAt: { gt: new Date() },
    },
    data: { remainingMinutes: { decrement: minutes } },
  });
  if (updated.count === 0) return false;
  const pass = await db.userPass.findUnique({
    where: { id: passId },
    select: { price: true, totalMinutes: true },
  });
  await db.passRedemption.create({
    data: {
      userPassId: passId,
      bookingId,
      minutes,
      value: pass ? passMinutesValue(pass, minutes) : 0,
      coveredAmount,
    },
  });
  // Flip to EXHAUSTED when the balance hits zero (display nicety).
  await db.userPass.updateMany({
    where: { id: passId, remainingMinutes: { lte: 0 }, status: "ACTIVE" },
    data: { status: "EXHAUSTED" },
  });
  return true;
}

/** Restore hours on an eligible cancellation. No-op if already
 *  restored, no redemption exists, or the pass has expired (dead
 *  hours are dead). */
export async function restorePassForBooking(bookingId: string) {
  const red = await db.passRedemption.findUnique({ where: { bookingId } });
  if (!red || red.restoredAt) return;
  const pass = await db.userPass.findUnique({ where: { id: red.userPassId } });
  if (!pass || pass.expiresAt.getTime() < Date.now() || pass.status === "CANCELLED") return;
  await db.$transaction([
    db.userPass.update({
      where: { id: pass.id },
      data: {
        remainingMinutes: { increment: red.minutes },
        status: "ACTIVE",
      },
    }),
    db.passRedemption.update({
      where: { id: red.id },
      data: { restoredAt: new Date() },
    }),
  ]);
}

/**
 * All passes a user can use — owned + shared with them — in the shape
 * both the web account page and the mobile app render (role, owner,
 * band summary, clock fields). Single source so the two surfaces never
 * drift.
 */
export async function listUserPasses(userId: string) {
  const passes = await db.userPass.findMany({
    where: {
      OR: [{ userId }, { members: { some: { userId } } }],
    },
    orderBy: { purchasedAt: "desc" },
    include: {
      user: { select: { name: true } },
      redemptions: {
        orderBy: { createdAt: "desc" },
        select: { minutes: true, createdAt: true, restoredAt: true, bookingId: true },
      },
    },
  });
  return passes.map((p) => ({
    id: p.id,
    name: p.name,
    sport: String(p.sport),
    totalMinutes: p.totalMinutes,
    remainingMinutes: p.remainingMinutes,
    bandsSummary: bandsSummary(parseBands(p.bands)),
    purchasedAt: p.purchasedAt.toISOString(),
    startsAt: p.startsAt.toISOString(),
    expiresAt: p.expiresAt.toISOString(),
    status: passLiveStatus(p),
    role: p.userId === userId ? ("owner" as const) : ("member" as const),
    ownerName: p.user.name,
    redemptions: p.redemptions.map((r) => ({
      minutes: r.minutes,
      createdAt: r.createdAt.toISOString(),
      restored: !!r.restoredAt,
    })),
  }));
}

/** Master storefront switch (ArenaSettings.passesEnabled). OFF hides
 *  the buying page + blocks purchases; sold passes still redeem. */
export async function arePassesEnabled(): Promise<boolean> {
  try {
    const settings = await db.arenaSettings.findFirst({
      select: { passesEnabled: true },
    });
    return settings?.passesEnabled ?? false;
  } catch {
    return false;
  }
}
