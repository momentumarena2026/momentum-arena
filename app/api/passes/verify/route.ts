import { NextRequest, NextResponse } from "next/server";
import { getAuthUserId } from "@/lib/auth-unified";
import { db } from "@/lib/db";
import { fetchRazorpayOrder, verifyRazorpaySignature } from "@/lib/razorpay";
import { materializeUserPass, parseStartDate } from "@/lib/passes";

/** Client-side confirmation after the Razorpay modal succeeds. The
 *  payment.captured webhook is the backstop — both paths are
 *  idempotent on razorpayOrderId. Unified auth (web cookie or mobile
 *  bearer token).
 *
 *  The signature only proves a capture happened. WHAT was bought comes
 *  from the ORDER we created in createPassOrder (notes: type/planId/
 *  userId/startsAt) — trusting a client planId would let a cheap-plan
 *  payment materialize an expensive plan. */
export async function POST(request: NextRequest) {
  const userId = await getAuthUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = body;
  if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }
  if (!verifyRazorpaySignature(razorpayOrderId, razorpayPaymentId, razorpaySignature)) {
    return NextResponse.json({ error: "Signature mismatch" }, { status: 400 });
  }

  let order;
  try {
    order = await fetchRazorpayOrder(razorpayOrderId);
  } catch (err) {
    console.error("[passes] verify order fetch failed", razorpayOrderId, err);
    return NextResponse.json(
      { error: "Couldn't confirm the payment with Razorpay — please retry" },
      { status: 502 },
    );
  }
  const notes =
    order.notes && !Array.isArray(order.notes) ? order.notes : ({} as Record<string, string>);
  if (notes.type !== "PASS" || !notes.planId || !notes.userId) {
    return NextResponse.json({ error: "Not a pass order" }, { status: 400 });
  }
  const plan = await db.passPlan.findUnique({
    where: { id: notes.planId },
    select: { price: true },
  });
  if (!plan) {
    return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  }
  // The captured order must pay the plan's full price (paise) — a
  // repriced plan or a tampered flow never materializes at a discount.
  if (order.amount !== Math.round(plan.price * 100)) {
    return NextResponse.json(
      { error: "Payment amount doesn't match the plan price" },
      { status: 400 },
    );
  }

  const noteStart = notes.startsAt ? new Date(notes.startsAt) : undefined;
  const result = await materializeUserPass({
    razorpayOrderId,
    razorpayPaymentId,
    planId: notes.planId,
    // The order's user, not the caller — mirrors the webhook branch.
    userId: notes.userId,
    startsAt:
      noteStart && !Number.isNaN(noteStart.getTime())
        ? noteStart
        : parseStartDate(),
  });
  if (!result) {
    return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  }
  return NextResponse.json({ success: true, userPassId: result.userPassId });
}
