import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getMobileAdmin } from "@/lib/mobile-auth";
import { refundBooking } from "@/actions/admin-booking";

/**
 * POST /api/mobile/admin/bookings/[id]/refund
 * body: { reason, refundMethod?, refundAmount? }
 *
 * Refunds (full or partial) the booking and cancels it. Reason
 * required. refundAmount in rupees (whole number); when omitted the
 * full Payment.amount is refunded.
 */
const Body = z.object({
  reason: z.string().min(1).max(500),
  refundMethod: z.enum(["ORIGINAL", "CASH", "UPI", "BANK_TRANSFER"]).optional(),
  refundAmount: z.number().int().positive().optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await getMobileAdmin(request);
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Reason is required; refundAmount must be positive if provided" },
      { status: 400 },
    );
  }

  const { id } = await params;
  const result = await refundBooking(
    id,
    parsed.data.reason,
    parsed.data.refundMethod,
    parsed.data.refundAmount,
    admin.id,
  );
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
