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
};
