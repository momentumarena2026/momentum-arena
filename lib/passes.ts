import { db } from "@/lib/db";
import { RAZORPAY_KEY_ID } from "@/lib/razorpay";
import { getSlotPricesForDate } from "@/lib/pricing";
import { parseBands, slotInBands, bandsSummary } from "@/lib/pass-bands";
import { courtGroupLabel } from "@/lib/court-config";
import { normalizeIndianPhone } from "@/lib/phone";
import { recordOrphanPayment } from "@/lib/payment-orphan";

/**
 * Monthly Passes — purchase plumbing (money-first). No UserPass row
 * exists until Razorpay confirms capture (verify endpoint or the
 * payment.captured webhook); both paths call materializeUserPass,
 * which is idempotent on razorpayOrderId.
 */

const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || "";

/** Prisma P2002 unique-violation check (same shape as lib/rewards). */
function isUniqueViolation(err: unknown): boolean {
  return (
    err !== null &&
    typeof err === "object" &&
    "code" in err &&
    (err as { code: string }).code === "P2002"
  );
}

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
  try {
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
  } catch (err) {
    // Verify + webhook race the find-then-create: the loser hits the
    // unique gateway-ref constraint — return the winner's pass.
    if (isUniqueViolation(err)) {
      const raced = await db.userPass.findFirst({
        where: {
          OR: [
            args.razorpayOrderId
              ? { razorpayOrderId: args.razorpayOrderId }
              : {},
            args.phonePeMerchantTxnId
              ? { phonePeMerchantTxnId: args.phonePeMerchantTxnId }
              : {},
          ].filter((o) => Object.keys(o).length > 0),
        },
        select: { id: true },
      });
      if (raced) return { userPassId: raced.id, alreadyDone: true };
    }
    throw err;
  }
}

/** Sentinel stored in PassPurchaseIntent.consumedUserPassId when a DQR
 *  capture didn't match the plan price — makes the mismatch terminal
 *  without a schema change. */
const PASS_INTENT_MISMATCH = "AMOUNT_MISMATCH";

/** DQR pass confirm — look up the intent by txn, materialise the pass,
 *  stamp the intent. Called by the status poll + S2S callback; both
 *  idempotent. */
export async function confirmDqrPass(
  transactionId: string,
  providerReferenceId?: string,
  /** Captured amount in PAISE, when the gateway reported one. Checked
   *  against the plan's price — same guard the Razorpay verify/webhook
   *  paths apply — so a plan repriced inside the QR window can't
   *  materialize at the wrong terms. */
  capturedPaise?: number,
): Promise<{
  userPassId: string | null;
  alreadyDone: boolean;
  /** Captured amount didn't match the plan price — terminal, money is
   *  on the orphan worklist. */
  mismatch?: boolean;
}> {
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
  if (intent.consumedUserPassId === PASS_INTENT_MISMATCH) {
    // Already settled as a price mismatch — terminal, orphan filed once.
    return { userPassId: null, alreadyDone: true, mismatch: true };
  }
  if (intent.consumedUserPassId) {
    return { userPassId: intent.consumedUserPassId, alreadyDone: true };
  }
  if (typeof capturedPaise === "number") {
    const plan = await db.passPlan.findUnique({
      where: { id: intent.planId },
      select: { price: true },
    });
    if (!plan || capturedPaise !== Math.round(plan.price * 100)) {
      console.error(
        "[passes] DQR amount mismatch — pass NOT issued",
        transactionId,
        capturedPaise,
        plan?.price ?? "no-plan",
      );
      // Consume the intent so this is TERMINAL: the status poll would
      // otherwise re-enter this branch on every tick, filing one orphan
      // per poll and leaving the customer on a QR screen that never
      // resolves. `mismatch` tells the route to stop polling and say
      // the money was received.
      const firstTime = await db.passPurchaseIntent
        .updateMany({
          where: { id: intent.id, consumedUserPassId: null },
          data: { consumedUserPassId: PASS_INTENT_MISMATCH },
        })
        .then((r) => r.count === 1)
        .catch(() => false);
      if (firstTime) {
        recordOrphanPayment({
          gateway: "PHONEPE_DQR",
          reason: "pass-price-mismatch",
          userId: intent.userId,
          amountRupees: Math.round(capturedPaise / 100),
          phonePeMerchantTxnId: transactionId,
        });
      }
      return { userPassId: null, alreadyDone: false, mismatch: true };
    }
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
 *  combine with passes (v1) — holds carrying either are ineligible.
 *  A pass buys COURT TIME only: equipment rental on the hold is always
 *  money, and lands in `remainderAmount`. */
export async function getPassOfferForHold(
  hold: {
  userId: string;
  courtConfigId: string | null;
  date: Date;
  hours: number[];
  totalAmount: number;
  /** Gear the customer ticked — never pass-covered. */
  equipmentTotalAmount?: number | null;
  /** The hold's stored per-slot prices (Json blob, same index order as
   *  `hours` — exactly how createBookingFromHold reads it). Authoritative
   *  for remainder math so covered + remainder reconciles with
   *  totalAmount even after pricing-rule changes. */
  slotPrices?: unknown;
  couponId?: string | null;
  pointsToRedeem?: number | null;
  courtConfig?: { slotDurationMinutes: number } | null;
  },
  /** Restrict the offer to ONE pass — used after the customer has
   *  committed to a specific pass, so buying another mid-payment can't
   *  invalidate the top-up already in flight. */
  opts?: { onlyPassId?: string | null },
) {
  if (!hold.courtConfigId) return null;
  if (hold.couponId || (hold.pointsToRedeem ?? 0) > 0) return null;

  const slotMinutes = hold.courtConfig?.slotDurationMinutes ?? 60;
  const neededMinutes = hold.hours.length * slotMinutes;

  // Classify every booked slot (dayType + timeType) for the date so we
  // can match slots against each pass's bands. One entry PER HOLD SLOT,
  // tracked by index — bowling holds carry the same hour twice (:00 and
  // :30), so entries are never collapsed by hour or deduped by object
  // identity. Prices come from the hold's own slotPrices blob (falling
  // back to the day's rate for legacy holds without one).
  const classified = await getSlotPricesForDate(
    hold.courtConfigId,
    hold.date,
  ).catch(() => []);
  const byHour = new Map(classified.map((s) => [s.hour, s]));
  const stored = Array.isArray(hold.slotPrices)
    ? (hold.slotPrices as { hour?: number; minute?: number; price?: number }[])
    : [];
  const bookedSlots = hold.hours
    .map((h, i) => {
      const cls = byHour.get(h);
      if (!cls) return null;
      const storedPrice = stored[i]?.price;
      return {
        dayType: cls.dayType,
        timeType: cls.timeType,
        price: typeof storedPrice === "number" ? storedPrice : cls.price,
      };
    })
    .filter((s): s is NonNullable<typeof s> => !!s);
  // Any unclassifiable slot would leave the remainder mispriced — bail
  // to the normal payment path instead.
  if (bookedSlots.length !== hold.hours.length || bookedSlots.length === 0) {
    return null;
  }

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
      ...(opts?.onlyPassId ? { id: opts.onlyPassId } : {}),
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
  // against current price). Coverage counts in WHOLE slots — a partial
  // balance covers floor(remaining / slotMinutes) slots and the rest is
  // paid money, so odd remainders never vaporise minutes and a pass that
  // can't cover even one slot is skipped. Pick the pass covering the
  // most slots, then the soonest-expiring (already ordered).
  let best:
    | {
        pass: (typeof passes)[number];
        matchingIdx: number[];
        coveredSlots: number;
      }
    | null = null;
  for (const pass of passes) {
    const bands = parseBands(pass.bands);
    const matchingIdx: number[] = [];
    bookedSlots.forEach((s, i) => {
      if (slotInBands(bands, s)) matchingIdx.push(i);
    });
    const coveredSlots = Math.min(
      matchingIdx.length,
      Math.floor(pass.remainingMinutes / slotMinutes),
    );
    if (coveredSlots === 0) continue;
    if (!best || coveredSlots > best.coveredSlots) {
      best = { pass, matchingIdx, coveredSlots };
    }
  }
  if (!best) return null;

  const { pass, matchingIdx, coveredSlots } = best;
  const coveredMinutes = coveredSlots * slotMinutes;
  // When the balance can't cover every matching slot, cover the priciest
  // ones first so the customer pays the least on the remainder. Coverage
  // is tracked per index so duplicate-hour bowling entries stay distinct.
  const covered = new Array<boolean>(bookedSlots.length).fill(false);
  [...matchingIdx]
    .sort((a, b) => bookedSlots[b].price - bookedSlots[a].price)
    .slice(0, coveredSlots)
    .forEach((i) => {
      covered[i] = true;
    });
  // What the pass settles (court time only) and what stays payable.
  // Gear is never covered — it rides on the remainder so the customer
  // is never told "nothing to pay" while equipment money is owed.
  const coveredAmount = bookedSlots.reduce(
    (sum, s, i) => (covered[i] ? sum + s.price : sum),
    0,
  );
  const equipmentAmount = Math.max(0, hold.equipmentTotalAmount ?? 0);
  const uncoveredSlotAmount = bookedSlots.reduce(
    (sum, s, i) => (covered[i] ? sum : sum + s.price),
    0,
  );
  const remainderAmount = uncoveredSlotAmount + equipmentAmount;
  // A ₹0 remainder must route to the full-coverage path — Razorpay
  // won't mint a ₹0 order for it.
  const fullCoverage = remainderAmount <= 0;

  return {
    passId: pass.id,
    passName: pass.name,
    remainingMinutes: pass.remainingMinutes,
    neededMinutes,
    coveredMinutes,
    /** List price the pass settles — the redemption's coveredAmount. */
    coveredAmount,
    fullCoverage,
    remainderAmount,
    /** Portion of the remainder that is gear, not uncovered court time. */
    equipmentAmount,
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
  try {
    await db.$transaction(async (tx) => {
      // Duplicate verify/webhook race: if this booking already carries a
      // live redemption the debit landed — no-op instead of debiting the
      // balance a second time.
      const existing = await tx.passRedemption.findUnique({
        where: { bookingId },
      });
      if (existing && !existing.restoredAt) return;
      const updated = await tx.userPass.updateMany({
        where: {
          id: passId,
          remainingMinutes: { gte: minutes },
          status: "ACTIVE",
          expiresAt: { gt: new Date() },
        },
        data: { remainingMinutes: { decrement: minutes } },
      });
      if (updated.count === 0) throw new Error("PASS_BALANCE_CHANGED");
      const pass = await tx.userPass.findUnique({
        where: { id: passId },
        select: { price: true, totalMinutes: true },
      });
      const figures = {
        userPassId: passId,
        minutes,
        value: pass ? passMinutesValue(pass, minutes) : 0,
        coveredAmount,
      };
      if (existing) {
        // Restored row still occupies the unique bookingId — reactivate
        // it with this debit's figures.
        await tx.passRedemption.update({
          where: { id: existing.id },
          data: { ...figures, restoredAt: null },
        });
      } else {
        // A concurrent duplicate that slipped past the findUnique above
        // hits P2002 here, rolling its decrement back with the tx.
        await tx.passRedemption.create({
          data: { ...figures, bookingId },
        });
      }
      // Flip to EXHAUSTED when the balance hits zero (display nicety).
      await tx.userPass.updateMany({
        where: { id: passId, remainingMinutes: { lte: 0 }, status: "ACTIVE" },
        data: { status: "EXHAUSTED" },
      });
    });
    return true;
  } catch (err) {
    if (isUniqueViolation(err)) {
      // The concurrent duplicate won the race — treat as settled if its
      // redemption is live.
      const red = await db.passRedemption.findUnique({
        where: { bookingId },
        select: { restoredAt: true },
      });
      return !!red && !red.restoredAt;
    }
    if (err instanceof Error && err.message === "PASS_BALANCE_CHANGED") {
      return false;
    }
    throw err;
  }
}

/** Restore hours on an eligible cancellation. No-op if already
 *  restored, no redemption exists, or the pass has expired (dead
 *  hours are dead). */
export async function restorePassForBooking(bookingId: string) {
  const red = await db.passRedemption.findUnique({ where: { bookingId } });
  if (!red || red.restoredAt) return;
  const pass = await db.userPass.findUnique({ where: { id: red.userPassId } });
  if (!pass || pass.expiresAt.getTime() < Date.now() || pass.status === "CANCELLED") return;
  await db.$transaction(async (tx) => {
    // Stamp-first guard: under a concurrent cancel + refund exactly one
    // caller flips restoredAt, and only that caller credits the minutes.
    const stamped = await tx.passRedemption.updateMany({
      where: { id: red.id, restoredAt: null },
      data: { restoredAt: new Date() },
    });
    if (stamped.count !== 1) return;
    // Re-read INSIDE the tx: an admin edit may have shrunk the
    // redemption (crediting part of it back) since the pre-tx read, and
    // crediting the stale figure would fabricate minutes.
    const current = await tx.passRedemption.findUnique({
      where: { id: red.id },
      select: { minutes: true },
    });
    const minutes = current?.minutes ?? 0;
    if (minutes <= 0) return;
    await tx.userPass.update({
      where: { id: pass.id },
      data: {
        remainingMinutes: { increment: minutes },
        status: "ACTIVE",
      },
    });
  });
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

// ─── Pass detail + shared members (core, auth-agnostic) ──────────────
// Web server actions (actions/passes.ts) and the mobile API routes both
// delegate here; callers supply the already-authenticated viewer id.

/** "5am – 7am" style label from a booking's slots. */
function slotWindowLabel(
  slots: { startHour: number; startMinute: number; durationMinutes: number }[],
): string {
  if (slots.length === 0) return "—";
  const startMins = slots.map((s) => s.startHour * 60 + s.startMinute);
  const endMins = slots.map(
    (s) => s.startHour * 60 + s.startMinute + s.durationMinutes,
  );
  const fmt = (m: number) => {
    const h24 = Math.floor(m / 60) % 24;
    const min = m % 60;
    const ampm = h24 >= 12 ? "pm" : "am";
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    return min === 0
      ? `${h12}${ampm}`
      : `${h12}:${String(min).padStart(2, "0")}${ampm}`;
  };
  return `${fmt(Math.min(...startMins))} – ${fmt(Math.max(...endMins))}`;
}

/** Full pass detail for the viewer (owner or member); null otherwise. */
export async function getPassDetailForUser(passId: string, viewerId: string) {
  const pass = await db.userPass.findUnique({
    where: { id: passId },
    include: {
      user: { select: { id: true, name: true, phone: true } },
      courtConfig: {
        select: {
          label: true,
          size: true,
          category: true,
          maxPassMembers: true,
        },
      },
      members: {
        orderBy: { addedAt: "asc" },
        include: { user: { select: { id: true, name: true, phone: true } } },
      },
      redemptions: {
        orderBy: { createdAt: "desc" },
        select: {
          minutes: true,
          value: true,
          createdAt: true,
          restoredAt: true,
          bookingId: true,
        },
      },
    },
  });
  if (!pass) return null;

  const isOwner = pass.userId === viewerId;
  const isMember = pass.members.some((m) => m.userId === viewerId);
  if (!isOwner && !isMember) return null;

  const bookings = await db.booking.findMany({
    where: { id: { in: pass.redemptions.map((r) => r.bookingId) } },
    select: {
      id: true,
      date: true,
      status: true,
      user: { select: { name: true } },
      slots: {
        select: { startHour: true, startMinute: true, durationMinutes: true },
      },
    },
  });
  const bookingById = new Map(bookings.map((b) => [b.id, b]));

  return {
    id: pass.id,
    name: pass.name,
    sport: String(pass.sport),
    courtLabel: courtGroupLabel({
      sport: String(pass.sport),
      size: String(pass.courtConfig.size),
      category: pass.courtConfig.category
        ? String(pass.courtConfig.category)
        : null,
      label: pass.courtConfig.label,
    }),
    bandsSummary: bandsSummary(parseBands(pass.bands)),
    totalMinutes: pass.totalMinutes,
    remainingMinutes: pass.remainingMinutes,
    price: pass.price,
    validityDays: pass.validityDays,
    purchasedAt: pass.purchasedAt.toISOString(),
    startsAt: pass.startsAt.toISOString(),
    expiresAt: pass.expiresAt.toISOString(),
    status: passLiveStatus(pass),
    role: isOwner ? ("owner" as const) : ("member" as const),
    maxMembers: pass.courtConfig.maxPassMembers,
    owner: { name: pass.user.name, phone: pass.user.phone },
    members: pass.members.map((m) => ({
      userId: m.userId,
      name: m.user.name,
      phone: m.user.phone,
      addedAt: m.addedAt.toISOString(),
    })),
    bookings: pass.redemptions.map((r) => {
      const b = bookingById.get(r.bookingId);
      return {
        bookingId: r.bookingId,
        date: b?.date.toISOString() ?? null,
        timeLabel: b ? slotWindowLabel(b.slots) : "—",
        bookingStatus: b?.status ?? "—",
        bookedBy: b?.user?.name ?? null,
        minutes: r.minutes,
        value: r.value,
        restored: !!r.restoredAt,
        redeemedAt: r.createdAt.toISOString(),
      };
    }),
  };
}

/** Owner adds a member by registered phone (core; caller authenticates). */
export async function addPassMemberForOwner(
  passId: string,
  ownerUserId: string,
  phoneRaw: string,
): Promise<
  | { ok: true; member: { userId: string; name: string | null; phone: string | null } }
  | { ok: false; error: string; notRegistered?: boolean; phone?: string }
> {
  const pass = await db.userPass.findUnique({
    where: { id: passId },
    include: {
      courtConfig: { select: { maxPassMembers: true } },
      _count: { select: { members: true } },
    },
  });
  if (!pass) return { ok: false, error: "Pass not found." };
  if (pass.userId !== ownerUserId) {
    return { ok: false, error: "Only the pass owner can manage members." };
  }
  if (pass.status === "CANCELLED") {
    return { ok: false, error: "This pass is cancelled." };
  }

  const max = pass.courtConfig.maxPassMembers;
  if (max <= 0) {
    return { ok: false, error: "Sharing isn't enabled for this pass." };
  }
  if (pass._count.members >= max) {
    return {
      ok: false,
      error: `Member limit reached (${max} member${max === 1 ? "" : "s"} max).`,
    };
  }

  const phone = normalizeIndianPhone(phoneRaw);
  if (phone.length !== 12 || !phone.startsWith("91")) {
    return { ok: false, error: "Enter a valid 10-digit Indian mobile number." };
  }

  const user = await db.user.findUnique({
    where: { phone },
    select: { id: true, name: true, phone: true },
  });
  if (!user) {
    return {
      ok: false,
      error: "This number isn't registered yet.",
      notRegistered: true,
      phone,
    };
  }
  if (user.id === pass.userId) {
    return { ok: false, error: "That's you — the owner is always included." };
  }

  try {
    await db.passMember.create({
      data: { userPassId: passId, userId: user.id, addedBy: "OWNER" },
    });
  } catch {
    return { ok: false, error: "They're already a member of this pass." };
  }
  return {
    ok: true,
    member: { userId: user.id, name: user.name, phone: user.phone },
  };
}

/** Owner removes a member (core; caller authenticates). */
export async function removePassMemberForOwner(
  passId: string,
  ownerUserId: string,
  memberUserId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const pass = await db.userPass.findUnique({
    where: { id: passId },
    select: { userId: true },
  });
  if (!pass) return { ok: false, error: "Pass not found." };
  if (pass.userId !== ownerUserId) {
    return { ok: false, error: "Only the pass owner can manage members." };
  }
  await db.passMember
    .delete({
      where: {
        userPassId_userId: { userPassId: passId, userId: memberUserId },
      },
    })
    .catch(() => {});
  return { ok: true };
}

// ─── Admin-edit pass sync ────────────────────────────────────────────
// Keeps a booking's PassRedemption coherent when an ADMIN edit changes
// its slots / date / court / total. Runs INSIDE the editor's
// transaction so a failed pass debit aborts the whole edit.
//
// The invariant every display + report relies on:
//     owed-at-venue = Booking.totalAmount − Payment.amount − coveredAmount
// After an edit, coveredAmount only ever SHRINKS toward
// clamp(newTotal − paymentAmount) — it grows solely through the explicit
// debit branches, so added-but-uncovered time surfaces as owed instead
// of being silently written off as pass-settled.
// Minutes move with booked time: added time can be debited from an
// eligible pass (coverDeltaWithPass), removed time is credited back.

import { courtGroupKey } from "@/lib/court-config";
import type { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

/** Public (non-tx) form of the court-group check — used by the extend
 *  action and eligibility endpoints. */
export async function passCoversCourtGroup(
  passCourtConfigId: string,
  bookingCourtConfigId: string,
): Promise<boolean> {
  return passCoversCourt(db, passCourtConfigId, bookingCourtConfigId);
}

/** Do the pass and the booking's court belong to the same interchangeable
 *  court group (both cricket half-courts, both leather pitches, ...)? */
async function passCoversCourt(
  tx: Tx,
  passCourtConfigId: string,
  bookingCourtConfigId: string,
): Promise<boolean> {
  if (passCourtConfigId === bookingCourtConfigId) return true;
  const [a, b] = await Promise.all([
    tx.courtConfig.findUnique({
      where: { id: passCourtConfigId },
      select: { sport: true, size: true, category: true },
    }),
    tx.courtConfig.findUnique({
      where: { id: bookingCourtConfigId },
      select: { sport: true, size: true, category: true },
    }),
  ]);
  if (!a || !b) return false;
  const key = (c: { sport: unknown; size: unknown; category: unknown }) =>
    courtGroupKey({
      sport: String(c.sport),
      size: String(c.size),
      category: c.category ? String(c.category) : null,
    });
  return key(a) === key(b);
}

/**
 * Do a pass's pricing bands cover these hours on this date/court?
 *
 * A pass is bound to ONE price tier (see lib/pass-bands): a ₹3000
 * weekday off-peak pass must not silently pay for a Saturday-evening
 * peak slot worth 2.5× its anchor. Checkout enforces this via
 * getPassOfferForHold; every ADMIN path (edit, extend, eligibility)
 * must apply the same rule or the venue gives away peak time.
 *
 * Unclassifiable hours (outside the pricing table) are treated as NOT
 * covered — safer to charge than to hand over untiered time.
 */
export async function passBandsCoverHours(
  pass: { bands: unknown },
  courtConfigId: string,
  date: Date,
  hours: number[],
): Promise<boolean> {
  const bands = parseBands(pass.bands);
  // An unrestricted pass (no bands) covers every tier.
  if (bands.length === 0 || hours.length === 0) return true;
  const classified = await getSlotPricesForDate(courtConfigId, date).catch(
    () => [],
  );
  const byHour = new Map(classified.map((s) => [s.hour, s]));
  return hours.every((h) => {
    const slot = byHour.get(h);
    return !!slot && slotInBands(bands, slot);
  });
}

/** An eligible pass for covering ADDED minutes on a booking — the
 *  booking's existing redemption pass first, else the customer's best
 *  eligible pass (owner or shared member, court group + play-date
 *  valid, enough balance). Used by the admin edit flows AND by the
 *  detail endpoints that decide whether to OFFER the option. */
export async function findPassForBookingDelta(args: {
  bookingId: string;
  bookingUserId: string | null;
  bookingDate: Date;
  courtConfigId: string;
  deltaMinutes: number;
  /** The hours being added — checked against the pass's price bands. */
  addedHours?: number[];
}): Promise<{ passId: string; passName: string; remainingMinutes: number } | null> {
  if (!args.bookingUserId || args.deltaMinutes <= 0) return null;
  const now = new Date();

  const eligible = async (p: {
    id: string;
    name: string;
    courtConfigId: string;
    status: string;
    startsAt: Date;
    expiresAt: Date;
    remainingMinutes: number;
    bands: unknown;
  }) =>
    p.status === "ACTIVE" &&
    p.startsAt.getTime() <= args.bookingDate.getTime() &&
    p.expiresAt.getTime() > args.bookingDate.getTime() &&
    p.expiresAt.getTime() > now.getTime() &&
    p.remainingMinutes >= args.deltaMinutes &&
    (await passCoversCourt(db, p.courtConfigId, args.courtConfigId)) &&
    (await passBandsCoverHours(
      p,
      args.courtConfigId,
      args.bookingDate,
      args.addedHours ?? [],
    ));

  // 1. The pass already attached to this booking, if any.
  const red = await db.passRedemption.findUnique({
    where: { bookingId: args.bookingId },
    include: { userPass: true },
  });
  if (red && !red.restoredAt) {
    const p = red.userPass;
    if (await eligible(p)) {
      return { passId: p.id, passName: p.name, remainingMinutes: p.remainingMinutes };
    }
    return null; // attached pass can't cover — don't silently switch passes
  }

  // 2. Otherwise the customer's own or shared passes, SOONEST-EXPIRING
  //    first — one ordering shared with syncPassAfterAdminEdit and the
  //    admin detail page, so the pass the UI names is the pass the save
  //    actually debits (and the closest-to-expiring balance is used up
  //    first, same as checkout).
  const candidates = await db.userPass.findMany({
    where: {
      status: "ACTIVE",
      OR: [
        { userId: args.bookingUserId },
        { members: { some: { userId: args.bookingUserId } } },
      ],
    },
    orderBy: { expiresAt: "asc" },
  });
  for (const p of candidates) {
    if (await eligible(p)) {
      return { passId: p.id, passName: p.name, remainingMinutes: p.remainingMinutes };
    }
  }
  return null;
}

/**
 * Sync the booking's pass state after an admin edit. Call INSIDE the
 * edit transaction, AFTER Booking/Payment rows are written.
 *
 *  - time ADDED + coverDeltaWithPass: debit the delta from the
 *    attached pass (or the customer's eligible pass when the booking
 *    wasn't pass-paid yet), grow/create the redemption.
 *  - time ADDED without cover: redemption untouched — the invariant
 *    surfaces the added slots' price as owed-at-venue.
 *  - time REMOVED: credit back only the minutes that no longer FIT in
 *    the booking (a 30-min pass extension on a 3h booking survives the
 *    removal of a paid hour — those minutes were never pass-covered),
 *    unless the pass is cancelled/expired — dead hours are dead. A
 *    redemption shrunk to zero minutes is stamped restored.
 *  - coveredAmount grows ONLY in the debit branches, and only by the
 *    price of the time just added (newTotal − oldTotal) — never to the
 *    whole uncaptured gap, which would write off a pre-existing
 *    advance remainder or an earlier uncovered edit. Otherwise it only
 *    ever SHRINKS toward clamp(newTotal − paymentAmount) so repricing
 *    and date moves stay exact.
 */
export async function syncPassAfterAdminEdit(
  tx: Tx,
  args: {
    bookingId: string;
    bookingUserId: string | null;
    bookingDate: Date;
    courtConfigId: string;
    newTotalAmount: number;
    /** Payment.amount AFTER the edit (money actually captured). */
    paymentAmount: number;
    newMinutes: number;
    oldMinutes: number;
    /** The slot rows the edit actually wrote — court time only. The
     *  pass's share is RECOMPUTED from these (priciest first, exactly
     *  how checkout picks coverage) rather than nudged incrementally,
     *  so date/court moves are symmetric and a move-and-move-back
     *  lands back where it started. */
    newSlots: { price: number; durationMinutes: number }[];
    /** Gear on the booking — a pass never pays for it, so it's excluded
     *  from everything the pass may cover. */
    equipmentAmount?: number;
    /** Hours this edit ADDS — checked against the pass's price bands so
     *  an off-peak pass can't be made to pay for peak time. */
    addedHours?: number[];
    coverDeltaWithPass?: boolean;
  },
): Promise<
  | { ok: true; passUsed: string | null; coveredAmount: number }
  | { ok: false; error: string }
> {
  const delta = args.newMinutes - args.oldMinutes;
  const equipment = Math.max(0, args.equipmentAmount ?? 0);
  /** Court-time portion of the new total — the ceiling on pass cover. */
  const slotPortion = Math.max(0, args.newTotalAmount - equipment);
  const clampCovered = (v: number) => Math.max(0, Math.min(slotPortion, v));

  /**
   * List price of the `minutes` a pass covers, taken priciest-slot
   * first (same rule as getPassOfferForHold, so an admin edit values
   * coverage the way checkout did). Clamped to the court-time portion
   * of the total, which also absorbs any booking-level discount.
   */
  const coveredValueFor = (minutes: number) => {
    if (minutes <= 0) return 0;
    let left = minutes;
    let sum = 0;
    for (const s of [...args.newSlots].sort((a, b) => b.price - a.price)) {
      if (left <= 0) break;
      if (s.durationMinutes <= left) {
        sum += s.price;
        left -= s.durationMinutes;
      } else {
        // Partial slot (a 60-min row against 30 remaining minutes).
        sum += Math.round((s.price * left) / s.durationMinutes);
        left = 0;
      }
    }
    return clampCovered(sum);
  };

  /** Never claim more than the money still uncaptured. */
  const settleable = (v: number) =>
    clampCovered(Math.min(v, args.newTotalAmount - args.paymentAmount));

  const red = await tx.passRedemption.findUnique({
    where: { bookingId: args.bookingId },
    include: { userPass: true },
  });
  const live = red && !red.restoredAt ? red : null;

  // ── No pass on the booking yet ──
  if (!live) {
    if (!args.coverDeltaWithPass || delta <= 0) {
      return { ok: true, passUsed: null, coveredAmount: 0 };
    }
    if (!args.bookingUserId) {
      return { ok: false, error: "Guest bookings can't use a pass." };
    }
    // Cover the ADDED minutes from the customer's eligible pass.
    const candidates = await tx.userPass.findMany({
      where: {
        status: "ACTIVE",
        OR: [
          { userId: args.bookingUserId },
          { members: { some: { userId: args.bookingUserId } } },
        ],
      },
      // Soonest-expiring first — the same ordering findPassForBookingDelta
      // and the admin detail page use, so the pass the checkbox names is
      // the pass this debit takes.
      orderBy: { expiresAt: "asc" },
    });
    const now = new Date();
    let chosen: (typeof candidates)[number] | null = null;
    for (const p of candidates) {
      if (
        p.startsAt.getTime() <= args.bookingDate.getTime() &&
        p.expiresAt.getTime() > args.bookingDate.getTime() &&
        p.expiresAt.getTime() > now.getTime() &&
        p.remainingMinutes >= delta &&
        (await passCoversCourt(tx, p.courtConfigId, args.courtConfigId)) &&
        // A pass buys ONE price tier — never let it settle peak time it
        // wasn't sold for (checkout applies the same rule).
        (await passBandsCoverHours(
          p,
          args.courtConfigId,
          args.bookingDate,
          args.addedHours ?? [],
        ))
      ) {
        chosen = p;
        break;
      }
    }
    if (!chosen) {
      return {
        ok: false,
        error:
          "No pass covers this court, date and price band with enough balance — uncheck the pass option to charge instead.",
      };
    }
    const debited = await tx.userPass.updateMany({
      where: { id: chosen.id, remainingMinutes: { gte: delta }, status: "ACTIVE" },
      data: { remainingMinutes: { decrement: delta } },
    });
    if (debited.count === 0) {
      return { ok: false, error: "Pass balance changed — please retry." };
    }
    await tx.userPass.updateMany({
      where: { id: chosen.id, remainingMinutes: { lte: 0 }, status: "ACTIVE" },
      data: { status: "EXHAUSTED" },
    });
    // A restored redemption row still occupies the unique bookingId —
    // reactivate it with the new debit's figures instead of create
    // (which would P2002 and brick the edit).
    // The pass covers exactly the minutes it just paid for, valued
    // against the booking's own slots — an advance remainder or an
    // earlier uncovered edit stays owed at the venue.
    const coveredAmount = settleable(coveredValueFor(delta));
    if (red) {
      await tx.passRedemption.update({
        where: { id: red.id },
        data: {
          userPassId: chosen.id,
          minutes: delta,
          value: passMinutesValue(chosen, delta),
          coveredAmount,
          restoredAt: null,
        },
      });
    } else {
      await tx.passRedemption.create({
        data: {
          userPassId: chosen.id,
          bookingId: args.bookingId,
          minutes: delta,
          value: passMinutesValue(chosen, delta),
          coveredAmount,
        },
      });
    }
    return { ok: true, passUsed: chosen.id, coveredAmount };
  }

  // ── Booking already pass-paid ──
  const pass = live.userPass;

  if (delta > 0 && args.coverDeltaWithPass) {
    const now = new Date();
    const coversCourt = await passCoversCourt(tx, pass.courtConfigId, args.courtConfigId);
    const coversBands = await passBandsCoverHours(
      pass,
      args.courtConfigId,
      args.bookingDate,
      args.addedHours ?? [],
    );
    if (
      pass.status !== "ACTIVE" ||
      pass.startsAt.getTime() > args.bookingDate.getTime() ||
      pass.expiresAt.getTime() <= args.bookingDate.getTime() ||
      pass.expiresAt.getTime() <= now.getTime() ||
      pass.remainingMinutes < delta ||
      !coversCourt ||
      !coversBands
    ) {
      return {
        ok: false,
        error:
          "The booking's pass can't cover the added time (expired, out of balance, wrong court, or outside its price band) — uncheck the pass option to charge instead.",
      };
    }
    const debited = await tx.userPass.updateMany({
      where: { id: pass.id, remainingMinutes: { gte: delta }, status: "ACTIVE" },
      data: { remainingMinutes: { decrement: delta } },
    });
    if (debited.count === 0) {
      return { ok: false, error: "Pass balance changed — please retry." };
    }
    await tx.userPass.updateMany({
      where: { id: pass.id, remainingMinutes: { lte: 0 }, status: "ACTIVE" },
      data: { status: "EXHAUSTED" },
    });
    const coveredAmount = settleable(coveredValueFor(live.minutes + delta));
    await tx.passRedemption.update({
      where: { id: live.id },
      data: {
        minutes: { increment: delta },
        value: { increment: passMinutesValue(pass, delta) },
        coveredAmount,
      },
    });
    return { ok: true, passUsed: pass.id, coveredAmount };
  }

  if (delta < 0) {
    const restorable =
      pass.status !== "CANCELLED" && pass.expiresAt.getTime() > Date.now();
    // Recomputed from the surviving slots, so removing the CHEAP hours
    // from a partly covered booking doesn't strand value on slots the
    // pass never covered (and gear is excluded throughout).
    const shrunkCovered = settleable(coveredValueFor(live.minutes));
    if (!restorable) {
      // Dead pass (cancelled/expired): consumed hours stay consumed.
      // Shrinking minutes/value or stamping restoredAt here would make
      // analytics double-count — the pass sale was already recognised
      // while the booking's covered netting would vanish.
      if (shrunkCovered !== live.coveredAmount) {
        await tx.passRedemption.update({
          where: { id: live.id },
          data: { coveredAmount: shrunkCovered },
        });
      }
      return { ok: true, passUsed: pass.id, coveredAmount: shrunkCovered };
    }
    // Credit back only the covered minutes that no longer FIT in the
    // booking. Removing a PAID hour from a booking that merely carries a
    // 30-min pass extension frees no pass time — those 30 minutes are
    // still being played, so crediting them (and stamping the redemption
    // restored) would hand back minutes for a slot the customer keeps.
    const credit = Math.min(live.minutes, Math.max(0, live.minutes - args.newMinutes));
    if (credit > 0) {
      await tx.userPass.update({
        where: { id: pass.id },
        data: {
          remainingMinutes: { increment: credit },
          ...(pass.status === "EXHAUSTED" ? { status: "ACTIVE" } : {}),
        },
      });
    }
    const newMinutes = live.minutes - credit;
    await tx.passRedemption.update({
      where: { id: live.id },
      data: {
        minutes: newMinutes,
        value: Math.max(0, live.value - passMinutesValue(pass, credit)),
        coveredAmount: settleable(coveredValueFor(newMinutes)),
        // All covered time gone → the redemption is effectively undone.
        ...(newMinutes <= 0 ? { restoredAt: new Date() } : {}),
      },
    });
    return { ok: true, passUsed: pass.id, coveredAmount: shrunkCovered };
  }

  // delta === 0, or delta > 0 without pass cover: keep minutes/value and
  // revalue the SAME covered minutes against the new slots. Because the
  // figure is recomputed (not ratcheted), a date/court move is
  // symmetric — moving to pricier slots and back restores the original
  // coverage instead of stranding a bill on the customer. Added-but-
  // uncovered time still surfaces as owed: those minutes aren't in
  // live.minutes, so they're not in the recomputed value either.
  const target = settleable(coveredValueFor(live.minutes));
  if (target !== live.coveredAmount) {
    await tx.passRedemption.update({
      where: { id: live.id },
      data: { coveredAmount: target },
    });
  }
  return { ok: true, passUsed: null, coveredAmount: target };
}
