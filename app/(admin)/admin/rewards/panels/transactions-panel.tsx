"use client";

/**
 * Reward transactions ledger — admin tab for reconciling every earned
 * and redeemed point across all users.
 *
 * Filters (URL-stateful so refresh / share-link preserve state):
 *   - q       free-text user search (name / email / phone)
 *   - from    yyyy-mm-dd (IST midnight)
 *   - to      yyyy-mm-dd (inclusive of the day)
 *   - types   comma-separated RewardTxnType list (multi-select)
 *   - dir     credit | debit | all
 *   - src     bookingId or cafeOrderId (exact match)
 *   - actor   admin username/email substring (for ADJUSTMENT_* rows)
 *   - page    0-indexed page number (50/page)
 *
 * Footer aggregates show credit/debit/net totals over the WHOLE
 * filtered result (not just the current page) so reconciliation
 * tallies stay correct as you page through.
 *
 * Export button hits /api/admin/rewards/transactions/export which
 * streams the same filtered set to XLSX.
 */

import { useEffect, useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Download,
  Filter,
  Loader2,
  Search,
} from "lucide-react";
import {
  listRewardTransactions,
  REWARD_TXN_TYPES_ALL,
  type AdminRewardTxnLedger,
  type AdminRewardTxnRow,
  type RewardTxnTypeFilter,
} from "@/actions/admin-rewards";

const TYPE_LABELS: Record<RewardTxnTypeFilter, string> = {
  EARNED_BOOKING: "Earn — booking",
  EARNED_BOOKING_REMAINDER: "Earn — booking remainder",
  EARNED_CAFE: "Earn — cafe",
  EARNED_SIGNUP: "Earn — signup",
  EARNED_REFERRAL: "Earn — referral",
  EARNED_BIRTHDAY: "Earn — birthday",
  EARNED_ADJUSTMENT: "Earn — admin grant",
  ADJUSTMENT_REFUND: "Refund — re-credit",
  REDEEMED_BOOKING: "Redeem — booking",
  REDEEMED_CAFE: "Redeem — cafe",
  REVOKED: "Revoke — clawback",
  EXPIRED: "Expired",
  ADJUSTMENT_DEBIT: "Debit — admin",
};

const PAGE_SIZE = 50;

export function RewardsTransactionsPanel() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Parse current filter state from URL. We keep URL as the source of
  // truth so refresh / share-link survive — same pattern as the
  // bookings admin filters.
  const filters = useMemo(() => parseFilters(searchParams), [searchParams]);

  // Draft state for the filter form. Submitted to URL on Apply / Enter.
  const [draftQ, setDraftQ] = useState(filters.q);
  const [draftFrom, setDraftFrom] = useState(filters.from);
  const [draftTo, setDraftTo] = useState(filters.to);
  const [draftTypes, setDraftTypes] = useState<RewardTxnTypeFilter[]>(filters.types);
  const [draftDir, setDraftDir] = useState(filters.dir);
  const [draftSrc, setDraftSrc] = useState(filters.src);
  const [draftActor, setDraftActor] = useState(filters.actor);
  const [showTypes, setShowTypes] = useState(false);

  // Reset drafts when URL changes (e.g. via Back button).
  useEffect(() => {
    setDraftQ(filters.q);
    setDraftFrom(filters.from);
    setDraftTo(filters.to);
    setDraftTypes(filters.types);
    setDraftDir(filters.dir);
    setDraftSrc(filters.src);
    setDraftActor(filters.actor);
  }, [filters]);

  const [data, setData] = useState<AdminRewardTxnLedger | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Fetch whenever URL filters change.
  useEffect(() => {
    startTransition(async () => {
      try {
        setError(null);
        const result = await listRewardTransactions({
          query: filters.q || undefined,
          fromDate: filters.from || undefined,
          toDate: filters.to || undefined,
          types: filters.types.length > 0 ? filters.types : undefined,
          direction: filters.dir === "all" ? undefined : filters.dir,
          sourceId: filters.src || undefined,
          actorQuery: filters.actor || undefined,
          page: filters.page,
          pageSize: PAGE_SIZE,
        });
        setData(result);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't load transactions");
      }
    });
  }, [filters]);

  function apply() {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", "transactions");
    setOrDelete(params, "q", draftQ);
    setOrDelete(params, "from", draftFrom);
    setOrDelete(params, "to", draftTo);
    setOrDelete(params, "types", draftTypes.join(","));
    setOrDelete(params, "dir", draftDir === "all" ? "" : draftDir);
    setOrDelete(params, "src", draftSrc);
    setOrDelete(params, "actor", draftActor);
    params.delete("page"); // reset pagination on new filter set
    router.replace(`${pathname}?${params.toString()}`);
  }

  function clearAll() {
    const params = new URLSearchParams();
    params.set("tab", "transactions");
    router.replace(`${pathname}?${params.toString()}`);
  }

  function setPage(next: number) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === 0) params.delete("page");
    else params.set("page", String(next));
    router.replace(`${pathname}?${params.toString()}`);
  }

  function toggleType(t: RewardTxnTypeFilter) {
    setDraftTypes((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t],
    );
  }

  function downloadXlsx() {
    const params = new URLSearchParams();
    if (filters.q) params.set("q", filters.q);
    if (filters.from) params.set("from", filters.from);
    if (filters.to) params.set("to", filters.to);
    if (filters.types.length > 0) params.set("types", filters.types.join(","));
    if (filters.dir !== "all") params.set("dir", filters.dir);
    if (filters.src) params.set("src", filters.src);
    if (filters.actor) params.set("actor", filters.actor);
    const url = `/api/admin/rewards/transactions/export?${params.toString()}`;
    window.location.href = url;
  }

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;
  const aggs = data?.aggregates;

  return (
    <div className="space-y-4">
      {/* Filter form */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          apply();
        }}
        className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-3"
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {/* User search */}
          <div>
            <label className="mb-1 block text-xs font-medium uppercase text-zinc-500">
              User
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-zinc-500" />
              <input
                type="search"
                value={draftQ}
                onChange={(e) => setDraftQ(e.target.value)}
                placeholder="Name, email, or phone"
                className="w-full rounded-md border border-zinc-800 bg-zinc-950 pl-9 pr-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Date range */}
          <div>
            <label className="mb-1 block text-xs font-medium uppercase text-zinc-500">
              From
            </label>
            <input
              type="date"
              value={draftFrom}
              onChange={(e) => setDraftFrom(e.target.value)}
              className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase text-zinc-500">
              To
            </label>
            <input
              type="date"
              value={draftTo}
              onChange={(e) => setDraftTo(e.target.value)}
              className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
            />
          </div>

          {/* Direction */}
          <div>
            <label className="mb-1 block text-xs font-medium uppercase text-zinc-500">
              Direction
            </label>
            <div className="flex rounded-md border border-zinc-800 bg-zinc-950 p-0.5">
              {(["all", "credit", "debit"] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDraftDir(d)}
                  className={`flex-1 rounded px-2 py-1.5 text-xs font-medium capitalize transition ${
                    draftDir === d
                      ? d === "credit"
                        ? "bg-emerald-600 text-white"
                        : d === "debit"
                          ? "bg-rose-600 text-white"
                          : "bg-zinc-700 text-white"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>

          {/* Source ID */}
          <div>
            <label className="mb-1 block text-xs font-medium uppercase text-zinc-500">
              Source ID
            </label>
            <input
              type="text"
              value={draftSrc}
              onChange={(e) => setDraftSrc(e.target.value)}
              placeholder="Booking or cafe order ID"
              className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
            />
          </div>

          {/* Admin actor */}
          <div>
            <label className="mb-1 block text-xs font-medium uppercase text-zinc-500">
              Admin actor
            </label>
            <input
              type="text"
              value={draftActor}
              onChange={(e) => setDraftActor(e.target.value)}
              placeholder="Username or email"
              className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
            />
          </div>

          {/* Types multi-select */}
          <div className="sm:col-span-2 lg:col-span-2">
            <label className="mb-1 block text-xs font-medium uppercase text-zinc-500">
              Types {draftTypes.length > 0 && `(${draftTypes.length})`}
            </label>
            <button
              type="button"
              onClick={() => setShowTypes((v) => !v)}
              className="flex w-full items-center justify-between rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-300 hover:border-zinc-700"
            >
              <span className="flex items-center gap-2">
                <Filter className="h-3.5 w-3.5" />
                {draftTypes.length === 0
                  ? "All types"
                  : draftTypes.map((t) => TYPE_LABELS[t]).join(", ")}
              </span>
              <span className="text-xs text-zinc-500">
                {showTypes ? "▴" : "▾"}
              </span>
            </button>
            {showTypes && (
              <div className="mt-2 grid gap-1.5 rounded-md border border-zinc-800 bg-zinc-950/80 p-3 sm:grid-cols-2">
                {REWARD_TXN_TYPES_ALL.map((t) => {
                  const on = draftTypes.includes(t);
                  return (
                    <label
                      key={t}
                      className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-zinc-900"
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => toggleType(t)}
                        className="h-3.5 w-3.5 rounded border-zinc-700 bg-zinc-900 text-emerald-500 focus:ring-emerald-500"
                      />
                      <span className="text-xs text-zinc-200">
                        {TYPE_LABELS[t]}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={clearAll}
            className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-300 hover:border-zinc-700"
          >
            Clear filters
          </button>
          <button
            type="submit"
            disabled={pending}
            className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-60"
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Filter className="h-4 w-4" />}
            Apply
          </button>
          <button
            type="button"
            onClick={downloadXlsx}
            disabled={!data || data.rows.length === 0}
            className="inline-flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-60"
          >
            <Download className="h-4 w-4" />
            Export XLSX
          </button>
        </div>
      </form>

      {/* Aggregates strip */}
      {aggs && (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <AggCard
            label="Credits"
            value={aggs.creditPoints.toLocaleString("en-IN")}
            sub={`${aggs.creditCount.toLocaleString("en-IN")} rows · ₹${Math.round(aggs.creditValuePaise / 100).toLocaleString("en-IN")}`}
            tone="credit"
            Icon={ArrowDownToLine}
          />
          <AggCard
            label="Debits"
            value={aggs.debitPoints.toLocaleString("en-IN")}
            sub={`${aggs.debitCount.toLocaleString("en-IN")} rows · ₹${Math.round(aggs.debitValuePaise / 100).toLocaleString("en-IN")}`}
            tone="debit"
            Icon={ArrowUpFromLine}
          />
          <AggCard
            label="Net"
            value={aggs.netPoints.toLocaleString("en-IN")}
            sub="credits − debits"
            tone={aggs.netPoints >= 0 ? "credit" : "debit"}
            Icon={ArrowDownToLine}
          />
          <AggCard
            label="Rows matched"
            value={(data?.total ?? 0).toLocaleString("en-IN")}
            sub={
              data?.aggregateTruncated
                ? `Aggregates from first 10,000 — narrow filters`
                : `Page ${(data?.page ?? 0) + 1} of ${Math.max(totalPages, 1)}`
            }
            tone="neutral"
            Icon={ArrowDownToLine}
          />
        </div>
      )}

      {error && (
        <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-zinc-800">
        <table className="min-w-full divide-y divide-zinc-800 text-sm">
          <thead className="bg-zinc-950/60 text-zinc-500">
            <tr>
              <Th>When</Th>
              <Th>User</Th>
              <Th>Type</Th>
              <Th align="right">Points</Th>
              <Th align="right">Value</Th>
              <Th>Source</Th>
              <Th>Actor / reason</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/60">
            {data && data.rows.length === 0 && !pending ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-zinc-500">
                  No transactions match these filters.
                </td>
              </tr>
            ) : (
              data?.rows.map((r) => <TxnRow key={r.id} row={r} />)
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {data && data.total > PAGE_SIZE && (
        <div className="flex items-center justify-between text-xs text-zinc-500">
          <span>
            {data.page * PAGE_SIZE + 1}–
            {Math.min((data.page + 1) * PAGE_SIZE, data.total)} of{" "}
            {data.total.toLocaleString("en-IN")}
          </span>
          <div className="flex gap-1">
            <button
              type="button"
              disabled={data.page === 0}
              onClick={() => setPage(data.page - 1)}
              className="rounded border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-300 hover:border-zinc-700 disabled:opacity-40"
            >
              Prev
            </button>
            <button
              type="button"
              disabled={data.page + 1 >= totalPages}
              onClick={() => setPage(data.page + 1)}
              className="rounded border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-300 hover:border-zinc-700 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function parseFilters(p: URLSearchParams) {
  const types = (p.get("types") ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter((t): t is RewardTxnTypeFilter =>
      (REWARD_TXN_TYPES_ALL as readonly string[]).includes(t),
    );
  const rawDir = p.get("dir");
  const dir: "credit" | "debit" | "all" =
    rawDir === "credit" || rawDir === "debit" ? rawDir : "all";
  return {
    q: p.get("q") ?? "",
    from: p.get("from") ?? "",
    to: p.get("to") ?? "",
    types,
    dir,
    src: p.get("src") ?? "",
    actor: p.get("actor") ?? "",
    page: Math.max(0, parseInt(p.get("page") ?? "0", 10) || 0),
  };
}

function setOrDelete(params: URLSearchParams, key: string, value: string) {
  if (value) params.set(key, value);
  else params.delete(key);
}

function Th({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      className={`px-3 py-2 text-xs font-semibold uppercase tracking-wider ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}

function TxnRow({ row }: { row: AdminRewardTxnRow }) {
  const credit = row.points > 0;
  const when = new Date(row.createdAt).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const sourceId = row.bookingId ?? row.cafeOrderId ?? null;
  const sourceLabel = row.bookingId
    ? `Booking ${row.bookingId.slice(-6)}`
    : row.cafeOrderId
      ? `Cafe ${row.cafeOrderId.slice(-6)}`
      : "—";

  return (
    <tr className="hover:bg-zinc-900/40">
      <td className="px-3 py-2 text-zinc-400 whitespace-nowrap">{when}</td>
      <td className="px-3 py-2">
        <div className="flex flex-col">
          <span className="font-medium text-white">{row.user.name ?? "—"}</span>
          <span className="text-xs text-zinc-500">
            {row.user.phone ?? row.user.email ?? row.user.id.slice(-8)}
          </span>
        </div>
      </td>
      <td className="px-3 py-2 text-zinc-300 whitespace-nowrap">
        {TYPE_LABELS[row.type] ?? row.type}
      </td>
      <td
        className={`px-3 py-2 text-right font-semibold whitespace-nowrap ${
          credit ? "text-emerald-400" : "text-rose-400"
        }`}
      >
        {credit ? "+" : ""}
        {row.points.toLocaleString("en-IN")}
      </td>
      <td className="px-3 py-2 text-right text-zinc-400 whitespace-nowrap">
        ₹{Math.round(row.pointsValuePaise / 100).toLocaleString("en-IN")}
      </td>
      <td className="px-3 py-2 text-zinc-400" title={sourceId ?? undefined}>
        {sourceLabel}
      </td>
      <td className="px-3 py-2 text-xs text-zinc-500 max-w-[240px]">
        {row.actor ? (
          <div>
            <span className="text-zinc-300">@{row.actor.username}</span>
            {row.reason && <div className="mt-0.5 text-zinc-500">{row.reason}</div>}
          </div>
        ) : row.reason ? (
          <span>{row.reason}</span>
        ) : (
          "—"
        )}
      </td>
    </tr>
  );
}

function AggCard({
  label,
  value,
  sub,
  tone,
  Icon,
}: {
  label: string;
  value: string;
  sub: string;
  tone: "credit" | "debit" | "neutral";
  Icon: typeof ArrowDownToLine;
}) {
  const toneClass =
    tone === "credit"
      ? "text-emerald-400"
      : tone === "debit"
        ? "text-rose-400"
        : "text-zinc-200";
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
      <div className="flex items-center gap-1.5">
        <Icon className={`h-3.5 w-3.5 ${toneClass}`} />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
          {label}
        </span>
      </div>
      <div className={`mt-1 text-lg font-bold ${toneClass}`}>{value}</div>
      <div className="text-[11px] text-zinc-500">{sub}</div>
    </div>
  );
}
