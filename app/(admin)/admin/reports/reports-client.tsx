"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Cpu,
  Download,
  FileSpreadsheet,
  Loader2,
  Plus,
  XCircle,
} from "lucide-react";

export interface ReportRow {
  id: string;
  type: string;
  status: string;
  year: number;
  month: number;
  filename: string | null;
  fileSizeBytes: number | null;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  requestedByUsername: string;
}

const TYPES = [
  {
    value: "SALES_MONTHLY",
    label: "Momentum Arena sales",
    desc: "Bookings + cafe revenue, generated from our database. Includes cash/UPI/online split + per-sport, per-platform breakdowns.",
  },
  {
    value: "RAZORPAY_RECON_MONTHLY",
    label: "Razorpay settlement reconciliation",
    desc: "Per-line settlement breakdown pulled from Razorpay's API — payments, refunds, fees, GST, settlement IDs, UTRs.",
  },
  {
    value: "CA_MONTHLY",
    label: "CA monthly report",
    desc: "Same column shape as the sales report, filename-tagged for the chartered accountant's monthly filing.",
  },
] as const;

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

interface Props {
  initialReports: ReportRow[];
}

export function ReportsClient({ initialReports }: Props) {
  const [reports, setReports] = useState<ReportRow[]>(initialReports);
  const [pending, startTransition] = useTransition();

  // Form state — defaults to last completed month, sales report.
  const today = new Date();
  const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const [type, setType] = useState<(typeof TYPES)[number]["value"]>("SALES_MONTHLY");
  const [year, setYear] = useState(lastMonth.getFullYear());
  const [month, setMonth] = useState(lastMonth.getMonth() + 1);

  // Auto-poll every 4s while there's an active job. Stops when the
  // queue is idle so a long-idle tab doesn't spam the API. The
  // useCallback keeps refresh's reference stable across renders so
  // the dep-graph for the polling effect stays tight.
  const hasActive = useMemo(
    () => reports.some((r) => r.status === "QUEUED" || r.status === "GENERATING"),
    [reports],
  );

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/reports", { cache: "no-store" });
      if (!r.ok) return;
      const json = (await r.json()) as { reports: ReportRow[] };
      setReports(json.reports);
    } catch {
      /* swallow */
    }
  }, []);

  useEffect(() => {
    if (!hasActive) return;
    const id = setInterval(() => void refresh(), 4000);
    return () => clearInterval(id);
  }, [hasActive, refresh]);

  function handleEnqueue(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        const r = await fetch("/api/admin/reports", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type, year, month }),
        });
        const json = await r.json();
        if (!r.ok) {
          toast.error(json.error || "Couldn't queue report");
          return;
        }
        toast.success(
          `${TYPES.find((t) => t.value === type)?.label} queued for ${MONTHS[month - 1]} ${year}`,
        );
        await refresh();
      } catch {
        toast.error("Network error");
      }
    });
  }

  // Year picker: from 2 years back to current year.
  const currentYear = today.getFullYear();
  const yearOptions = useMemo(
    () => [currentYear - 2, currentYear - 1, currentYear],
    [currentYear],
  );

  return (
    <>
      {/* Enqueue form */}
      <form
        onSubmit={handleEnqueue}
        className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5"
      >
        <h2 className="mb-4 text-base font-semibold text-white">
          Queue a new report
        </h2>

        <div className="mb-4">
          <label className="mb-2 block text-xs font-medium uppercase text-zinc-500">
            Report type
          </label>
          <div className="grid gap-3 md:grid-cols-3">
            {TYPES.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => setType(t.value)}
                className={`rounded-lg border p-4 text-left transition-colors ${
                  type === t.value
                    ? "border-emerald-500/60 bg-emerald-500/10"
                    : "border-zinc-800 bg-zinc-950 hover:border-zinc-700"
                }`}
              >
                <div className="flex items-center gap-2">
                  <FileSpreadsheet
                    className={`h-4 w-4 ${
                      type === t.value ? "text-emerald-400" : "text-zinc-500"
                    }`}
                  />
                  <span className="text-sm font-semibold text-white">
                    {t.label}
                  </span>
                </div>
                <p className="mt-2 text-xs text-zinc-400">{t.desc}</p>
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-medium uppercase text-zinc-500">
              Year
            </label>
            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="mt-1 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white"
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium uppercase text-zinc-500">
              Month
            </label>
            <select
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
              className="mt-1 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white"
            >
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            disabled={pending}
            className="ml-auto inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
          >
            {pending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            {pending ? "Queueing…" : "Queue report"}
          </button>
        </div>
      </form>

      {/* Queue table */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40">
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <h2 className="text-base font-semibold text-white">Recent reports</h2>
          {hasActive && (
            <div className="inline-flex items-center gap-2 text-xs text-amber-300">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Auto-refreshing while jobs are active
            </div>
          )}
        </div>

        {reports.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-zinc-500">
            No reports yet. Queue one above to get started.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-zinc-800 text-left text-xs uppercase text-zinc-500">
                <tr>
                  <th className="px-4 py-2.5">Type</th>
                  <th className="px-4 py-2.5">Period</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Requested by</th>
                  <th className="px-4 py-2.5">Queued at</th>
                  <th className="px-4 py-2.5">Size</th>
                  <th className="px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60">
                {reports.map((r) => (
                  <ReportTableRow key={r.id} row={r} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

function ReportTableRow({ row }: { row: ReportRow }) {
  const typeLabel = TYPES.find((t) => t.value === row.type)?.label ?? row.type;
  const period = `${MONTHS[row.month - 1]} ${row.year}`;
  const queuedAt = new Date(row.createdAt).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const sizeLabel =
    row.fileSizeBytes != null
      ? row.fileSizeBytes > 1024 * 1024
        ? `${(row.fileSizeBytes / 1024 / 1024).toFixed(1)} MB`
        : `${Math.max(1, Math.round(row.fileSizeBytes / 1024))} KB`
      : "—";

  return (
    <tr>
      <td className="px-4 py-2.5 text-white">{typeLabel}</td>
      <td className="px-4 py-2.5 text-zinc-300">{period}</td>
      <td className="px-4 py-2.5">
        <StatusChip status={row.status} errorMessage={row.errorMessage} />
      </td>
      <td className="px-4 py-2.5 text-zinc-400">{row.requestedByUsername}</td>
      <td className="px-4 py-2.5 text-zinc-500">{queuedAt}</td>
      <td className="px-4 py-2.5 text-zinc-500">{sizeLabel}</td>
      <td className="px-4 py-2.5 text-right">
        {row.status === "READY" ? (
          <a
            href={`/api/admin/reports/${row.id}/download`}
            className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-500/20"
          >
            <Download className="h-3.5 w-3.5" />
            Download
          </a>
        ) : null}
      </td>
    </tr>
  );
}

function StatusChip({
  status,
  errorMessage,
}: {
  status: string;
  errorMessage: string | null;
}) {
  const map: Record<
    string,
    { Icon: typeof Clock; bg: string; text: string; border: string; label: string }
  > = {
    QUEUED: {
      Icon: Clock,
      bg: "bg-zinc-800",
      text: "text-zinc-300",
      border: "border-zinc-700",
      label: "Queued",
    },
    GENERATING: {
      Icon: Cpu,
      bg: "bg-amber-500/10",
      text: "text-amber-300",
      border: "border-amber-500/40",
      label: "Generating…",
    },
    READY: {
      Icon: CheckCircle2,
      bg: "bg-emerald-500/10",
      text: "text-emerald-300",
      border: "border-emerald-500/40",
      label: "Ready",
    },
    FAILED: {
      Icon: XCircle,
      bg: "bg-red-500/10",
      text: "text-red-300",
      border: "border-red-500/40",
      label: "Failed",
    },
    EXPIRED: {
      Icon: AlertCircle,
      bg: "bg-zinc-800",
      text: "text-zinc-500",
      border: "border-zinc-700",
      label: "Expired",
    },
  };
  const cfg = map[status] ?? map.QUEUED;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${cfg.bg} ${cfg.border} ${cfg.text}`}
      title={errorMessage ?? undefined}
    >
      <cfg.Icon className="h-3 w-3" />
      {cfg.label}
    </span>
  );
}
