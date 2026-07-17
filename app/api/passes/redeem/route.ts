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

  // Passes don't combine with coupons/points. If the customer applied
  // either and then chose to pay with the pass, the pass wins — drop the
  // coupon/points so (a) getPassOfferForHold below sees a clean hold and
  // (b) the ₹0 PASS booking created by createBookingFromHold doesn't also
  // spend the points / consume the coupon. They aren't consumed here, so
  // the customer keeps their points balance.
  if (hold.couponId || (hold.pointsToRedeem ?? 0) > 0) {
    await db.slotHold.update({
      where: { id: hold.id },
      data: {
        couponId: null,
        discountAmount: null,
        pointsToRedeem: null,
        pointsRedeemPaiseSaved: null,
      },
    });
    hold.couponId = null;
    hold.discountAmount = null;
    hold.pointsToRedeem = null;
    hold.pointsRedeemPaiseSaved = null;
  }

  const offer = await getPassOfferForHold(hold);
  if (!offer) {
    return NextResponse.json({ error: "No eligible pass for this booking" }, { status: 400 });
  }

  if (offer.fullCoverage) {
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
    // Full coverage settles the whole slot total at list price.
    const ok = await debitPass(
      offer.passId,
      offer.coveredMinutes,
      bookingId,
      hold.totalAmount,
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
  await db.slotHold.update({ where: { id: holdId }, data: { redeemPassId: offer.passId } });
  return NextResponse.json({
    topup: {
      orderId: order.id,
      keyId: RAZORPAY_KEY_ID,
      amount: offer.remainderAmount,
      coveredMinutes: offer.coveredMinutes,
    },
  });
}
