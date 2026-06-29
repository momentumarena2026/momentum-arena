import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireMobileAdmin } from "@/lib/mobile-admin-guard";

/**
 * GET /api/mobile/admin/bookings/[id]
 *
 * Full booking detail for the mobile admin detail screen — customer
 * info, court config, slots, payment (with partial-payment fields
 * intact for the "Collect ₹X at venue" pill), edit history, and the
 * recurring-series link if any.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireMobileAdmin(request, "MANAGE_BOOKINGS");
  if ("error" in gate) return gate.error;

  const { id } = await params;

  const booking = await db.booking.findUnique({
    where: { id },
    include: {
      user: {
        select: { id: true, name: true, phone: true, email: true },
      },
      courtConfig: true,
      slots: { orderBy: { startHour: "asc" } },
      payment: true,
      editHistory: { orderBy: { createdAt: "desc" } },
      recurringBooking: {
        include: {
          bookings: {
            where: { payment: { isNot: null } },
            include: { payment: true },
            take: 1,
            orderBy: { date: "asc" },
          },
        },
      },
    },
  });

  if (!booking) {
    return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  }

  // Same recurring-child payment inheritance as the list endpoint.
  let payment = booking.payment;
  let isRecurringChildPayment = false;
  if (!payment && booking.recurringBooking?.bookings?.[0]?.payment) {
    payment = booking.recurringBooking.bookings[0].payment;
    isRecurringChildPayment = true;
  }

  return NextResponse.json({
    booking: {
      ...booking,
      payment,
      _isRecurringChildPayment: isRecurringChildPayment,
    },
  });
}
