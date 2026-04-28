import { NextRequest, NextResponse } from "next/server";
import { getMobileAdmin } from "@/lib/mobile-auth";
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
  const admin = await getMobileAdmin(request);
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const result = await unblockSlot(id, true);
  if (!result.success) {
    return NextResponse.json(
      { error: "Failed to remove block" },
      { status: 400 },
    );
  }
  return NextResponse.json({ ok: true });
}
