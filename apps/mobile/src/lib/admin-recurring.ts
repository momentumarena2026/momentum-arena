import { request } from "./admin-api";

/**
 * Recurring-booking config. Mirrors web /admin/recurring.
 * `discountPercent`, `weeks`, `days` are whole numbers (a percent is a
 * percent, not basis points). allowedDays uses 0=Sun … 6=Sat.
 */
export interface RecurringTier {
  weeks: number;
  discountPercent: number;
}

export interface DailyTier {
  days: number;
  discountPercent: number;
}

export interface RecurringConfig {
  id?: string;
  tiers: RecurringTier[];
  allowedDays: number[];
  maxWeeks: number;
  minWeeks: number;
  dailyTiers: DailyTier[];
  maxDays: number;
  minDays: number;
  enabled: boolean;
}

export type RecurringConfigInput = Omit<RecurringConfig, "id">;

export const adminRecurringApi = {
  get: () =>
    request<{ config: RecurringConfig }>("/api/mobile/admin/recurring-config", {
      method: "GET",
    }),
  save: (body: RecurringConfigInput) =>
    request<{ ok: true }>("/api/mobile/admin/recurring-config", {
      method: "POST",
      body,
    }),
};
