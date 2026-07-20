import { NextRequest, NextResponse } from "next/server";
import { requireMobileAdmin } from "@/lib/mobile-admin-guard";
import { confirmUpiPayment } from "@/actions/admin-booking";

/**
 * POST /api/mobile/admin/bookings/[id]/confirm-upi
 *
 * Floor-staff verifies the UTR / WhatsApp screenshot, taps the
 * "Confirm UPI" button on mobile → flips the booking from PENDING to
 * CONFIRMED and the UPI_QR payment to PARTIAL or COMPLETED depending
 * on whether it was a partial booking. Reuses the existing web
 * action directly — its `requireAdmin()` resolves the mobile Bearer
 * JWT from this request, so the audit trail captures the mobile
 * admin id without any caller-supplied identity.
 *
 * The requireMobileAdmin gate below is kept on purpose: it turns an
 * unauthenticated/unauthorized call into a proper 401/403 JSON body,
 * where the action's own guard would throw and surface as a 500.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireMobileAdmin(request, "MANAGE_BOOKINGS");
  if ("error" in gate) return gate.error;

  const { id } = await params;
  const result = await confirmUpiPayment(id);
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
