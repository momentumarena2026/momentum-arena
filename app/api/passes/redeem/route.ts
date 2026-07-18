import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { getAuthUserId } from "@/lib/auth-unified";
import { db } from "@/lib/db";
import { getValidHold } from "@/lib/slot-hold";
import { createBookingFromHold } from "@/actions/booking";
import { getPassOfferForHold, debitPass } from "@/lib/passes";
import {
  sendBookingConfirmation,
  notifyAdminBookingConfirmed,
} from "@/lib/notifications";
import { RAZORPAY_KEY_ID } from "@/lib/razorpay";

// Same payment window /api/razorpay/create-order grants a hold once an
// order is minted against it.
const PAYMENT_ATTEMPT_TTL_MINUTES = 15;

/**
 * Redeem a pass against a hold. Full coverage → booking created now
 * (method PASS, ₹0). Partial → returns a Razorpay order for the
 * pro-rata remainder; /api/passes/redeem-verify completes it.
 */
export async function POST(request: NextRequest) {
  const userId = await getAuthUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { holdId } = await request.json().catch(() => ({}));
  if (!holdId) return NextResponse.json({ error: "Missing holdId" }, { status: 400 });

  const hold = await getValidHold(holdId, userId);
  if (!hold) return NextResponse.json({ error: "Hold expired" }, { status: 404 });

  // Passes don't combine with coupons/points (v1). Eligibility is judged
  // on a coupon-free VIEW of the hold; the row keeps its coupon/points
  // until a pass path actually COMMITS below, so a "no eligible pass"
  // answer never costs the customer their applied discount on the normal
  // payment path.
  const offer = await getPassOfferForHold({
    ...hold,
    couponId: null,
    pointsToRedeem: null,
  });
  if (!offer) {
    return NextResponse.json({ error: "No eligible pass for this booking" }, { status: 400 });
  }

  // Committing to the pass drops coupon/points from the hold so the
  // booking built from it doesn't also spend the points / consume the
  // coupon. They aren't consumed here, so the customer keeps their
  // points balance.
  const dropDiscounts = {
    couponId: null,
    discountAmount: null,
    pointsToRedeem: null,
    pointsRedeemPaiseSaved: null,
  };

  if (offer.fullCoverage) {
    if (hold.couponId || (hold.pointsToRedeem ?? 0) > 0) {
      await db.slotHold.update({ where: { id: hold.id }, data: dropDiscounts });
    }
    const bookingId = await createBookingFromHold(
      hold.id,
      {
        method: "PASS",
        status: "COMPLETED",
        amount: 0,
        confirmedAt: new Date(),
        confirmedBy: "PASS",
      },
      "CONFIRMED",
    );
    if (!bookingId) {
      return NextResponse.json({ error: "Slot no longer available" }, { status: 409 });
    }
    // Settle exactly the court time the pass covered — hold.totalAmount
    // would also swallow any equipment (which a pass never pays for).
    const ok = await debitPass(
      offer.passId,
      offer.coveredMinutes,
      bookingId,
      offer.coveredAmount,
    );
    if (!ok) {
      // Balance raced away between offer + debit — undo the booking.
      await db.booking.update({ where: { id: bookingId }, data: { status: "CANCELLED" } });
      return NextResponse.json({ error: "Pass balance changed — try again" }, { status: 409 });
    }
    // Confirmation messages ride after() so the response isn't blocked —
    // same pattern as the gateway/DQR paths (this was missing: pass
    // bookings confirmed silently, no SMS/push/admin notify).
    after(async () => {
      await Promise.allSettled([
        sendBookingConfirmation(bookingId).catch((err) =>
          console.error("[passes] booking confirmation failed", err),
        ),
        notifyAdminBookingConfirmed(bookingId).catch((err) =>
          console.error("[passes] admin notify failed", err),
        ),
      ]);
    });
    return NextResponse.json({ bookingId });
  }

  // Partial — Razorpay order for the remainder; notes carry routing.
  const authHdr = Buffer.from(
    `${RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET || ""}`,
  ).toString("base64");
  const res = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    signal: AbortSignal.timeout(8000),
    headers: { "Content-Type": "application/json", Authorization: `Basic ${authHdr}` },
    body: JSON.stringify({
      amount: Math.round(offer.remainderAmount * 100),
      currency: "INR",
      receipt: `ptop_${holdId.slice(-12)}`,
      notes: { type: "PASS_TOPUP", holdId, passId: offer.passId },
    }),
  });
  if (!res.ok) {
    console.error("[passes] topup order failed", await res.text());
    return NextResponse.json({ error: "Couldn't start payment" }, { status: 500 });
  }
  const order = (await res.json()) as { id: string };
  // Commit the pass path on the hold in one write, mirroring
  // /api/razorpay/create-order: razorpayOrderId ties the order to this
  // hold (verify + webhook route on it), paymentInitiatedAt buys the
  // 24h late-payment grace in cleanupExpiredHolds, and the TTL bump
  // gives the Razorpay modal time to finish.
  // NOTE: coupon/points stay on the hold until the top-up is actually
  // captured (completePassTopup strips them just before it builds the
  // booking). Dropping them here would silently cost the customer their
  // discount if they dismissed the Razorpay sheet and paid the normal
  // way instead.
  await db.slotHold.update({
    where: { id: holdId },
    data: {
      redeemPassId: offer.passId,
      razorpayOrderId: order.id,
      paymentMethod: "RAZORPAY",
      paymentAmount: offer.remainderAmount,
      paymentInitiatedAt: new Date(),
      expiresAt: new Date(Date.now() + PAYMENT_ATTEMPT_TTL_MINUTES * 60 * 1000),
    },
  });
  return NextResponse.json({
    topup: {
      orderId: order.id,
      keyId: RAZORPAY_KEY_ID,
      amount: offer.remainderAmount,
      coveredMinutes: offer.coveredMinutes,
    },
  });
}
