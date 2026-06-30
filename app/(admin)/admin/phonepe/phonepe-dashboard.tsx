"use client";

import { useState, useEffect, useTransition } from "react";
import {
  getPhonePeTransactions,
  refreshPhonePeStatus,
  type PhonePeOverview,
  type PhonePeTxn,
  type PhonePeTxnPage,
} from "@/actions/admin-phonepe";
import { formatPrice } from "@/lib/pricing";
import {
  IndianRupee,
  CheckCircle2,
  Clock,
  XCircle,
  Hash,
  ArrowDownLeft,
  RefreshCw,
} from "lucide-react";

// admin-phonepe returns every monetary field in rupees already, so we can use
// formatPrice directly (no paise conversion, unlike the Razorpay dashboard).

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "COMPLETED", label: "Completed" },
  { value: "PENDING", label: "Pending" },
  { value: "FAILED", label: "Failed" },
  { value: "REFUNDED", label: "Refunded" },
] as const;

const TYPE_OPTIONS = [
  { value: "", label: "All types" },
  { value: "booking", label: "Booking" },
  { value: "cafe", label: "Cafe" },
] as const;

// --- Status badge (PaymentStatus enum values) ---

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    COMPLETED: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    PENDING: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    PROCESSING: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    REFUNDED: "bg-purple-500/20 text-purple-400 border-purple-500/30",
    FAILED: "bg-red-500/20 text-red-400 border-red-500/30",
  };
  const c =
    colors[status] || "bg-zinc-500/20 text-zinc-400 border-zinc-500/30";
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border ${c}`}>
      {status.toLowerCase()}
    </span>
  );
}

function TypeBadge({ type }: { type: PhonePeTxn["type"] }) {
  const c =
    type === "booking"
      ? "bg-indigo-500/20 text-indigo-400 border-indigo-500/30"
      : "bg-orange-500/20 text-orange-400 border-orange-500/30";
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border ${c}`}>
      {type === "booking" ? "Booking" : "Cafe"}
    </span>
  );
}

function ChannelBadge({ channel }: { channel: PhonePeTxn["channel"] }) {
  const c =
    channel === "CHECKOUT"
      ? "bg-sky-500/20 text-sky-400 border-sky-500/30"
      : "bg-teal-500/20 text-teal-400 border-teal-500/30";
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border ${c}`}>
      {channel === "CHECKOUT" ? "Checkout" : "DQR"}
    </span>
  );
}

// --- Date formatter (ISO strings from the server) ---

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// --- Pagination ---

function Pagination({
  page,
  totalPages,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  onPageChange: (p: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center gap-2 justify-center pt-4">
      <button
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
        className="px-3 py-1 text-sm rounded-md bg-zinc-800 text-zinc-300 hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Prev
      </button>
      <span className="text-sm text-zinc-400">
        Page {page} of {totalPages}
      </span>
      <button
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
        className="px-3 py-1 text-sm rounded-md bg-zinc-800 text-zinc-300 hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Next
      </button>
    </div>
  );
}

// --- Error / empty / loading ---

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-400">
      {message}
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-12 text-center text-zinc-500">
      No {label} found
    </div>
  );
}

function LoadingState() {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-12 text-center text-zinc-500">
      Loading...
    </div>
  );
}

// --- Overview KPI cards + splits ---

function OverviewCards({ overview }: { overview: PhonePeOverview }) {
  const stats = [
    {
      label: "Total Transactions",
      value: overview.totalCount.toLocaleString("en-IN"),
      icon: Hash,
      color: "text-blue-400 bg-blue-500/20",
    },
    {
      label: "Completed",
      value: overview.completedCount.toLocaleString("en-IN"),
      icon: CheckCircle2,
      color: "text-emerald-400 bg-emerald-500/20",
    },
    {
      label: "Pending",
      value: overview.pendingCount.toLocaleString("en-IN"),
      icon: Clock,
      color: "text-yellow-400 bg-yellow-500/20",
    },
    {
      label: "Failed",
      value: overview.failedCount.toLocaleString("en-IN"),
      icon: XCircle,
      color: "text-red-400 bg-red-500/20",
    },
    {
      label: "Total Volume",
      value: formatPrice(overview.totalVolume),
      icon: IndianRupee,
      color: "text-emerald-400 bg-emerald-500/20",
    },
    {
      label: `Refunded (${overview.refundedCount})`,
      value: formatPrice(overview.refundedAmount),
      icon: ArrowDownLeft,
      color: "text-purple-400 bg-purple-500/20",
    },
  ];

  const channelTotal =
    overview.byChannel.CHECKOUT + overview.byChannel.DQR || 1;
  const typeTotal = overview.byType.booking + overview.byType.cafe || 1;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {stats.map((s) => {
          const Icon = s.icon;
          return (
            <div
              key={s.label}
              className="rounded-xl border border-zinc-800 bg-zinc-950 p-5"
            >
              <div className="flex items-center gap-3 mb-3">
                <div className={`rounded-lg p-2 ${s.color}`}>
                  <Icon className="h-5 w-5" />
                </div>
                <span className="text-sm text-zinc-400">{s.label}</span>
              </div>
              <p className="text-2xl font-bold text-white">{s.value}</p>
            </div>
          );
        })}
      </div>

      {/* Channel & Type splits (completed volume) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-6">
          <h3 className="text-lg font-semibold text-white mb-1">Channel</h3>
          <p className="text-xs text-zinc-500 mb-4">
            Completed volume — Checkout vs Dynamic-QR
          </p>
          <SplitBar
            rows={[
              {
                label: "Checkout",
                amount: overview.byChannel.CHECKOUT,
                color: "bg-sky-500",
              },
              {
                label: "Dynamic-QR",
                amount: overview.byChannel.DQR,
                color: "bg-teal-500",
              },
            ]}
            total={channelTotal}
          />
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-6">
          <h3 className="text-lg font-semibold text-white mb-1">Type</h3>
          <p className="text-xs text-zinc-500 mb-4">
            Completed volume — Booking vs Cafe
          </p>
          <SplitBar
            rows={[
              {
                label: "Booking",
                amount: overview.byType.booking,
                color: "bg-indigo-500",
              },
              {
                label: "Cafe",
                amount: overview.byType.cafe,
                color: "bg-orange-500",
              },
            ]}
            total={typeTotal}
          />
        </div>
      </div>
    </div>
  );
}

function SplitBar({
  rows,
  total,
}: {
  rows: { label: string; amount: number; color: string }[];
  total: number;
}) {
  return (
    <div className="space-y-3">
      {rows.map((r) => {
        const pct = Math.round((r.amount / total) * 100);
        return (
          <div key={r.label} className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span className="text-zinc-300">{r.label}</span>
              <span className="text-zinc-400">{formatPrice(r.amount)}</span>
            </div>
            <div className="h-2 rounded-full bg-zinc-800">
              <div
                className={`h-2 rounded-full ${r.color}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// --- Live status cell ---

type LiveStatus =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; state?: string; success?: boolean }
  | { kind: "error"; message: string };

function LiveStatusButton({ merchantTxnId }: { merchantTxnId: string | null }) {
  const [status, setStatus] = useState<LiveStatus>({ kind: "idle" });
  const [isPending, startTransition] = useTransition();

  const check = () => {
    if (!merchantTxnId) return;
    setStatus({ kind: "loading" });
    startTransition(async () => {
      const r = await refreshPhonePeStatus(merchantTxnId);
      if (r.ok) {
        setStatus({ kind: "ok", state: r.state, success: r.success });
      } else {
        setStatus({ kind: "error", message: r.error || "Failed" });
      }
    });
  };

  if (!merchantTxnId) {
    return <span className="text-xs text-zinc-600">—</span>;
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={check}
        disabled={isPending}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md bg-zinc-800 text-zinc-300 hover:bg-zinc-700 disabled:opacity-50"
      >
        <RefreshCw className={`h-3 w-3 ${isPending ? "animate-spin" : ""}`} />
        Check live status
      </button>
      {status.kind === "ok" && (
        <span
          className={`text-xs ${
            status.success ? "text-emerald-400" : "text-yellow-400"
          }`}
        >
          {status.state || (status.success ? "SUCCESS" : "PENDING")}
        </span>
      )}
      {status.kind === "error" && (
        <span className="text-xs text-red-400" title={status.message}>
          {status.message.length > 32
            ? status.message.slice(0, 32) + "…"
            : status.message}
        </span>
      )}
    </div>
  );
}

// --- Transactions table ---

function TransactionsTable({ initialRange }: { initialRange: { from: string; to: string } }) {
  const [data, setData] = useState<PhonePeTxnPage | null>(null);
  const [page, setPage] = useState(1);
  const [from, setFrom] = useState(initialRange.from);
  const [to, setTo] = useState(initialRange.to);
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const [isPending, startTransition] = useTransition();

  const load = (p: number) => {
    startTransition(async () => {
      const result = await getPhonePeTransactions({
        page: p,
        from: from || undefined,
        to: to || undefined,
        status: status || undefined,
        type: (type || undefined) as "booking" | "cafe" | undefined,
      });
      setData(result);
      setPage(p);
    });
  };

  useEffect(() => {
    load(1);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="text-xs text-zinc-500 block mb-1">From</label>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="bg-zinc-900 border border-zinc-700 rounded-md px-3 py-1.5 text-sm text-white"
          />
        </div>
        <div>
          <label className="text-xs text-zinc-500 block mb-1">To</label>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="bg-zinc-900 border border-zinc-700 rounded-md px-3 py-1.5 text-sm text-white"
          />
        </div>
        <div>
          <label className="text-xs text-zinc-500 block mb-1">Status</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="bg-zinc-900 border border-zinc-700 rounded-md px-3 py-1.5 text-sm text-white"
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-zinc-500 block mb-1">Type</label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="bg-zinc-900 border border-zinc-700 rounded-md px-3 py-1.5 text-sm text-white"
          >
            {TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={() => load(1)}
          disabled={isPending}
          className="px-4 py-1.5 text-sm rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {isPending ? "Loading..." : "Filter"}
        </button>
      </div>

      {!data && isPending ? (
        <LoadingState />
      ) : !data || data.items.length === 0 ? (
        <EmptyState label="transactions" />
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-zinc-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 bg-zinc-900/50">
                  <th className="text-left p-3 text-zinc-400 font-medium">Date</th>
                  <th className="text-left p-3 text-zinc-400 font-medium">Customer</th>
                  <th className="text-left p-3 text-zinc-400 font-medium">Type</th>
                  <th className="text-left p-3 text-zinc-400 font-medium">Channel</th>
                  <th className="text-left p-3 text-zinc-400 font-medium">Amount</th>
                  <th className="text-left p-3 text-zinc-400 font-medium">Status</th>
                  <th className="text-left p-3 text-zinc-400 font-medium">PhonePe txn</th>
                  <th className="text-left p-3 text-zinc-400 font-medium">Live status</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-zinc-800/50 hover:bg-zinc-900/30"
                  >
                    <td className="p-3 text-zinc-400 whitespace-nowrap">
                      {formatDateTime(row.createdAt)}
                    </td>
                    <td className="p-3">
                      <div className="text-zinc-200">
                        {row.customerName || "—"}
                      </div>
                      {row.customerPhone && (
                        <div className="text-xs text-zinc-500">
                          {row.customerPhone}
                        </div>
                      )}
                    </td>
                    <td className="p-3">
                      <TypeBadge type={row.type} />
                    </td>
                    <td className="p-3">
                      <ChannelBadge channel={row.channel} />
                    </td>
                    <td className="p-3 text-white whitespace-nowrap">
                      {formatPrice(row.amount)}
                    </td>
                    <td className="p-3">
                      <StatusBadge status={row.status} />
                    </td>
                    <td className="p-3">
                      <div className="text-zinc-300 font-mono text-xs">
                        {row.phonePeTransactionId || "—"}
                      </div>
                      {row.merchantTxnId && (
                        <div className="text-xs text-zinc-600 font-mono">
                          {row.merchantTxnId}
                        </div>
                      )}
                    </td>
                    <td className="p-3">
                      <LiveStatusButton merchantTxnId={row.merchantTxnId} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Pagination page={page} totalPages={data.totalPages} onPageChange={load} />
        </>
      )}
    </div>
  );
}

// --- Main Dashboard ---

export function PhonePeDashboard({
  initialOverview,
}: {
  initialOverview: PhonePeOverview;
}) {
  return (
    <div className="space-y-6">
      {/* Header note — PhonePe has no list/settlement/dispute API */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 text-sm text-zinc-400">
        PhonePe has no merchant settlement/dispute/list API — this view is our
        recorded PhonePe transactions; tap{" "}
        <span className="text-zinc-200 font-medium">&ldquo;Check live status&rdquo;</span>{" "}
        for PhonePe&apos;s live state per transaction.
      </div>

      <OverviewCards overview={initialOverview} />

      <TransactionsTable initialRange={initialOverview.range} />
    </div>
  );
}
