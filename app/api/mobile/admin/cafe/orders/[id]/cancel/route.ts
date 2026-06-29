import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireMobileAdmin } from "@/lib/mobile-admin-guard";
import { cancelCafeOrder } from "@/actions/admin-cafe-orders";

/**
 * POST /api/mobile/admin/cafe/orders/[id]/cancel
 * body: { reason: string }
 *
 * Cancels a non-completed cafe order. The action also flips an
 * attached payment to REFUNDED — same behaviour as the web admin
 * cancel button — so the floor staffer doesn't have to fire a second
 * action for the refund side.
 */
const Body = z.object({ reason: z.string().min(1).max(500) });

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireMobileAdmin(request, "MANAGE_CAFE_ORDERS");
  if ("error" in gate) return gate.error;
  const admin = gate.admin;

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Cancellation reason is required" },
      { status: 400 },
    );
  }

  const { id } = await params;
  const result = await cancelCafeOrder(id, parsed.data.reason, {
    id: admin.id,
    username: admin.username,
  });
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
