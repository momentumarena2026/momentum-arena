import { NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * Daily cron — purges aged raw analytics rows:
 *
 *   - AnalyticsEvent  → ANALYTICS_RAW_RETENTION_DAYS (default 90)
 *   - ServerActionLog → SERVER_LOG_RETENTION_DAYS   (default 90)
 *   - DailyPushSend   → DAILY_PUSH_RETENTION_DAYS   (default 90)
 *
 * AnalyticsSession + MetricRollup + UserCohort are kept indefinitely
 * (rollups are tiny; sessions are useful for retention queries;
 * cohorts are immutable).
 *
 * DailyPushSend is bounded rather than kept: the engine only ever reads
 * the trailing seven days (the weekly cap) plus today (idempotency), so
 * everything older is history the admin dashboard summarises and nothing
 * depends on. The floor below is deliberately far above what the engine
 * needs — a retention window set to 3 days would silently uncap the
 * whole module, which is a worse failure than a large table.
 *
 * Auth: Bearer CRON_SECRET (same convention as the other crons).
 */

const DEFAULT_RETENTION_DAYS = 90;

function retentionDays(envKey: string): number {
  const raw = process.env[envKey];
  if (!raw) return DEFAULT_RETENTION_DAYS;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_RETENTION_DAYS;
}

function cutoffDate(days: number): Date {
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - days);
  return cutoff;
}

/** Chunked delete — bounded memory, same ctid/limit pattern as before. */
async function purgeTableByOccurredAt(
  table: "AnalyticsEvent" | "ServerActionLog",
  cutoff: Date,
): Promise<number> {
  let totalDeleted = 0;
  for (let i = 0; i < 200; i++) {
    const result =
      table === "AnalyticsEvent"
        ? await db.$executeRaw`
            DELETE FROM "AnalyticsEvent"
            WHERE ctid IN (
              SELECT ctid FROM "AnalyticsEvent"
              WHERE "occurredAt" < ${cutoff}
              LIMIT 5000
            )
          `
        : await db.$executeRaw`
            DELETE FROM "ServerActionLog"
            WHERE ctid IN (
              SELECT ctid FROM "ServerActionLog"
              WHERE "occurredAt" < ${cutoff}
              LIMIT 5000
            )
          `;
    totalDeleted += result;
    if (result < 5000) break;
  }
  return totalDeleted;
}

async function handle(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const analyticsDays = retentionDays("ANALYTICS_RAW_RETENTION_DAYS");
  const serverLogDays = retentionDays("SERVER_LOG_RETENTION_DAYS");
  // Floored at 30, whatever the env says. The daily push reads the
  // trailing 7 days to enforce its per-person weekly cap, so a retention
  // window shorter than that would not save space — it would delete the
  // evidence the cap is counted from and quietly let the module send
  // without limit. Never let an operations knob disable a guard.
  const dailyPushDays = Math.max(30, retentionDays("DAILY_PUSH_RETENTION_DAYS"));

  const analyticsCutoff = cutoffDate(analyticsDays);
  const serverLogCutoff = cutoffDate(serverLogDays);
  const dailyPushCutoff = cutoffDate(dailyPushDays);

  const [analyticsDeleted, serverLogsDeleted, dailyPushDeleted] = await Promise.all([
    purgeTableByOccurredAt("AnalyticsEvent", analyticsCutoff),
    purgeTableByOccurredAt("ServerActionLog", serverLogCutoff),
    db.dailyPushSend
      .deleteMany({ where: { createdAt: { lt: dailyPushCutoff } } })
      .then((r) => r.count)
      // A missing table during a pre-migration deploy window must not
      // fail the whole retention sweep, which has two other jobs.
      .catch(() => 0),
  ]);

  return NextResponse.json({
    analytics: {
      retentionDays: analyticsDays,
      cutoff: analyticsCutoff.toISOString(),
      deleted: analyticsDeleted,
    },
    serverLogs: {
      retentionDays: serverLogDays,
      cutoff: serverLogCutoff.toISOString(),
      deleted: serverLogsDeleted,
    },
    dailyPush: {
      retentionDays: dailyPushDays,
      cutoff: dailyPushCutoff.toISOString(),
      deleted: dailyPushDeleted,
    },
    timestamp: new Date().toISOString(),
  });
}

export const GET = handle;
export const POST = handle;
