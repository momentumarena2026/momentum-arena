import { NextRequest, NextResponse } from "next/server";
import { getMobileAdmin } from "@/lib/mobile-auth";
import { getAvailableSlots } from "@/actions/admin-booking";

/**
 * GET /api/mobile/admin/bookings/[id]/available-slots?courtConfigId=&date=YYYY-MM-DD
 *
 * Powers the slot picker in the Edit Slots / Edit Booking forms —
 * returns each operating-hour slot with whether it's already booked
 * (excluding the booking being edited), blocked by a SlotBlock, and
 * the per-slot price for the target court+date.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await getMobileAdmin(request);
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: bookingId } = await params;
  const { searchParams } = new URL(request.url);
  const courtConfigId = searchParams.get("courtConfigId");
  const date = searchParams.get("date");

  if (!courtConfigId || !date) {
    return NextResponse.json(
      { error: "courtConfigId and date are required" },
      { status: 400 },
    );
  }

  const result = await getAvailableSlots(courtConfigId, date, bookingId, true);
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  // Normalize field names. Server returns `available` (free to book)
  // and `blocked` (admin-imposed); client wants the inverse + the
  // semantically clearer `isBooked` / `isBlocked` so the picker can
  // disable a tile and show a reason chip without inverting the
  // boolean at every callsite.
  const slots = result.slots.map((s) => ({
    hour: s.hour,
    price: s.price,
    isBooked: !s.available && !s.blocked,
    isBlocked: s.blocked,
  }));
  return NextResponse.json({ slots });
}
