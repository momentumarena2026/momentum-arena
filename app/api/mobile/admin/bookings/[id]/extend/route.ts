import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireMobileAdmin } from "@/lib/mobile-admin-guard";
import {
  extendBookingByThirtyMin,
  suggestExtendPrice,
} from "@/actions/admin-booking";

/**
 * GET  /api/mobile/admin/bookings/[id]/extend?direction=before|after
 *   → { suggestedPrice: number }   default for the price input
 *
 * POST /api/mobile/admin/bookings/[id]/extend
 *   body: { direction: "before" | "after", price: number }
 *   → { ok: true, newSlot: { startHour, startMinute, durationMinutes: 30, price, label } }
 *
 * Adds a 30-min BookingSlot adjacent to the booking's earliest
 * (direction "before") or latest (direction "after") slot. Hard-
 * blocks on zone+time conflict with another active booking.
 *
 * Mirror of the web Extend Booking control on
 * /admin/bookings/[id] — same server action, same conflict rules,
 * same history-log writes.
 */
const DirectionSchema = z.enum(["before", "after"]);

const Body = z.object({
  direction: DirectionSchema,
  price: z.number().int().min(0),
  // Debit the 30 min from this pass instead of charging (validated
  // server-side: owner/member, court group, validity, balance).
  payWithPassId: z.string().min(1).optional(),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireMobileAdmin(request, "MANAGE_BOOKINGS");
  if ("error" in gate) return gate.error;

  const direction = DirectionSchema.safeParse(
    request.nextUrl.searchParams.get("direction"),
  );
  if (!direction.success) {
    return NextResponse.json(
      { error: "direction must be 'before' or 'after'" },
      { status: 400 },
    );
  }

  const { id } = await params;
  const suggestedPrice = await suggestExtendPrice(id, direction.data);
  return NextResponse.json({ suggestedPrice });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireMobileAdmin(request, "MANAGE_BOOKINGS");
  if ("error" in gate) return gate.error;

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "direction must be 'before'|'after'; price must be a non-negative integer" },
      { status: 400 },
    );
  }

  const { id } = await params;
  const result = await extendBookingByThirtyMin(
    id,
    parsed.data.direction,
    parsed.data.price,
    parsed.data.payWithPassId,
  );
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true, newSlot: result.newSlot });
}
