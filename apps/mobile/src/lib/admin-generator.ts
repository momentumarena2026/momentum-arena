import { request } from "./admin-api";

export interface GeneratorFuelLog {
  id: string;
  date: string;
  litres: number;
  pricePerLitre: number; // paise
  totalCost: number; // paise
  isStockPurchase: boolean;
  notes: string | null;
  createdAt: string;
}

export interface GeneratorOilChange {
  id: string;
  date: string;
  runningHoursAtChange: number;
  litres: number;
  costPerLitre: number; // paise
  totalCost: number; // paise
  sequenceNumber: number;
  notes: string | null;
  createdAt: string;
}

export interface GeneratorRunLog {
  id: string;
  entryId: number | null;
  source: string;
  startTime: string;
  endTime: string | null;
  durationHours: number | null;
  notes: string | null;
}

export interface GeneratorDashboard {
  generator: { id: string; name: string };
  totalRunningHours: number;
  totalFuelFilled: number; // litres
  nextOilChangeAt: number; // running hours
  hoursUntilOilChange: number;
  totalOilChanges: number;
  monthlyFuelCost: number; // paise
  monthlyOilCost: number; // paise
  monthlyCost: number; // paise
  recentFuelLogs: GeneratorFuelLog[];
  recentOilChanges: GeneratorOilChange[];
  activeRunLog: { id: string; startTime: string } | null;
}

/**
 * Generator config (singleton). Money fields are PAISE on the wire (raw
 * DB values); the screen converts to/from rupees for display + editing.
 */
export interface GeneratorConfig {
  id: string;
  petrolPricePerLitre: number; // paise
  oilPricePerLitre: number; // paise
  consumptionRate: number; // litres per hour
  firstOilChangeHours: number;
  secondOilChangeHours: number;
  regularOilChangeHours: number;
  oilChangeAlertHours: number;
  notificationEmails: string;
  oilChangeTemplateId: string;
  monthlyTemplateId: string;
  pinChangeTemplateId: string;
  generatorPin: string;
  hardwareApiKey: string;
}

export type GeneratorConfigInput = {
  petrolPricePerLitre: number; // paise
  oilPricePerLitre: number; // paise
  consumptionRate: number;
  firstOilChangeHours: number;
  secondOilChangeHours: number;
  regularOilChangeHours: number;
  oilChangeAlertHours: number;
  notificationEmails: string;
  oilChangeTemplateId: string;
  monthlyTemplateId: string;
  pinChangeTemplateId: string;
  generatorPin: string;
  hardwareApiKey: string;
  pinChanged?: boolean;
};

export interface GeneratorAnalytics {
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
    fuelCost: number; // paise
    oilCost: number; // paise
    totalCost: number; // paise
    litres: number;
  }>;
}

export type GeneratorLogType = "fuel" | "oil" | "run";

export interface LogFuelInput {
  type: "fuel";
  generatorId: string;
  date: string;
  litres: number;
  pricePerLitre: number; // RUPEES — server converts to paise
  isStockPurchase?: boolean;
  notes?: string;
}

export interface LogOilInput {
  type: "oil";
  generatorId: string;
  date: string;
  litres: number;
  costPerLitre: number; // RUPEES — server converts to paise
  notes?: string;
}

export interface LogRunInput {
  type: "run";
  generatorId: string;
  date: string;
  durationHours: number;
  notes?: string;
}

export type LogInput = LogFuelInput | LogOilInput | LogRunInput;

export const adminGeneratorApi = {
  list: () =>
    request<{ generators: GeneratorDashboard[] }>("/api/mobile/admin/generator", {
      method: "GET",
    }),
  log: (body: LogInput) =>
    request<{ ok: true }>("/api/mobile/admin/generator", {
      method: "POST",
      body,
    }),
  create: (id: string, name: string) =>
    request<{ ok: true; id: string }>("/api/mobile/admin/generator", {
      method: "PUT",
      body: { id, name },
    }),
  remove: (generatorId: string) =>
    request<{ ok: true }>(
      `/api/mobile/admin/generator/${encodeURIComponent(generatorId)}`,
      { method: "DELETE" },
    ),

  // ─── Run log timer (start/stop) ──────────────────────────────
  startRun: (generatorId: string) =>
    request<{ ok: true; id: string }>("/api/mobile/admin/generator/run", {
      method: "POST",
      body: { action: "start", generatorId },
    }),
  stopRun: (runLogId: string) =>
    request<{ ok: true }>("/api/mobile/admin/generator/run", {
      method: "POST",
      body: { action: "stop", runLogId },
    }),

  // ─── Config ──────────────────────────────────────────────────
  getConfig: () =>
    request<{ config: GeneratorConfig }>("/api/mobile/admin/generator/config", {
      method: "GET",
    }),
  saveConfig: (body: GeneratorConfigInput) =>
    request<{ ok: true }>("/api/mobile/admin/generator/config", {
      method: "PUT",
      body,
    }),

  // ─── Analytics ───────────────────────────────────────────────
  analytics: (generatorId: string, period?: { from?: string; to?: string }) => {
    const sp = new URLSearchParams({ generatorId });
    if (period?.from) sp.set("from", period.from);
    if (period?.to) sp.set("to", period.to);
    return request<GeneratorAnalytics>(
      `/api/mobile/admin/generator/analytics?${sp.toString()}`,
      { method: "GET" },
    );
  },

  // ─── History ─────────────────────────────────────────────────
  fuelLogs: (generatorId: string, month?: string) => {
    const sp = new URLSearchParams({ generatorId });
    if (month) sp.set("month", month);
    return request<{ logs: GeneratorFuelLog[] }>(
      `/api/mobile/admin/generator/history?type=fuel&${sp.toString()}`,
      { method: "GET" },
    );
  },
  oilChanges: (generatorId: string) =>
    request<{ changes: GeneratorOilChange[] }>(
      `/api/mobile/admin/generator/history?type=oil&generatorId=${encodeURIComponent(generatorId)}`,
      { method: "GET" },
    ),
  runLogs: (generatorId: string) =>
    request<{ logs: GeneratorRunLog[] }>(
      `/api/mobile/admin/generator/history?type=run&generatorId=${encodeURIComponent(generatorId)}`,
      { method: "GET" },
    ),
};
