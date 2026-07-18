import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireMobileAdmin } from "@/lib/mobile-admin-guard";

/**
 * GET /api/mobile/admin/bookings/unconfirmed
 *
 * Mirrors the composite filter the web /admin/bookings/unconfirmed
 * page uses — bookings literally awaiting admin verification of a
 * UPI screenshot or cash collection. NOT the same as the broader
 * "Pending" status chip on the regular bookings list.
 *
 * Web filter exactly:
 *   { status: "PENDING",
 *     payment: { status: "PENDING", method: { in: ["UPI_QR","CASH"] } } }
 *
 * Auto-confirmed gateway payments (Razorpay / PhonePe) are excluded
 * because the gateway webhook flips them to CONFIRMED already; if
 * they're sitting at PENDING something is wrong upstream and they
 * shouldn't clutter the floor-staff queue.
 */
export async function GET(request: NextRequest) {
  const gate = await requireMobileAdmin(request, "MANAGE_BOOKINGS");
  if ("error" in gate) return gate.error;

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const limit = Math.min(
    100,
    Math.max(1, parseInt(searchParams.get("limit") || "20", 10)),
  );

  const where = {
    status: "PENDING" as const,
    payment: {
      status: "PENDING" as const,
      method: { in: ["UPI_QR" as const, "CASH" as const] },
    },
  };

  const [bookings, total] = await Promise.all([
    db.booking.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, phone: true } },
        courtConfig: { select: { sport: true, label: true, size: true } },
        slots: { orderBy: { startHour: "asc" } },
        payment: true,
      },
      orderBy: [{ createdAt: "desc" }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.booking.count({ where }),
  ]);

  // Same enriched shape the regular list returns so the row component
  // can be reused without a separate type. Recurring inheritance
  // doesn't apply here — recurring child bookings don't sit in
  // PENDING with a UPI/Cash payment row of their own.
  const enriched = bookings.map((b) => ({
    ...b,
    _isRecurringChildPayment: false,
  }));

  // Customer-claimed cafe/pass payments PhonePe hasn't confirmed. Kept
  // as intents (materialising early would issue a redeemable pass), so
  // they ride alongside the bookings rather than inside them. Only sent
  // on page 1 — this is a short list, not a paginated one.
  const claims =
    page === 1
      ? await (async () => {
          const [cafe, passes] = await Promise.all([
            db.cafePaymentIntent.findMany({
              where: { claimedAt: { not: null }, consumedOrderId: null },
              orderBy: { claimedAt: "desc" },
              take: 25,
            }),
            db.passPurchaseIntent.findMany({
              where: { claimedAt: { not: null }, consumedUserPassId: null },
              orderBy: { claimedAt: "desc" },
              take: 25,
            }),
          ]);
          const userIds = [
            ...new Set(
              [...cafe, ...passes]
                .map((c) => c.userId)
                .filter((id): id is string => !!id),
            ),
          ];
          const [users, plans] = await Promise.all([
            userIds.length
              ? db.user.findMany({
                  where: { id: { in: userIds } },
                  select: { id: true, name: true, phone: true },
                })
              : [],
            passes.length
              ? db.passPlan.findMany({
                  where: { id: { in: passes.map((p) => p.planId) } },
                  select: { id: true, name: true, price: true },
                })
              : [],
          ]);
          const userById = new Map(users.map((u) => [u.id, u]));
          const planById = new Map(plans.map((p) => [p.id, p]));
          return [
            ...cafe.map((c) => ({
              kind: "cafe" as const,
              id: c.id,
              customer:
                userById.get(c.userId ?? "")?.name ??
                c.guestName ??
                userById.get(c.userId ?? "")?.phone ??
                c.guestPhone ??
                null,
              label: "Cafe order",
              amount: c.totalAmount,
              transactionId: c.phonePeMerchantTxnId,
              claimedAt: c.claimedAt,
            })),
            ...passes.map((p) => ({
              kind: "pass" as const,
              id: p.id,
              customer: userById.get(p.userId)?.name ?? userById.get(p.userId)?.phone ?? null,
              label: planById.get(p.planId)?.name ?? "Pass",
              amount: planById.get(p.planId)?.price ?? 0,
              transactionId: p.phonePeMerchantTxnId,
              claimedAt: p.claimedAt,
            })),
          ];
        })()
      : [];

  return NextResponse.json({
    bookings: enriched,
    claims,
    total,
    page,
    totalPages: Math.ceil(total / limit),
  });
}
