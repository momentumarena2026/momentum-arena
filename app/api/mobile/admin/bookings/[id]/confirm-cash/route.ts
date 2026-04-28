import { NextRequest, NextResponse } from "next/server";
import { getMobileAdmin } from "@/lib/mobile-auth";
import { confirmCashPayment } from "@/actions/admin-booking";

/**
 * POST /api/mobile/admin/bookings/[id]/confirm-cash
 *
 * Customer paid in cash at the venue → admin taps "Confirm Cash" →
 * booking flips to CONFIRMED, payment to COMPLETED (or PARTIAL for
 * an advance booking). Same wrapper as the UPI variant.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await getMobileAdmin(request);
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const result = await confirmCashPayment(id, admin.id);
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
