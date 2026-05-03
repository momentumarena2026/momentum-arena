import { NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * Daily cron — purges raw AnalyticsEvent rows older than the
 * configured retention window. AnalyticsSession + MetricRollup +
 * UserCohort are kept indefinitely (rollups are tiny; sessions are
 * useful for retention queries; cohorts are immutable).
 *
 * Default 90 days. Override via ANALYTICS_RAW_RETENTION_DAYS.
 *
 * Auth: Bearer CRON_SECRET (same convention as the other crons).
 */

const DEFAULT_RETENTION_DAYS = 90;

async function handle(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const days = (() => {
    const raw = process.env.ANALYTICS_RAW_RETENTION_DAYS;
    if (!raw) return DEFAULT_RETENTION_DAYS;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_RETENTION_DAYS;
  })();

  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - days);

  // Delete in chunks via raw SQL — Prisma's deleteMany on a large
  // table can blow up memory because it returns the count of every
  // deleted row. Raw SQL streams server-side and is bounded by the
  // ctid/limit pattern.
  let totalDeleted = 0;
  // Loop guard — bail after this many iterations to avoid an
  // unbounded run if something's wrong.
  for (let i = 0; i < 200; i++) {
    const result = await db.$executeRaw`
      DELETE FROM "AnalyticsEvent"
      WHERE ctid IN (
        SELECT ctid FROM "AnalyticsEvent"
        WHERE "occurredAt" < ${cutoff}
        LIMIT 5000
      )
    `;
    totalDeleted += result;
    if (result < 5000) break;
  }

  return NextResponse.json({
    retentionDays: days,
    cutoff: cutoff.toISOString(),
    deleted: totalDeleted,
    timestamp: new Date().toISOString(),
  });
}

export const GET = handle;
export const POST = handle;
