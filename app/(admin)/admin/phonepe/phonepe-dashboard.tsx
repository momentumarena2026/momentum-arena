"use client";

import { useState, useEffect, useTransition } from "react";
import {
  getPhonePeOverview,
  getPhonePeTransactions,
  type PhonePeChannel,
  type PhonePeStatus,
  type PhonePeOverview,
  type PhonePeStore,
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
  AlertTriangle,
} from "lucide-react";

// admin-phonepe returns every monetary field in rupees already, so we can use
// formatPrice directly (no paise conversion, unlike the Razorpay dashboard).

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "COMPLETED", label: "Completed" },
  { value: "PENDING", label: "Pending" },
  { value: "FAILED", label: "Failed" },
] as const;

const CHANNEL_OPTIONS = [
  { value: "", label: "All channels" },
  { value: "STATIC", label: "Static QR" },
  { value: "DQR", label: "DQR" },
] as const;

// --- Status badge (PhonePeStatus values) ---

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    COMPLETED: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    PENDING: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
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

function ChannelBadge({ channel }: { channel: PhonePeTxn["channel"] }) {
  const c =
    channel === "STATIC"
      ? "bg-sky-500/20 text-sky-400 border-sky-500/30"
      : "bg-teal-500/20 text-teal-400 border-teal-500/30";
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border ${c}`}>
      {channel === "STATIC" ? "Static QR" : "DQR"}
    </span>
  );
}

// --- Date formatter (ISO strings from the server) ---

function formatDateTime(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-IN", {
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

// --- Error / empty / loading / notices ---

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

function NotConfiguredNotice() {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-6 text-sm text-zinc-300">
      <p className="font-medium text-white mb-1">
        PhonePe QR reporting isn&apos;t configured
      </p>
      <p className="text-zinc-400">
        Set{" "}
        <span className="font-mono text-zinc-200">PHONEPE_DQR_MERCHANT_ID</span>
        , <span className="font-mono text-zinc-200">PHONEPE_DQR_SALT_KEY</span>{" "}
        and{" "}
        <span className="font-mono text-zinc-200">PHONEPE_DQR_STORE_ID</span>{" "}
        (live DQR creds) to pull transactions.
      </p>
    </div>
  );
}

function TruncatedBanner() {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-400">
      <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
      <span>
        Showing the most recent transactions only (API page cap). Narrow the
        date range to see older ones.
      </span>
    </div>
  );
}

// --- Overview KPI cards + channel split ---

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
  ];

  const channelTotal = overview.byChannel.STATIC + overview.byChannel.DQR || 1;

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

      {/* Channel split (completed volume) */}
      <div className="grid grid-cols-1 gap-4">
        <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-6">
          <h3 className="text-lg font-semibold text-white mb-1">Channel</h3>
          <p className="text-xs text-zinc-500 mb-4">
            Completed volume — Static QR vs Dynamic QR
          </p>
          <SplitBar
            rows={[
              {
                label: "Static QR",
                amount: overview.byChannel.STATIC,
                color: "bg-sky-500",
              },
              {
                label: "Dynamic QR",
                amount: overview.byChannel.DQR,
                color: "bg-teal-500",
              },
            ]}
            total={channelTotal}
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

// --- Transactions table ---

function TransactionsTable({
  store,
  initialRange,
}: {
  store: string;
  initialRange: { from: string; to: string };
}) {
  const [data, setData] = useState<PhonePeTxnPage | null>(null);
  const [page, setPage] = useState(1);
  const [from, setFrom] = useState(initialRange.from);
  const [to, setTo] = useState(initialRange.to);
  const [status, setStatus] = useState("");
  const [channel, setChannel] = useState("");
  const [isPending, startTransition] = useTransition();

  const load = (p: number) => {
    startTransition(async () => {
      const result = await getPhonePeTransactions({
        store,
        page: p,
        from: from || undefined,
        to: to || undefined,
        status: (status || undefined) as PhonePeStatus | undefined,
        channel: (channel || undefined) as PhonePeChannel | undefined,
      });
      setData(result);
      setPage(p);
    });
  };

  // Refetch page 1 on mount AND whenever the selected store changes; the
  // date/status/channel filters and pagination operate within that store.
  useEffect(() => {
    load(1);
  }, [store]); // eslint-disable-line react-hooks/exhaustive-deps

  // Filtered fetch can report the creds went away — surface the same notice.
  if (data && !data.configured) {
    return <NotConfiguredNotice />;
  }

  return (
    <div className="space-y-4">
      {data?.truncated && <TruncatedBanner />}

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
          <label className="text-xs text-zinc-500 block mb-1">Channel</label>
          <select
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
            className="bg-zinc-900 border border-zinc-700 rounded-md px-3 py-1.5 text-sm text-white"
          >
            {CHANNEL_OPTIONS.map((o) => (
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
                  <th className="text-left p-3 text-zinc-400 font-medium">Channel</th>
                  <th className="text-left p-3 text-zinc-400 font-medium">Amount</th>
                  <th className="text-left p-3 text-zinc-400 font-medium">Status</th>
                  <th className="text-left p-3 text-zinc-400 font-medium">UTR</th>
                  <th className="text-left p-3 text-zinc-400 font-medium">Txn id</th>
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
                      <ChannelBadge channel={row.channel} />
                    </td>
                    <td className="p-3 text-white whitespace-nowrap">
                      {formatPrice(row.amount)}
                    </td>
                    <td className="p-3">
                      <StatusBadge status={row.status} />
                    </td>
                    <td className="p-3 text-zinc-400 font-mono text-xs">
                      {row.utr || "—"}
                    </td>
                    <td className="p-3">
                      <div className="text-zinc-300 font-mono text-xs">
                        {row.merchantTxnId || "—"}
                      </div>
                      {row.providerReferenceId && (
                        <div className="text-xs text-zinc-600 font-mono">
                          {row.providerReferenceId}
                        </div>
                      )}
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

// --- Store tab selector (horizontal pill row) ---

function StoreTabs({
  stores,
  selected,
  onSelect,
  disabled,
}: {
  stores: PhonePeStore[];
  selected: string | null;
  onSelect: (key: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2 overflow-x-auto">
      {stores.map((s) => (
        <button
          key={s.key}
          onClick={() => onSelect(s.key)}
          disabled={disabled}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition whitespace-nowrap disabled:cursor-not-allowed ${
            selected === s.key
              ? "bg-emerald-600 text-white"
              : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 disabled:opacity-60"
          }`}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}

export function PhonePeDashboard({
  stores,
  defaultStore,
  initialOverview,
}: {
  stores: PhonePeStore[];
  defaultStore: string | null;
  initialOverview: PhonePeOverview;
}) {
  // No stores configured → no tabs, just the setup notice.
  if (stores.length === 0 || !defaultStore) {
    return <NotConfiguredNotice />;
  }

  const [selectedStore, setSelectedStore] = useState<string>(defaultStore);
  const [overview, setOverview] = useState<PhonePeOverview>(initialOverview);
  const [isSwitching, startSwitch] = useTransition();

  const selectStore = (store: string) => {
    if (store === selectedStore) return;
    setSelectedStore(store);
    startSwitch(async () => {
      // Refetch the overview for the newly selected store. The transactions
      // table refetches itself off the `store` prop change (page resets to 1).
      const next = await getPhonePeOverview({ store });
      setOverview(next);
    });
  };

  return (
    <div className="space-y-6">
      {/* Store tabs — pick which PhonePe store to view (one merchant, 5 stores) */}
      <StoreTabs
        stores={stores}
        selected={selectedStore}
        onSelect={selectStore}
        disabled={isSwitching}
      />

      {/* Header note — live from PhonePe's QR transaction list */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 text-sm text-zinc-400">
        Live from PhonePe — static + Dynamic QR transactions as PhonePe records
        them (includes payments whose callback we may have missed). PhonePe
        standard-checkout payments aren&apos;t included.
      </div>

      {!overview.configured ? (
        <NotConfiguredNotice />
      ) : (
        <>
          {overview.truncated && <TruncatedBanner />}

          <OverviewCards overview={overview} />

          <TransactionsTable
            key={selectedStore}
            store={selectedStore}
            initialRange={overview.range}
          />
        </>
      )}
    </div>
  );
}
