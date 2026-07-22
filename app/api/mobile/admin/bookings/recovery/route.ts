import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getMobileAdmin } from "@/lib/mobile-auth";
import { hasPermission } from "@/lib/permissions";
import { recoverRazorpayPayment } from "@/actions/admin-booking";

/**
 * Mobile admin Razorpay payment recovery. Mirrors web
 * /admin/bookings/recovery (actions/admin-booking.ts
 * recoverRazorpayPayment): paste a Razorpay `pay_…` id, we fetch the
 * captured payment, locate the matching SlotHold and create the
 * Booking via the same createBookingFromHold path the verify route +
 * webhook use.
 *
 * The action already returns a structured RecoverRazorpayResult
 * (success/state/bookingId/payment/error), so we authenticate, gate on
 * MANAGE_BOOKINGS, then call it and forward the result verbatim. The
 * action re-checks MANAGE_BOOKINGS itself (resolving this request's
 * Bearer JWT); the gate here is kept so an unauthorized call gets a
 * proper 401/403 JSON body instead of a thrown 500.
 */
async function guard(request: NextRequest) {
  const admin = await getMobileAdmin(request);
  if (!admin) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (
    admin.role !== "SUPERADMIN" &&
    !hasPermission(admin.permissions ?? [], "MANAGE_BOOKINGS")
  ) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { admin };
}

const bodySchema = z.object({
  paymentId: z.string().min(1),
});

export async function POST(request: NextRequest) {
  const g = await guard(request);
  if ("error" in g) return g.error;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid data" },
      { status: 400 },
    );
  }

  const result = await recoverRazorpayPayment(parsed.data.paymentId);
  return NextResponse.json(result);
}
