import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { arePassesEnabled, createPassOrder, parseStartDate } from "@/lib/passes";
import { RAZORPAY_KEY_ID } from "@/lib/razorpay";

/** Start a pass purchase — creates the Razorpay order (money-first:
 *  no UserPass row yet; notes carry planId+userId for the webhook). */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Sign in to buy a pass" }, { status: 401 });
  }
  if (!(await arePassesEnabled())) {
    return NextResponse.json(
      { error: "Passes aren't available right now" },
      { status: 403 },
    );
  }
  const { planId, startDate } = await request.json().catch(() => ({}));
  if (!planId) {
    return NextResponse.json({ error: "Missing planId" }, { status: 400 });
  }
  try {
    const order = await createPassOrder(
      planId,
      session.user.id,
      parseStartDate(startDate),
    );
    if (!order) {
      return NextResponse.json({ error: "Plan not available" }, { status: 404 });
    }
    return NextResponse.json({
      orderId: order.orderId,
      keyId: RAZORPAY_KEY_ID,
      amount: order.amount, // rupees
      planName: order.plan.name,
    });
  } catch (err) {
    console.error("[passes] create-order failed", err);
    return NextResponse.json({ error: "Couldn't start payment" }, { status: 500 });
  }
}
