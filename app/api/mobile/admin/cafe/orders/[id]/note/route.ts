import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireMobileAdmin } from "@/lib/mobile-admin-guard";
import { updateCafeOrderNote } from "@/actions/admin-cafe-orders";

/**
 * POST /api/mobile/admin/cafe/orders/[id]/note
 * body: { note: string }   — "" clears it.
 *
 * Same action the web order page calls, so the edit-history entry and
 * the length rule are shared rather than restated here. The length cap
 * is left to the action: a second copy of the number here is one that
 * can drift.
 */
const Body = z.object({ note: z.string() });

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireMobileAdmin(request, "MANAGE_CAFE_ORDERS");
  if ("error" in gate) return gate.error;

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid note" }, { status: 400 });
  }

  const { id } = await params;
  const result = await updateCafeOrderNote(id, parsed.data.note);
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true, note: result.note });
}
