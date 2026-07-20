import { NextRequest, NextResponse } from "next/server";
import { requireMobileAdmin } from "@/lib/mobile-admin-guard";
import { toggleCafeItemAvailability } from "@/actions/admin-cafe";

/**
 * POST /api/mobile/admin/cafe/items/[id]/availability
 *
 * Toggles the menu item's `isAvailable` flag — same action the web
 * /admin/cafe page wires to the per-row eye/eye-off button. Returns
 * the new flag value so the optimistic UI can sync without re-fetching
 * the entire menu list.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireMobileAdmin(request, "MANAGE_CAFE_MENU");
  if ("error" in gate) return gate.error;

  const { id } = await params;
  const result = await toggleCafeItemAvailability(id);
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true, isAvailable: result.isAvailable });
}
