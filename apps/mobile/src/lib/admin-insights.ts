import { request } from "./admin-api";

/**
 * API client for the mobile-admin analytics surface (read-only). Backs
 * four screens that mirror the web /admin/analytics/* pages:
 *   - Demand heatmap  (day-of-week × hour grid of unmet demand)
 *   - Cohorts         (week-on-week retention grid)
 *   - Funnels         (predefined funnel step conversion)
 *   - Events & logs   (client analytics events + server action log)
 *
 * Types here mirror the shapes returned by actions/admin-insights.ts.
 * The mobile bundle can't import web types, so JSON blobs that the web
 * types as Prisma.JsonValue are surfaced as `unknown` here.
 */

// ---------- Funnels ----------

/** Keys must stay in sync with lib/analytics-funnels.ts FUNNELS. */
export type FunnelKey = "booking" | "cafe" | "waitlist" | "auth" | "rewards";

export const FUNNEL_OPTIONS: { key: FunnelKey; label: string }[] = [
  { key: "booking", label: "Booking" },
  { key: "cafe", label: "Cafe" },
  { key: "waitlist", label: "Waitlist" },
  { key: "auth", label: "Auth" },
  { key: "rewards", label: "Rewards" },
];

export interface FunnelStepRow {
  step: string;
  count: number;
  uniqueUsers: number;
  ratePct: number;
  dropOffPct: number;
}

export interface FunnelResult {
  key: FunnelKey;
  label: string;
  dateFrom: string;
  dateTo: string;
  rows: FunnelStepRow[];
}

export interface OverviewKpis {
  sessions: number;
  signedInUsers: number;
  bookingsConfirmed: number;
  waitlistJoined: number;
  unmetDemandTaps: number;
  waitlistConversionPct: number;
}

export interface FunnelScreenResult {
  funnel: FunnelResult;
  overview: OverviewKpis;
}

// ---------- Demand heatmap ----------

export interface DemandCell {
  /** 0=Mon ... 6=Sun */
  dayOfWeek: number;
  hour: number;
  sport: string;
  intensity: number;
}

export interface DemandResult {
  dateFrom: string;
  dateTo: string;
  cells: DemandCell[];
}

// ---------- Cohorts ----------

export interface CohortCell {
  cohortStart: string;
  weekIndex: number;
  retainedUsers: number;
  cohortSize: number;
  ratePct: number;
}

export interface CohortGridResult {
  weeks: number;
  cohorts: { cohortStart: string; cohortSize: number; cells: CohortCell[] }[];
}

// ---------- Events & logs ----------

export interface EventRow {
  id: string;
  name: string;
  category: string;
  userId: string | null;
  userName: string | null;
  userPhone: string | null;
  sessionId: string;
  platform: string;
  properties: unknown;
  pageUrl: string | null;
  occurredAt: string;
}

export interface EventsListResult {
  rows: EventRow[];
  hasMore: boolean;
  nextCursor: string | null;
}

export interface ServerLogRow {
  id: string;
  action: string;
  category: string;
  outcome: string;
  userId: string | null;
  userName: string | null;
  userPhone: string | null;
  path: string | null;
  method: string | null;
  platform: string;
  metadata: unknown;
  sport: string | null;
  error: string | null;
  occurredAt: string;
}

export interface ServerLogsListResult {
  rows: ServerLogRow[];
  hasMore: boolean;
  nextCursor: string | null;
}

export const adminInsightsApi = {
  demand(params: { from: string; to: string }): Promise<DemandResult> {
    const sp = new URLSearchParams();
    sp.set("from", params.from);
    sp.set("to", params.to);
    return request(`/api/mobile/admin/analytics/demand?${sp.toString()}`, {
      method: "GET",
    });
  },

  cohorts(params: { weeks?: number } = {}): Promise<CohortGridResult> {
    const sp = new URLSearchParams();
    if (params.weeks) sp.set("weeks", String(params.weeks));
    const qs = sp.toString();
    return request(
      `/api/mobile/admin/analytics/cohorts${qs ? `?${qs}` : ""}`,
      { method: "GET" },
    );
  },

  funnel(params: {
    key: FunnelKey;
    from: string;
    to: string;
  }): Promise<FunnelScreenResult> {
    const sp = new URLSearchParams();
    sp.set("key", params.key);
    sp.set("from", params.from);
    sp.set("to", params.to);
    return request(`/api/mobile/admin/analytics/funnels?${sp.toString()}`, {
      method: "GET",
    });
  },

  clientEvents(filters: {
    name?: string;
    category?: string;
    before?: string;
    limit?: number;
  } = {}): Promise<EventsListResult> {
    const sp = new URLSearchParams();
    sp.set("tab", "client");
    if (filters.name) sp.set("name", filters.name);
    if (filters.category) sp.set("category", filters.category);
    if (filters.before) sp.set("before", filters.before);
    if (filters.limit) sp.set("limit", String(filters.limit));
    return request(`/api/mobile/admin/analytics/events?${sp.toString()}`, {
      method: "GET",
    });
  },

  serverLogs(filters: {
    name?: string;
    category?: string;
    outcome?: string;
    before?: string;
    limit?: number;
  } = {}): Promise<ServerLogsListResult> {
    const sp = new URLSearchParams();
    sp.set("tab", "server");
    if (filters.name) sp.set("name", filters.name);
    if (filters.category) sp.set("category", filters.category);
    if (filters.outcome) sp.set("outcome", filters.outcome);
    if (filters.before) sp.set("before", filters.before);
    if (filters.limit) sp.set("limit", String(filters.limit));
    return request(`/api/mobile/admin/analytics/events?${sp.toString()}`, {
      method: "GET",
    });
  },
};
