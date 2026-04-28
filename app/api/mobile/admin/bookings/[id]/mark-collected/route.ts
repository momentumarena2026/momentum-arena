import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getMobileAdmin } from "@/lib/mobile-auth";
import { markRemainderCollected } from "@/actions/admin-booking";

/**
 * POST /api/mobile/admin/bookings/[id]/mark-collected
 * body: { cashAmount: number, upiAmount: number }
 *
 * Mark the venue-side remainder of a partial-payment booking as
 * collected. Either cashAmount or upiAmount can be 0 (single-method
 * collection) but the sum must equal the remaining amount owed —
 * `markRemainderCollected` validates that, so we just pass through.
 */
const Body = z.object({
  cashAmount: z.number().int().nonnegative(),
  upiAmount: z.number().int().nonnegative(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await getMobileAdmin(request);
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "cashAmount and upiAmount are required non-negative integers" },
      { status: 400 },
    );
  }

  const { id } = await params;
  const result = await markRemainderCollected(
    id,
    { cashAmount: parsed.data.cashAmount, upiAmount: parsed.data.upiAmount },
    admin.id,
  );
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
