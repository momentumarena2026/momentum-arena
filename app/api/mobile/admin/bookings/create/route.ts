import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getMobileAdmin } from "@/lib/mobile-auth";
import { adminCreateBooking } from "@/actions/admin-booking";

/**
 * POST /api/mobile/admin/bookings/create
 *
 * Mobile mirror of the web admin create-booking form. Accepts the
 * same payload shape adminCreateBooking takes; admin identity flows
 * through `adminOverride` from the JWT. customTotalAmount is
 * optional — when omitted, the server uses the slot-sum.
 */
const Body = z
  .object({
    courtConfigId: z.string().min(1),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    // Hourly courts (cricket, football, pickleball) send `hours`; the
    // Bowling Machine sends `bowlingSlots` instead. The action picks
    // the path off the court's category; the API just relays. Either
    // array must carry at least one entry but not both.
    // 0..24 inclusive — admin gets the full 24h clock. Hour 24 is the
    // legacy "12am-1am of next morning" slot some older bookings store;
    // keeping it accepted matches the web adminCreateBooking guard.
    hours: z.array(z.number().int().min(0).max(24)).default([]),
    bowlingSlots: z
      .array(
        z.object({
          hour: z.number().int().min(0).max(23),
          minute: z.union([z.literal(0), z.literal(30)]),
        }),
      )
      .optional(),
    userId: z.string().min(1),
    paymentMethod: z.enum(["CASH", "UPI_QR", "RAZORPAY", "FREE"]),
    razorpayPaymentId: z.string().max(200).optional(),
    advanceAmount: z.number().int().min(0).optional(),
    customTotalAmount: z.number().int().min(0).optional(),
    // Optional coupon to apply (today only PICKLEBALL25). The action
    // re-fetches the live coupon row server-side so the client can't
    // smuggle in a non-existent code.
    applyCouponCode: z.string().max(30).optional(),
    // Optional equipment rentals to attach at create time. Each
    // entry is {equipmentId, quantity}; the server re-fetches the
    // live Equipment row + prices the rental against the current
    // pricePerHour × slot count, same formula the post-create
    // EquipmentEditor uses.
    equipment: z
      .array(
        z.object({
          equipmentId: z.string().min(1),
          quantity: z.number().int().min(1).max(100),
        }),
      )
      .optional(),
    note: z.string().max(500).optional(),
  })
  .refine(
    (b) =>
      (b.bowlingSlots && b.bowlingSlots.length > 0) ||
      (b.hours && b.hours.length > 0),
    { message: "Pick at least one slot" },
  );

export async function POST(request: NextRequest) {
  const admin = await getMobileAdmin(request);
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid body" },
      { status: 400 },
    );
  }

  const result = await adminCreateBooking(parsed.data, {
    id: admin.id,
    username: admin.username,
  });
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true, bookingId: result.bookingId });
}
