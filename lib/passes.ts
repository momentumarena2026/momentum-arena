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
