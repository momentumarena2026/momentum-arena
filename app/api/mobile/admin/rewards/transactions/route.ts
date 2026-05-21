import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getMobileAdmin } from "@/lib/mobile-auth";
import { hasPermission } from "@/lib/permissions";
import {
  buildRewardTxnWhere,
  REWARD_TXN_TYPES_ALL,
  resolveActorAdminIds,
  type RewardTxnTypeFilter,
} from "@/actions/admin-rewards";

/**
 * Mobile admin endpoint for the reward transactions ledger.
 *
 * Query params mirror the web ledger panel — same shape so the mobile
 * screen and the web tab read from identical filter semantics.
 *
 *   q       free-text user search (name / email / phone)
 *   from    yyyy-mm-dd (IST midnight)
 *   to      yyyy-mm-dd (inclusive of the day)
 *   types   comma-separated RewardTxnType list
 *   dir     credit | debit (default: both)
 *   src     bookingId or cafeOrderId
 *   actor   admin username/email substring
 *   page    0-indexed
 *   pageSize default 25 (smaller than web's 50 — mobile list)
 */
export async function GET(request: NextRequest) {
  const admin = await getMobileAdmin(request);
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (
    admin.role !== "SUPERADMIN" &&
    !hasPermission(admin.permissions ?? [], "MANAGE_REWARDS")
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const sp = request.nextUrl.searchParams;
  const q = sp.get("q") ?? undefined;
  const fromDate = sp.get("from") ?? undefined;
  const toDate = sp.get("to") ?? undefined;
  const typesParam = (sp.get("types") ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter((t): t is RewardTxnTypeFilter =>
      (REWARD_TXN_TYPES_ALL as readonly string[]).includes(t),
    );
  const dirRaw = sp.get("dir") ?? "all";
  const direction: "credit" | "debit" | "all" =
    dirRaw === "credit" || dirRaw === "debit" ? dirRaw : "all";
  const sourceId = sp.get("src") ?? undefined;
  const actorQuery = sp.get("actor") ?? undefined;
  const page = Math.max(0, parseInt(sp.get("page") ?? "0", 10) || 0);
  const pageSize = Math.min(
    Math.max(parseInt(sp.get("pageSize") ?? "25", 10) || 25, 1),
    100,
  );

  // Resolve actor query → admin IDs (same as web).
  const actorAdminIds = await resolveActorAdminIds(actorQuery);
  if (actorAdminIds && actorAdminIds.length === 0) {
    return NextResponse.json(emptyResponse(page, pageSize));
  }

  const where = buildRewardTxnWhere({
    query: q,
    fromDate,
    toDate,
    types: typesParam.length > 0 ? typesParam : undefined,
    direction: direction === "all" ? undefined : direction,
    sourceId,
    actorAdminIds: actorAdminIds ?? undefined,
  });

  const AGG_CAP = 10_000;
  const [rows, total, aggregateRows] = await Promise.all([
    db.rewardTransaction.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: page * pageSize,
      take: pageSize,
      include: {
        user: { select: { id: true, name: true, email: true, phone: true } },
      },
    }),
    db.rewardTransaction.count({ where }),
    db.rewardTransaction.findMany({
      where,
      take: AGG_CAP,
      select: { points: true, pointsValuePaise: true },
    }),
  ]);

  const actorIds = Array.from(
    new Set(rows.map((r) => r.actorAdminId).filter((x): x is string => !!x)),
  );
  const actorMap = new Map<string, { username: string; email: string }>();
  if (actorIds.length > 0) {
    const actors = await db.adminUser.findMany({
      where: { id: { in: actorIds } },
      select: { id: true, username: true, email: true },
    });
    for (const a of actors) actorMap.set(a.id, a);
  }

  let creditPoints = 0;
  let debitPoints = 0;
  let creditCount = 0;
  let debitCount = 0;
  let creditValuePaise = 0;
  let debitValuePaise = 0;
  for (const r of aggregateRows) {
    if (r.points > 0) {
      creditPoints += r.points;
      creditValuePaise += r.pointsValuePaise;
      creditCount++;
    } else if (r.points < 0) {
      debitPoints += Math.abs(r.points);
      debitValuePaise += r.pointsValuePaise;
      debitCount++;
    }
  }

  return NextResponse.json({
    rows: rows.map((r) => ({
      id: r.id,
      type: r.type,
      points: r.points,
      pointsValuePaise: r.pointsValuePaise,
      bookingId: r.bookingId,
      cafeOrderId: r.cafeOrderId,
      reason: r.reason,
      createdAt: r.createdAt.toISOString(),
      user: r.user,
      actor: r.actorAdminId
        ? (actorMap.get(r.actorAdminId) ?? {
            username: "unknown",
            email: "",
          })
        : null,
    })),
    total,
    page,
    pageSize,
    aggregates: {
      creditPoints,
      debitPoints,
      netPoints: creditPoints - debitPoints,
      creditCount,
      debitCount,
      creditValuePaise,
      debitValuePaise,
    },
    aggregateTruncated: total > AGG_CAP,
  });
}

function emptyResponse(page: number, pageSize: number) {
  return {
    rows: [],
    total: 0,
    page,
    pageSize,
    aggregates: {
      creditPoints: 0,
      debitPoints: 0,
      netPoints: 0,
      creditCount: 0,
      debitCount: 0,
      creditValuePaise: 0,
      debitValuePaise: 0,
    },
    aggregateTruncated: false,
  };
}
