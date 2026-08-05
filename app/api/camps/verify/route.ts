import { NextRequest, NextResponse } from "next/server";
import { getAuthUserId } from "@/lib/auth-unified";
import { confirmCampPayment } from "@/lib/camps";
import { fetchRazorpayOrder, verifyRazorpaySignature } from "@/lib/razorpay";
import { recordOrphanPayment } from "@/lib/payment-orphan";

/**
 * Confirm a camp registration after the Razorpay modal succeeds.
 *
 * The signature only proves a capture happened — WHAT it was for comes
 * from the ORDER we created (notes.registrationId), never from the
 * client, so a cheap order can't confirm an expensive registration.
 */
export async function POST(request: NextRequest) {
  const userId = await getAuthUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = body || {};
  if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }
  if (!verifyRazorpaySignature(razorpayOrderId, razorpayPaymentId, razorpaySignature)) {
    return NextResponse.json({ error: "Signature mismatch" }, { status: 400 });
  }

  let order;
  try {
    order = await fetchRazorpayOrder(razorpayOrderId);
  } catch {
    return NextResponse.json(
      { error: "Couldn't confirm the payment with Razorpay — please retry" },
      { status: 502 },
    );
  }
  const notes =
    order.notes && !Array.isArray(order.notes)
      ? order.notes
      : ({} as Record<string, string>);
  if (notes.type !== "CAMP" || !notes.registrationId) {
    return NextResponse.json({ error: "Not a camp order" }, { status: 400 });
  }

  const res = await confirmCampPayment({
    registrationId: String(notes.registrationId),
    paidRupees: Math.round(order.amount / 100),
    method: "RAZORPAY",
    paymentRef: String(razorpayPaymentId),
  });
  if (!res.ok) {
    // Money IS captured — never a silent failure. File it for recovery.
    recordOrphanPayment({
      gateway: "RAZORPAY",
      reason: `camp-${res.error || "confirm-failed"}`,
      userId,
      amountRupees: Math.round(order.amount / 100),
      razorpayOrderId: String(razorpayOrderId),
      razorpayPaymentId: String(razorpayPaymentId),
      path: request.nextUrl.pathname,
    });
    return NextResponse.json(
      {
        error:
          "Payment received, but we couldn't auto-confirm your spot. Do NOT pay again — our team will confirm it shortly.",
        paymentReceived: true,
      },
      { status: 409 },
    );
  }
  return NextResponse.json({ success: true });
}
