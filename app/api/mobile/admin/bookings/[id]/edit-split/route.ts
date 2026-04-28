import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getMobileAdmin } from "@/lib/mobile-auth";
import { updateRemainderSplit } from "@/actions/admin-booking";

/**
 * POST /api/mobile/admin/bookings/[id]/edit-split
 * body: { cashAmount, upiAmount, discountAmount? }
 *
 * Adjusts how the venue-side remainder of an already-collected
 * partial-payment booking was split between cash, UPI QR, and an
 * optional goodwill discount. Sum must equal the venue-side total;
 * `updateRemainderSplit` validates and adjusts Payment.amount when
 * the discount slice changes (since the discount portion does not
 * count as collected).
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
  const result = await updateRemainderSplit(
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
