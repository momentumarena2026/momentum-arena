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

  // ── Pass state (mirrors the web detail page) ──────────────────────
  // A redemption stamped restoredAt is undone — only a LIVE one settles
  // money or pins which pass may extend this booking.
  const redemptionRow = await db.passRedemption.findUnique({
    where: { bookingId: id },
    select: {
      minutes: true,
      value: true,
      coveredAmount: true,
      restoredAt: true,
      userPassId: true,
      userPass: { select: { name: true } },
    },
  });
  const live = redemptionRow && !redemptionRow.restoredAt ? redemptionRow : null;

  // Interchangeable courts: a pass bought for the LEFT half covers a
  // booking on the RIGHT half (same sport + size + category).
  const groupSiblingIds = await (async () => {
    const siblings = await db.courtConfig.findMany({
      where: {
        sport: booking.courtConfig.sport,
        size: booking.courtConfig.size,
        category: booking.courtConfig.category,
      },
      select: { id: true },
    });
    return siblings.map((s) => s.id);
  })();

  // A live redemption PINS the pass — extendBookingByThirtyMin rejects
  // any other id — so offer the attached pass when it's still usable,
  // and only fall back to the best-eligible pass when none is attached.
  const eligibility = {
    courtConfigId: { in: groupSiblingIds },
    status: "ACTIVE" as const,
    remainingMinutes: { gte: 30 },
    startsAt: { lte: booking.date },
    expiresAt: { gt: booking.date },
  };
  const extendPass = booking.userId
    ? live
      ? await db.userPass.findFirst({
          where: { id: live.userPassId, ...eligibility },
          select: { id: true, name: true, remainingMinutes: true },
        })
      : await db.userPass.findFirst({
          where: {
            OR: [
              { userId: booking.userId },
              { members: { some: { userId: booking.userId } } },
            ],
            ...eligibility,
          },
          orderBy: { expiresAt: "asc" },
          select: { id: true, name: true, remainingMinutes: true },
        })
    : null;

  // The invariant staff act on: what's still collectable at the venue
  // (equipment and any added-but-uncovered time on a pass booking).
  const owedAtVenue = Math.max(
    0,
    booking.totalAmount - (payment?.amount ?? 0) - (live?.coveredAmount ?? 0),
  );

  return NextResponse.json({
    booking: {
      ...booking,
      payment,
      _isRecurringChildPayment: isRecurringChildPayment,
      passRedemption: live
        ? {
            passName: live.userPass.name,
            minutes: live.minutes,
            value: live.value,
            coveredAmount: live.coveredAmount,
          }
        : null,
      extendPass,
      owedAtVenue,
    },
  });
}
