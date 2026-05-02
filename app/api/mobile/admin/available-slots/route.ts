import { NextRequest, NextResponse } from "next/server";
import { getMobileAdmin } from "@/lib/mobile-auth";
import { getAvailableSlots } from "@/actions/admin-booking";

/**
 * GET /api/mobile/admin/available-slots?courtConfigId=&date=YYYY-MM-DD
 *
 * Same shape as /api/mobile/admin/bookings/[id]/available-slots, but
 * without an existing booking to exclude — used by the create-booking
 * form's slot picker before a booking exists.
 */
export async function GET(request: NextRequest) {
  const admin = await getMobileAdmin(request);
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const courtConfigId = searchParams.get("courtConfigId");
  const date = searchParams.get("date");

  if (!courtConfigId || !date) {
    return NextResponse.json(
      { error: "courtConfigId and date are required" },
      { status: 400 },
    );
  }

  const result = await getAvailableSlots(courtConfigId, date, undefined, true);
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  const slots = result.slots.map((s) => ({
    hour: s.hour,
    price: s.price,
    isBooked: !s.available && !s.blocked,
    isBlocked: s.blocked,
  }));
  return NextResponse.json({ slots });
}
