import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";

/**
 * Hourly rollup writer.
 *
 * Produces three families of MetricRollup rows for each fully-elapsed
 * hour bucket:
 *
 *   1. event.<name>             — count of every event by (sport, platform).
 *                                 Drives funnel charts + the dashboard's
 *                                 per-event time series.
 *   2. kpi.distinct_users       — distinct authenticated users per hour
 *                                 (uniqueCount).
 *   3. kpi.distinct_sessions    — distinct sessions per hour (auth + anon).
 *
 * Plus one daily-aligned row family for daily KPIs that are only useful
 * at day grain (DAU, etc.). The cron itself is invoked hourly; on the
 * top-of-day call it also writes the day rollup for the previous day.
 *
 * Idempotent: each (bucketStart, bucketKind, metric, dimensionsKey)
 * is unique. Re-running the cron for the same hour upserts identical
 * rows — safe to retry.
 */

// We always slice by these two dimensions. Empty values get the literal
// "_" so the dimensionsKey stays stable even when the property is null.
const SPORT_DIM_KEY = "sport";
const PLATFORM_DIM_KEY = "platform";

interface RollupOptions {
  /** Process this many recent hours. Defaults to 2 — covers the just-closed
   *  hour plus the one before it, in case a previous run was missed. */
  hoursBack?: number;
}

export interface RollupResult {
  hoursProcessed: number;
  rowsWritten: number;
  daysProcessed: number;
  startedAt: string;
  finishedAt: string;
}

/**
 * Stable, sorted JSON key for the (dimensions) JSON blob — keeps the
 * UNIQUE index on MetricRollup deterministic regardless of property
 * insertion order.
 */
function dimensionsKey(dims: Record<string, string>): string {
  const sortedEntries = Object.entries(dims).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return sortedEntries.map(([k, v]) => `${k}=${v}`).join("|");
}

/** Snap a timestamp to the start of its hour (UTC). */
function snapHour(t: Date): Date {
  const d = new Date(t);
  d.setUTCMinutes(0, 0, 0);
  return d;
}

export async function rollupMetrics(opts: RollupOptions = {}): Promise<RollupResult> {
  const startedAt = new Date();
  const hoursBack = Math.max(1, Math.min(opts.hoursBack ?? 2, 24));
  let rowsWritten = 0;

  // The "current" hour is in progress — skip it. Roll up the
  // last fully-elapsed hours.
  const currentHourStart = snapHour(new Date());
  const buckets: Date[] = [];
  for (let i = 1; i <= hoursBack; i++) {
    const b = new Date(currentHourStart);
    b.setUTCHours(b.getUTCHours() - i);
    buckets.push(b);
  }

  for (const bucketStart of buckets) {
    const bucketEnd = new Date(bucketStart);
    bucketEnd.setUTCHours(bucketEnd.getUTCHours() + 1);
    rowsWritten += await rollupHourBucket(bucketStart, bucketEnd);
  }

  // Top-of-hour 0 → also roll up yesterday's daily metrics.
  let daysProcessed = 0;
  if (currentHourStart.getUTCHours() === 0) {
    const yesterday = new Date(currentHourStart);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    rowsWritten += await rollupDayBucket(yesterday);
    daysProcessed++;
  }

  return {
    hoursProcessed: buckets.length,
    rowsWritten,
    daysProcessed,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
  };
}

// ---------- per-bucket workers ----------

async function rollupHourBucket(
  bucketStart: Date,
  bucketEnd: Date,
): Promise<number> {
  // 1. event.<name> counts grouped by (name, sport, platform).
  //    `properties->>'sport'` reads the sport string out of the
  //    JSONB blob — null/missing collapses to "_" via COALESCE.
  type EventGroup = {
    name: string;
    sport: string;
    platform: string;
    count: bigint;
    unique_users: bigint;
  };
  const eventRows = await db.$queryRaw<EventGroup[]>`
    SELECT
      e."name",
      COALESCE(e."properties"->>'sport', '_') AS sport,
      e."platform",
      COUNT(*)::bigint AS count,
      COUNT(DISTINCT e."userId")::bigint AS unique_users
    FROM "AnalyticsEvent" e
    WHERE e."occurredAt" >= ${bucketStart}
      AND e."occurredAt" <  ${bucketEnd}
    GROUP BY e."name", sport, e."platform"
  `;

  const inserts: Prisma.MetricRollupCreateManyInput[] = [];
  for (const r of eventRows) {
    const dims = {
      [SPORT_DIM_KEY]: r.sport,
      [PLATFORM_DIM_KEY]: r.platform,
    };
    inserts.push({
      bucketStart,
      bucketKind: "hour",
      metric: `event.${r.name}`,
      dimensions: dims as Prisma.InputJsonValue,
      dimensionsKey: dimensionsKey(dims),
      count: Number(r.count),
      uniqueCount: Number(r.unique_users),
    });
  }

  // 2. kpi.distinct_users (no sport slice — global per-hour count).
  type CountRow = { count: bigint };
  const distinctUsersRows = await db.$queryRaw<CountRow[]>`
    SELECT COUNT(DISTINCT "userId")::bigint AS count
    FROM "AnalyticsEvent"
    WHERE "occurredAt" >= ${bucketStart}
      AND "occurredAt" <  ${bucketEnd}
      AND "userId" IS NOT NULL
  `;
  if (distinctUsersRows[0] && Number(distinctUsersRows[0].count) > 0) {
    const dims = {};
    inserts.push({
      bucketStart,
      bucketKind: "hour",
      metric: "kpi.distinct_users",
      dimensions: dims,
      dimensionsKey: dimensionsKey(dims),
      count: Number(distinctUsersRows[0].count),
    });
  }

  // 3. kpi.distinct_sessions (auth + anon).
  const distinctSessionsRows = await db.$queryRaw<CountRow[]>`
    SELECT COUNT(DISTINCT "sessionId")::bigint AS count
    FROM "AnalyticsEvent"
    WHERE "occurredAt" >= ${bucketStart}
      AND "occurredAt" <  ${bucketEnd}
  `;
  if (distinctSessionsRows[0] && Number(distinctSessionsRows[0].count) > 0) {
    const dims = {};
    inserts.push({
      bucketStart,
      bucketKind: "hour",
      metric: "kpi.distinct_sessions",
      dimensions: dims,
      dimensionsKey: dimensionsKey(dims),
      count: Number(distinctSessionsRows[0].count),
    });
  }

  if (inserts.length === 0) return 0;

  // Upsert pattern via raw SQL — Prisma's createMany doesn't support
  // ON CONFLICT. The unique index is (bucketStart, bucketKind,
  // metric, dimensionsKey) so the same hour re-running just refreshes
  // counts. Cheap because we only re-write the rows for this hour.
  await db.$transaction([
    // Delete then insert is cleaner than per-row upsert and runs in
    // a single transaction so the dashboard never sees half-replaced
    // data. Hour buckets are tiny (a few hundred rows max).
    db.metricRollup.deleteMany({
      where: {
        bucketStart,
        bucketKind: "hour",
        metric: { in: inserts.map((i) => i.metric) },
      },
    }),
    db.metricRollup.createMany({ data: inserts }),
  ]);

  return inserts.length;
}

async function rollupDayBucket(dayStart: Date): Promise<number> {
  const dayEnd = new Date(dayStart);
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

  type DayCountRow = { count: bigint };
  const dau = await db.$queryRaw<DayCountRow[]>`
    SELECT COUNT(DISTINCT "userId")::bigint AS count
    FROM "AnalyticsEvent"
    WHERE "occurredAt" >= ${dayStart}
      AND "occurredAt" <  ${dayEnd}
      AND "userId" IS NOT NULL
  `;
  const dailySessions = await db.$queryRaw<DayCountRow[]>`
    SELECT COUNT(DISTINCT "sessionId")::bigint AS count
    FROM "AnalyticsEvent"
    WHERE "occurredAt" >= ${dayStart}
      AND "occurredAt" <  ${dayEnd}
  `;
  const newSessions = await db.$queryRaw<DayCountRow[]>`
    SELECT COUNT(*)::bigint AS count
    FROM "AnalyticsSession"
    WHERE "startedAt" >= ${dayStart}
      AND "startedAt" <  ${dayEnd}
  `;

  const inserts: Prisma.MetricRollupCreateManyInput[] = [];
  const dims = {};
  if (dau[0] && Number(dau[0].count) > 0) {
    inserts.push({
      bucketStart: dayStart,
      bucketKind: "day",
      metric: "kpi.dau",
      dimensions: dims,
      dimensionsKey: dimensionsKey(dims),
      count: Number(dau[0].count),
    });
  }
  if (dailySessions[0] && Number(dailySessions[0].count) > 0) {
    inserts.push({
      bucketStart: dayStart,
      bucketKind: "day",
      metric: "kpi.daily_sessions",
      dimensions: dims,
      dimensionsKey: dimensionsKey(dims),
      count: Number(dailySessions[0].count),
    });
  }
  if (newSessions[0] && Number(newSessions[0].count) > 0) {
    inserts.push({
      bucketStart: dayStart,
      bucketKind: "day",
      metric: "kpi.new_sessions",
      dimensions: dims,
      dimensionsKey: dimensionsKey(dims),
      count: Number(newSessions[0].count),
    });
  }

  if (inserts.length === 0) return 0;
  await db.$transaction([
    db.metricRollup.deleteMany({
      where: {
        bucketStart: dayStart,
        bucketKind: "day",
        metric: { in: inserts.map((i) => i.metric) },
      },
    }),
    db.metricRollup.createMany({ data: inserts }),
  ]);
  return inserts.length;
}
