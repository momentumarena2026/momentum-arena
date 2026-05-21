import ExcelJS from "exceljs";
import { db } from "@/lib/db";
import { REWARD_TXN_TYPES_ALL, type RewardTxnTypeFilter } from "@/lib/rewards/admin-ledger";

/**
 * Three rewards reports — all share the same workbook scaffolding
 * (header style, IST date format, trailing TOTAL row, autofilter).
 *
 *   1. REWARD_LIABILITY_MONTHLY
 *      - Sheet "By user":    per-user balance + month-bucketed counters
 *      - Sheet "Summary":    aggregate liability + 30d-style activity
 *
 *   2. REWARD_LIABILITY_LIFETIME — same shape but no date filter on
 *      the activity columns. Year/month on the Report row are
 *      request-timestamp metadata only.
 *
 *   3. REWARD_ALERTS_MONTHLY
 *      - Sheet "Alerts":     one row per RewardAlert in the month
 *      - Sheet "By kind":    aggregate counts + open/resolved split
 */

const HEADER_FILL: ExcelJS.FillPattern = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF10B981" }, // emerald-500
};
const HEADER_FONT: Partial<ExcelJS.Font> = {
  bold: true,
  color: { argb: "FFFFFFFF" },
};
const TOTAL_ROW_FILL: ExcelJS.FillPattern = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF1F2937" },
};
const TOTAL_ROW_FONT: Partial<ExcelJS.Font> = {
  bold: true,
  color: { argb: "FFFFFFFF" },
};

// ── 1. Monthly liability ─────────────────────────────────────────

export async function generateRewardLiabilityMonthlyReport(input: {
  year: number;
  month: number;
}): Promise<{ filename: string; bytes: Buffer }> {
  const monthStart = new Date(Date.UTC(input.year, input.month - 1, 1));
  const monthEnd = new Date(Date.UTC(input.year, input.month, 1));
  const yyyy = String(input.year).padStart(4, "0");
  const mm = String(input.month).padStart(2, "0");
  return buildLiabilityReport({
    activityRange: { gte: monthStart, lt: monthEnd },
    titleSuffix: `${yyyy}-${mm}`,
    filename: `momentum-arena_${yyyy}-${mm}_rewards-liability.xlsx`,
  });
}

// ── 2. Lifetime liability ────────────────────────────────────────

export async function generateRewardLiabilityLifetimeReport(_input: {
  year: number;
  month: number;
}): Promise<{ filename: string; bytes: Buffer }> {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  return buildLiabilityReport({
    activityRange: null,
    titleSuffix: "lifetime",
    filename: `momentum-arena_${yyyy}-${mm}-${dd}_rewards-liability-lifetime.xlsx`,
  });
}

interface LiabilityOpts {
  activityRange: { gte: Date; lt: Date } | null;
  titleSuffix: string;
  filename: string;
}

async function buildLiabilityReport(
  opts: LiabilityOpts,
): Promise<{ filename: string; bytes: Buffer }> {
  // Pull every user with a non-zero balance or any historical txn so
  // we don't miss zero-balance users who once earned (their lifetime
  // counters are still meaningful for the audit). For larger tenants
  // we'd push this into a SQL view; at our scale a single findMany is fine.
  const balances = await db.rewardBalance.findMany({
    include: {
      user: {
        select: { id: true, name: true, email: true, phone: true },
      },
    },
    orderBy: { pointsAvailable: "desc" },
  });

  // Per-user activity buckets (earn / redeem / expire) over the
  // selected window. Lifetime version skips the where clause.
  const txnWhere = opts.activityRange
    ? { createdAt: opts.activityRange }
    : {};
  const txns = await db.rewardTransaction.findMany({
    where: txnWhere,
    select: { userId: true, type: true, points: true },
  });

  interface Bucket {
    earn: number;
    redeem: number;
    expire: number;
    revoke: number;
  }
  const byUser = new Map<string, Bucket>();
  for (const t of txns) {
    const b = byUser.get(t.userId) ?? {
      earn: 0,
      redeem: 0,
      expire: 0,
      revoke: 0,
    };
    if (t.type.startsWith("EARNED_") || t.type === "ADJUSTMENT_REFUND") {
      b.earn += t.points;
    } else if (t.type === "REDEEMED_BOOKING" || t.type === "REDEEMED_CAFE") {
      b.redeem += Math.abs(t.points);
    } else if (t.type === "EXPIRED") {
      b.expire += Math.abs(t.points);
    } else if (t.type === "REVOKED" || t.type === "ADJUSTMENT_DEBIT") {
      b.revoke += Math.abs(t.points);
    }
    byUser.set(t.userId, b);
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = "Momentum Arena admin";
  wb.created = new Date();

  // 1. By user sheet
  const byUserSheet = wb.addWorksheet("By user");
  byUserSheet.columns = [
    { header: "Name", key: "name", width: 22 },
    { header: "Phone", key: "phone", width: 14 },
    { header: "Email", key: "email", width: 26 },
    { header: "Available pts", key: "available", width: 14 },
    { header: "Lifetime earned", key: "ltEarn", width: 16 },
    { header: "Lifetime redeemed", key: "ltRedeem", width: 18 },
    { header: "Lifetime expired", key: "ltExpire", width: 16 },
    { header: "Lifetime revoked", key: "ltRevoke", width: 16 },
    { header: `Earn (${opts.titleSuffix})`, key: "earn", width: 16 },
    { header: `Redeem (${opts.titleSuffix})`, key: "redeem", width: 16 },
    { header: `Expire (${opts.titleSuffix})`, key: "expire", width: 16 },
    { header: "Last txn", key: "lastTxn", width: 14 },
  ];
  styleHeaderRow(byUserSheet);

  let totalAvailable = 0;
  let totalLtEarn = 0;
  let totalLtRedeem = 0;
  let totalEarn = 0;
  let totalRedeem = 0;
  let totalExpire = 0;
  for (const b of balances) {
    const win = byUser.get(b.userId);
    totalAvailable += b.pointsAvailable;
    totalLtEarn += b.pointsLifetimeEarned;
    totalLtRedeem += b.pointsLifetimeRedeemed;
    totalEarn += win?.earn ?? 0;
    totalRedeem += win?.redeem ?? 0;
    totalExpire += win?.expire ?? 0;
    byUserSheet.addRow({
      name: b.user.name ?? "",
      phone: b.user.phone ?? "",
      email: b.user.email ?? "",
      available: b.pointsAvailable,
      ltEarn: b.pointsLifetimeEarned,
      ltRedeem: b.pointsLifetimeRedeemed,
      ltExpire: b.pointsLifetimeExpired,
      ltRevoke: b.pointsLifetimeRevoked,
      earn: win?.earn ?? 0,
      redeem: win?.redeem ?? 0,
      expire: win?.expire ?? 0,
      lastTxn: b.lastTransactionAt ? fmtIstDate(b.lastTransactionAt) : "",
    });
  }
  if (balances.length > 0) {
    const totalRow = byUserSheet.addRow({
      name: "TOTAL",
      available: totalAvailable,
      ltEarn: totalLtEarn,
      ltRedeem: totalLtRedeem,
      earn: totalEarn,
      redeem: totalRedeem,
      expire: totalExpire,
    });
    totalRow.font = TOTAL_ROW_FONT;
    totalRow.fill = TOTAL_ROW_FILL;
  }
  byUserSheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: byUserSheet.columns.length },
  };

  // 2. Summary sheet
  const cfg = await db.rewardConfig.findUnique({ where: { id: "singleton" } });
  const pointValuePaise = cfg?.pointValuePaise ?? 100;
  const liabilityPaise = totalAvailable * pointValuePaise;

  const summary = wb.addWorksheet("Summary");
  summary.columns = [
    { header: "Metric", key: "metric", width: 32 },
    { header: "Value", key: "value", width: 24 },
  ];
  styleHeaderRow(summary);

  summary.addRow({
    metric: "Total users with balance",
    value: balances.filter((b) => b.pointsAvailable > 0).length,
  });
  summary.addRow({
    metric: "Total points outstanding",
    value: totalAvailable,
  });
  summary.addRow({
    metric: "Liability at current rate (₹)",
    value: Math.round(liabilityPaise / 100),
  });
  summary.addRow({
    metric: "Total lifetime earned",
    value: totalLtEarn,
  });
  summary.addRow({
    metric: "Total lifetime redeemed",
    value: totalLtRedeem,
  });
  summary.addRow({
    metric: `Earn (${opts.titleSuffix})`,
    value: totalEarn,
  });
  summary.addRow({
    metric: `Redeem (${opts.titleSuffix})`,
    value: totalRedeem,
  });
  summary.addRow({
    metric: `Expire (${opts.titleSuffix})`,
    value: totalExpire,
  });
  summary.addRow({
    metric: "Earn rate — bookings (bps)",
    value: cfg?.earnRateBookingBps ?? 0,
  });
  summary.addRow({
    metric: "Earn rate — cafe (bps)",
    value: cfg?.earnRateCafeBps ?? 0,
  });
  summary.addRow({
    metric: "Point value (paise)",
    value: pointValuePaise,
  });

  const ab = await wb.xlsx.writeBuffer();
  return { filename: opts.filename, bytes: Buffer.from(ab) };
}

// ── 3. Alerts monthly ────────────────────────────────────────────

export async function generateRewardAlertsMonthlyReport(input: {
  year: number;
  month: number;
}): Promise<{ filename: string; bytes: Buffer }> {
  const monthStart = new Date(Date.UTC(input.year, input.month - 1, 1));
  const monthEnd = new Date(Date.UTC(input.year, input.month, 1));
  const yyyy = String(input.year).padStart(4, "0");
  const mm = String(input.month).padStart(2, "0");

  const alerts = await db.rewardAlert.findMany({
    where: { createdAt: { gte: monthStart, lt: monthEnd } },
    orderBy: [{ severity: "desc" }, { createdAt: "asc" }],
    include: {
      user: {
        select: { id: true, name: true, email: true, phone: true },
      },
    },
  });

  const wb = new ExcelJS.Workbook();
  wb.creator = "Momentum Arena admin";
  wb.created = new Date();

  // 1. Alerts sheet
  const alertsSheet = wb.addWorksheet("Alerts");
  alertsSheet.columns = [
    { header: "Created", key: "createdAt", width: 14 },
    { header: "Kind", key: "kind", width: 24 },
    { header: "Severity", key: "severity", width: 10 },
    { header: "Status", key: "status", width: 12 },
    { header: "User", key: "user", width: 22 },
    { header: "Phone", key: "phone", width: 14 },
    { header: "Details", key: "details", width: 60 },
    { header: "Resolved", key: "resolvedAt", width: 14 },
    { header: "Resolved by", key: "resolvedBy", width: 18 },
    { header: "Resolution", key: "resolution", width: 32 },
  ];
  styleHeaderRow(alertsSheet);

  for (const a of alerts) {
    alertsSheet.addRow({
      createdAt: fmtIstDate(a.createdAt),
      kind: a.kind,
      severity: a.severity,
      status: a.status,
      user: a.user.name ?? a.user.id,
      phone: a.user.phone ?? "",
      details: safeJson(a.details),
      resolvedAt: a.resolvedAt ? fmtIstDate(a.resolvedAt) : "",
      resolvedBy: a.resolvedBy ?? "",
      resolution: a.resolution ?? "",
    });
  }
  alertsSheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: alertsSheet.columns.length },
  };

  // 2. By kind sheet
  const byKindSheet = wb.addWorksheet("By kind");
  byKindSheet.columns = [
    { header: "Kind", key: "kind", width: 28 },
    { header: "Total", key: "total", width: 8 },
    { header: "Open", key: "open", width: 8 },
    { header: "Dismissed", key: "dismissed", width: 10 },
    { header: "Actioned", key: "actioned", width: 10 },
  ];
  styleHeaderRow(byKindSheet);

  interface KindAgg {
    total: number;
    open: number;
    dismissed: number;
    actioned: number;
  }
  const byKind = new Map<string, KindAgg>();
  for (const a of alerts) {
    const cur = byKind.get(a.kind) ?? {
      total: 0,
      open: 0,
      dismissed: 0,
      actioned: 0,
    };
    cur.total += 1;
    if (a.status === "OPEN") cur.open += 1;
    else if (a.status === "DISMISSED") cur.dismissed += 1;
    else if (a.status === "ACTIONED") cur.actioned += 1;
    byKind.set(a.kind, cur);
  }
  const sortedKinds = [...byKind.entries()].sort(
    ([, a], [, b]) => b.total - a.total,
  );
  for (const [kind, agg] of sortedKinds) {
    byKindSheet.addRow({
      kind,
      total: agg.total,
      open: agg.open,
      dismissed: agg.dismissed,
      actioned: agg.actioned,
    });
  }
  if (sortedKinds.length > 0) {
    const total = sortedKinds.reduce((s, [, a]) => s + a.total, 0);
    const open = sortedKinds.reduce((s, [, a]) => s + a.open, 0);
    const dismissed = sortedKinds.reduce((s, [, a]) => s + a.dismissed, 0);
    const actioned = sortedKinds.reduce((s, [, a]) => s + a.actioned, 0);
    const totalRow = byKindSheet.addRow({
      kind: "TOTAL",
      total,
      open,
      dismissed,
      actioned,
    });
    totalRow.font = TOTAL_ROW_FONT;
    totalRow.fill = TOTAL_ROW_FILL;
  }

  const ab = await wb.xlsx.writeBuffer();
  return {
    filename: `momentum-arena_${yyyy}-${mm}_rewards-alerts.xlsx`,
    bytes: Buffer.from(ab),
  };
}

// ── Helpers ──────────────────────────────────────────────────────

function fmtIstDate(d: Date): string {
  return d.toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function styleHeaderRow(sheet: ExcelJS.Worksheet): void {
  const row = sheet.getRow(1);
  row.font = HEADER_FONT;
  row.fill = HEADER_FILL;
  row.alignment = { vertical: "middle", horizontal: "left" };
  row.height = 22;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

// ── 4. Transaction ledger (monthly + lifetime) ──────────────────
//
// Full per-row ledger of every RewardTransaction for the period.
// Two sheets:
//   - "Transactions": one row per RewardTransaction with user, type,
//     points, value, source, reason, actor.
//   - "Summary": credits/debits totals, by-type breakdown, by-month
//     roll-up — same shape the live ledger panel exports, so the
//     monthly cron output matches what admins click-to-download.

export async function generateRewardTxnLedgerMonthlyReport(input: {
  year: number;
  month: number;
}): Promise<{ filename: string; bytes: Buffer }> {
  const monthStart = new Date(Date.UTC(input.year, input.month - 1, 1));
  const monthEnd = new Date(Date.UTC(input.year, input.month, 1));
  const yyyy = String(input.year).padStart(4, "0");
  const mm = String(input.month).padStart(2, "0");
  return buildTxnLedgerReport({
    range: { gte: monthStart, lt: monthEnd },
    titleSuffix: `${yyyy}-${mm}`,
    filename: `momentum-arena_${yyyy}-${mm}_rewards-ledger.xlsx`,
  });
}

export async function generateRewardTxnLedgerLifetimeReport(_input: {
  year: number;
  month: number;
}): Promise<{ filename: string; bytes: Buffer }> {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  return buildTxnLedgerReport({
    range: null,
    titleSuffix: "lifetime",
    filename: `momentum-arena_${yyyy}-${mm}-${dd}_rewards-ledger-lifetime.xlsx`,
  });
}

interface LedgerOpts {
  range: { gte: Date; lt: Date } | null;
  titleSuffix: string;
  filename: string;
}

async function buildTxnLedgerReport(
  opts: LedgerOpts,
): Promise<{ filename: string; bytes: Buffer }> {
  const where = opts.range ? { createdAt: opts.range } : {};
  // Hard cap for ledger generation. Past this, sharding by quarter
  // is the right move — but at our volume (<10k txns total) the cap
  // never matters in practice. Kept generous so years of data still
  // fit one workbook.
  const HARD_CAP = 100_000;
  const rows = await db.rewardTransaction.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: HARD_CAP,
    include: {
      user: { select: { id: true, name: true, email: true, phone: true } },
    },
  });

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
    opts.titleSuffix,
  );

  const ab = await wb.xlsx.writeBuffer();
  return { filename: opts.filename, bytes: Buffer.from(ab) };
}

/**
 * Shared workbook builder for both the on-demand ledger export
 * (live download from the Transactions tab) and the queued monthly/
 * lifetime ledger reports. Keep the column shape stable — the CA
 * reconciles against it.
 */
export interface LedgerExportRow {
  id: string;
  type: RewardTxnTypeFilter;
  points: number;
  pointsValuePaise: number;
  bookingId: string | null;
  cafeOrderId: string | null;
  reason: string | null;
  createdAt: Date;
  user: {
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
  };
  actor: { username: string; email: string } | null;
}

export function buildLedgerWorkbook(
  rows: LedgerExportRow[],
  titleSuffix?: string,
): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Momentum Arena admin";
  wb.created = new Date();

  // 1. Detail sheet
  const detail = wb.addWorksheet("Transactions");
  detail.columns = [
    { header: "Created (IST)", key: "createdAt", width: 18 },
    { header: "User", key: "userName", width: 22 },
    { header: "Phone", key: "phone", width: 14 },
    { header: "Email", key: "email", width: 26 },
    { header: "Type", key: "type", width: 26 },
    { header: "Direction", key: "direction", width: 10 },
    { header: "Points", key: "points", width: 10 },
    { header: "Value (₹)", key: "valueRupees", width: 12 },
    { header: "Booking ID", key: "bookingId", width: 28 },
    { header: "Cafe order ID", key: "cafeOrderId", width: 28 },
    { header: "Reason / notes", key: "reason", width: 32 },
    { header: "Actor (admin)", key: "actor", width: 16 },
    { header: "Txn ID", key: "id", width: 28 },
  ];
  styleHeaderRow(detail);

  let totalCreditPts = 0;
  let totalDebitPts = 0;
  let totalCreditPaise = 0;
  let totalDebitPaise = 0;
  for (const r of rows) {
    const isCredit = r.points > 0;
    if (isCredit) {
      totalCreditPts += r.points;
      totalCreditPaise += r.pointsValuePaise;
    } else if (r.points < 0) {
      totalDebitPts += Math.abs(r.points);
      totalDebitPaise += r.pointsValuePaise;
    }
    detail.addRow({
      createdAt: fmtIstDateTime(r.createdAt),
      userName: r.user.name ?? "",
      phone: r.user.phone ?? "",
      email: r.user.email ?? "",
      type: r.type,
      direction: isCredit ? "Credit" : "Debit",
      points: r.points,
      valueRupees: Math.round(r.pointsValuePaise / 100),
      bookingId: r.bookingId ?? "",
      cafeOrderId: r.cafeOrderId ?? "",
      reason: r.reason ?? "",
      actor: r.actor?.username ?? "",
      id: r.id,
    });
  }
  if (rows.length > 0) {
    const totalRow = detail.addRow({
      createdAt: "TOTAL",
      points: totalCreditPts - totalDebitPts,
      valueRupees: Math.round((totalCreditPaise - totalDebitPaise) / 100),
    });
    totalRow.font = TOTAL_ROW_FONT;
    totalRow.fill = TOTAL_ROW_FILL;
  }
  detail.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: detail.columns.length },
  };

  // 2. Summary sheet — totals + by-type + by-month
  const summary = wb.addWorksheet("Summary");
  summary.columns = [
    { header: "Metric", key: "metric", width: 38 },
    { header: "Value", key: "value", width: 28 },
  ];
  styleHeaderRow(summary);

  summary.addRow({
    metric: `Period: ${titleSuffix ?? "lifetime"}`,
    value: "",
  });
  summary.addRow({ metric: "Total rows", value: rows.length });
  summary.addRow({ metric: "Credit points (sum)", value: totalCreditPts });
  summary.addRow({ metric: "Debit points (sum)", value: totalDebitPts });
  summary.addRow({
    metric: "Net points (credits − debits)",
    value: totalCreditPts - totalDebitPts,
  });
  summary.addRow({
    metric: "Credit value (₹)",
    value: Math.round(totalCreditPaise / 100),
  });
  summary.addRow({
    metric: "Debit value (₹)",
    value: Math.round(totalDebitPaise / 100),
  });
  summary.addRow({});

  const byTypeHeader = summary.addRow({ metric: "── BY TYPE ──", value: "" });
  byTypeHeader.font = TOTAL_ROW_FONT;
  const byType = new Map<RewardTxnTypeFilter, { count: number; points: number; paise: number }>();
  for (const r of rows) {
    const b = byType.get(r.type) ?? { count: 0, points: 0, paise: 0 };
    b.count++;
    b.points += r.points;
    b.paise += r.pointsValuePaise;
    byType.set(r.type, b);
  }
  for (const t of REWARD_TXN_TYPES_ALL) {
    const b = byType.get(t);
    if (!b) continue;
    summary.addRow({
      metric: `${t} — ${b.count} rows`,
      value: `${b.points >= 0 ? "+" : ""}${b.points.toLocaleString("en-IN")} pts (₹${Math.round(b.paise / 100).toLocaleString("en-IN")})`,
    });
  }
  summary.addRow({});

  const byMonthHeader = summary.addRow({
    metric: "── BY MONTH (IST) ──",
    value: "",
  });
  byMonthHeader.font = TOTAL_ROW_FONT;
  const byMonth = new Map<
    string,
    { credit: number; debit: number; net: number; count: number }
  >();
  for (const r of rows) {
    const k = istMonthKey(r.createdAt);
    const b = byMonth.get(k) ?? { credit: 0, debit: 0, net: 0, count: 0 };
    b.count++;
    if (r.points > 0) b.credit += r.points;
    else if (r.points < 0) b.debit += Math.abs(r.points);
    b.net += r.points;
    byMonth.set(k, b);
  }
  const months = [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  for (const [month, b] of months) {
    summary.addRow({
      metric: `${month} — ${b.count} rows`,
      value: `+${b.credit.toLocaleString("en-IN")} / −${b.debit.toLocaleString("en-IN")} = net ${b.net.toLocaleString("en-IN")}`,
    });
  }

  return wb;
}

function fmtIstDateTime(d: Date): string {
  return d.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function istMonthKey(d: Date): string {
  // Bucket by IST month so January-cusp UTC dates land in the right
  // month for reconciliation. Format: "2026-05 (May 2026)".
  const istMs = d.getTime() + (5 * 60 + 30) * 60 * 1000;
  const ist = new Date(istMs);
  const yyyy = ist.getUTCFullYear();
  const mm = String(ist.getUTCMonth() + 1).padStart(2, "0");
  const monthName = ist.toLocaleDateString("en-IN", {
    month: "long",
    timeZone: "UTC",
  });
  return `${yyyy}-${mm} (${monthName} ${yyyy})`;
}
