import { NextRequest, NextResponse } from "next/server";
import { requireMobileAdmin } from "@/lib/mobile-admin-guard";
import { markBookingCompleted } from "@/actions/admin-booking";

/**
 * POST /api/mobile/admin/bookings/[id]/mark-completed
 * body: (none)
 *
 * Closes a CONFIRMED booking out as COMPLETED — customer attended,
 * advance retained as earnings, remainder forfeit. Mirror of the
 * web Admin Actions "Mark Completed" button.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireMobileAdmin(request, "MANAGE_BOOKINGS");
  if ("error" in gate) return gate.error;
  const admin = gate.admin;
  const { id } = await params;
  const result = await markBookingCompleted(id, {
    id: admin.id,
    username: admin.username,
  });
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
