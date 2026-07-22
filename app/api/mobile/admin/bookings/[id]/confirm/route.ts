import { NextRequest, NextResponse } from "next/server";
import { requireMobileAdmin } from "@/lib/mobile-admin-guard";
import { confirmBookingManually } from "@/actions/admin-booking";

/**
 * POST /api/mobile/admin/bookings/[id]/confirm
 *
 * Generic "force confirm" — flips a PENDING booking to CONFIRMED
 * regardless of payment method/status. Escape hatch for stuck
 * states the regular confirm-cash / confirm-upi routes can't reach
 * (e.g. partial-payment booking whose remainder was collected
 * without first confirming the advance, or a payment that landed
 * COMPLETED via some out-of-band path while the booking row stayed
 * PENDING).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireMobileAdmin(request, "MANAGE_BOOKINGS");
  if ("error" in gate) return gate.error;

  const { id } = await params;
  const result = await confirmBookingManually(id);
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
