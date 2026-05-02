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
const Body = z.object({
  courtConfigId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  hours: z.array(z.number().int().min(0).max(23)).min(1),
  userId: z.string().min(1),
  paymentMethod: z.enum(["CASH", "UPI_QR", "RAZORPAY", "FREE"]),
  razorpayPaymentId: z.string().max(200).optional(),
  advanceAmount: z.number().int().min(0).optional(),
  customTotalAmount: z.number().int().min(0).optional(),
  note: z.string().max(500).optional(),
});

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
