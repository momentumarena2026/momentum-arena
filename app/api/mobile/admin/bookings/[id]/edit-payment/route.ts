import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getMobileAdmin } from "@/lib/mobile-auth";
import { adminEditPayment } from "@/actions/admin-booking";

/**
 * POST /api/mobile/admin/bookings/[id]/edit-payment
 * body: any subset of { method, status, totalAmount, advanceAmount,
 *                       isPartialPayment, razorpayPaymentId,
 *                       utrNumber, note }
 *
 * Mirrors the web Edit Payment modal — admin patches whatever
 * payment fields need correcting on an existing booking. Field
 * semantics match adminEditPayment: undefined = leave alone, null
 * (where allowed) = clear. Status is NOT auto-derived; the admin
 * picks the new status explicitly.
 */
const Body = z.object({
  method: z.enum(["CASH", "UPI_QR", "RAZORPAY", "PHONEPE", "FREE"]).optional(),
  status: z
    .enum(["PENDING", "PARTIAL", "COMPLETED", "REFUNDED", "FAILED"])
    .optional(),
  totalAmount: z.number().int().min(0).optional(),
  advanceAmount: z.union([z.number().int().min(0), z.null()]).optional(),
  isPartialPayment: z.boolean().optional(),
  razorpayPaymentId: z.union([z.string().max(200), z.null()]).optional(),
  utrNumber: z.union([z.string().max(64), z.null()]).optional(),
  note: z.string().max(500).optional(),
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
      { error: parsed.error.issues[0]?.message || "Invalid body" },
      { status: 400 },
    );
  }

  const { id } = await params;
  const result = await adminEditPayment(id, parsed.data, {
    id: admin.id,
    username: admin.username,
  });
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
