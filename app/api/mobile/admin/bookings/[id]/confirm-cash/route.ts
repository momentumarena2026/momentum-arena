import { NextRequest, NextResponse } from "next/server";
import { requireMobileAdmin } from "@/lib/mobile-admin-guard";
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
  const gate = await requireMobileAdmin(request, "MANAGE_BOOKINGS");
  if ("error" in gate) return gate.error;
  const admin = gate.admin;

  const { id } = await params;
  const result = await confirmCashPayment(id, admin.id);
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
