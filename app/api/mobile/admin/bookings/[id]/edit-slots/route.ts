import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireMobileAdmin } from "@/lib/mobile-admin-guard";
import { adminEditBookingSlots } from "@/actions/admin-booking";

/**
 * POST /api/mobile/admin/bookings/[id]/edit-slots
 * body: { hours: number[], date?: "YYYY-MM-DD" }
 *
 * Replaces the slot range and (optionally) the date for the booking.
 * Re-validates availability + slot blocks against the target date.
 */
const Body = z.object({
  hours: z.array(z.number().int().min(0).max(24)).min(1),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireMobileAdmin(request, "MANAGE_BOOKINGS");
  if ("error" in gate) return gate.error;
  const admin = gate.admin;

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Provide at least one hour; date must be YYYY-MM-DD" },
      { status: 400 },
    );
  }

  const { id } = await params;
  const result = await adminEditBookingSlots(
    id,
    parsed.data.hours,
    parsed.data.date,
    { id: admin.id, username: admin.username },
  );
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
