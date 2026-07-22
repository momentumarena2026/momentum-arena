import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireMobileAdmin } from "@/lib/mobile-admin-guard";

/**
 * Mobile admin generator tracking. Mirrors the read + log + CRUD flows
 * from actions/generator.ts (getGenerators, getGeneratorDashboard,
 * addFuelLog, addOilChange, addManualRunLog, createGenerator,
 * deleteGenerator) with bearer auth + the MANAGE_PRICING permission
 * (SUPERADMIN bypass — matches the web sidebar gating for
 * /admin/generator: layout.tsx → permission: "MANAGE_PRICING").
 *
 * The web server actions call `requireAdmin()` with no permission arg, so
 * reusing them would drop the MANAGE_PRICING check — this route
 * re-implements the same DB logic and enforces MANAGE_PRICING itself via
 * requireMobileAdmin.
 *
 * Money is stored in PAISE. Per-litre prices are accepted in RUPEES
 * over the wire and converted to paise here (matching the web form
 * which does `Math.round(rupees * 100)`).
 */

/**
 * Oil-change schedule (mirror of getNextOilChangeHours in
 * actions/generator.ts):
 *  - 1st at firstOilChangeHours
 *  - 2nd at first + secondOilChangeHours
 *  - 3rd+ at first + second + (n-1)*regular
 */
function getNextOilChangeHours(
  totalOilChanges: number,
  config: {
    firstOilChangeHours: number;
    secondOilChangeHours: number;
    regularOilChangeHours: number;
  },
): number {
  if (totalOilChanges === 0) return config.firstOilChangeHours;
  if (totalOilChanges === 1)
    return config.firstOilChangeHours + config.secondOilChangeHours;
  return (
    config.firstOilChangeHours +
    config.secondOilChangeHours +
    (totalOilChanges - 1) * config.regularOilChangeHours
  );
}

async function getOrCreateConfig() {
  let config = await db.generatorConfig.findFirst();
  if (!config) config = await db.generatorConfig.create({ data: {} });
  return config;
}

async function buildDashboard(generatorId: string) {
  const generator = await db.generator.findUnique({ where: { id: generatorId } });
  if (!generator) return null;

  const config = await getOrCreateConfig();

  const allFuelLogs = await db.generatorFuelLog.findMany({ where: { generatorId } });
  const totalFuelFilled = allFuelLogs.reduce((s, l) => s + l.litres, 0);

  const completedRunLogs = await db.generatorRunLog.findMany({
    where: { generatorId, endTime: { not: null } },
    select: { durationHours: true },
  });
  const totalRunningHours = completedRunLogs.reduce(
    (s, r) => s + Math.max(0, r.durationHours || 0),
    0,
  );

  const oilChanges = await db.generatorOilChange.findMany({
    where: { generatorId },
    orderBy: { date: "desc" },
  });
  const totalOilChanges = oilChanges.length;
  const nextOilChangeAt = getNextOilChangeHours(totalOilChanges, config);
  const hoursUntilOilChange = Math.max(0, nextOilChangeAt - totalRunningHours);

  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
  const monthEnd = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 1));

  const monthlyFuelCost = allFuelLogs
    .filter((l) => l.date >= monthStart && l.date < monthEnd)
    .reduce((s, l) => s + l.totalCost, 0);
  const monthlyOilCost = oilChanges
    .filter((o) => o.date >= monthStart && o.date < monthEnd)
    .reduce((s, o) => s + o.totalCost, 0);

  const recentFuelLogs = await db.generatorFuelLog.findMany({
    where: { generatorId },
    orderBy: { date: "desc" },
    take: 5,
  });
  const recentOilChanges = oilChanges.slice(0, 5);

  const activeRunLog = await db.generatorRunLog.findFirst({
    where: { generatorId, endTime: null },
    orderBy: { startTime: "desc" },
    select: { id: true, startTime: true },
  });

  return {
    generator: { id: generator.id, name: generator.name },
    totalRunningHours: Math.round(totalRunningHours * 100) / 100,
    totalFuelFilled: Math.round(totalFuelFilled * 100) / 100,
    nextOilChangeAt,
    hoursUntilOilChange: Math.round(hoursUntilOilChange * 100) / 100,
    totalOilChanges,
    monthlyFuelCost,
    monthlyOilCost,
    monthlyCost: monthlyFuelCost + monthlyOilCost,
    recentFuelLogs,
    recentOilChanges,
    activeRunLog,
  };
}

export async function GET(request: NextRequest) {
  const g = await requireMobileAdmin(request, "MANAGE_PRICING");
  if ("error" in g) return g.error;

  const generators = await db.generator.findMany({
    where: { isActive: true },
    orderBy: { createdAt: "asc" },
  });

  const dashboards = (
    await Promise.all(generators.map((g) => buildDashboard(g.id)))
  ).filter((d): d is NonNullable<typeof d> => d !== null);

  return NextResponse.json({ generators: dashboards });
}

const baseLog = z.object({
  generatorId: z.string().min(1),
  date: z.string().min(1),
  notes: z.string().optional(),
});

const logSchema = z.discriminatedUnion("type", [
  baseLog.extend({
    type: z.literal("fuel"),
    litres: z.number().positive(),
    // rupees over the wire
    pricePerLitre: z.number().positive(),
    isStockPurchase: z.boolean().default(false),
  }),
  baseLog.extend({
    type: z.literal("oil"),
    litres: z.number().positive(),
    // rupees over the wire
    costPerLitre: z.number().positive(),
  }),
  baseLog.extend({
    type: z.literal("run"),
    durationHours: z.number().positive(),
  }),
]);

export async function POST(request: NextRequest) {
  const g = await requireMobileAdmin(request, "MANAGE_PRICING");
  if ("error" in g) return g.error;

  const parsed = logSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid data" },
      { status: 400 },
    );
  }
  const d = parsed.data;

  const generator = await db.generator.findUnique({
    where: { id: d.generatorId },
  });
  if (!generator || !generator.isActive) {
    return NextResponse.json({ error: "Generator not found" }, { status: 404 });
  }

  try {
    if (d.type === "fuel") {
      const pricePaise = Math.round(d.pricePerLitre * 100);
      await db.generatorFuelLog.create({
        data: {
          generatorId: d.generatorId,
          date: new Date(d.date),
          litres: d.litres,
          pricePerLitre: pricePaise,
          totalCost: Math.round(d.litres * pricePaise),
          isStockPurchase: d.isStockPurchase,
          notes: d.notes || null,
        },
      });
    } else if (d.type === "oil") {
      const costPaise = Math.round(d.costPerLitre * 100);
      const existingCount = await db.generatorOilChange.count({
        where: { generatorId: d.generatorId },
      });
      const completedRuns = await db.generatorRunLog.findMany({
        where: { generatorId: d.generatorId, endTime: { not: null } },
        select: { durationHours: true },
      });
      const runningHours = completedRuns.reduce(
        (s, r) => s + (r.durationHours || 0),
        0,
      );
      await db.generatorOilChange.create({
        data: {
          generatorId: d.generatorId,
          date: new Date(d.date),
          runningHoursAtChange: Math.round(runningHours * 100) / 100,
          litres: d.litres,
          costPerLitre: costPaise,
          totalCost: Math.round(d.litres * costPaise),
          notes: d.notes || null,
          sequenceNumber: existingCount + 1,
        },
      });
    } else {
      // run — manual running-hours entry
      const startTime = new Date(d.date);
      const durationHours = Math.round(d.durationHours * 100) / 100;
      const endTime = new Date(startTime.getTime() + durationHours * 3600 * 1000);
      const last = await db.generatorRunLog.findFirst({
        where: { generatorId: d.generatorId },
        orderBy: { entryId: "desc" },
        select: { entryId: true },
      });
      await db.generatorRunLog.create({
        data: {
          generatorId: d.generatorId,
          entryId: (last?.entryId || 0) + 1,
          source: "website",
          startTime,
          endTime,
          durationHours,
          notes: d.notes || null,
        },
      });
    }
  } catch (e) {
    console.error("generator log error:", e);
    return NextResponse.json({ error: "Failed to log entry" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

// ─── Create generator (mirror createGenerator) ───────────────
const createSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
});

export async function PUT(request: NextRequest) {
  const g = await requireMobileAdmin(request, "MANAGE_PRICING");
  if ("error" in g) return g.error;

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid data" },
      { status: 400 },
    );
  }
  const id = parsed.data.id.trim();
  const name = parsed.data.name.trim();

  // Same validation as actions/generator.ts createGenerator
  if (id.length < 2) {
    return NextResponse.json(
      { error: "Generator ID must be at least 2 characters" },
      { status: 400 },
    );
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    return NextResponse.json(
      {
        error:
          "Generator ID can only contain letters, numbers, hyphens and underscores",
      },
      { status: 400 },
    );
  }

  try {
    const existing = await db.generator.findUnique({ where: { id } });
    if (existing) {
      return NextResponse.json(
        { error: "A generator with this ID already exists" },
        { status: 409 },
      );
    }
    const gen = await db.generator.create({ data: { id, name } });
    return NextResponse.json({ ok: true, id: gen.id });
  } catch (e) {
    console.error("createGenerator error:", e);
    return NextResponse.json(
      { error: "Failed to create generator" },
      { status: 500 },
    );
  }
}
