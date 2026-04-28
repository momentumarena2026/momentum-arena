import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getMobileAdmin } from "@/lib/mobile-auth";
import { cancelBooking } from "@/actions/admin-booking";

/**
 * POST /api/mobile/admin/bookings/[id]/cancel
 * body: { reason: string }
 *
 * Cancels the booking (status → CANCELLED), frees the slot, and
 * fires the customer push notification (handled inside cancelBooking
 * via notifyBookingCancelled). Reason is required to keep the audit
 * trail meaningful.
 */
const Body = z.object({ reason: z.string().min(1).max(500) });

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
      { error: "Cancellation reason is required" },
      { status: 400 },
    );
  }

  const { id } = await params;
  const result = await cancelBooking(id, parsed.data.reason, admin.id);
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
