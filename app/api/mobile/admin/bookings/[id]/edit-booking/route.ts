import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireMobileAdmin } from "@/lib/mobile-admin-guard";
import { adminEditBookingFull } from "@/actions/admin-booking";

/**
 * POST /api/mobile/admin/bookings/[id]/edit-booking
 * body: { newDate?, newCourtConfigId?, newHours?[], newAdvanceAmount?, newAdvanceMethod? }
 *
 * Full edit — court / date / slots / advance. The action re-validates
 * the new combination (zone overlap, slot blocks, pricing) and either
 * leaves Payment.amount alone (gateway-paid customer bookings) or
 * adjusts it (admin-created cash bookings). Refund-due / collect-extra
 * delta is then surfaced on the detail screen.
 */
const Body = z.object({
  newDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  newCourtConfigId: z.string().min(1).optional(),
  newHours: z.array(z.number().int().min(0).max(24)).min(1).optional(),
  newAdvanceAmount: z.number().int().min(0).optional(),
  newAdvanceMethod: z.enum(["CASH", "UPI_QR"]).optional(),
  // Cover ADDED minutes from the customer's eligible pass.
  coverDeltaWithPass: z.boolean().optional(),
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
    return NextResponse.json({ error: "Invalid edit payload" }, { status: 400 });
  }

  const { id } = await params;
  const result = await adminEditBookingFull(id, parsed.data, {
    id: admin.id,
    username: admin.username,
  });
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
