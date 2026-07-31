import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireMobileAdmin } from "@/lib/mobile-admin-guard";
import { convertBookingToPass } from "@/actions/admin-booking";

const Body = z.object({ note: z.string().max(500).optional() });

/**
 * POST /api/mobile/admin/bookings/[id]/convert-to-pass — move a
 * money-paid booking onto the customer's pass(es). Thin wrapper over
 * the web action (which resolves the mobile admin via headers), same
 * pattern as ./edit-payment.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireMobileAdmin(request, "MANAGE_BOOKINGS");
  if ("error" in gate) return gate.error;

  const { id } = await params;
  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const result = await convertBookingToPass(id, parsed.data.note);
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true, ...result });
}
