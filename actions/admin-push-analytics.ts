"use server";

import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { requireAdmin } from "@/lib/admin-auth";

// Read-only analytics — gated like the rest of the analytics section,
// not by MANAGE_PUSH (which gates *sending*). Lets analytics viewers see
// push metrics without the ability to broadcast.
const PERMISSION = "VIEW_ANALYTICS";

/**
 * Push analytics fetcher backing /admin/analytics/push.
 *
 * Two data sources:
 *  - PushDispatch (one row per send) → volume, delivery rate, breakdown
 *    by kind / source / day. Filtered by the date range + the kind /
 *    source / scope filters.
 *  - PushDevice / AdminPushDevice → the device fleet snapshot (current
 *    counts, platform split, reach, active/stale, app-version mix) plus
 *    new-registration counts within the range.
 *
 * Sends made before the PushDispatch log existed aren't captured, so the
 * send metrics build up from the log's first write onward; the fleet
 * metrics have full history.
 */

const ACTIVE_WINDOW_DAYS = 30;

export interface PushAnalyticsFilters {
  dateFrom: string; // YYYY-MM-DD inclusive
  dateTo: string; // YYYY-MM-DD inclusive
  kinds?: string[];
  sources?: string[]; // event | broadcast | test
  scope?: "customer" | "admin" | "all";
}

export interface PushAnalytics {
  range: { from: string; to: string };
  totals: {
    dispatches: number;
    attempted: number;
    succeeded: number;
    failed: number;
    cleanedUp: number;
    deliveryRate: number | null;
    broadcasts: number;
  };
  byKind: {
    kind: string;
    dispatches: number;
    attempted: number;
    succeeded: number;
    failed: number;
    deliveryRate: number | null;
  }[];
  bySource: {
    source: string;
    dispatches: number;
    attempted: number;
    succeeded: number;
  }[];
  timeSeries: {
    date: string;
    dispatches: number;
    attempted: number;
    succeeded: number;
    failed: number;
  }[];
  recent: {
    id: string;
    kind: string;
    scope: string;
    source: string;
    audience: string | null;
    title: string;
    body: string;
    attempted: number;
    succeeded: number;
    failed: number;
    cleanedUp: number;
    createdAt: string;
  }[];
  fleet: {
    totalDevices: number;
    iosDevices: number;
    androidDevices: number;
    adminDevices: number;
    reachUsers: number;
    activeDevices: number;
    staleDevices: number;
    byAppVersion: { version: string; count: number }[];
    registrations: { date: string; count: number }[];
  };
}

function rate(succeeded: number, attempted: number): number | null {
  return attempted > 0 ? Math.round((succeeded / attempted) * 100) : null;
}

function day(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function getPushAnalytics(
  filters: PushAnalyticsFilters,
): Promise<PushAnalytics> {
  // requireAdmin resolves the caller from the web cookie session OR the
  // mobile Bearer JWT, so mobile admin routes reuse this with no bypass.
  await requireAdmin(PERMISSION);

  const from = new Date(`${filters.dateFrom}T00:00:00.000Z`);
  const to = new Date(`${filters.dateTo}T23:59:59.999Z`);

  const where: Prisma.PushDispatchWhereInput = {
    createdAt: { gte: from, lte: to },
  };
  if (filters.kinds?.length) where.kind = { in: filters.kinds };
  if (filters.sources?.length) where.source = { in: filters.sources };
  if (filters.scope && filters.scope !== "all") where.scope = filters.scope;

  const activeSince = new Date(
    Date.now() - ACTIVE_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  );

  const [
    agg,
    broadcasts,
    byKindRaw,
    bySourceRaw,
    seriesRows,
    recentRows,
    totalDevices,
    iosDevices,
    androidDevices,
    adminDevices,
    reachRows,
    activeDevices,
    appVersionRaw,
    regRows,
  ] = await Promise.all([
    db.pushDispatch.aggregate({
      where,
      _sum: { attempted: true, succeeded: true, failed: true, cleanedUp: true },
      _count: true,
    }),
    db.pushDispatch.count({ where: { ...where, source: "broadcast" } }),
    db.pushDispatch.groupBy({
      by: ["kind"],
      where,
      _sum: { attempted: true, succeeded: true, failed: true },
      _count: true,
    }),
    db.pushDispatch.groupBy({
      by: ["source"],
      where,
      _sum: { attempted: true, succeeded: true },
      _count: true,
    }),
    db.pushDispatch.findMany({
      where,
      select: { createdAt: true, attempted: true, succeeded: true, failed: true },
      orderBy: { createdAt: "asc" },
    }),
    db.pushDispatch.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    db.pushDevice.count(),
    db.pushDevice.count({ where: { platform: "ios" } }),
    db.pushDevice.count({ where: { platform: "android" } }),
    db.adminPushDevice.count(),
    db.pushDevice.findMany({ select: { userId: true }, distinct: ["userId"] }),
    db.pushDevice.count({ where: { lastSeenAt: { gte: activeSince } } }),
    db.pushDevice.groupBy({ by: ["appVersion"], _count: true }),
    db.pushDevice.findMany({
      where: { createdAt: { gte: from, lte: to } },
      select: { createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const attempted = agg._sum.attempted ?? 0;
  const succeeded = agg._sum.succeeded ?? 0;
  const failed = agg._sum.failed ?? 0;

  const byKind = byKindRaw
    .map((g) => ({
      kind: g.kind,
      dispatches: g._count,
      attempted: g._sum.attempted ?? 0,
      succeeded: g._sum.succeeded ?? 0,
      failed: g._sum.failed ?? 0,
      deliveryRate: rate(g._sum.succeeded ?? 0, g._sum.attempted ?? 0),
    }))
    .sort((a, b) => b.attempted - a.attempted);

  const bySource = bySourceRaw
    .map((g) => ({
      source: g.source,
      dispatches: g._count,
      attempted: g._sum.attempted ?? 0,
      succeeded: g._sum.succeeded ?? 0,
    }))
    .sort((a, b) => b.dispatches - a.dispatches);

  const seriesMap = new Map<
    string,
    { dispatches: number; attempted: number; succeeded: number; failed: number }
  >();
  for (const r of seriesRows) {
    const k = day(r.createdAt);
    const cur =
      seriesMap.get(k) ?? { dispatches: 0, attempted: 0, succeeded: 0, failed: 0 };
    cur.dispatches += 1;
    cur.attempted += r.attempted;
    cur.succeeded += r.succeeded;
    cur.failed += r.failed;
    seriesMap.set(k, cur);
  }
  const timeSeries = [...seriesMap.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, v]) => ({ date, ...v }));

  const regMap = new Map<string, number>();
  for (const r of regRows) {
    const k = day(r.createdAt);
    regMap.set(k, (regMap.get(k) ?? 0) + 1);
  }
  const registrations = [...regMap.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, count]) => ({ date, count }));

  const byAppVersion = appVersionRaw
    .map((g) => ({ version: g.appVersion ?? "unknown", count: g._count }))
    .sort((a, b) => b.count - a.count);

  return {
    range: { from: filters.dateFrom, to: filters.dateTo },
    totals: {
      dispatches: agg._count,
      attempted,
      succeeded,
      failed,
      cleanedUp: agg._sum.cleanedUp ?? 0,
      deliveryRate: rate(succeeded, attempted),
      broadcasts,
    },
    byKind,
    bySource,
    timeSeries,
    recent: recentRows.map((r) => ({
      id: r.id,
      kind: r.kind,
      scope: r.scope,
      source: r.source,
      audience: r.audience,
      title: r.title,
      body: r.body,
      attempted: r.attempted,
      succeeded: r.succeeded,
      failed: r.failed,
      cleanedUp: r.cleanedUp,
      createdAt: r.createdAt.toISOString(),
    })),
    fleet: {
      totalDevices,
      iosDevices,
      androidDevices,
      adminDevices,
      reachUsers: reachRows.length,
      activeDevices,
      staleDevices: Math.max(0, totalDevices - activeDevices),
      byAppVersion,
      registrations,
    },
  };
}

/** Distinct kinds that have ever been dispatched — populates the filter. */
export async function getDispatchedKinds(): Promise<string[]> {
  await requireAdmin(PERMISSION);
  const rows = await db.pushDispatch.groupBy({ by: ["kind"] });
  return rows.map((r) => r.kind).sort();
}
