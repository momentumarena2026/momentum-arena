import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { db } from "@/lib/db";
import { adminAuth } from "@/lib/admin-auth-session";
import { hasPermission } from "@/lib/permissions";
import {
  buildRewardTxnWhere,
  REWARD_TXN_TYPES_ALL,
  resolveActorAdminIds,
  type RewardTxnTypeFilter,
} from "@/actions/admin-rewards";
import { buildLedgerWorkbook } from "@/lib/reports/workers/rewards";

/**
 * GET /api/admin/rewards/transactions/export
 *
 * Streams the filtered ledger as an XLSX file. Same query params as
 * the live ledger panel (see panels/transactions-panel.tsx).
 *
 * Two sheets:
 *   - "Transactions"  — one row per RewardTransaction with full detail
 *   - "Summary"       — credit/debit totals, by-type breakdown, by-month
 *                       roll-up so the file is self-contained for
 *                       monthly reconciliation against Razorpay /
 *                       sales reports.
 */
export async function GET(request: NextRequest) {
  const session = await adminAuth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const u = session.user as unknown as { id: string; permissions?: string[] };
  if (!hasPermission(u.permissions ?? [], "MANAGE_REWARDS")) {
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

  // Resolve actor query → adminUser IDs (same path the live ledger
  // takes) so the filter matches exactly what the admin sees on screen.
  const actorAdminIds = await resolveActorAdminIds(actorQuery);
  if (actorAdminIds && actorAdminIds.length === 0) {
    // Empty match → empty workbook, but still return a valid file so
    // the download click doesn't 404.
    return await buildEmptyResponse();
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

  // Streaming-style read: hard cap at 50_000 rows. The XLSX itself
  // would be unwieldy past that and the reports queue (REWARD_TXN_LEDGER_*)
  // is the right tool for full-history exports.
  const HARD_CAP = 50_000;
  const rows = await db.rewardTransaction.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: HARD_CAP,
    include: {
      user: { select: { id: true, name: true, email: true, phone: true } },
    },
  });

  // Resolve admin actor usernames in one batch.
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

  // Build a short suffix for the Summary sheet ("2026-05" if both
  // dates fall in the same month, "filtered" otherwise). The
  // workbook builder is shared with the monthly report worker.
  const suffix = (() => {
    if (fromDate && toDate && fromDate.slice(0, 7) === toDate.slice(0, 7)) {
      return fromDate.slice(0, 7);
    }
    if (fromDate || toDate) return `${fromDate ?? "—"}…${toDate ?? "—"}`;
    return "all-time";
  })();

  const wb = buildLedgerWorkbook(
    rows.map((r) => ({
      id: r.id,
      type: r.type as RewardTxnTypeFilter,
      points: r.points,
      pointsValuePaise: r.pointsValuePaise,
      bookingId: r.bookingId,
      cafeOrderId: r.cafeOrderId,
      reason: r.reason,
      createdAt: r.createdAt,
      user: r.user,
      actor: r.actorAdminId
        ? (actorMap.get(r.actorAdminId) ?? { username: "unknown", email: "" })
        : null,
    })),
    suffix,
  );

  const ab = await wb.xlsx.writeBuffer();
  // Convert ArrayBufferLike → ArrayBuffer-backed Uint8Array (NextResponse.body wants that flavor)
  const fresh = new ArrayBuffer(ab.byteLength);
  new Uint8Array(fresh).set(new Uint8Array(ab));

  const today = new Date();
  const stamp = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const filename = `momentum-arena_${stamp}_rewards-ledger.xlsx`;

  return new NextResponse(fresh, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

async function buildEmptyResponse() {
  const wb = new ExcelJS.Workbook();
  const s = wb.addWorksheet("Transactions");
  s.addRow(["No transactions match the current filters."]);
  const ab = await wb.xlsx.writeBuffer();
  const fresh = new ArrayBuffer(ab.byteLength);
  new Uint8Array(fresh).set(new Uint8Array(ab));
  return new NextResponse(fresh, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="rewards-ledger-empty.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
