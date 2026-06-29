import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireMobileAdmin } from "@/lib/mobile-admin-guard";

/**
 * GET /api/mobile/admin/generator/analytics?generatorId=&from=&to=
 *
 * Cost/usage analytics for a generator over a date range. Mirrors
 * getGeneratorAnalytics in actions/generator.ts: totals (hours, fuel
 * cost, oil cost, litres), oil-change count, cost-per-booking-hour,
 * and a monthly breakdown. Money is PAISE. Gated by MANAGE_PRICING.
 */
export async function GET(request: NextRequest) {
  const g = await requireMobileAdmin(request, "MANAGE_PRICING");
  if ("error" in g) return g.error;

  const sp = new URL(request.url).searchParams;
  const generatorId = sp.get("generatorId");
  if (!generatorId) {
    return NextResponse.json(
      { error: "generatorId is required" },
      { status: 400 },
    );
  }

  const now = new Date();
  const from = sp.get("from")
    ? new Date(sp.get("from") as string)
    : new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
  const to = sp.get("to")
    ? new Date(sp.get("to") as string)
    : new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 1));

  // Fuel logs in period
  const fuelLogs = await db.generatorFuelLog.findMany({
    where: { generatorId, date: { gte: from, lt: to } },
    orderBy: { date: "asc" },
  });
  const totalFuelCost = fuelLogs.reduce((s, l) => s + l.totalCost, 0);
  const totalLitres = fuelLogs.reduce((s, l) => s + l.litres, 0);

  // Running hours from completed run logs in period
  const runLogsInPeriod = await db.generatorRunLog.findMany({
    where: {
      generatorId,
      endTime: { not: null },
      startTime: { gte: from, lt: to },
    },
    select: { durationHours: true, startTime: true },
  });
  const totalHours = runLogsInPeriod.reduce(
    (s, r) => s + Math.max(0, r.durationHours || 0),
    0,
  );

  // Oil changes in period
  const oilChanges = await db.generatorOilChange.findMany({
    where: { generatorId, date: { gte: from, lt: to } },
  });
  const totalOilCost = oilChanges.reduce((s, o) => s + o.totalCost, 0);

  // Cost per booking hour — confirmed bookings in the same period
  let costPerBookingHour = 0;
  try {
    const bookings = await db.booking.findMany({
      where: { status: "CONFIRMED", date: { gte: from, lt: to } },
      include: { slots: true },
    });
    const totalBookingHours = bookings.reduce(
      (s, b) => s + b.slots.length,
      0,
    );
    const totalCost = totalFuelCost + totalOilCost;
    if (totalBookingHours > 0) {
      costPerBookingHour = Math.round(totalCost / totalBookingHours);
    }
  } catch {
    // leave at 0 if booking query fails
  }

  // Monthly breakdown
  const monthlyMap = new Map<
    string,
    { hours: number; fuelCost: number; oilCost: number; litres: number }
  >();
  const bump = (key: string) =>
    monthlyMap.get(key) || { hours: 0, fuelCost: 0, oilCost: 0, litres: 0 };

  for (const run of runLogsInPeriod) {
    const d = new Date(run.startTime);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    const entry = bump(key);
    entry.hours += Math.max(0, run.durationHours || 0);
    monthlyMap.set(key, entry);
  }
  for (const log of fuelLogs) {
    const d = new Date(log.date);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    const entry = bump(key);
    entry.fuelCost += log.totalCost;
    entry.litres += log.litres;
    monthlyMap.set(key, entry);
  }
  for (const oc of oilChanges) {
    const d = new Date(oc.date);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    const entry = bump(key);
    entry.oilCost += oc.totalCost;
    monthlyMap.set(key, entry);
  }

  const monthlyBreakdown = Array.from(monthlyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, d]) => ({
      month,
      hours: Math.round(d.hours * 100) / 100,
      fuelCost: d.fuelCost,
      oilCost: d.oilCost,
      totalCost: d.fuelCost + d.oilCost,
      litres: Math.round(d.litres * 100) / 100,
    }));

  return NextResponse.json({
    totalHours: Math.round(totalHours * 100) / 100,
    totalFuelCost,
    totalOilCost,
    totalCost: totalFuelCost + totalOilCost,
    totalLitres: Math.round(totalLitres * 100) / 100,
    oilChangesInPeriod: oilChanges.length,
    costPerBookingHour,
    monthlyBreakdown,
  });
}
