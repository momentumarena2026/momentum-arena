import { NextRequest, NextResponse } from "next/server";
import { getMobileAdmin } from "@/lib/mobile-auth";
import { confirmUpiPayment } from "@/actions/admin-booking";

/**
 * POST /api/mobile/admin/bookings/[id]/confirm-upi
 *
 * Floor-staff verifies the UTR / WhatsApp screenshot, taps the
 * "Confirm UPI" button on mobile → flips the booking from PENDING to
 * CONFIRMED and the UPI_QR payment to PARTIAL or COMPLETED depending
 * on whether it was a partial booking. Reuses the existing web
 * action by passing `adminIdOverride` so the audit trail captures
 * the mobile admin id.
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
  const result = await confirmUpiPayment(id, admin.id);
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
