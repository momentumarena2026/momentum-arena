import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireMobileAdmin } from "@/lib/mobile-admin-guard";
import { adminEditBookingSlots } from "@/actions/admin-booking";

/**
 * POST /api/mobile/admin/bookings/[id]/edit-slots
 * body: { hours: number[], bowlingSlots?: {hour,minute}[], date?: "YYYY-MM-DD" }
 *
 * Replaces the slot range and (optionally) the date for the booking.
 * Re-validates availability + slot blocks against the target date.
 */
const Body = z
  .object({
    hours: z.array(z.number().int().min(0).max(24)).default([]),
    // Bowling-machine 30-min picks. Mutually exclusive with hours[] —
    // the action rejects whichever doesn't match the court's slot
    // duration, so a 30-min court needs this shape to be editable.
    bowlingSlots: z
      .array(
        z.object({
          hour: z.number().int().min(0).max(23),
          minute: z.union([z.literal(0), z.literal(30)]),
        }),
      )
      .optional(),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    // Cover ADDED minutes from the customer's eligible pass.
    coverDeltaWithPass: z.boolean().optional(),
  })
  .refine(
    (b) => b.hours.length > 0 || (b.bowlingSlots?.length ?? 0) > 0,
    "At least one slot is required",
  );

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireMobileAdmin(request, "MANAGE_BOOKINGS");
  if ("error" in gate) return gate.error;

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Provide at least one slot; date must be YYYY-MM-DD" },
      { status: 400 },
    );
  }

  const { id } = await params;
  const result = await adminEditBookingSlots(
    id,
    parsed.data.hours,
    parsed.data.date,
    parsed.data.bowlingSlots,
    parsed.data.coverDeltaWithPass,
  );
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
