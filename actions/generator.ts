"use server";

import { db } from "@/lib/db";
import { adminAuth } from "@/lib/admin-auth-session";
import { isGeneratorPinVerified } from "@/lib/generator-pin";
import { sendPinChangedEmail } from "@/lib/generator-notifications";

// ─── Helpers ─────────────────────────────────────────────────

async function requireAdmin() {
  const session = await adminAuth();
  if (!session?.user) {
    throw new Error("Unauthorized");
  }
  return session.user;
}

async function requirePin() {
  const verified = await isGeneratorPinVerified();
  if (!verified) throw new Error("PIN not verified");
}

/**
 * Calculate the total running hours at which the Nth oil change is due.
 *
 * Schedule:
 *  - 1st at firstOilChangeHours (default 20)
 *  - 2nd at first + secondOilChangeHours (default 20+50 = 70)
 *  - 3rd+ at 70 + (n-2)*regularOilChangeHours (170, 270, ...)
 */
function getNextOilChangeHours(
  totalOilChanges: number,
  config: {
    firstOilChangeHours: number;
    secondOilChangeHours: number;
    regularOilChangeHours: number;
  }
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

// ─── Config (singleton) ──────────────────────────────────────

export async function getGeneratorConfig() {
  await requireAdmin();
  let config = await db.generatorConfig.findFirst();
  if (!config) {
    config = await db.generatorConfig.create({ data: {} });
  }
  return config;
}

export async function updateGeneratorConfig(data: {
  petrolPricePerLitre?: number;
  oilPricePerLitre?: number;
  consumptionRate?: number;
  firstOilChangeHours?: number;
  secondOilChangeHours?: number;
  regularOilChangeHours?: number;
  oilChangeAlertHours?: number;
  notificationEmails?: string;
  oilChangeTemplateId?: string;
  monthlyTemplateId?: string;
  pinChangeTemplateId?: string;
  generatorPin?: string;
  hardwareApiKey?: string;
  pinChanged?: boolean;
}): Promise<{ success: boolean; error?: string }> {
  const user = await requireAdmin();
  try {
    let config = await db.generatorConfig.findFirst();
    if (!config) {
      config = await db.generatorConfig.create({ data: {} });
    }

    const { pinChanged, ...updateData } = data;

    await db.generatorConfig.update({
      where: { id: config.id },
      data: updateData,
    });

    // Send PIN change email if PIN was changed
    if (pinChanged && data.generatorPin) {
      const adminName =
        (user as unknown as { name?: string })?.name ||
        (user as unknown as { email?: string })?.email ||
        "Admin";
      sendPinChangedEmail({
        newPin: data.generatorPin,
        changedBy: adminName,
        changedAt: new Date().toLocaleString("en-IN", {
          timeZone: "Asia/Kolkata",
          dateStyle: "medium",
          timeStyle: "short",
        }),
        adminUrl: `${process.env.NEXT_PUBLIC_APP_URL || "https://momentumarena.com"}/admin/generator`,
      }).catch((err) => console.error("PIN change email error:", err));
    }

    return { success: true };
  } catch (e) {
    console.error("updateGeneratorConfig error:", e);
    return { success: false, error: "Failed to update config" };
  }
}

// ─── Generators CRUD ─────────────────────────────────────────

export async function createGenerator(
  id: string,
  name: string
): Promise<{ success: boolean; error?: string; id?: string }> {
  await requireAdmin();
  const trimmedId = id.trim();
  if (!trimmedId || trimmedId.length < 2) {
    return { success: false, error: "Generator ID must be at least 2 characters" };
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(trimmedId)) {
    return { success: false, error: "Generator ID can only contain letters, numbers, hyphens and underscores" };
  }
  try {
    const existing = await db.generator.findUnique({ where: { id: trimmedId } });
    if (existing) {
      return { success: false, error: "A generator with this ID already exists" };
    }
    const gen = await db.generator.create({ data: { id: trimmedId, name } });
    return { success: true, id: gen.id };
  } catch (e) {
    console.error("createGenerator error:", e);
    return { success: false, error: "Failed to create generator" };
  }
}

export async function deleteGenerator(
  generatorId: string
): Promise<{ success: boolean; error?: string }> {
  await requireAdmin();
  try {
    await db.generator.update({
      where: { id: generatorId },
      data: { isActive: false },
    });
    return { success: true };
  } catch (e) {
    console.error("deleteGenerator error:", e);
    return { success: false, error: "Failed to delete generator" };
  }
}

export async function getGenerators() {
  await requireAdmin();
  return db.generator.findMany({
    where: { isActive: true },
    orderBy: { createdAt: "asc" },
  });
}

// ─── Fuel Logging ────────────────────────────────────────────

export async function addFuelLog(data: {
  generatorId: string;
  date: string; // ISO string
  litres: number;
  pricePerLitre: number; // paise
  isStockPurchase: boolean;
  notes?: string;
}): Promise<{ success: boolean; error?: string }> {
  await requireAdmin();
  try {
    const totalCost = Math.round(data.litres * data.pricePerLitre);
    await db.generatorFuelLog.create({
      data: {
        generatorId: data.generatorId,
        date: new Date(data.date),
        litres: data.litres,
        pricePerLitre: data.pricePerLitre,
        totalCost,
        isStockPurchase: data.isStockPurchase,
        notes: data.notes || null,
      },
    });
    return { success: true };
  } catch (e) {
    console.error("addFuelLog error:", e);
    return { success: false, error: "Failed to add fuel log" };
  }
}

export async function getFuelLogs(generatorId: string, month?: string) {
  await requireAdmin();

  const where: { generatorId: string; date?: { gte: Date; lt: Date } } = {
    generatorId,
  };

  if (month) {
    // month format: "2026-04"
    const [y, m] = month.split("-").map(Number);
    const start = new Date(Date.UTC(y, m - 1, 1));
    const end = new Date(Date.UTC(y, m, 1));
    where.date = { gte: start, lt: end };
  }

  return db.generatorFuelLog.findMany({
    where,
    orderBy: { date: "desc" },
  });
}

// ─── Oil Changes ─────────────────────────────────────────────

export async function addOilChange(data: {
  generatorId: string;
  date: string;
  litres: number;
  costPerLitre: number; // paise
  notes?: string;
}): Promise<{ success: boolean; error?: string }> {
  await requireAdmin();
  try {
    // Count existing oil changes to determine sequence number
    const existingCount = await db.generatorOilChange.count({
      where: { generatorId: data.generatorId },
    });

    // Calculate running hours at change time
    const config = await getOrCreateConfig();
    const fuelLogs = await db.generatorFuelLog.findMany({
      where: { generatorId: data.generatorId, isStockPurchase: false },
    });
    const totalLitresFilled = fuelLogs.reduce((sum, l) => sum + l.litres, 0);
    const runningHours = totalLitresFilled / config.consumptionRate;

    const totalCost = Math.round(data.litres * data.costPerLitre);
    await db.generatorOilChange.create({
      data: {
        generatorId: data.generatorId,
        date: new Date(data.date),
        runningHoursAtChange: Math.round(runningHours * 100) / 100,
        litres: data.litres,
        costPerLitre: data.costPerLitre,
        totalCost,
        notes: data.notes || null,
        sequenceNumber: existingCount + 1,
      },
    });
    return { success: true };
  } catch (e) {
    console.error("addOilChange error:", e);
    return { success: false, error: "Failed to add oil change" };
  }
}

export async function getOilChanges(generatorId: string) {
  await requireAdmin();
  return db.generatorOilChange.findMany({
    where: { generatorId },
    orderBy: { date: "desc" },
  });
}

// ─── Run Logging ─────────────────────────────────────────────

export async function startRunLog(
  generatorId: string
): Promise<{ success: boolean; error?: string; id?: string }> {
  await requireAdmin();
  try {
    const log = await db.generatorRunLog.create({
      data: {
        generatorId,
        startTime: new Date(),
      },
    });
    return { success: true, id: log.id };
  } catch (e) {
    console.error("startRunLog error:", e);
    return { success: false, error: "Failed to start run log" };
  }
}

export async function stopRunLog(
  runLogId: string
): Promise<{ success: boolean; error?: string }> {
  await requireAdmin();
  try {
    const log = await db.generatorRunLog.findUnique({
      where: { id: runLogId },
    });
    if (!log) return { success: false, error: "Run log not found" };
    if (log.endTime) return { success: false, error: "Run log already stopped" };

    const endTime = new Date();
    const durationHours =
      (endTime.getTime() - log.startTime.getTime()) / (1000 * 60 * 60);

    await db.generatorRunLog.update({
      where: { id: runLogId },
      data: {
        endTime,
        durationHours: Math.round(durationHours * 100) / 100,
      },
    });
    return { success: true };
  } catch (e) {
    console.error("stopRunLog error:", e);
    return { success: false, error: "Failed to stop run log" };
  }
}

export async function addManualRunLog(data: {
  generatorId: string;
  startTime: string;
  endTime?: string;
  durationHours?: number;
  notes?: string;
}): Promise<{ success: boolean; error?: string }> {
  await requireAdmin();
  try {
    const startTime = new Date(data.startTime);
    let endTime: Date | undefined;
    let durationHours: number | undefined;

    if (data.endTime) {
      endTime = new Date(data.endTime);
      durationHours =
        (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60);
      durationHours = Math.round(durationHours * 100) / 100;
    } else if (data.durationHours) {
      durationHours = data.durationHours;
      endTime = new Date(startTime.getTime() + durationHours * 60 * 60 * 1000);
    }

    await db.generatorRunLog.create({
      data: {
        generatorId: data.generatorId,
        startTime,
        endTime: endTime || null,
        durationHours: durationHours || null,
        notes: data.notes || null,
      },
    });
    return { success: true };
  } catch (e) {
    console.error("addManualRunLog error:", e);
    return { success: false, error: "Failed to add run log" };
  }
}

export async function getRunLogs(generatorId: string) {
  await requireAdmin();
  return db.generatorRunLog.findMany({
    where: { generatorId },
    orderBy: { startTime: "desc" },
    take: 50,
  });
}

// ─── Internal helper ─────────────────────────────────────────

async function getOrCreateConfig() {
  let config = await db.generatorConfig.findFirst();
  if (!config) {
    config = await db.generatorConfig.create({ data: {} });
  }
  return config;
}

// ─── Dashboard / Analytics ───────────────────────────────────

export interface GeneratorDashboardData {
  generator: { id: string; name: string };
  totalRunningHours: number;
  totalFuelFilled: number; // litres
  nextOilChangeAt: number; // running hours
  hoursUntilOilChange: number;
  totalOilChanges: number;
  monthlyFuelCost: number; // paise
  monthlyOilCost: number; // paise
  monthlyCost: number; // paise
  recentFuelLogs: Array<{
    id: string;
    date: Date;
    litres: number;
    pricePerLitre: number;
    totalCost: number;
    isStockPurchase: boolean;
    notes: string | null;
    createdAt: Date;
  }>;
  recentOilChanges: Array<{
    id: string;
    date: Date;
    runningHoursAtChange: number;
    litres: number;
    costPerLitre: number;
    totalCost: number;
    sequenceNumber: number;
    notes: string | null;
    createdAt: Date;
  }>;
  activeRunLog: {
    id: string;
    startTime: Date;
  } | null;
}

async function _getGeneratorDashboard(
  generatorId: string
): Promise<GeneratorDashboardData | null> {

  const generator = await db.generator.findUnique({
    where: { id: generatorId },
  });
  if (!generator) return null;

  const config = await getOrCreateConfig();

  // Fuel logs — all, for running hours and stock calculation
  const allFuelLogs = await db.generatorFuelLog.findMany({
    where: { generatorId },
  });

  // Total litres filled into generator
  const totalFuelFilled = allFuelLogs.reduce((sum, l) => sum + l.litres, 0);

  const totalRunningHours = totalFuelFilled / config.consumptionRate;

  // Oil changes
  const oilChanges = await db.generatorOilChange.findMany({
    where: { generatorId },
    orderBy: { date: "desc" },
  });
  const totalOilChanges = oilChanges.length;
  const nextOilChangeAt = getNextOilChangeHours(totalOilChanges, config);
  const hoursUntilOilChange = Math.max(0, nextOilChangeAt - totalRunningHours);

  // Monthly costs (current month)
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
  const monthEnd = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 1));

  const monthlyFuelLogs = allFuelLogs.filter(
    (l) => l.date >= monthStart && l.date < monthEnd
  );
  const monthlyFuelCost = monthlyFuelLogs.reduce(
    (sum, l) => sum + l.totalCost,
    0
  );

  const monthlyOilChanges = oilChanges.filter(
    (o) => o.date >= monthStart && o.date < monthEnd
  );
  const monthlyOilCost = monthlyOilChanges.reduce(
    (sum, o) => sum + o.totalCost,
    0
  );

  // Recent fuel logs (last 10)
  const recentFuelLogs = await db.generatorFuelLog.findMany({
    where: { generatorId },
    orderBy: { date: "desc" },
    take: 10,
  });

  // Recent oil changes
  const recentOilChanges = oilChanges.slice(0, 10);

  // Active (unstopped) run log
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

export async function getGeneratorDashboard(
  generatorId: string
): Promise<GeneratorDashboardData | null> {
  await requireAdmin();
  return _getGeneratorDashboard(generatorId);
}

export interface GeneratorAnalyticsData {
  totalHours: number;
  totalFuelCost: number; // paise
  totalOilCost: number; // paise
  totalCost: number; // paise
  totalLitres: number;
  oilChangesInPeriod: number;
  costPerBookingHour: number; // paise
  monthlyBreakdown: Array<{
    month: string;
    hours: number;
    fuelCost: number;
    oilCost: number;
    totalCost: number;
    litres: number;
  }>;
}

export async function getGeneratorAnalytics(
  generatorId: string,
  period?: { from: string; to: string }
): Promise<GeneratorAnalyticsData> {
  await requireAdmin();

  const config = await getOrCreateConfig();

  const now = new Date();
  const from = period?.from
    ? new Date(period.from)
    : new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
  const to = period?.to ? new Date(period.to) : new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 1));

  // Fuel logs in period
  const fuelLogs = await db.generatorFuelLog.findMany({
    where: {
      generatorId,
      date: { gte: from, lt: to },
    },
    orderBy: { date: "asc" },
  });

  const filledLitres = fuelLogs
    .filter((l) => !l.isStockPurchase)
    .reduce((sum, l) => sum + l.litres, 0);
  const totalHours = filledLitres / config.consumptionRate;
  const totalFuelCost = fuelLogs.reduce((sum, l) => sum + l.totalCost, 0);
  const totalLitres = fuelLogs.reduce((sum, l) => sum + l.litres, 0);

  // Oil changes in period
  const oilChanges = await db.generatorOilChange.findMany({
    where: {
      generatorId,
      date: { gte: from, lt: to },
    },
  });
  const totalOilCost = oilChanges.reduce((sum, o) => sum + o.totalCost, 0);

  // Cost per booking hour — get confirmed bookings in the same period
  let costPerBookingHour = 0;
  try {
    const bookings = await db.booking.findMany({
      where: {
        status: "CONFIRMED",
        date: { gte: from, lt: to },
      },
      include: { slots: true },
    });
    const totalBookingHours = bookings.reduce(
      (sum, b) => sum + b.slots.length,
      0
    );
    const totalCost = totalFuelCost + totalOilCost;
    if (totalBookingHours > 0) {
      costPerBookingHour = Math.round(totalCost / totalBookingHours);
    }
  } catch {
    // If booking query fails, leave as 0
  }

  // Monthly breakdown
  const monthlyMap = new Map<
    string,
    {
      hours: number;
      fuelCost: number;
      oilCost: number;
      litres: number;
    }
  >();

  for (const log of fuelLogs) {
    const d = new Date(log.date);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    const entry = monthlyMap.get(key) || {
      hours: 0,
      fuelCost: 0,
      oilCost: 0,
      litres: 0,
    };
    entry.fuelCost += log.totalCost;
    entry.litres += log.litres;
    if (!log.isStockPurchase) {
      entry.hours += log.litres / config.consumptionRate;
    }
    monthlyMap.set(key, entry);
  }

  for (const oc of oilChanges) {
    const d = new Date(oc.date);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    const entry = monthlyMap.get(key) || {
      hours: 0,
      fuelCost: 0,
      oilCost: 0,
      litres: 0,
    };
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

  return {
    totalHours: Math.round(totalHours * 100) / 100,
    totalFuelCost,
    totalOilCost,
    totalCost: totalFuelCost + totalOilCost,
    totalLitres: Math.round(totalLitres * 100) / 100,
    oilChangesInPeriod: oilChanges.length,
    costPerBookingHour,
    monthlyBreakdown,
  };
}

// ─── Public helper for cron (no auth) ────────────────────────

export async function getGeneratorOilChangeStatus(generatorId: string) {
  const config = await getOrCreateConfig();
  const generator = await db.generator.findUnique({
    where: { id: generatorId },
  });
  if (!generator) return null;

  const fuelLogs = await db.generatorFuelLog.findMany({
    where: { generatorId },
  });
  const totalLitresFilled = fuelLogs.reduce((sum, l) => sum + l.litres, 0);
  const totalRunningHours = totalLitresFilled / config.consumptionRate;

  const oilChanges = await db.generatorOilChange.findMany({
    where: { generatorId },
    orderBy: { date: "desc" },
  });
  const totalOilChanges = oilChanges.length;
  const nextOilChangeAt = getNextOilChangeHours(totalOilChanges, config);
  const hoursUntilOilChange = Math.max(0, nextOilChangeAt - totalRunningHours);
  const lastOilChange = oilChanges[0] || null;

  return {
    generator,
    config,
    totalRunningHours: Math.round(totalRunningHours * 100) / 100,
    totalOilChanges,
    nextOilChangeAt,
    hoursUntilOilChange: Math.round(hoursUntilOilChange * 100) / 100,
    lastOilChange,
  };
}

// ─── PIN-protected public actions (for mobile pages) ────────

export async function pinGetGenerator(generatorId: string) {
  await requirePin();
  const gen = await db.generator.findUnique({ where: { id: generatorId } });
  if (!gen || !gen.isActive) return null;
  return { id: gen.id, name: gen.name };
}

export async function pinGetDashboard(generatorId: string) {
  await requirePin();
  return _getGeneratorDashboard(generatorId);
}

export async function pinStartRunLog(
  generatorId: string
): Promise<{ success: boolean; error?: string; id?: string }> {
  await requirePin();
  try {
    const existing = await db.generatorRunLog.findFirst({
      where: { generatorId, endTime: null },
    });
    if (existing) return { success: false, error: "Already running" };

    const log = await db.generatorRunLog.create({
      data: { generatorId, startTime: new Date() },
    });
    return { success: true, id: log.id };
  } catch (e) {
    console.error("pinStartRunLog error:", e);
    return { success: false, error: "Failed to start" };
  }
}

export async function pinStopRunLog(
  runLogId: string
): Promise<{ success: boolean; error?: string }> {
  await requirePin();
  try {
    const log = await db.generatorRunLog.findUnique({ where: { id: runLogId } });
    if (!log || log.endTime) return { success: false, error: "Invalid run log" };

    const endTime = new Date();
    const durationHours =
      (endTime.getTime() - log.startTime.getTime()) / (1000 * 60 * 60);

    await db.generatorRunLog.update({
      where: { id: runLogId },
      data: {
        endTime,
        durationHours: Math.round(durationHours * 100) / 100,
      },
    });
    return { success: true };
  } catch (e) {
    console.error("pinStopRunLog error:", e);
    return { success: false, error: "Failed to stop" };
  }
}

export async function pinAddFuelLog(data: {
  generatorId: string;
  date: string;
  litres: number;
  pricePerLitre: number;
  notes?: string;
}): Promise<{ success: boolean; error?: string }> {
  await requirePin();
  try {
    const totalCost = Math.round(data.litres * data.pricePerLitre);
    await db.generatorFuelLog.create({
      data: {
        generatorId: data.generatorId,
        date: new Date(data.date),
        litres: data.litres,
        pricePerLitre: data.pricePerLitre,
        totalCost,
        isStockPurchase: false,
        notes: data.notes || null,
      },
    });
    return { success: true };
  } catch (e) {
    console.error("pinAddFuelLog error:", e);
    return { success: false, error: "Failed to add fuel log" };
  }
}

export async function pinGetFuelLogs(generatorId: string, month?: string) {
  await requirePin();
  const where: { generatorId: string; date?: { gte: Date; lt: Date } } = {
    generatorId,
  };
  if (month) {
    const [y, m] = month.split("-").map(Number);
    const start = new Date(Date.UTC(y, m - 1, 1));
    const end = new Date(Date.UTC(y, m, 1));
    where.date = { gte: start, lt: end };
  }
  return db.generatorFuelLog.findMany({
    where,
    orderBy: { date: "desc" },
  });
}

export async function pinGetConfig() {
  await requirePin();
  const config = await getOrCreateConfig();
  return { petrolPricePerLitre: config.petrolPricePerLitre };
}
