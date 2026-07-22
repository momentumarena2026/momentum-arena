import { NextRequest, NextResponse } from "next/server";
import { requireMobileAdmin } from "@/lib/mobile-admin-guard";
import { unblockSlot } from "@/actions/admin-slots";

/**
 * DELETE /api/mobile/admin/slot-blocks/[id]
 *
 * Removes a slot block. The web admin uses POST + a soft confirm; we
 * keep DELETE here because the RN client can express "intent to
 * remove" cleanly without an extra wrapper, and the action itself
 * does the right thing regardless of HTTP verb.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireMobileAdmin(request, "MANAGE_SLOTS");
  if ("error" in gate) return gate.error;

  const { id } = await params;
  const result = await unblockSlot(id);
  if (!result.success) {
    return NextResponse.json(
      { error: "Failed to remove block" },
      { status: 400 },
    );
  }
  return NextResponse.json({ ok: true });
}
