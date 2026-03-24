"use client";

import { useState, useEffect, useTransition } from "react";
import {
  getRazorpayPayments,
  getRazorpayOrders,
  getRazorpayRefunds,
  getRazorpaySettlements,
  type RazorpayOverview,
  type PaginatedResult,
} from "@/actions/admin-razorpay";
import { formatPrice } from "@/lib/pricing";
import {
  IndianRupee,
  ArrowDownLeft,
  TrendingUp,
  Clock,
} from "lucide-react";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "payments", label: "Payments" },
  { key: "orders", label: "Orders" },
  { key: "refunds", label: "Refunds" },
  { key: "settlements", label: "Settlements" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

// --- Status badge ---

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    captured: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    paid: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    processed: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    created: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    authorized: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    attempted: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    refunded: "bg-purple-500/20 text-purple-400 border-purple-500/30",
    failed: "bg-red-500/20 text-red-400 border-red-500/30",
  };
  const c = colors[status] || "bg-zinc-500/20 text-zinc-400 border-zinc-500/30";
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border ${c}`}>
      {status}
    </span>
  );
}

// --- Date formatter ---

function formatDate(unixSeconds: number) {
  return new Date(unixSeconds * 1000).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatDateTime(unixSeconds: number) {
  return new Date(unixSeconds * 1000).toLocaleString("en-IN", {
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

// --- Error banner ---

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-400">
      {message}
    </div>
  );
}

// --- Empty state ---

function EmptyState({ label }: { label: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-12 text-center text-zinc-500">
      No {label} found
    </div>
  );
}

// --- Overview Tab ---

function OverviewTab({ overview }: { overview: RazorpayOverview }) {
  if (overview.error) return <ErrorBanner message={overview.error} />;

  const stats = [
    {
      label: "Total Collected",
      value: formatPrice(overview.totalCollected),
      icon: IndianRupee,
      color: "text-emerald-400 bg-emerald-500/20",
    },
    {
      label: "Total Refunded",
      value: formatPrice(overview.totalRefunded),
      icon: ArrowDownLeft,
      color: "text-red-400 bg-red-500/20",
    },
    {
      label: "Net Revenue",
      value: formatPrice(overview.netRevenue),
      icon: TrendingUp,
      color: "text-blue-400 bg-blue-500/20",
    },
    {
      label: "Pending Settlements",
      value: formatPrice(overview.pendingSettlements),
      icon: Clock,
      color: "text-yellow-400 bg-yellow-500/20",
    },
  ];

  const methods = Object.entries(overview.paymentMethodBreakdown).sort(
    (a, b) => b[1] - a[1]
  );
  const maxMethodAmount = methods.length > 0 ? methods[0][1] : 1;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
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

      {/* Payment method breakdown */}
      {methods.length > 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-6">
          <h3 className="text-lg font-semibold text-white mb-4">
            Payment Methods
          </h3>
          <p className="text-xs text-zinc-500 mb-4">
            Based on last 100 captured payments (30 days)
          </p>
          <div className="space-y-3">
            {methods.map(([method, amount]) => {
              const pct = Math.round((amount / maxMethodAmount) * 100);
              return (
                <div key={method} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-zinc-300 capitalize">{method}</span>
                    <span className="text-zinc-400">
                      {formatPrice(amount)}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-zinc-800">
                    <div
                      className="h-2 rounded-full bg-emerald-500"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {methods.length === 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-6 text-center text-zinc-500">
          No payment data available yet
        </div>
      )}
    </div>
  );
}

// --- Payments Tab ---

function PaymentsTab() {
  const [data, setData] = useState<PaginatedResult<Record<string, unknown>> | null>(null);
  const [page, setPage] = useState(1);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [isPending, startTransition] = useTransition();

  const load = (p: number) => {
    startTransition(async () => {
      const result = await getRazorpayPayments({
        page: p,
        from: from || undefined,
        to: to || undefined,
      });
      setData(result);
      setPage(p);
    });
  };

  useEffect(() => { load(1); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!data && isPending) return <LoadingState />;
  if (data?.error) return <ErrorBanner message={data.error} />;
  if (!data || data.items.length === 0) return <EmptyState label="payments" />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="text-xs text-zinc-500 block mb-1">From</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="bg-zinc-900 border border-zinc-700 rounded-md px-3 py-1.5 text-sm text-white" />
        </div>
        <div>
          <label className="text-xs text-zinc-500 block mb-1">To</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
            className="bg-zinc-900 border border-zinc-700 rounded-md px-3 py-1.5 text-sm text-white" />
        </div>
        <button onClick={() => load(1)} disabled={isPending}
          className="px-4 py-1.5 text-sm rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">
          {isPending ? "Loading..." : "Filter"}
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-zinc-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800 bg-zinc-900/50">
              <th className="text-left p-3 text-zinc-400 font-medium">ID</th>
              <th className="text-left p-3 text-zinc-400 font-medium">Amount</th>
              <th className="text-left p-3 text-zinc-400 font-medium">Status</th>
              <th className="text-left p-3 text-zinc-400 font-medium">Method</th>
              <th className="text-left p-3 text-zinc-400 font-medium">Email</th>
              <th className="text-left p-3 text-zinc-400 font-medium">Date</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((p) => (
              <tr key={p.id as string} className="border-b border-zinc-800/50 hover:bg-zinc-900/30">
                <td className="p-3 text-zinc-300 font-mono text-xs">{(p.id as string).slice(0, 18)}...</td>
                <td className="p-3 text-white">{formatPrice(p.amount as number)}</td>
                <td className="p-3"><StatusBadge status={p.status as string} /></td>
                <td className="p-3 text-zinc-300 capitalize">{p.method as string}</td>
                <td className="p-3 text-zinc-400 text-xs">{p.email as string}</td>
                <td className="p-3 text-zinc-400">{formatDateTime(p.created_at as number)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Pagination page={page} totalPages={data.totalPages} onPageChange={load} />
    </div>
  );
}

// --- Orders Tab ---

function OrdersTab() {
  const [data, setData] = useState<PaginatedResult<Record<string, unknown>> | null>(null);
  const [page, setPage] = useState(1);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [isPending, startTransition] = useTransition();

  const load = (p: number) => {
    startTransition(async () => {
      const result = await getRazorpayOrders({ page: p, from: from || undefined, to: to || undefined });
      setData(result);
      setPage(p);
    });
  };

  useEffect(() => { load(1); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!data && isPending) return <LoadingState />;
  if (data?.error) return <ErrorBanner message={data.error} />;
  if (!data || data.items.length === 0) return <EmptyState label="orders" />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="text-xs text-zinc-500 block mb-1">From</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="bg-zinc-900 border border-zinc-700 rounded-md px-3 py-1.5 text-sm text-white" />
        </div>
        <div>
          <label className="text-xs text-zinc-500 block mb-1">To</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
            className="bg-zinc-900 border border-zinc-700 rounded-md px-3 py-1.5 text-sm text-white" />
        </div>
        <button onClick={() => load(1)} disabled={isPending}
          className="px-4 py-1.5 text-sm rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">
          {isPending ? "Loading..." : "Filter"}
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-zinc-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800 bg-zinc-900/50">
              <th className="text-left p-3 text-zinc-400 font-medium">Order ID</th>
              <th className="text-left p-3 text-zinc-400 font-medium">Amount</th>
              <th className="text-left p-3 text-zinc-400 font-medium">Paid</th>
              <th className="text-left p-3 text-zinc-400 font-medium">Due</th>
              <th className="text-left p-3 text-zinc-400 font-medium">Status</th>
              <th className="text-left p-3 text-zinc-400 font-medium">Receipt</th>
              <th className="text-left p-3 text-zinc-400 font-medium">Date</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((o) => (
              <tr key={o.id as string} className="border-b border-zinc-800/50 hover:bg-zinc-900/30">
                <td className="p-3 text-zinc-300 font-mono text-xs">{(o.id as string).slice(0, 18)}...</td>
                <td className="p-3 text-white">{formatPrice(o.amount as number)}</td>
                <td className="p-3 text-emerald-400">{formatPrice(o.amount_paid as number)}</td>
                <td className="p-3 text-yellow-400">{formatPrice(o.amount_due as number)}</td>
                <td className="p-3"><StatusBadge status={o.status as string} /></td>
                <td className="p-3 text-zinc-400 text-xs font-mono">{(o.receipt as string) || "—"}</td>
                <td className="p-3 text-zinc-400">{formatDate(o.created_at as number)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Pagination page={page} totalPages={data.totalPages} onPageChange={load} />
    </div>
  );
}

// --- Refunds Tab ---

function RefundsTab() {
  const [data, setData] = useState<PaginatedResult<Record<string, unknown>> | null>(null);
  const [page, setPage] = useState(1);
  const [isPending, startTransition] = useTransition();

  const load = (p: number) => {
    startTransition(async () => {
      const result = await getRazorpayRefunds({ page: p });
      setData(result);
      setPage(p);
    });
  };

  useEffect(() => { load(1); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!data && isPending) return <LoadingState />;
  if (data?.error) return <ErrorBanner message={data.error} />;
  if (!data || data.items.length === 0) return <EmptyState label="refunds" />;

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-xl border border-zinc-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800 bg-zinc-900/50">
              <th className="text-left p-3 text-zinc-400 font-medium">Refund ID</th>
              <th className="text-left p-3 text-zinc-400 font-medium">Payment ID</th>
              <th className="text-left p-3 text-zinc-400 font-medium">Amount</th>
              <th className="text-left p-3 text-zinc-400 font-medium">Status</th>
              <th className="text-left p-3 text-zinc-400 font-medium">Date</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((r) => (
              <tr key={r.id as string} className="border-b border-zinc-800/50 hover:bg-zinc-900/30">
                <td className="p-3 text-zinc-300 font-mono text-xs">{(r.id as string).slice(0, 18)}...</td>
                <td className="p-3 text-zinc-400 font-mono text-xs">{(r.payment_id as string)?.slice(0, 18)}...</td>
                <td className="p-3 text-white">{formatPrice(r.amount as number)}</td>
                <td className="p-3"><StatusBadge status={r.status as string} /></td>
                <td className="p-3 text-zinc-400">{formatDate(r.created_at as number)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Pagination page={page} totalPages={data.totalPages} onPageChange={load} />
    </div>
  );
}

// --- Settlements Tab ---

function SettlementsTab() {
  const [data, setData] = useState<PaginatedResult<Record<string, unknown>> | null>(null);
  const [page, setPage] = useState(1);
  const [isPending, startTransition] = useTransition();

  const load = (p: number) => {
    startTransition(async () => {
      const result = await getRazorpaySettlements({ page: p });
      setData(result);
      setPage(p);
    });
  };

  useEffect(() => { load(1); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!data && isPending) return <LoadingState />;
  if (data?.error) return <ErrorBanner message={data.error} />;
  if (!data || data.items.length === 0) return <EmptyState label="settlements" />;

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-xl border border-zinc-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800 bg-zinc-900/50">
              <th className="text-left p-3 text-zinc-400 font-medium">ID</th>
              <th className="text-left p-3 text-zinc-400 font-medium">Amount</th>
              <th className="text-left p-3 text-zinc-400 font-medium">Fees</th>
              <th className="text-left p-3 text-zinc-400 font-medium">Tax</th>
              <th className="text-left p-3 text-zinc-400 font-medium">UTR</th>
              <th className="text-left p-3 text-zinc-400 font-medium">Status</th>
              <th className="text-left p-3 text-zinc-400 font-medium">Date</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((s) => (
              <tr key={s.id as string} className="border-b border-zinc-800/50 hover:bg-zinc-900/30">
                <td className="p-3 text-zinc-300 font-mono text-xs">{(s.id as string).slice(0, 18)}...</td>
                <td className="p-3 text-white">{formatPrice(s.amount as number)}</td>
                <td className="p-3 text-zinc-400">{formatPrice(s.fees as number)}</td>
                <td className="p-3 text-zinc-400">{formatPrice(s.tax as number)}</td>
                <td className="p-3 text-zinc-400 font-mono text-xs">{(s.utr as string) || "—"}</td>
                <td className="p-3"><StatusBadge status={s.status as string} /></td>
                <td className="p-3 text-zinc-400">{formatDate(s.created_at as number)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Pagination page={page} totalPages={data.totalPages} onPageChange={load} />
    </div>
  );
}

// --- Loading state ---

function LoadingState() {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-12 text-center text-zinc-500">
      Loading...
    </div>
  );
}

// --- Main Dashboard ---

export function RazorpayDashboard({
  initialOverview,
}: {
  initialOverview: RazorpayOverview;
}) {
  const [activeTab, setActiveTab] = useState<TabKey>("overview");

  return (
    <div className="space-y-6">
      {/* Tab switcher */}
      <div className="flex gap-1 overflow-x-auto">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors whitespace-nowrap ${
              activeTab === tab.key
                ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                : "bg-zinc-800 text-zinc-400 border border-zinc-700 hover:bg-zinc-700"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "overview" && <OverviewTab overview={initialOverview} />}
      {activeTab === "payments" && <PaymentsTab />}
      {activeTab === "orders" && <OrdersTab />}
      {activeTab === "refunds" && <RefundsTab />}
      {activeTab === "settlements" && <SettlementsTab />}
    </div>
  );
}
