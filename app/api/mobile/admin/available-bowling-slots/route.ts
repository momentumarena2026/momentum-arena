import { NextRequest, NextResponse } from "next/server";
import { requireMobileAdmin } from "@/lib/mobile-admin-guard";
import { getAvailableBowlingSlots } from "@/actions/admin-booking";

/**
 * GET /api/mobile/admin/available-bowling-slots?courtConfigId=&date=YYYY-MM-DD
 *
 * Half-hour slot availability for the mobile admin create-booking
 * form. Mirrors /api/mobile/admin/available-slots but for the
 * Bowling Machine court — runs `getAvailableBowlingSlots` with the
 * `adminOverride: true` flag (set inside the action) so all 48
 * half-hour slots are returned regardless of operating window or
 * past-time cutoff, while conflict / hold / SlotBlock checks stay
 * enforced.
 */
export async function GET(request: NextRequest) {
  const gate = await requireMobileAdmin(request, "MANAGE_BOOKINGS");
  if ("error" in gate) return gate.error;

  const { searchParams } = new URL(request.url);
  const courtConfigId = searchParams.get("courtConfigId");
  const date = searchParams.get("date");

  if (!courtConfigId || !date) {
    return NextResponse.json(
      { error: "courtConfigId and date are required" },
      { status: 400 },
    );
  }

  const result = await getAvailableBowlingSlots(courtConfigId, date);
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  const slots = result.slots.map((s) => ({
    hour: s.hour,
    minute: s.minute,
    price: s.price,
    isBooked: !s.available && !s.blocked,
    isBlocked: s.blocked,
  }));
  return NextResponse.json({ slots });
}
