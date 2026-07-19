import { NextRequest, NextResponse } from "next/server";
import { getAuthUserId } from "@/lib/auth-unified";
import { db } from "@/lib/db";
import { initiatePhonePePayment } from "@/lib/phonepe";
import { getValidHold } from "@/lib/slot-hold";
import { verifyBowlingHoldStillBookable } from "@/lib/bowling-availability";
import { deriveHoldCharge, splitAdvancePayment } from "@/lib/booking-amounts";
import { AnalyticsCategory, logServerAction, resolveRequestPlatform } from "@/lib/server-log";

const PAYMENT_ATTEMPT_TTL_MINUTES = 15;

export async function POST(request: NextRequest) {
  const userId = await getAuthUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { holdId, isAdvance, overrideAmount, recurring } = await request.json();

  if (!holdId) {
    return NextResponse.json({ error: "Missing holdId" }, { status: 400 });
  }

  const hold = await getValidHold(holdId, userId);
  if (!hold) {
    logServerAction({
      userId,
      category: AnalyticsCategory.PAYMENT,
      action: "payment.phonepe.initiate",
      outcome: "error",
      path: request.nextUrl.pathname,
      method: "POST",
      platform: resolveRequestPlatform(request),
      metadata: { holdId },
      error: "Hold not found or expired",
    });
    return NextResponse.json(
      { error: "Hold not found or expired" },
      { status: 404 }
    );
  }

  // Bowling-machine re-check — see razorpay/create-order for the
  // rationale. Catches admin-override turf bookings on the shared
  // zones between lock and payment-init.
  const stillOk = await verifyBowlingHoldStillBookable(holdId);
  if (!stillOk.ok) {
    logServerAction({
      userId,
      category: AnalyticsCategory.PAYMENT,
      action: "payment.phonepe.initiate",
      outcome: "error",
      path: request.nextUrl.pathname,
      method: "POST",
      platform: resolveRequestPlatform(request),
      metadata: { holdId, conflicts: stillOk.conflicts },
      error: stillOk.reason,
    });
    return NextResponse.json(
      { error: stillOk.reason, conflicts: stillOk.conflicts },
      { status: 409 },
    );
  }

  try {
    // The charge is derived server-side, never taken from the request body
    // — see /api/razorpay/create-order for the ₹1 exploit this closes, and
    // lib/booking-amounts for the rule itself (recurring multiplier
    // included; it is NOT stored on the hold).
    const charge = await deriveHoldCharge(hold, {
      clientAmount: overrideAmount,
      recurring,
    });
    const paymentAmount = charge.payableAmount;

    // Fully covered by coupon + points — PhonePe rejects a zero-value
    // order. Committing the booking straight from here was tried and
    // reverted: it needed an unauthenticated server action, and the two
    // sibling routes' clients don't understand a `fullyCovered` response,
    // so the booking was created while checkout still showed a failure.
    // See /api/razorpay/create-order.
    if (paymentAmount <= 0) {
      return NextResponse.json(
        { error: "Nothing left to pay for this booking" },
        { status: 400 }
      );
    }

    let orderAmount = paymentAmount;
    let advanceAmount: number | undefined;
    let remainingAmount: number | undefined;

    if (isAdvance) {
      ({ advanceAmount, remainingAmount } = splitAdvancePayment(paymentAmount));
      orderAmount = advanceAmount;
    }

    // Encode holdId into merchantOrderId so the redirect handler
    // can look it up. PhonePe v2 allows up to 63 chars for this
    // identifier — our `MA_{12-char-suffix}_{timestamp}` pattern is
    // ~30 chars, well within bounds. Stored as
    // SlotHold.phonePeMerchantTxnId; the column kept its legacy
    // name to avoid a pointless schema migration.
    const merchantOrderId = `MA_${holdId.slice(-12)}_${Date.now()}`;
    const origin =
      request.headers.get("origin") ||
      process.env.NEXTAUTH_URL ||
      "http://localhost:3000";

    // Booking amounts on the hold are stored in
    // *rupees* — same convention as Razorpay's create-order which does
    // its own ×100 internally. PhonePe v2's /checkout/v2/pay expects
    // paise, so convert here before handing off. Without this, ₹1600
    // ends up displayed as ₹16 on the PhonePe page (× 100 short).
    const orderAmountPaise = orderAmount * 100;

    // v2 has no separate `callbackUrl` parameter — webhooks are
    // configured globally in the PhonePe dashboard's Webhooks tab,
    // not per-payment. We pass only the user-facing redirectUrl.
    const result = await initiatePhonePePayment({
      merchantOrderId,
      amount: orderAmountPaise,
      redirectUrl: `${origin}/api/phonepe/redirect?holdId=${holdId}`,
      message: `Booking — ${formatRupeesForMessage(orderAmountPaise)}`,
    });

    // Track attempt on the hold + extend TTL so payment flow has room to
    // complete. paymentAmount must store the amount PhonePe was actually
    // asked to charge (orderAmount = 50% advance when isAdvance).
    // Otherwise the verify/callback path will read this back as the amount
    // paid and miscompute advanceAmount / remainingAmount on Payment.
    await db.slotHold.update({
      where: { id: holdId },
      data: {
        phonePeMerchantTxnId: merchantOrderId,
        paymentMethod: isAdvance ? "CASH" : "PHONEPE",
        paymentAmount: orderAmount,
        paymentInitiatedAt: new Date(),
        // Abandoned pass top-up → paying the full way; drop the
        // attachment so no callback treats this as a top-up.
        redeemPassId: null,
        expiresAt: new Date(
          Date.now() + PAYMENT_ATTEMPT_TTL_MINUTES * 60 * 1000
        ),
      },
    });

    logServerAction({
      userId,
      category: AnalyticsCategory.PAYMENT,
      action: "payment.phonepe.initiate",
      outcome: "success",
      path: request.nextUrl.pathname,
      method: "POST",
      platform: resolveRequestPlatform(request),
      metadata: {
        holdId,
        merchantOrderId,
        amount: orderAmount,
        clientAmount: overrideAmount ?? null,
        clientAmountUnexplained: charge.clientAmountUnexplained,
        recurringCount: charge.recurringCount,
        isAdvance: !!isAdvance,
        advanceAmount: advanceAmount ?? null,
        remainingAmount: remainingAmount ?? null,
      },
    });

    return NextResponse.json({
      redirectUrl: result.redirectUrl,
      isAdvance: !!isAdvance,
      advanceAmount: advanceAmount ?? null,
      remainingAmount: remainingAmount ?? null,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to initiate payment";
    logServerAction({
      userId,
      category: AnalyticsCategory.PAYMENT,
      action: "payment.phonepe.initiate",
      outcome: "error",
      path: request.nextUrl.pathname,
      method: "POST",
      platform: resolveRequestPlatform(request),
      metadata: { holdId },
      error: message,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// Tiny helper kept inline — used only for the cosmetic message
// shown on the PhonePe page header.
function formatRupeesForMessage(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN")}`;
}
