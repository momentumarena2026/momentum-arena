import { NextRequest, NextResponse } from "next/server";
import { requireMobileAdmin } from "@/lib/mobile-admin-guard";
import { markBookingAbsent } from "@/actions/admin-booking";

/**
 * POST /api/mobile/admin/bookings/[id]/mark-absent
 * body: (none)
 *
 * Closes a CONFIRMED booking out as ABSENT — customer no-show,
 * advance retained as earnings, remainder forfeit. Mirror of the
 * web Admin Actions "Mark Absent" button.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireMobileAdmin(request, "MANAGE_BOOKINGS");
  if ("error" in gate) return gate.error;
  const { id } = await params;
  const result = await markBookingAbsent(id);
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
