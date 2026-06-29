import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireMobileAdmin } from "@/lib/mobile-admin-guard";

/**
 * GET /api/mobile/admin/generator/history?type=fuel|oil|run&generatorId=&month=
 *
 * Full history for a generator. Mirrors getFuelLogs (month-filterable),
 * getOilChanges, and getRunLogs in actions/generator.ts. Run logs are
 * capped at the most recent 50 and the web filters out the internal
 * "oil_change_alert_" marker rows — we replicate that here.
 * Gated by MANAGE_PRICING (web sidebar rule for /admin/generator).
 */
export async function GET(request: NextRequest) {
  const g = await requireMobileAdmin(request, "MANAGE_PRICING");
  if ("error" in g) return g.error;

  const sp = new URL(request.url).searchParams;
  const type = sp.get("type");
  const generatorId = sp.get("generatorId");

  if (!generatorId) {
    return NextResponse.json(
      { error: "generatorId is required" },
      { status: 400 },
    );
  }

  if (type === "fuel") {
    const month = sp.get("month") || undefined;
    const where: { generatorId: string; date?: { gte: Date; lt: Date } } = {
      generatorId,
    };
    if (month) {
      const [y, m] = month.split("-").map(Number);
      where.date = {
        gte: new Date(Date.UTC(y, m - 1, 1)),
        lt: new Date(Date.UTC(y, m, 1)),
      };
    }
    const logs = await db.generatorFuelLog.findMany({
      where,
      orderBy: { date: "desc" },
    });
    return NextResponse.json({ logs });
  }

  if (type === "oil") {
    const changes = await db.generatorOilChange.findMany({
      where: { generatorId },
      orderBy: { date: "desc" },
    });
    return NextResponse.json({ changes });
  }

  if (type === "run") {
    const all = await db.generatorRunLog.findMany({
      where: { generatorId },
      orderBy: { startTime: "desc" },
      take: 50,
    });
    // Hide internal oil-change alert markers (matches web RunLogTab).
    const logs = all.filter((r) => !r.notes?.startsWith("oil_change_alert_"));
    return NextResponse.json({ logs });
  }

  return NextResponse.json(
    { error: "type must be one of fuel | oil | run" },
    { status: 400 },
  );
}
