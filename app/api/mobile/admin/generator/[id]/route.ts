import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireMobileAdmin } from "@/lib/mobile-admin-guard";

/**
 * DELETE /api/mobile/admin/generator/[id]
 *
 * Soft-deletes a generator (isActive = false) — mirrors deleteGenerator
 * in actions/generator.ts, which hides it from the list rather than
 * destroying its logs. Gated by MANAGE_PRICING (web sidebar rule).
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const g = await requireMobileAdmin(request, "MANAGE_PRICING");
  if ("error" in g) return g.error;

  const { id } = await params;

  try {
    await db.generator.update({
      where: { id },
      data: { isActive: false },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("deleteGenerator error:", e);
    return NextResponse.json(
      { error: "Failed to delete generator" },
      { status: 500 },
    );
  }
}
