import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getMobileAdmin } from "@/lib/mobile-auth";
import { blockSlot, getSlotBlocks } from "@/actions/admin-slots";

/**
 * GET /api/mobile/admin/slot-blocks?date=YYYY-MM-DD
 *   List all slot blocks for a given date.
 *
 * POST /api/mobile/admin/slot-blocks
 *   body: { date, courtConfigId?, sport?, startHour?, reason? }
 *   Create a new slot block. Both courtConfigId and sport are
 *   optional — omitting both creates an "all courts" block. Omitting
 *   startHour creates a full-day block. Mirrors the web modal flow.
 */

export async function GET(request: NextRequest) {
  const admin = await getMobileAdmin(request);
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const date = new URL(request.url).searchParams.get("date");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json(
      { error: "date (YYYY-MM-DD) required" },
      { status: 400 },
    );
  }

  const blocks = await getSlotBlocks(date, true);

  // Trim to a mobile-friendly shape — drop nested timestamps the
  // floor-staff don't need, and surface the courtConfig label inline
  // because the RN list is flat.
  const enriched = blocks.map((b) => ({
    id: b.id,
    date: b.date.toISOString(),
    startHour: b.startHour,
    sport: b.sport,
    courtConfig: b.courtConfig
      ? {
          id: b.courtConfig.id,
          sport: b.courtConfig.sport,
          label: b.courtConfig.label,
          size: b.courtConfig.size,
        }
      : null,
    reason: b.reason,
    createdAt: b.createdAt.toISOString(),
  }));

  return NextResponse.json({ blocks: enriched });
}

const Body = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  courtConfigId: z.string().optional(),
  sport: z.enum(["CRICKET", "FOOTBALL", "PICKLEBALL"]).optional(),
  startHour: z.number().int().min(5).max(24).optional(),
  reason: z.string().max(500).optional(),
});

export async function POST(request: NextRequest) {
  const admin = await getMobileAdmin(request);
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid block data" },
      { status: 400 },
    );
  }

  const result = await blockSlot(parsed.data, admin.id);
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
