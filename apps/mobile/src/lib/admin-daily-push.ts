import { request } from "./admin-api";

/**
 * Admin client for the daily push.
 *
 * The shapes below mirror `lib/daily-push-rules.ts` and
 * `actions/admin-daily-push.ts` exactly, and they are re-declared rather
 * than imported because `apps/mobile` does not compile against the web
 * tsconfig. That makes this a mirrored pair in spirit — if a field is
 * added to DailyPushLimits on the server, it has to be added here too or
 * the phone will save a settings object missing it.
 *
 * What is NOT duplicated, deliberately: the validator. Saving goes
 * through the same `saveDailyPushSettings` action the web calls, so a
 * combination the web refuses is refused here too, with the same
 * sentence. A second copy of those rules living in the app is exactly
 * how the two surfaces drift.
 */

export interface DailyPushRuleToggle {
  enabled: boolean;
  days: number;
}

export interface DailyPushSettings {
  enabled: boolean;
  sendHourIST: number;
  quietFromHour: number;
  quietToHour: number;
  maxPerUserPerWeek: number;
  skipIfBookedSoon: boolean;
  skipIfPushedToday: boolean;
  passExpiry: DailyPushRuleToggle;
  neverBooked: DailyPushRuleToggle;
  lapsed: DailyPushRuleToggle;
  freeSlots: { enabled: boolean; fromHour: number; minOpen: number };
}

export interface DailyPushAdminView {
  settings: DailyPushSettings;
  reachable: number;
  optedOut: number;
  lastWeekByRule: { rule: string; label: string; count: number }[];
  lastSentAt: string | null;
}

export interface DailyPushBucket {
  rule: string;
  label: string;
  count: number;
  sample: string[];
  title: string | null;
  body: string | null;
  attempted: number;
  succeeded: number;
}

export interface DailyPushRun {
  refusal: string | null;
  dryRun: boolean;
  considered: number;
  sent: number;
  buckets: DailyPushBucket[];
  skipped: Record<string, number>;
  venue: { freeSlotsTonight: number; sports: string[] };
  ranAt: string;
}

export const adminDailyPushApi = {
  get: () => request<DailyPushAdminView>("/api/mobile/admin/push/daily", { method: "GET" }),

  /** Returns the refreshed view, so callers can setQueryData without a GET. */
  save: (settings: DailyPushSettings) =>
    request<DailyPushAdminView>("/api/mobile/admin/push/daily", {
      method: "POST",
      body: { settings },
    }),

  /** Evaluates every rule against the real audience and sends nothing. */
  dryRun: () =>
    request<DailyPushRun>("/api/mobile/admin/push/daily", {
      method: "POST",
      body: { dryRun: true },
    }),
};
