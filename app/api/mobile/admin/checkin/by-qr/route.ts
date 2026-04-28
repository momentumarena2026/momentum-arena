import { NextRequest, NextResponse } from "next/server";
import { getMobileAdmin } from "@/lib/mobile-auth";
import { getBookingByQrToken } from "@/actions/checkin";

/**
 * GET /api/mobile/admin/checkin/by-qr?qrToken=...
 *
 * Looks up a booking by QR token. Mirrors the web check-in flow that
 * lands on /admin/checkin?token=... after a scan. On mobile the
 * scanner UI lives in the RN screen, this endpoint is the data half.
 *
 * Returns 404 if the token doesn't resolve, which the client uses to
 * render the "Invalid QR" state matching the web admin.
 */
export async function GET(request: NextRequest) {
  const admin = await getMobileAdmin(request);
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const qrToken = new URL(request.url).searchParams.get("qrToken");
  if (!qrToken) {
    return NextResponse.json(
      { error: "qrToken required" },
      { status: 400 },
    );
  }

  const booking = await getBookingByQrToken(qrToken);
  if (!booking) {
    return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  }

  return NextResponse.json({
    booking: {
      id: booking.id,
      // Echo the qrToken back so the RN check-in card can wire the
      // confirm button without keeping a parallel state field.
      qrToken,
      date: booking.date.toISOString(),
      status: booking.status,
      totalAmount: booking.totalAmount,
      checkedInAt: booking.checkedInAt?.toISOString() ?? null,
      user: {
        name: booking.user.name,
        email: booking.user.email,
        phone: booking.user.phone,
      },
      courtConfig: {
        id: booking.courtConfig.id,
        sport: booking.courtConfig.sport,
        label: booking.courtConfig.label,
        size: booking.courtConfig.size,
      },
      slots: booking.slots.map((s) => ({ startHour: s.startHour })),
      payment: booking.payment
        ? {
            status: booking.payment.status,
            method: booking.payment.method,
          }
        : null,
    },
  });
}
