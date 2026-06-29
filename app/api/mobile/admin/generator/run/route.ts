import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireMobileAdmin } from "@/lib/mobile-admin-guard";

/**
 * POST /api/mobile/admin/generator/run
 *
 * Start/stop the live generator run timer. Mirrors startRunLog /
 * stopRunLog in actions/generator.ts (open an entry with no endTime,
 * then close it computing durationHours). Manual fixed-duration entries
 * still go through the base route's "run" log type. Gated by
 * MANAGE_PRICING (web sidebar rule for /admin/generator).
 */
const runSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), generatorId: z.string().min(1) }),
  z.object({ action: z.literal("stop"), runLogId: z.string().min(1) }),
]);

async function getNextEntryId(generatorId: string): Promise<number> {
  const last = await db.generatorRunLog.findFirst({
    where: { generatorId },
    orderBy: { entryId: "desc" },
    select: { entryId: true },
  });
  return (last?.entryId || 0) + 1;
}

export async function POST(request: NextRequest) {
  const g = await requireMobileAdmin(request, "MANAGE_PRICING");
  if ("error" in g) return g.error;

  const parsed = runSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid data" },
      { status: 400 },
    );
  }
  const d = parsed.data;

  try {
    if (d.action === "start") {
      const generator = await db.generator.findUnique({
        where: { id: d.generatorId },
      });
      if (!generator || !generator.isActive) {
        return NextResponse.json(
          { error: "Generator not found" },
          { status: 404 },
        );
      }
      // Guard against double-start (mirrors pinStartRunLog).
      const existing = await db.generatorRunLog.findFirst({
        where: { generatorId: d.generatorId, endTime: null },
      });
      if (existing) {
        return NextResponse.json(
          { error: "Generator is already running" },
          { status: 409 },
        );
      }
      const entryId = await getNextEntryId(d.generatorId);
      const log = await db.generatorRunLog.create({
        data: {
          generatorId: d.generatorId,
          entryId,
          source: "website",
          startTime: new Date(),
        },
      });
      return NextResponse.json({ ok: true, id: log.id });
    }

    // stop
    const log = await db.generatorRunLog.findUnique({
      where: { id: d.runLogId },
    });
    if (!log) {
      return NextResponse.json({ error: "Run log not found" }, { status: 404 });
    }
    if (log.endTime) {
      return NextResponse.json(
        { error: "Run log already stopped" },
        { status: 409 },
      );
    }
    const endTime = new Date();
    const durationHours =
      (endTime.getTime() - log.startTime.getTime()) / (1000 * 60 * 60);
    await db.generatorRunLog.update({
      where: { id: d.runLogId },
      data: { endTime, durationHours: Math.round(durationHours * 100) / 100 },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("generator run timer error:", e);
    return NextResponse.json(
      { error: "Failed to update run timer" },
      { status: 500 },
    );
  }
}
