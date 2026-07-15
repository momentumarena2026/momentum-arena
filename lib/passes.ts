import { db } from "@/lib/db";
import { RAZORPAY_KEY_ID } from "@/lib/razorpay";

/**
 * Monthly Passes — purchase plumbing (money-first). No UserPass row
 * exists until Razorpay confirms capture (verify endpoint or the
 * payment.captured webhook); both paths call materializeUserPass,
 * which is idempotent on razorpayOrderId.
 */

const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || "";

/** Create a Razorpay order for a pass purchase. Notes carry the
 *  routing info the webhook needs to materialize without a DB
 *  intent row. */
export async function createPassOrder(planId: string, userId: string) {
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
      notes: { type: "PASS", planId, userId },
    }),
  });
  if (!res.ok) {
    throw new Error(`Razorpay pass order failed: ${await res.text()}`);
  }
  const order = (await res.json()) as { id: string; amount: number };
  return { plan, orderId: order.id, amount: plan.price };
}

/** Idempotently convert a captured payment into a UserPass. */
export async function materializeUserPass(args: {
  razorpayOrderId: string;
  razorpayPaymentId?: string;
  planId: string;
  userId: string;
}): Promise<{ userPassId: string; alreadyDone: boolean } | null> {
  const existing = await db.userPass.findUnique({
    where: { razorpayOrderId: args.razorpayOrderId },
    select: { id: true },
  });
  if (existing) return { userPassId: existing.id, alreadyDone: true };

  const plan = await db.passPlan.findUnique({ where: { id: args.planId } });
  if (!plan) return null;

  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + plan.validityDays * 24 * 60 * 60 * 1000,
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
      expiresAt,
      razorpayOrderId: args.razorpayOrderId,
      razorpayPaymentId: args.razorpayPaymentId ?? null,
    },
  });
  return { userPassId: created.id, alreadyDone: false };
}

/** Live status for display + eligibility (lazy expiry). */
export function passLiveStatus(p: {
  status: string;
  remainingMinutes: number;
  expiresAt: Date;
}): "ACTIVE" | "EXHAUSTED" | "EXPIRED" | "CANCELLED" {
  if (p.status === "CANCELLED") return "CANCELLED";
  if (p.expiresAt.getTime() < Date.now()) return "EXPIRED";
  if (p.remainingMinutes <= 0) return "EXHAUSTED";
  return "ACTIVE";
}

// ─── Redemption (Phase 3) ────────────────────────────────────────────

/** Eligible pass + coverage math for a hold. Coupons/points don't
 *  combine with passes (v1) — holds carrying either are ineligible. */
export async function getPassOfferForHold(hold: {
  userId: string;
  courtConfigId: string | null;
  hours: number[];
  totalAmount: number;
  couponId?: string | null;
  pointsToRedeem?: number | null;
  courtConfig?: { slotDurationMinutes: number } | null;
}) {
  if (!hold.courtConfigId) return null;
  if (hold.couponId || (hold.pointsToRedeem ?? 0) > 0) return null;
  const pass = await db.userPass.findFirst({
    where: {
      userId: hold.userId,
      courtConfigId: hold.courtConfigId,
      status: "ACTIVE",
      remainingMinutes: { gt: 0 },
      expiresAt: { gt: new Date() },
    },
    orderBy: { expiresAt: "asc" }, // burn the soonest-expiring first
  });
  if (!pass) return null;

  const slotMinutes = hold.courtConfig?.slotDurationMinutes ?? 60;
  const neededMinutes = hold.hours.length * slotMinutes;
  const coveredMinutes = Math.min(pass.remainingMinutes, neededMinutes);
  // Pro-rata remainder — per-slot prices vary, so the uncovered share
  // is charged proportionally to uncovered time.
  const remainderAmount = Math.round(
    (hold.totalAmount * (neededMinutes - coveredMinutes)) / neededMinutes,
  );
  return {
    passId: pass.id,
    passName: pass.name,
    remainingMinutes: pass.remainingMinutes,
    neededMinutes,
    coveredMinutes,
    fullCoverage: coveredMinutes >= neededMinutes,
    remainderAmount,
  };
}

/** Atomic debit — fails (returns false) if the balance moved. */
export async function debitPass(passId: string, minutes: number, bookingId: string) {
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
  await db.passRedemption.create({
    data: { userPassId: passId, bookingId, minutes },
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
