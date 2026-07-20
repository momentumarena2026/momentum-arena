import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireMobileAdmin } from "@/lib/mobile-admin-guard";
import { updateCafeOrderStatus } from "@/actions/admin-cafe-orders";

/**
 * POST /api/mobile/admin/cafe/orders/[id]/status
 * body: { newStatus: "PREPARING" | "READY" | "COMPLETED" | "CANCELLED" }
 *
 * Pushes a cafe order one step along the kanban. The action enforces
 * the allowed transitions table (PENDING→PREPARING|CANCELLED, etc),
 * so the route just forwards the input and lets the action's error
 * map back to a 400 with a friendly message.
 */
const Body = z.object({
  newStatus: z.enum([
    "PENDING",
    "PREPARING",
    "READY",
    "COMPLETED",
    "CANCELLED",
  ]),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireMobileAdmin(request, "MANAGE_CAFE_ORDERS");
  if ("error" in gate) return gate.error;

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  const { id } = await params;
  const result = await updateCafeOrderStatus(id, parsed.data.newStatus);
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
