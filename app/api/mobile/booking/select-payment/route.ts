import { NextRequest, NextResponse } from "next/server";
import { getMobileUser, getMobilePlatform } from "@/lib/mobile-auth";
import { getValidHold } from "@/lib/slot-hold";
import { createBookingFromHold } from "@/actions/booking";
import { notifyAdminPendingBooking } from "@/lib/notifications";

// POST /api/mobile/booking/select-payment — native wrapper around the web
// server actions `selectUpiPayment` and `selectCashPayment`. The web actions
// depend on NextAuth's session, so we re-implement them here under mobile JWT
// auth. Body:
//   { holdId, method: "UPI_QR" | "CASH", overrideAmount?: number,
//     isAdvance?: boolean }
// Returns { success, bookingId } matching the action return shape.
export async function POST(request: NextRequest) {
  const user = await getMobileUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    holdId?: string;
    method?: "UPI_QR" | "CASH";
    overrideAmount?: number;
    isAdvance?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const { holdId, method, overrideAmount, isAdvance } = body;
  if (!holdId || !method) {
    return NextResponse.json(
      { error: "Missing holdId or method" },
      { status: 400 }
    );
  }
  if (method !== "UPI_QR" && method !== "CASH") {
    return NextResponse.json(
      { error: "Unsupported method" },
      { status: 400 }
    );
  }

  const hold = await getValidHold(holdId, user.id);
  if (!hold) {
    return NextResponse.json(
      { success: false, error: "Hold not found or expired" },
      { status: 404 }
    );
  }

  const amount =
    overrideAmount && overrideAmount > 0 ? overrideAmount : hold.totalAmount;

  // For the 50% advance flow the customer paid `amount` (already post-discount,
  // passed from the client) via UPI QR. Compute the remainder against the
  // post-discount total so the coupon savings aren't clawed back at the venue.
  const advance = !!isAdvance;
  const appliedDiscount =
    hold.couponId && hold.discountAmount && hold.discountAmount > 0
      ? hold.discountAmount
      : 0;
  const effectiveTotal = hold.totalAmount - appliedDiscount;
  const advanceAmount = advance ? amount : undefined;
  const remainingAmount = advance
    ? Math.max(effectiveTotal - amount, 0)
    : undefined;

  // method === "CASH" + isAdvance: the customer paid the advance via QR, so we
  // record UPI_QR as the payment method (admin confirms on the WhatsApp
  // screenshot). Plain "CASH" is "pay full at venue" — not used from the
  // mobile UI but kept here for completeness.
  const paymentMethod =
    method === "UPI_QR" ? "UPI_QR" : advance ? "UPI_QR" : "CASH";

  const bookingId = await createBookingFromHold(
    holdId,
    {
      method: paymentMethod,
      status: "PENDING",
      amount,
      isPartialPayment: advance,
      advanceAmount,
      remainingAmount,
    },
    "PENDING",
    getMobilePlatform(request)
  );

  if (!bookingId) {
    return NextResponse.json(
      { success: false, error: "Failed to create booking" },
      { status: 500 }
    );
  }

  // Fire-and-forget — same behaviour as the web actions.
  notifyAdminPendingBooking(bookingId).catch(() => {});

  return NextResponse.json({ success: true, bookingId });
}
