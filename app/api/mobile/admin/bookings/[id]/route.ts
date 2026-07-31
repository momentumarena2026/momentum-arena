import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireMobileAdmin } from "@/lib/mobile-admin-guard";
import { passBandsCoverHours, getPassOfferForHold } from "@/lib/passes";

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
  const redemptionRows = await db.passRedemption.findMany({
    where: { bookingId: id, restoredAt: null },
    orderBy: { createdAt: "asc" },
    select: {
      minutes: true,
      value: true,
      coveredAmount: true,
      userPassId: true,
      userPass: { select: { name: true } },
    },
  });
  const live = redemptionRows[0] ?? null;

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
  const extendCandidates = booking.userId
    ? await db.userPass.findMany({
        where: live
          ? { id: live.userPassId, ...eligibility }
          : {
              OR: [
                { userId: booking.userId },
                { members: { some: { userId: booking.userId } } },
              ],
              ...eligibility,
            },
        orderBy: { expiresAt: "asc" },
        select: { id: true, name: true, remainingMinutes: true, bands: true },
      })
    : [];
  // Only offer a pass whose price bands cover this booking's hours —
  // the server enforces bands on save (same filter as the web page).
  let extendPass: {
    id: string;
    name: string;
    remainingMinutes: number;
  } | null = null;
  // Same rule as the web page: the booking's hours plus the two an
  // extend could reach; at least one must be in band.
  const bookedHours = booking.slots.map((s) => s.startHour);
  const candidateHours = [
    ...new Set([
      ...bookedHours,
      Math.max(0, Math.min(...bookedHours) - 1),
      (Math.max(...bookedHours) + 1) % 24,
    ]),
  ];
  for (const candidate of extendCandidates) {
    const covers = (
      await Promise.all(
        candidateHours.map((h) =>
          passBandsCoverHours(candidate, booking.courtConfigId, booking.date, [h]),
        ),
      )
    ).some(Boolean);
    if (covers) {
      extendPass = {
        id: candidate.id,
        name: candidate.name,
        remainingMinutes: candidate.remainingMinutes,
      };
      break;
    }
  }

  // The invariant staff act on: what's still collectable at the venue
  // (equipment and any added-but-uncovered time on a pass booking).
  const owedAtVenue = Math.max(
    0,
    booking.totalAmount - (payment?.amount ?? 0) - (live?.coveredAmount ?? 0),
  );

  // "Move to pass payment" preview for the Edit Payment screen —
  // offered when the booking is money-paid but the customer's passes
  // could cover its slots (mirror of the web detail page).
  const passConvert =
    redemptionRows.length === 0 &&
    booking.userId &&
    payment &&
    payment.method !== "PASS" &&
    booking.status !== "CANCELLED"
      ? await getPassOfferForHold({
          userId: booking.userId,
          courtConfigId: booking.courtConfigId,
          date: booking.date,
          hours: booking.slots.map((sl) => sl.startHour),
          startMinutes: booking.slots.map((sl) => sl.startMinute),
          totalAmount: booking.slots.reduce((sum, sl) => sum + sl.price, 0),
          slotPrices: booking.slots.map((sl) => ({
            hour: sl.startHour,
            minute: sl.startMinute,
            price: sl.price,
          })),
          equipmentTotalAmount: booking.equipmentTotalAmount ?? 0,
          courtConfig: {
            slotDurationMinutes: booking.slots.some(
              (sl) => sl.durationMinutes === 30,
            )
              ? 30
              : 60,
          },
        })
          .then((offer) =>
            offer
              ? {
                  fullCoverage: offer.fullCoverage,
                  remainderAmount: offer.remainderAmount,
                  passes: offer.passes.map((sh) => ({
                    passName: sh.passName,
                    coveredMinutes: sh.coveredMinutes,
                  })),
                }
              : null,
          )
          .catch(() => null)
      : null;

  return NextResponse.json({
    booking: {
      ...booking,
      payment,
      passConvert,
      _isRecurringChildPayment: isRecurringChildPayment,
      passRedemption: live
        ? {
            // Aggregates across every contributing pass; names joined so
            // the existing single-line UI reads correctly.
            passName: redemptionRows
              .map((r) => r.userPass.name)
              .join(" + "),
            minutes: redemptionRows.reduce((s, r) => s + r.minutes, 0),
            value: redemptionRows.reduce((s, r) => s + r.value, 0),
            coveredAmount: redemptionRows.reduce(
              (s, r) => s + r.coveredAmount,
              0,
            ),
          }
        : null,
      passRedemptions: redemptionRows.map((r) => ({
        passName: r.userPass.name,
        minutes: r.minutes,
        value: r.value,
        coveredAmount: r.coveredAmount,
      })),
      extendPass,
      owedAtVenue,
    },
  });
}
