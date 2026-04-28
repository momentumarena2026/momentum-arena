import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getMobileAdmin } from "@/lib/mobile-auth";
import { markRemainderCollected } from "@/actions/admin-booking";

/**
 * POST /api/mobile/admin/bookings/[id]/mark-collected
 * body: { cashAmount: number, upiAmount: number, discountAmount?: number }
 *
 * Mark the venue-side remainder of a partial-payment booking as
 * collected. The split has three legs — cash, UPI QR, and an
 * optional on-the-spot discount the floor staff can apply (e.g. a
 * goodwill cut for a regular). Each leg can be 0 individually, but
 * cash + UPI + discount must equal the remainder owed AND at least
 * one of cash/UPI must be > 0 (a 100% discount at collection is a
 * refund-shaped operation, not a remainder collection).
 *
 * `markRemainderCollected` does the validation, so we just pass
 * through. `discountAmount` defaults to 0 when omitted, preserving
 * the previous body shape for older clients.
 */
const Body = z.object({
  cashAmount: z.number().int().nonnegative(),
  upiAmount: z.number().int().nonnegative(),
  discountAmount: z.number().int().nonnegative().optional(),
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
      {
        error:
          "cashAmount, upiAmount and (optional) discountAmount must be non-negative integers",
      },
      { status: 400 },
    );
  }

  const { id } = await params;
  const result = await markRemainderCollected(
    id,
    {
      cashAmount: parsed.data.cashAmount,
      upiAmount: parsed.data.upiAmount,
      discountAmount: parsed.data.discountAmount ?? 0,
    },
    admin.id,
  );
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
