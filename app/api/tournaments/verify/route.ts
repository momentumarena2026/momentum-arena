import { NextRequest, NextResponse } from "next/server";
import { getAuthUserId } from "@/lib/auth-unified";
import { verifyRazorpaySignature, fetchRazorpayOrder } from "@/lib/razorpay";
import { recordOrphanPayment } from "@/lib/payment-orphan";
import { confirmTournamentEntry } from "@/lib/tournaments";

/** Client-side confirmation after the Razorpay modal succeeds. The
 *  payment.captured webhook is the backstop — both paths are idempotent
 *  (confirmTournamentEntry no-ops on an already-CONFIRMED team). WHAT was
 *  bought comes from the ORDER's notes, never the client body.
 *
 *  Deliberately NOT gated on the tournaments master switch: this route
 *  applies money that has already been captured. If an admin switches the
 *  module off mid-payment, refusing here would strand a real charge. New
 *  payments are stopped at their entry points (register / dqr-initiate)
 *  instead, which is where the switch belongs. */
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
    console.error("[tournaments] verify order fetch failed", razorpayOrderId, err);
    return NextResponse.json(
      { error: "Couldn't confirm the payment with Razorpay — please retry" },
      { status: 502 }
    );
  }
  const notes =
    order.notes && !Array.isArray(order.notes) ? order.notes : ({} as Record<string, string>);
  if (notes.type !== "TOURNAMENT_ENTRY" || !notes.teamId) {
    return NextResponse.json({ error: "Not a tournament order" }, { status: 400 });
  }

  const paidRupees = Math.round(Number(order.amount) / 100);
  const result = await confirmTournamentEntry({
    teamId: notes.teamId,
    razorpayPaymentId,
    paidRupees,
  });

  if (!result.ok) {
    // Money IS captured — never a silent failure. File it for admin recovery.
    recordOrphanPayment({
      gateway: "RAZORPAY",
      reason: `tournament-${result.error || "confirm-failed"}`,
      userId: notes.userId || userId,
      amountRupees: paidRupees,
      razorpayOrderId,
      razorpayPaymentId,
      path: request.nextUrl.pathname,
    });
    return NextResponse.json(
      {
        error:
          "Payment received, but we couldn't auto-confirm your team. Please do NOT pay again — our team will confirm your spot shortly.",
        paymentReceived: true,
      },
      { status: 409 }
    );
  }
  return NextResponse.json({ success: true, teamId: notes.teamId });
}
