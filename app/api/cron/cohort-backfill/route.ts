import { NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * Daily cron — assigns a UserCohort row to any User that doesn't
 * already have one.
 *
 * Live signups get assigned lazily inside /api/events the moment
 * they fire their first authenticated event. This cron exists to
 * (a) backfill the User base that existed BEFORE analytics shipped,
 * and (b) catch any user who somehow signed up without firing an
 * auth event (admin-created users, OAuth corner cases, etc.).
 *
 * Cohort is frozen to the User.createdAt timestamp's calendar week
 * + month, IST-aligned. Idempotent — UserCohort.userId is the PK so
 * re-runs no-op.
 *
 * Auth: Bearer CRON_SECRET (same convention as the other crons).
 */

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

async function handle(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Find users without a cohort row. Limit per run so a one-time
  // backfill doesn't time out — cron will catch the rest tomorrow.
  const PAGE = 5000;
  let totalAssigned = 0;
  for (let i = 0; i < 50; i++) {
    const users = await db.user.findMany({
      where: { cohort: null },
      select: { id: true, createdAt: true },
      take: PAGE,
    });
    if (users.length === 0) break;

    const inserts = users.map((u) => {
      const { week, month } = istWeekAndMonth(u.createdAt);
      return {
        userId: u.id,
        cohortWeek: week,
        cohortMonth: month,
        firstSeenAt: u.createdAt,
      };
    });

    // skipDuplicates handles the race where /api/events assigned the
    // same user concurrently between the SELECT and the INSERT.
    const result = await db.userCohort.createMany({
      data: inserts,
      skipDuplicates: true,
    });
    totalAssigned += result.count;
    if (users.length < PAGE) break;
  }

  return NextResponse.json({
    assigned: totalAssigned,
    timestamp: new Date().toISOString(),
  });
}

function istWeekAndMonth(t: Date): { week: Date; month: Date } {
  const istNow = new Date(t.getTime() + IST_OFFSET_MS);
  // ISO week, Monday-aligned, in IST.
  const istDow = istNow.getUTCDay(); // 0=Sun ... 6=Sat
  const daysSinceMon = (istDow + 6) % 7;
  const week = new Date(
    Date.UTC(
      istNow.getUTCFullYear(),
      istNow.getUTCMonth(),
      istNow.getUTCDate() - daysSinceMon,
      0,
      0,
      0,
      0,
    ) - IST_OFFSET_MS,
  );
  const month = new Date(
    Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), 1, 0, 0, 0, 0) -
      IST_OFFSET_MS,
  );
  return { week, month };
}

export const GET = handle;
export const POST = handle;
