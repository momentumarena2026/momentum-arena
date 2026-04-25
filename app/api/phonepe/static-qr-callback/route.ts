import { NextRequest, NextResponse, after } from "next/server";
import { db } from "@/lib/db";
import {
  verifyStaticQrCallback,
  type StaticQrCallbackData,
} from "@/lib/phonepe-static-qr";
import {
  sendBookingConfirmation,
  notifyAdminBookingConfirmed,
} from "@/lib/notifications";

/**
 * PhonePe Static QR S2S Callback
 *
 * When a customer pays via the static QR at the venue, PhonePe sends a
 * server-to-server callback here.  We match the payment by UTR and
 * auto-verify it — no manual admin verification needed.
 *
 * Endpoint: POST /api/phonepe/static-qr-callback
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const base64Response = body.response as string;

    if (!base64Response) {
      console.error("Static QR callback: missing response payload");
      return NextResponse.json({ success: true }); // always 200
    }

    // Decode base64 payload. Guard against malformed callbacks — the
    // handler is public-facing and must never 500 on garbage input, or
    // PhonePe will keep retrying.
    let decoded: StaticQrCallbackData;
    try {
      decoded = JSON.parse(
        Buffer.from(base64Response, "base64").toString("utf-8")
      );
    } catch (err) {
      console.error("Static QR callback: malformed base64/JSON payload", err);
      return NextResponse.json({ success: true }); // always 200
    }

    const { data } = decoded;
    if (!data) {
      console.error("Static QR callback: missing data in decoded payload");
      return NextResponse.json({ success: true });
    }

    // Verify checksum (V1)
    const xVerify = request.headers.get("X-VERIFY") || "";
    const isValid = verifyStaticQrCallback(
      xVerify,
      data.merchantId,
      data.transactionId,
      data.amount
    );

    if (!isValid) {
      console.error("Static QR callback: checksum verification failed");
      return NextResponse.json({ success: true });
    }

    // Only process successful payments
    if (decoded.code !== "PAYMENT_SUCCESS" || data.paymentState !== "COMPLETED") {
      console.log(
        `Static QR callback: non-success status — code=${decoded.code}, state=${data.paymentState}`
      );
      return NextResponse.json({ success: true });
    }

    // Extract UTR from paymentModes
    const utr =
      data.paymentModes?.find((m) => m.utr)?.utr?.trim() || null;

    if (!utr) {
      console.warn(
        `Static QR callback: no UTR in payment modes for txn ${data.transactionId}`
      );
      return NextResponse.json({ success: true });
    }

    const now = new Date();

    // Try to match against pending UPI_QR booking payments by UTR
    const bookingPayment = await db.payment.findFirst({
      where: {
        method: "UPI_QR",
        status: "PENDING",
        utrNumber: utr,
      },
      include: { booking: true },
    });

    if (bookingPayment) {
      // Verify the amount matches
      const expectedAmount = bookingPayment.isPartialPayment
        ? bookingPayment.advanceAmount ?? bookingPayment.amount
        : bookingPayment.amount;

      if (data.amount !== expectedAmount) {
        console.warn(
          `Static QR callback: amount mismatch for booking payment ${bookingPayment.id}. Expected ${expectedAmount}, got ${data.amount}`
        );
        // Still proceed — admin can review, but log warning
      }

      await db.$transaction([
        db.payment.update({
          where: { id: bookingPayment.id },
          data: {
            status: "COMPLETED",
            utrVerifiedAt: now,
            phonePeTransactionId: data.transactionId,
            confirmedAt: now,
            confirmedBy: "PHONEPE_STATIC_QR",
          },
        }),
        // Booking was already in PENDING (user clicked "I've paid"); mark it CONFIRMED
        db.booking.update({
          where: { id: bookingPayment.bookingId },
          data: { status: "CONFIRMED" },
        }),
      ]);

      // Defer SMS dispatch via `after()` so the Vercel serverless function
      // stays alive until MSG91 responds. Fire-and-forget `.catch()` would be
      // killed the moment NextResponse.json returns.
      const confirmedBookingId = bookingPayment.bookingId;
      after(async () => {
        await Promise.allSettled([
          sendBookingConfirmation(confirmedBookingId).catch((err) =>
            console.error("Notification dispatch failed:", err)
          ),
          notifyAdminBookingConfirmed(confirmedBookingId).catch((err) =>
            console.error("Notification dispatch failed:", err)
          ),
        ]);
      });

      console.log(
        `Static QR callback: auto-verified booking payment ${bookingPayment.id} (UTR: ${utr})`
      );
      return NextResponse.json({ success: true });
    }

    // Try to match against pending UPI_QR cafe payments by UTR
    const cafePayment = await db.cafePayment.findFirst({
      where: {
        method: "UPI_QR",
        status: "PENDING",
        utrNumber: utr,
      },
      include: { order: true },
    });

    if (cafePayment) {
      if (data.amount !== cafePayment.amount) {
        console.warn(
          `Static QR callback: amount mismatch for cafe payment ${cafePayment.id}. Expected ${cafePayment.amount}, got ${data.amount}`
        );
      }

      await db.$transaction([
        db.cafePayment.update({
          where: { id: cafePayment.id },
          data: {
            status: "COMPLETED",
            utrVerifiedAt: now,
            phonePeTransactionId: data.transactionId,
            confirmedAt: now,
            confirmedBy: "PHONEPE_STATIC_QR",
          },
        }),
        db.cafeOrder.update({
          where: { id: cafePayment.orderId },
          data: { status: "PREPARING" },
        }),
      ]);

      console.log(
        `Static QR callback: auto-verified cafe payment ${cafePayment.id} (UTR: ${utr})`
      );
      return NextResponse.json({ success: true });
    }

    // No matching pending payment found — log for debugging
    console.log(
      `Static QR callback: no matching pending UPI_QR payment for UTR ${utr}, amount ${data.amount}, txn ${data.transactionId}`
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Static QR callback error:", error);
    return NextResponse.json({ success: true }); // Always 200 to PhonePe
  }
}
