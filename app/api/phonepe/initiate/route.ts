import { NextRequest, NextResponse } from "next/server";
import { getAuthUserId } from "@/lib/auth-unified";
import { db } from "@/lib/db";
import { initiatePhonePePayment } from "@/lib/phonepe";
import { getValidHold } from "@/lib/slot-hold";

const PAYMENT_ATTEMPT_TTL_MINUTES = 15;

export async function POST(request: NextRequest) {
  const userId = await getAuthUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { holdId, isAdvance, overrideAmount } = await request.json();

  if (!holdId) {
    return NextResponse.json({ error: "Missing holdId" }, { status: 400 });
  }

  const hold = await getValidHold(holdId, userId);
  if (!hold) {
    return NextResponse.json(
      { error: "Hold not found or expired" },
      { status: 404 }
    );
  }

  try {
    const paymentAmount =
      overrideAmount && overrideAmount > 0 ? overrideAmount : hold.totalAmount;

    let orderAmount = paymentAmount;
    let advanceAmount: number | undefined;
    let remainingAmount: number | undefined;

    if (isAdvance) {
      advanceAmount = Math.ceil(paymentAmount * 0.5);
      remainingAmount = paymentAmount - advanceAmount;
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

    // v2 has no separate `callbackUrl` parameter — webhooks are
    // configured globally in the PhonePe dashboard's Webhooks tab,
    // not per-payment. We pass only the user-facing redirectUrl.
    const result = await initiatePhonePePayment({
      merchantOrderId,
      amount: orderAmount,
      redirectUrl: `${origin}/api/phonepe/redirect?holdId=${holdId}`,
      message: `Booking — ${formatRupeesForMessage(orderAmount)}`,
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
        expiresAt: new Date(
          Date.now() + PAYMENT_ATTEMPT_TTL_MINUTES * 60 * 1000
        ),
      },
    });

    return NextResponse.json({
      redirectUrl: result.redirectUrl,
      isAdvance: !!isAdvance,
      advanceAmount: advanceAmount ?? null,
      remainingAmount: remainingAmount ?? null,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to initiate payment",
      },
      { status: 500 }
    );
  }
}

// Tiny helper kept inline — used only for the cosmetic message
// shown on the PhonePe page header.
function formatRupeesForMessage(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN")}`;
}
