import { db } from "@/lib/db";
import { generateSalesReport } from "./workers/sales";
import { generateRazorpayReconReport } from "./workers/razorpay-recon";
import { generateCaMonthlyReport } from "./workers/ca";
import {
  generateExpensesLifetimeReport,
  generateExpensesMonthlyReport,
} from "./workers/expenses";
import {
  generateRewardAlertsMonthlyReport,
  generateRewardLiabilityLifetimeReport,
  generateRewardLiabilityMonthlyReport,
  generateRewardTxnLedgerLifetimeReport,
  generateRewardTxnLedgerMonthlyReport,
} from "./workers/rewards";

/**
 * Async report queue.
 *
 * Admin requests a report → enqueueReport() inserts a row with
 * status=QUEUED and returns immediately. A cron worker
 * (/api/cron/process-reports) drains the queue serially: pick
 * oldest QUEUED, mark GENERATING, run the worker, write bytes back.
 *
 * Why serial: report generation is rare and the workers are cheap
 * (~hundreds of DB rows + a few Razorpay API calls). Serial keeps
 * the implementation simple — no need for distributed locks or job
 * leases. If volume ever justifies parallelism, add a
 * `claimedAt` column + a SELECT FOR UPDATE SKIP LOCKED query.
 */

interface EnqueueInput {
  type:
    | "SALES_MONTHLY"
    | "RAZORPAY_RECON_MONTHLY"
    | "CA_MONTHLY"
    | "EXPENSES_MONTHLY"
    | "EXPENSES_LIFETIME"
    | "REWARD_LIABILITY_MONTHLY"
    | "REWARD_LIABILITY_LIFETIME"
    | "REWARD_ALERTS_MONTHLY"
    | "REWARD_TXN_LEDGER_MONTHLY"
    | "REWARD_TXN_LEDGER_LIFETIME";
  year: number;
  month: number; // 1-12
  requestedById: string;
}

export interface EnqueueResult {
  success: boolean;
  report?: {
    id: string;
    type: string;
    year: number;
    month: number;
    status: string;
  };
  error?: string;
}

const VALID_TYPES = [
  "SALES_MONTHLY",
  "RAZORPAY_RECON_MONTHLY",
  "CA_MONTHLY",
  "EXPENSES_MONTHLY",
  "EXPENSES_LIFETIME",
  "REWARD_LIABILITY_MONTHLY",
  "REWARD_LIABILITY_LIFETIME",
  "REWARD_ALERTS_MONTHLY",
  "REWARD_TXN_LEDGER_MONTHLY",
  "REWARD_TXN_LEDGER_LIFETIME",
] as const;

export async function enqueueReport(input: EnqueueInput): Promise<EnqueueResult> {
  if (!VALID_TYPES.includes(input.type)) {
    return { success: false, error: "Unknown report type" };
  }
  if (!Number.isInteger(input.year) || input.year < 2024 || input.year > 2100) {
    return { success: false, error: "Year out of range" };
  }
  if (!Number.isInteger(input.month) || input.month < 1 || input.month > 12) {
    return { success: false, error: "Month must be 1–12" };
  }

  // Future-period guard — admin shouldn't be able to ask for "next month".
  // We allow the current month though (a partial-month snapshot is useful
  // for live cash-flow visibility).
  const now = new Date();
  const today = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0),
  );
  const requested = new Date(Date.UTC(input.year, input.month - 1, 1, 0, 0, 0, 0));
  if (requested.getTime() > today.getTime()) {
    return { success: false, error: "Can't request a future month" };
  }

  // Soft-dedupe: if there's already a QUEUED or GENERATING row for the
  // same (type, year, month, requestedBy), reuse it. Re-running a READY
  // report IS allowed (admin might want fresh Razorpay data), so we
  // don't dedupe against READY/FAILED/EXPIRED.
  const existing = await db.report.findFirst({
    where: {
      type: input.type,
      year: input.year,
      month: input.month,
      requestedById: input.requestedById,
      status: { in: ["QUEUED", "GENERATING"] },
    },
  });
  if (existing) {
    return {
      success: true,
      report: {
        id: existing.id,
        type: existing.type,
        year: existing.year,
        month: existing.month,
        status: existing.status,
      },
    };
  }

  const created = await db.report.create({
    data: {
      type: input.type,
      year: input.year,
      month: input.month,
      requestedById: input.requestedById,
    },
    select: { id: true, type: true, year: true, month: true, status: true },
  });

  return { success: true, report: created };
}

/**
 * Pick the single oldest QUEUED report and run it. Cron worker calls
 * this on every fire — if the queue is empty we no-op cheaply.
 *
 * Returns one of:
 *   - { processed: false } when the queue is empty
 *   - { processed: true, reportId, status: "READY" | "FAILED" }
 *
 * NOT idempotent against concurrent invocations — if two crons fire
 * at once, both could grab the same row. The cron schedule is
 * one-per-minute single-runner so this isn't worth defending against
 * with a transaction lock yet.
 */
export interface ProcessResult {
  processed: boolean;
  reportId?: string;
  status?: "READY" | "FAILED";
  error?: string;
  durationMs?: number;
}

// A worker that crashed (Vercel function timeout, container kill,
// uncaught throw between the GENERATING flip and the READY flip)
// would leave a Report row stuck at GENERATING forever. On every
// queue scan, we mark any GENERATING row older than this as FAILED
// so the queue keeps moving. Picked generously enough to cover the
// slowest realistic worker run (Razorpay recon over a busy month
// can take ~10s).
const STUCK_GENERATING_THRESHOLD_MS = 5 * 60 * 1000;

export async function processNextQueuedReport(): Promise<ProcessResult> {
  // Recover any GENERATING rows that have been stuck past the
  // threshold. Idempotent — fine to run on every scan.
  const stuckCutoff = new Date(Date.now() - STUCK_GENERATING_THRESHOLD_MS);
  await db.report.updateMany({
    where: {
      status: "GENERATING",
      startedAt: { lt: stuckCutoff },
    },
    data: {
      status: "FAILED",
      completedAt: new Date(),
      errorMessage:
        "Worker timed out before completing — re-queue the report to retry.",
    },
  });

  const next = await db.report.findFirst({
    where: { status: "QUEUED" },
    orderBy: { createdAt: "asc" },
    select: { id: true, type: true, year: true, month: true },
  });
  if (!next) return { processed: false };

  const started = Date.now();
  await db.report.update({
    where: { id: next.id },
    data: { status: "GENERATING", startedAt: new Date() },
  });

  try {
    const built = await runWorker(next.type, next.year, next.month);
    // Prisma's Bytes type wants a Uint8Array<ArrayBuffer>, but Node's
    // Buffer's underlying `.buffer` is an ArrayBufferLike (could be a
    // SharedArrayBuffer in some contexts). Copy into a fresh
    // ArrayBuffer-backed view so TS is satisfied.
    const fresh = new ArrayBuffer(built.bytes.byteLength);
    new Uint8Array(fresh).set(built.bytes);
    const bytesView = new Uint8Array(fresh);
    await db.report.update({
      where: { id: next.id },
      data: {
        status: "READY",
        completedAt: new Date(),
        filename: built.filename,
        fileSizeBytes: built.bytes.length,
        fileBytes: bytesView,
      },
    });
    return {
      processed: true,
      reportId: next.id,
      status: "READY",
      durationMs: Date.now() - started,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.report.update({
      where: { id: next.id },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        errorMessage: message.slice(0, 500),
      },
    });
    return {
      processed: true,
      reportId: next.id,
      status: "FAILED",
      error: message,
      durationMs: Date.now() - started,
    };
  }
}

interface WorkerOutput {
  filename: string;
  bytes: Buffer;
}

async function runWorker(
  type: string,
  year: number,
  month: number,
): Promise<WorkerOutput> {
  switch (type) {
    case "SALES_MONTHLY":
      return generateSalesReport({ year, month });
    case "RAZORPAY_RECON_MONTHLY":
      return generateRazorpayReconReport({ year, month });
    case "CA_MONTHLY":
      return generateCaMonthlyReport({ year, month });
    case "EXPENSES_MONTHLY":
      return generateExpensesMonthlyReport({ year, month });
    case "EXPENSES_LIFETIME":
      return generateExpensesLifetimeReport({ year, month });
    case "REWARD_LIABILITY_MONTHLY":
      return generateRewardLiabilityMonthlyReport({ year, month });
    case "REWARD_LIABILITY_LIFETIME":
      return generateRewardLiabilityLifetimeReport({ year, month });
    case "REWARD_ALERTS_MONTHLY":
      return generateRewardAlertsMonthlyReport({ year, month });
    case "REWARD_TXN_LEDGER_MONTHLY":
      return generateRewardTxnLedgerMonthlyReport({ year, month });
    case "REWARD_TXN_LEDGER_LIFETIME":
      return generateRewardTxnLedgerLifetimeReport({ year, month });
    default:
      throw new Error(`Unknown report type: ${type}`);
  }
}

/**
 * Daily retention sweep — clears `fileBytes` on rows older than
 * RETENTION_DAYS while keeping the row itself for audit. Status
 * flips to EXPIRED.
 */
export async function expireOldReports(retentionDays = 90): Promise<number> {
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - retentionDays);
  const result = await db.report.updateMany({
    where: {
      status: "READY",
      completedAt: { lt: cutoff },
    },
    data: {
      status: "EXPIRED",
      fileBytes: null,
    },
  });
  return result.count;
}
