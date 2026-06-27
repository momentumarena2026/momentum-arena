import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getMobileAdmin } from "@/lib/mobile-auth";
import { hasPermission } from "@/lib/permissions";
import {
  getPendingUtrPayments,
  verifyBookingUtr,
  verifyCafeUtr,
  rejectUtr,
} from "@/actions/upi-payment";

/**
 * Mobile admin UPI UTR verification. Mirrors web /admin/utr-verify
 * (actions/upi-payment.ts getPendingUtrPayments + verify/reject):
 *   GET  → pending UPI_QR booking + cafe payments awaiting an admin to
 *          eyeball the UTR against the bank, plus today's verified /
 *          rejected counts.
 *   POST → { paymentId, action: "verify" | "reject", type?, reason? }.
 *          Verify flips the payment COMPLETED + booking/order forward;
 *          reject flips it FAILED + cancels.
 *
 * Amounts from the action are already in the model's native unit
 * (Payment.amount = rupees). Gated on MANAGE_BOOKINGS.
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

export async function GET(request: NextRequest) {
  const g = await guard(request);
  if ("error" in g) return g.error;

  const data = await getPendingUtrPayments(true);
  return NextResponse.json(data);
}

const bodySchema = z.object({
  paymentId: z.string().min(1),
  action: z.enum(["verify", "reject"]),
  type: z.enum(["booking", "cafe"]).default("booking"),
  reason: z.string().optional(),
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
  const { paymentId, action, type, reason } = parsed.data;

  let result: { success: boolean; error?: string };
  if (action === "verify") {
    result =
      type === "cafe"
        ? await verifyCafeUtr(paymentId, g.admin.id, true)
        : await verifyBookingUtr(paymentId, g.admin.id, true);
  } else {
    result = await rejectUtr(
      paymentId,
      g.admin.id,
      reason ?? "Rejected by admin",
      type,
      true,
    );
  }

  if (!result.success) {
    return NextResponse.json(
      { error: result.error ?? "Action failed" },
      { status: 400 },
    );
  }
  return NextResponse.json({ ok: true });
}
