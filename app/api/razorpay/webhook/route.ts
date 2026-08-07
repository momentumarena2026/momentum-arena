import { NextRequest, NextResponse, after } from "next/server";
import { db } from "@/lib/db";
import { materializeUserPass } from "@/lib/passes";
import { confirmTournamentEntry } from "@/lib/tournaments";
import { completePassTopup } from "@/lib/pass-topup";
import { verifyRazorpayWebhookSignature } from "@/lib/razorpay";
import { createBookingFromHold } from "@/actions/booking";
import { confirmShopOrderPaid } from "@/lib/shop-confirm";
import { materializeOrderFromIntent } from "@/lib/cafe-intent";
import {
  sendBookingConfirmation,
  notifyAdminBookingConfirmed,
} from "@/lib/notifications";
import { awardBookingPoints } from "@/lib/rewards/earn";
import { recordOrphanPayment } from "@/lib/payment-orphan";

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
 * The same reasoning applies to every other thing Razorpay can be
 * paid for, so this route reconciles all of them: slot bookings
 * (SlotHold), pass purchases, pass top-ups, shop orders
 * (ProductOrder) and cafe orders (CafePaymentIntent).
 *
 * Idempotency: `createBookingFromHold` short-circuits on duplicate
 * `razorpayPaymentId`. If the client's verify call also lands, only
 * one Booking is created — whichever path wins the race. The shop and
 * cafe helpers short-circuit the same way (already-CONFIRMED order /
 * already-consumed intent), so re-delivery and out-of-order delivery
 * are safe.
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
 * smoke-test: `curl https://www.momentumarena.com/api/razorpay/webhook`.
 * (www, not the apex — the apex 307s everything except /.well-known/.)
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

  // Tournament entry fees route on order NOTES stamped in
  // lib/tournaments.registerTournamentTeam — no SlotHold. Confirm the team
  // idempotently (the client verify may have already won); a mismatch files
  // an orphan so captured money always surfaces on the admin worklist.
  if (payment.notes?.type === "TOURNAMENT_ENTRY" && payment.notes.teamId) {
    const result = await confirmTournamentEntry({
      teamId: payment.notes.teamId,
      razorpayPaymentId: payment.id,
      paidRupees: Math.round(payment.amount / 100),
    });
    if (!result.ok) {
      console.error(
        "[razorpay-webhook] tournament confirm failed",
        payment.order_id,
        result.error,
      );
      recordOrphanPayment({
        gateway: "RAZORPAY",
        reason: `tournament-${result.error || "confirm-failed"}`,
        userId: payment.notes.userId || "unknown",
        amountRupees: Math.round(payment.amount / 100),
        razorpayOrderId: payment.order_id,
        razorpayPaymentId: payment.id,
        path: request.nextUrl.pathname,
      });
      return NextResponse.json({ ok: true, reason: "tournament-confirm-failed" });
    }
    return NextResponse.json({ ok: true, tournamentTeam: payment.notes.teamId });
  }

  // Pass purchases route on the order NOTES we stamp in
  // /api/passes/create-order — they have no SlotHold. Materialize the
  // UserPass idempotently (the client verify may have already won).
  if (payment.notes?.type === "PASS" && payment.notes.planId && payment.notes.userId) {
    // The notes ride from OUR order creation (Razorpay copies order
    // notes onto the payment), but never materialize a pass the captured
    // amount doesn't actually pay for (e.g. the plan was repriced
    // between order and capture).
    const plan = await db.passPlan.findUnique({
      where: { id: payment.notes.planId },
      select: { price: true },
    });
    if (!plan || payment.amount !== Math.round(plan.price * 100)) {
      console.error(
        "[razorpay-webhook] pass amount mismatch",
        payment.order_id,
        payment.amount,
        plan?.price ?? "no-plan",
      );
      // Captured money with no pass issued — make it a worklist item,
      // not just a log line.
      recordOrphanPayment({
        gateway: "RAZORPAY",
        reason: "pass-price-mismatch",
        userId: payment.notes.userId,
        amountRupees: Math.round(payment.amount / 100),
        razorpayOrderId: payment.order_id,
        razorpayPaymentId: payment.id,
        path: request.nextUrl.pathname,
      });
      return NextResponse.json({ ok: true, reason: "pass-amount-mismatch" });
    }
    const startsAt = payment.notes.startsAt
      ? new Date(payment.notes.startsAt)
      : undefined;
    const result = await materializeUserPass({
      razorpayOrderId: payment.order_id,
      razorpayPaymentId: payment.id,
      planId: payment.notes.planId,
      userId: payment.notes.userId,
      startsAt: startsAt && !Number.isNaN(startsAt.getTime()) ? startsAt : undefined,
    });
    return NextResponse.json({
      ok: true,
      via: result?.alreadyDone ? "pass-already-created" : "pass-created",
      userPassId: result?.userPassId ?? null,
    });
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
    include: { courtConfig: true },
  });
  if (!hold) {
    // Not every Razorpay order is a slot booking. Shop and cafe checkouts
    // mint their own order/intent rows and are confirmed ONLY by their
    // client-side verify calls — which is exactly the call that never
    // lands when the browser/app dies right after capture. Reconcile them
    // here (same server-side backstop the booking path gets) before
    // treating the payment as unrecognised.

    // Shop: the razorpayOrderId is stamped on the ProductOrderPayment by
    // /api/shop/razorpay/create-order. confirmOrderAfterRazorpay is
    // idempotent (returns success on an already CONFIRMED/FULFILLED
    // order), so re-delivery is safe.
    const shopPayment = await db.productOrderPayment.findFirst({
      where: { razorpayOrderId: payment.order_id },
      select: { order: { select: { id: true, userId: true } } },
    });
    if (shopPayment?.order) {
      // The internal helper, not the server action: there is no session
      // on a webhook, and the action no longer accepts a caller-supplied
      // user id (that parameter was an IDOR). The owner is read from the
      // order row we just looked up.
      const res = await confirmShopOrderPaid({
        orderId: shopPayment.order.id,
        userId: shopPayment.order.userId,
        razorpayPaymentId: payment.id,
        razorpayOrderId: payment.order_id,
        // Same synthesised-signature rationale as the booking path below.
        razorpaySignature: `webhook:${payment.id}`,
      });
      if (!res.success) {
        console.error(
          "[razorpay-webhook] shop confirm failed",
          shopPayment.order.id,
          res.error,
        );
        // Captured money on an order we could not confirm (cancelled or
        // otherwise non-PENDING) — worklist item, not just a log line.
        recordOrphanPayment({
          gateway: "RAZORPAY",
          reason: "create-failed",
          userId: shopPayment.order.userId,
          amountRupees: Math.round(payment.amount / 100),
          razorpayOrderId: payment.order_id,
          razorpayPaymentId: payment.id,
          path: request.nextUrl.pathname,
        });
      }
      return NextResponse.json(
        res.success
          ? { ok: true, orderId: shopPayment.order.id, via: "webhook-shop" }
          : { ok: true, reason: "shop-confirm-failed", error: res.error },
      );
    }

    // Cafe: no CafeOrder exists until the intent is materialised, so the
    // intent (keyed by razorpayOrderId) is the only pointer back. The
    // helper short-circuits on an already-consumed intent.
    const cafeIntent = await db.cafePaymentIntent.findUnique({
      where: { razorpayOrderId: payment.order_id },
      select: { id: true, userId: true },
    });
    if (cafeIntent) {
      const result = await materializeOrderFromIntent(cafeIntent.id, {
        razorpayOrderId: payment.order_id,
        razorpayPaymentId: payment.id,
        razorpaySignature: `webhook:${payment.id}`,
      });
      if (!result.ok) {
        console.error(
          "[razorpay-webhook] cafe materialize failed",
          cafeIntent.id,
          result.error,
        );
        // A sold-out race still materialises a CANCELLED order for the
        // refund trail (result.refundOrderId); anything else leaves the
        // money with nothing attached, so record it.
        if (!result.refundOrderId) {
          recordOrphanPayment({
            gateway: "RAZORPAY",
            reason: "create-failed",
            userId: cafeIntent.userId,
            amountRupees: Math.round(payment.amount / 100),
            razorpayOrderId: payment.order_id,
            razorpayPaymentId: payment.id,
            path: request.nextUrl.pathname,
          });
        }
      }
      return NextResponse.json(
        result.ok
          ? { ok: true, orderId: result.orderId, via: "webhook-cafe" }
          : {
              ok: true,
              reason: "cafe-materialize-failed",
              error: result.error,
              refundOrderId: result.refundOrderId ?? null,
            },
      );
    }

    // The intent is deleted once consumed + swept, so a late re-delivery
    // finds no intent even though the order exists. Match the client
    // verify route's fallback and look the payment up directly rather
    // than logging a false orphan.
    const existingCafePayment = await db.cafePayment.findFirst({
      where: { razorpayOrderId: payment.order_id },
      select: { orderId: true },
    });
    if (existingCafePayment?.orderId) {
      return NextResponse.json({
        ok: true,
        orderId: existingCafePayment.orderId,
        via: "cafe-already-created",
      });
    }

    console.warn(
      "[razorpay-webhook] no hold for order",
      payment.order_id,
      "— falls back to admin recovery tool",
    );
    // This is the payment.captured event → money is settled, but the hold
    // blueprint is gone (swept past the 24h grace, or never existed). Record
    // an orphan so an admin honours/refunds it rather than it living only in
    // a console.warn that no one reads.
    recordOrphanPayment({
      gateway: "RAZORPAY",
      reason: "no-hold",
      amountRupees: Math.round(payment.amount / 100),
      razorpayOrderId: payment.order_id,
      razorpayPaymentId: payment.id,
      path: request.nextUrl.pathname,
    });
    return NextResponse.json({
      ok: true,
      reason: "no-hold",
      orderId: payment.order_id,
    });
  }

  // Pass TOP-UP orders (minted in /api/passes/redeem) carry a
  // redeemPassId on their hold. Route them through the same helper the
  // client's /api/passes/redeem-verify uses so the booking, the
  // PassRedemption, and the pass debit land identically whichever path
  // wins — the generic reconstruction below would book the remainder
  // without ever debiting the pass.
  if (hold.redeemPassId) {
    const topup = await completePassTopup({
      hold,
      razorpayOrderId: payment.order_id,
      razorpayPaymentId: payment.id,
      // Same synthesised-signature rationale as the generic path below.
      razorpaySignature: `webhook:${payment.id}`,
      path: request.nextUrl.pathname,
    });
    // Always 2xx (webhook reply policy) — failures are already recorded
    // as orphans / logged inside the helper.
    return NextResponse.json(
      topup.ok
        ? { ok: true, bookingId: topup.bookingId, via: "webhook-pass-topup" }
        : { ok: true, reason: "pass-topup-failed", error: topup.error },
    );
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
  // Gear picked at lock time is PLUSed on top of the slot total — the
  // same `effectiveTotal` math createBookingFromHold uses for
  // Booking.totalAmount, and what create-order actually charged. Leaving
  // it out made a 50% advance on an equipment-heavy booking look like a
  // full payment, so the remainder was never flagged or collected.
  const fullAmount =
    hold.totalAmount -
    appliedDiscount -
    pointsRedeemRupees +
    (hold.equipmentTotalAmount ?? 0);
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
