import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getValidHold } from "@/lib/slot-hold";
import { createBookingFromHold } from "@/actions/booking";
import { getPassOfferForHold, debitPass } from "@/lib/passes";
import { verifyRazorpaySignature } from "@/lib/razorpay";

/** Complete a pass top-up: gateway remainder captured → create the
 *  booking (RAZORPAY, remainder amount) and debit the covered hours. */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const { holdId, razorpayOrderId, razorpayPaymentId, razorpaySignature } = body;
  if (!holdId || !razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }
  if (!verifyRazorpaySignature(razorpayOrderId, razorpayPaymentId, razorpaySignature)) {
    return NextResponse.json({ error: "Signature mismatch" }, { status: 400 });
  }

  const hold = await getValidHold(holdId, session.user.id);
  if (!hold || !hold.redeemPassId) {
    return NextResponse.json({ error: "Hold expired" }, { status: 404 });
  }
  // Server-side recompute — never trust client coverage numbers.
  const offer = await getPassOfferForHold(hold);
  if (!offer || offer.passId !== hold.redeemPassId) {
    return NextResponse.json({ error: "Pass no longer eligible" }, { status: 409 });
  }

  const bookingId = await createBookingFromHold(
    hold.id,
    {
      method: "RAZORPAY",
      status: "COMPLETED",
      amount: offer.remainderAmount,
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature,
      confirmedAt: new Date(),
      confirmedBy: "PASS_TOPUP",
    },
    "CONFIRMED",
  );
  if (!bookingId) {
    return NextResponse.json({ error: "Slot no longer available" }, { status: 409 });
  }
  const ok = await debitPass(offer.passId, offer.coveredMinutes, bookingId);
  if (!ok) {
    console.error("[passes] topup debit failed post-booking", bookingId);
  }
  void db; // (db imported for parity with redeem route)
  return NextResponse.json({ bookingId });
}
