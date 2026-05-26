import { NextRequest, NextResponse, after } from "next/server";
import { db } from "@/lib/db";
import { verifyRazorpayWebhookSignature } from "@/lib/razorpay";
import { createBookingFromHold } from "@/actions/booking";
import {
  sendBookingConfirmation,
  notifyAdminBookingConfirmed,
} from "@/lib/notifications";
import { awardBookingPoints } from "@/lib/rewards/earn";

/**
 * Razorpay server-to-server webhook.
 *
 * Endpoint registered in the Razorpay dashboard ("Settings → Webhooks")
 * with the secret stored in env as `RAZORPAY_WEBHOOK_SECRET`. Razorpay
 * POSTs the event JSON with an `X-Razorpay-Signature` HMAC of the raw
 * body — we verify that before doing anything else.
 *
 * Why this exists: the client-side `/api/razorpay/verify` call is
 * customer-driven. If the customer's network drops between Razorpay's
 * redirect and our verify endpoint, the money is captured by Razorpay
 * but our DB has no Booking — leaving a phantom-blocked slot plus a
 * frustrated customer. The webhook fires server-to-server when
 * Razorpay captures the payment, independent of the client, and
 * creates the Booking ourselves.
 *
 * Idempotency: `createBookingFromHold` short-circuits on duplicate
 * `razorpayPaymentId`. If the client's verify call also lands, only
 * one Booking is created — whichever path wins the race.
 *
 * Events handled:
 *   - payment.captured  → primary creation path
 *   - (others ignored)  → return 200 so Razorpay doesn't retry them
 *
 * Reply policy: always return 2xx unless the signature failed. A 5xx
 * tells Razorpay to retry, which can mask real bugs — we'd rather
 * log + investigate than retry-loop forever.
 *
 * Health check: a GET request returns 200 with the route's status so
 * we can quickly verify the route is reachable + the webhook secret
 * is configured without firing a real Razorpay event. Production
 * smoke-test: `curl https://momentumarena.com/api/razorpay/webhook`.
 */
export async function GET() {
  return NextResponse.json({
    ok: true,
    route: "razorpay-webhook",
    secretConfigured: !!process.env.RAZORPAY_WEBHOOK_SECRET,
  });
}

export async function POST(request: NextRequest) {
  const signature = request.headers.get("x-razorpay-signature");
  if (!signature) {
    return NextResponse.json(
      { error: "Missing signature" },
      { status: 400 },
    );
  }

  // The raw body MUST be passed to the HMAC verifier byte-for-byte —
  // any whitespace normalisation breaks the match. `request.text()`
  // returns the exact bytes Razorpay sent.
  const rawBody = await request.text();
  if (!verifyRazorpayWebhookSignature(rawBody, signature)) {
    console.warn("[razorpay-webhook] signature mismatch");
    return NextResponse.json(
      { error: "Invalid signature" },
      { status: 401 },
    );
  }

  let event: {
    event?: string;
    payload?: {
      payment?: { entity?: RazorpayPaymentEntity };
    };
  };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // We only act on payment.captured. Other events (order.paid,
  // payment.failed, refund.processed, etc.) get a polite 200 so
  // Razorpay marks the delivery successful and doesn't retry.
  if (event.event !== "payment.captured") {
    return NextResponse.json({ ok: true, ignored: event.event });
  }

  const payment = event.payload?.payment?.entity;
  if (!payment?.id || !payment.order_id) {
    return NextResponse.json(
      { ok: true, reason: "missing-payment-fields" },
    );
  }

  // If we already have a Booking for this payment, the client's
  // verify call won the race. Done.
  const existingPayment = await db.payment.findFirst({
    where: { razorpayPaymentId: payment.id },
    select: { bookingId: true },
  });
  if (existingPayment) {
    return NextResponse.json({
      ok: true,
      bookingId: existingPayment.bookingId,
      via: "already-created",
    });
  }

  // Look up the SlotHold via the Razorpay order id we stamped onto it
  // in /api/razorpay/create-order. If the hold has expired AND the
  // cleanup cron already swept it, the row is gone — the admin will
  // need to use the recovery tool at /admin/bookings/recovery to
  // reconstruct the booking manually.
  const hold = await db.slotHold.findFirst({
    where: { razorpayOrderId: payment.order_id },
  });
  if (!hold) {
    console.warn(
      "[razorpay-webhook] no hold for order",
      payment.order_id,
      "— falls back to admin recovery tool",
    );
    return NextResponse.json({
      ok: true,
      reason: "no-hold",
      orderId: payment.order_id,
    });
  }

  // Reconstruct the same payment record the client's /verify path
  // would have written. Mirror of app/api/razorpay/verify/route.ts —
  // any change there should ship here too.
  const paymentAmountRupees = Math.round(payment.amount / 100); // paise → rupees
  const appliedDiscount =
    hold.couponId && hold.discountAmount && hold.discountAmount > 0
      ? hold.discountAmount
      : 0;
  const pointsRedeemRupees =
    hold.pointsToRedeem && hold.pointsRedeemPaiseSaved
      ? Math.floor(hold.pointsRedeemPaiseSaved / 100)
      : 0;
  const fullAmount =
    hold.totalAmount - appliedDiscount - pointsRedeemRupees;
  const isAdvance = paymentAmountRupees < fullAmount;
  const advanceAmount = isAdvance ? paymentAmountRupees : undefined;
  const remainingAmount = isAdvance
    ? fullAmount - paymentAmountRupees
    : undefined;

  let bookingId: string | null = null;
  try {
    bookingId = await createBookingFromHold(
      hold.id,
      {
        method: "RAZORPAY",
        status: isAdvance ? "PARTIAL" : "COMPLETED",
        amount: paymentAmountRupees,
        razorpayOrderId: payment.order_id,
        razorpayPaymentId: payment.id,
        // The webhook payload does NOT carry the redirect-flow
        // signature (that's only in the client's payment-success
        // callback). We synthesise it from our key secret so the
        // Payment row's `razorpaySignature` column is never null —
        // the redirect-flow signature is for ANTI-TAMPER on the
        // CLIENT side; the webhook itself is already authenticated
        // via the HMAC of the raw body above.
        razorpaySignature: `webhook:${payment.id}`,
        confirmedAt: new Date(),
        isPartialPayment: isAdvance,
        advanceAmount,
        remainingAmount,
      },
      "CONFIRMED",
    );
  } catch (err) {
    console.error("[razorpay-webhook] createBookingFromHold failed", err);
    // Return 200 — retries would just hit the same error. Admin can
    // recover via the /admin/bookings/recovery tool.
    return NextResponse.json({
      ok: true,
      reason: "create-booking-failed",
      error: err instanceof Error ? err.message : "Unknown",
    });
  }

  if (!bookingId) {
    return NextResponse.json({
      ok: true,
      reason: "create-booking-returned-null",
    });
  }

  // Fire confirmation SMS + admin notification + rewards award in
  // the after() window so the webhook response goes back fast.
  // Razorpay's webhook policy says you have 5s to ack; we ship the
  // 200 immediately and let the post-response work complete async.
  after(async () => {
    await Promise.allSettled([
      sendBookingConfirmation(bookingId!).catch((err) =>
        console.error("[razorpay-webhook] sms failed", err),
      ),
      notifyAdminBookingConfirmed(bookingId!).catch((err) =>
        console.error("[razorpay-webhook] admin notify failed", err),
      ),
      awardBookingPoints(bookingId!).catch((err) =>
        console.error("[razorpay-webhook] award failed", err),
      ),
    ]);
  });

  return NextResponse.json({ ok: true, bookingId, via: "webhook" });
}

interface RazorpayPaymentEntity {
  id: string; // pay_…
  amount: number; // paise
  currency: string;
  status: string;
  order_id: string;
  method?: string;
  captured?: boolean;
  email?: string | null;
  contact?: string | null;
  notes?: Record<string, string> | null;
}
