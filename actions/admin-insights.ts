"use server";

import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";
import { FUNNELS, type FunnelKey } from "@/lib/analytics-funnels";
import type { Prisma } from "@prisma/client";

/**
 * First-party analytics queries for /admin/analytics/{funnels,events,
 * cohorts,demand}.
 *
 * Read paths only — no mutations. All queries pull from the
 * AnalyticsEvent / AnalyticsSession / MetricRollup / UserCohort
 * tables. Rollup-driven where possible (cheap, indexed) and
 * raw-event where the answer needs row-level detail (Events log,
 * specific funnels with custom filters).
 *
 * Auth: requireAdmin("VIEW_ANALYTICS") on every export.
 *
 * Note: this file is a Next.js Server Actions module ("use server"
 * directive above). EVERY export must be an async function. Static
 * data like the FUNNELS const lives in lib/analytics-funnels.ts —
 * importing it here is fine.
 */

// ---------- Funnels ----------

export interface FunnelStepRow {
  step: string;
  count: number;
  uniqueUsers: number;
  /** % of users that reached this step out of those that hit step 0. 100 for step 0. */
  ratePct: number;
  /** % drop-off from the previous step. 0 for step 0. */
  dropOffPct: number;
}

export interface FunnelResult {
  key: FunnelKey;
  label: string;
  dateFrom: string;
  dateTo: string;
  rows: FunnelStepRow[];
}

export async function getFunnel(
  key: FunnelKey,
  dateFrom: string,
  dateTo: string,
): Promise<FunnelResult> {
  await requireAdmin("VIEW_ANALYTICS");

  const fdef = FUNNELS[key];
  const from = new Date(`${dateFrom}T00:00:00.000Z`);
  const to = new Date(`${dateTo}T23:59:59.999Z`);

  // Per-step distinct sessions hitting each event in the window.
  // Sessions, not users — anonymous browsers count too. The funnel
  // measures journey progress, and an anonymous-then-authed user is
  // ONE journey across both phases (their sessionId is stable).
  const stepNames = [...fdef.steps];
  type Row = { name: string; sessions: bigint; users: bigint };
  const raw = await db.$queryRaw<Row[]>`
    SELECT
      e."name",
      COUNT(DISTINCT e."sessionId")::bigint AS sessions,
      COUNT(DISTINCT e."userId")::bigint   AS users
    FROM "AnalyticsEvent" e
    WHERE e."occurredAt" >= ${from}
      AND e."occurredAt" <= ${to}
      AND e."name" = ANY(${stepNames}::text[])
    GROUP BY e."name"
  `;
  const byName = new Map(
    raw.map((r) => ({ name: r.name, sessions: Number(r.sessions), users: Number(r.users) })).map(
      (r) => [r.name, r] as const,
    ),
  );

  const step0 = byName.get(stepNames[0])?.sessions ?? 0;
  const rows: FunnelStepRow[] = stepNames.map((step, idx) => {
    const r = byName.get(step);
    const sessions = r?.sessions ?? 0;
    const users = r?.users ?? 0;
    const prev = idx === 0 ? sessions : (byName.get(stepNames[idx - 1])?.sessions ?? 0);
    return {
      step,
      count: sessions,
      uniqueUsers: users,
      ratePct: step0 > 0 ? Math.round((sessions / step0) * 1000) / 10 : 0,
      dropOffPct:
        idx === 0 || prev === 0
          ? 0
          : Math.round(((prev - sessions) / prev) * 1000) / 10,
    };
  });

  return { key, label: fdef.label, dateFrom, dateTo, rows };
}

// ---------- Events log ----------

export interface EventRow {
  id: string;
  name: string;
  category: string;
  userId: string | null;
  userName: string | null;
  userPhone: string | null;
  sessionId: string;
  platform: string;
  properties: Prisma.JsonValue;
  pageUrl: string | null;
  occurredAt: string;
}

export interface EventsListResult {
  rows: EventRow[];
  hasMore: boolean;
  nextCursor: string | null;
}

export async function listAnalyticsEvents(filters: {
  name?: string;
  category?: string;
  userId?: string;
  sessionId?: string;
  /** ISO datetime — events older than this won't be returned. */
  before?: string;
  limit?: number;
}): Promise<EventsListResult> {
  await requireAdmin("VIEW_ANALYTICS");

  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);

  const where: Prisma.AnalyticsEventWhereInput = {};
  if (filters.name) where.name = filters.name;
  if (filters.category) {
    where.category = filters.category as Prisma.AnalyticsEventWhereInput["category"];
  }
  if (filters.userId) where.userId = filters.userId;
  if (filters.sessionId) where.sessionId = filters.sessionId;
  if (filters.before) where.occurredAt = { lt: new Date(filters.before) };

  const rows = await db.analyticsEvent.findMany({
    where,
    orderBy: { occurredAt: "desc" },
    take: limit + 1,
    select: {
      id: true,
      name: true,
      category: true,
      userId: true,
      sessionId: true,
      platform: true,
      properties: true,
      pageUrl: true,
      occurredAt: true,
      user: { select: { name: true, phone: true } },
    },
  });

  const hasMore = rows.length > limit;
  const sliced = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? sliced[sliced.length - 1].occurredAt.toISOString() : null;

  return {
    rows: sliced.map((r) => ({
      id: r.id,
      name: r.name,
      category: String(r.category),
      userId: r.userId,
      userName: r.user?.name ?? null,
      userPhone: r.user?.phone ?? null,
      sessionId: r.sessionId,
      platform: r.platform,
      properties: r.properties,
      pageUrl: r.pageUrl,
      occurredAt: r.occurredAt.toISOString(),
    })),
    hasMore,
    nextCursor,
  };
}

// ---------- Cohorts (week-on-week retention) ----------

export interface CohortCell {
  cohortStart: string;
  weekIndex: number;
  retainedUsers: number;
  /** Cohort size = users in the cohort who fired any event ever. Same as week 0. */
  cohortSize: number;
  ratePct: number;
}

export interface CohortGridResult {
  weeks: number; // how many weekly buckets we report
  cohorts: { cohortStart: string; cohortSize: number; cells: CohortCell[] }[];
}

/**
 * Classic week-on-week retention grid. Rows = cohort weeks, columns =
 * weeks-since-cohort. Each cell = % of cohort that fired ANY event
 * during that follow-up week.
 *
 * `weeks` controls how many cohorts (and how many follow-up weeks)
 * we compute; default 8 for a 2-month window.
 */
export async function getCohortRetention(
  weeks: number = 8,
): Promise<CohortGridResult> {
  await requireAdmin("VIEW_ANALYTICS");

  // Anchor at the start of the current ISO week (Mon 00:00 IST), then
  // walk back `weeks` cohorts. Same IST math as ensureUserCohort in
  // /api/events.
  const IST_MS = 5.5 * 60 * 60 * 1000;
  const now = new Date();
  const ist = new Date(now.getTime() + IST_MS);
  const dow = ist.getUTCDay();
  const sinceMon = (dow + 6) % 7;
  const currentWeekStart = new Date(
    Date.UTC(
      ist.getUTCFullYear(),
      ist.getUTCMonth(),
      ist.getUTCDate() - sinceMon,
      0,
      0,
      0,
      0,
    ) - IST_MS,
  );

  const cohortStartCutoff = new Date(currentWeekStart);
  cohortStartCutoff.setUTCDate(
    cohortStartCutoff.getUTCDate() - 7 * (weeks - 1),
  );

  // Pull all the data in 2 cheap queries:
  //  - cohort sizes from UserCohort
  //  - for every (cohort, retention-week) cell, COUNT(DISTINCT user)
  //    via a single grouped scan over AnalyticsEvent
  type CohortSizeRow = { cohort_start: Date; size: bigint };
  const sizes = await db.$queryRaw<CohortSizeRow[]>`
    SELECT "cohortWeek" AS cohort_start, COUNT(*)::bigint AS size
    FROM "UserCohort"
    WHERE "cohortWeek" >= ${cohortStartCutoff}
    GROUP BY "cohortWeek"
    ORDER BY "cohortWeek"
  `;

  type RetainedRow = { cohort_start: Date; week_idx: number; users: bigint };
  const retained = await db.$queryRaw<RetainedRow[]>`
    SELECT
      uc."cohortWeek" AS cohort_start,
      FLOOR(EXTRACT(EPOCH FROM (e."occurredAt" - uc."cohortWeek")) / (7 * 86400))::int AS week_idx,
      COUNT(DISTINCT e."userId")::bigint AS users
    FROM "AnalyticsEvent" e
    JOIN "UserCohort" uc ON uc."userId" = e."userId"
    WHERE uc."cohortWeek" >= ${cohortStartCutoff}
      AND e."occurredAt" >= uc."cohortWeek"
    GROUP BY uc."cohortWeek", week_idx
  `;

  const retainedByCohort = new Map<string, Map<number, number>>();
  for (const r of retained) {
    const key = r.cohort_start.toISOString();
    const inner = retainedByCohort.get(key) ?? new Map<number, number>();
    inner.set(r.week_idx, Number(r.users));
    retainedByCohort.set(key, inner);
  }

  const cohorts = sizes.map((s) => {
    const cohortStart = s.cohort_start.toISOString();
    const cohortSize = Number(s.size);
    const inner = retainedByCohort.get(cohortStart) ?? new Map<number, number>();
    const cells: CohortCell[] = [];
    // How many follow-up weeks are visible for this cohort = weeks
    // elapsed since its start. A cohort that started this week has
    // only 1 visible week (week 0).
    const ageWeeks = Math.floor(
      (currentWeekStart.getTime() - s.cohort_start.getTime()) /
        (7 * 24 * 60 * 60 * 1000),
    );
    const visibleWeeks = Math.min(weeks, ageWeeks + 1);
    for (let i = 0; i < visibleWeeks; i++) {
      const retainedUsers = inner.get(i) ?? 0;
      cells.push({
        cohortStart,
        weekIndex: i,
        retainedUsers,
        cohortSize,
        ratePct:
          cohortSize > 0
            ? Math.round((retainedUsers / cohortSize) * 1000) / 10
            : 0,
      });
    }
    return { cohortStart, cohortSize, cells };
  });

  return { weeks, cohorts };
}

// ---------- Demand heatmap ----------

export interface DemandCell {
  /** 0=Mon ... 6=Sun (so Mon-first week) */
  dayOfWeek: number;
  hour: number;
  sport: string;
  /** unique users who waitlisted/tapped this slot in the window */
  intensity: number;
}

export interface DemandResult {
  dateFrom: string;
  dateTo: string;
  cells: DemandCell[];
}

/**
 * Aggregates the unmet-demand signal into a (day-of-week × hour ×
 * sport) heatmap. Source = (Waitlist entries) ∪ (slot_unavailable_tap
 * events). Same user counted at most once per (slot, day, hour).
 */
export async function getDemandHeatmap(
  dateFrom: string,
  dateTo: string,
): Promise<DemandResult> {
  await requireAdmin("VIEW_ANALYTICS");

  const from = new Date(`${dateFrom}T00:00:00.000Z`);
  const to = new Date(`${dateTo}T23:59:59.999Z`);

  type WaitlistRow = { dow: number; hour: number; sport: string; n: bigint };
  // EXTRACT(DOW) returns 0=Sun..6=Sat — we shift to Mon=0 below.
  const waitlistRows = await db.$queryRaw<WaitlistRow[]>`
    SELECT
      EXTRACT(DOW FROM w."date" AT TIME ZONE 'Asia/Kolkata')::int AS dow,
      w."startHour" AS hour,
      cc."sport"::text AS sport,
      COUNT(DISTINCT COALESCE(w."userId", w."guestPhone", w."guestEmail", w."id"))::bigint AS n
    FROM "Waitlist" w
    JOIN "CourtConfig" cc ON cc."id" = w."courtConfigId"
    WHERE w."createdAt" >= ${from}
      AND w."createdAt" <= ${to}
    GROUP BY dow, hour, sport
  `;

  type EventRow = { dow: number; hour: number; sport: string; n: bigint };
  // Pull dow + hour from the event's `properties->>'date'` + properties->>'hour'.
  // dow comes from PostgreSQL's TO_DATE on the YYYY-MM-DD string.
  const eventRows = await db.$queryRaw<EventRow[]>`
    SELECT
      EXTRACT(DOW FROM TO_DATE(e."properties"->>'date', 'YYYY-MM-DD'))::int AS dow,
      (e."properties"->>'hour')::int AS hour,
      COALESCE(e."properties"->>'sport', '_')::text AS sport,
      COUNT(DISTINCT COALESCE(e."userId", e."sessionId"))::bigint AS n
    FROM "AnalyticsEvent" e
    WHERE e."name" = 'slot_unavailable_tap'
      AND e."occurredAt" >= ${from}
      AND e."occurredAt" <= ${to}
      AND e."properties" ? 'date'
      AND e."properties" ? 'hour'
    GROUP BY dow, hour, sport
  `;

  // Sum the two sources cell-by-cell. Mon-first: shift dow so Mon=0.
  const map = new Map<string, DemandCell>();
  function add(rows: { dow: number; hour: number; sport: string; n: bigint }[]) {
    for (const r of rows) {
      // Postgres DOW: 0=Sun, 1=Mon ... 6=Sat. Shift to 0=Mon ... 6=Sun.
      const dayOfWeek = (r.dow + 6) % 7;
      const key = `${dayOfWeek}-${r.hour}-${r.sport}`;
      const existing = map.get(key);
      if (existing) {
        existing.intensity += Number(r.n);
      } else {
        map.set(key, { dayOfWeek, hour: r.hour, sport: r.sport, intensity: Number(r.n) });
      }
    }
  }
  add(waitlistRows);
  add(eventRows);

  return { dateFrom, dateTo, cells: [...map.values()] };
}

// ---------- Overview KPIs (used by the Overview tab) ----------

export interface OverviewKpis {
  /** distinct sessions (auth + anon) in the window */
  sessions: number;
  /** distinct authenticated users in the window */
  signedInUsers: number;
  /** count of booking_confirmed_view events */
  bookingsConfirmed: number;
  /** count of waitlist_joined events */
  waitlistJoined: number;
  /** count of slot_unavailable_tap events */
  unmetDemandTaps: number;
  /** waitlist_joined / slot_unavailable_tap, percent */
  waitlistConversionPct: number;
}

export async function getInsightsOverview(
  dateFrom: string,
  dateTo: string,
): Promise<OverviewKpis> {
  await requireAdmin("VIEW_ANALYTICS");
  const from = new Date(`${dateFrom}T00:00:00.000Z`);
  const to = new Date(`${dateTo}T23:59:59.999Z`);

  type Row = { name: string; sessions: bigint; users: bigint };
  const rows = await db.$queryRaw<Row[]>`
    SELECT
      e."name",
      COUNT(DISTINCT e."sessionId")::bigint AS sessions,
      COUNT(DISTINCT e."userId")::bigint   AS users
    FROM "AnalyticsEvent" e
    WHERE e."occurredAt" >= ${from}
      AND e."occurredAt" <= ${to}
      AND e."name" IN ('booking_confirmed_view', 'waitlist_joined', 'slot_unavailable_tap')
    GROUP BY e."name"
  `;
  const byName = new Map(rows.map((r) => [r.name, r]));

  type CountRow = { count: bigint };
  const sessionsRows = await db.$queryRaw<CountRow[]>`
    SELECT COUNT(DISTINCT "sessionId")::bigint AS count
    FROM "AnalyticsEvent"
    WHERE "occurredAt" >= ${from} AND "occurredAt" <= ${to}
  `;
  const usersRows = await db.$queryRaw<CountRow[]>`
    SELECT COUNT(DISTINCT "userId")::bigint AS count
    FROM "AnalyticsEvent"
    WHERE "occurredAt" >= ${from} AND "occurredAt" <= ${to}
      AND "userId" IS NOT NULL
  `;

  const taps = Number(byName.get("slot_unavailable_tap")?.sessions ?? 0);
  const joined = Number(byName.get("waitlist_joined")?.sessions ?? 0);

  return {
    sessions: Number(sessionsRows[0]?.count ?? 0),
    signedInUsers: Number(usersRows[0]?.count ?? 0),
    bookingsConfirmed: Number(byName.get("booking_confirmed_view")?.sessions ?? 0),
    waitlistJoined: joined,
    unmetDemandTaps: taps,
    waitlistConversionPct:
      taps > 0 ? Math.round((joined / taps) * 1000) / 10 : 0,
  };
}

/** Distinct event names that have fired in the last 30 days — used to
 *  populate the Events log filter dropdown. */
export async function listEventNames(): Promise<string[]> {
  await requireAdmin("VIEW_ANALYTICS");
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - 30);
  type Row = { name: string };
  const rows = await db.$queryRaw<Row[]>`
    SELECT DISTINCT "name"
    FROM "AnalyticsEvent"
    WHERE "occurredAt" >= ${cutoff}
    ORDER BY "name"
  `;
  return rows.map((r) => r.name);
}
