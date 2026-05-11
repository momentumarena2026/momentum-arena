"use client";

import { useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Gift,
  RotateCcw,
  Clock,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { getMyRewardTransactions, type RewardTxnRow } from "@/actions/rewards";

interface Props {
  initialRows: RewardTxnRow[];
  initialNextCursor: string | null;
  initialHasMore: boolean;
}

function txnLabel(type: string): string {
  switch (type) {
    case "EARNED_BOOKING":
      return "Booking reward";
    case "EARNED_CAFE":
      return "Cafe reward";
    case "EARNED_SIGNUP":
      return "Welcome bonus";
    case "EARNED_REFERRAL":
      return "Referral bonus";
    case "EARNED_BIRTHDAY":
      return "Birthday bonus";
    case "EARNED_ADJUSTMENT":
      return "Bonus points";
    case "ADJUSTMENT_REFUND":
      return "Refund credit";
    case "REDEEMED_BOOKING":
      return "Booking discount";
    case "REDEEMED_CAFE":
      return "Cafe discount";
    case "REVOKED":
      return "Reversed";
    case "EXPIRED":
      return "Expired";
    case "ADJUSTMENT_DEBIT":
      return "Adjustment";
    default:
      return type;
  }
}

function isCredit(type: string): boolean {
  return type.startsWith("EARNED_") || type === "ADJUSTMENT_REFUND";
}

function txnIcon(type: string) {
  if (type === "REDEEMED_BOOKING" || type === "REDEEMED_CAFE")
    return <ArrowUpFromLine className="h-4 w-4" />;
  if (type === "EXPIRED") return <Clock className="h-4 w-4" />;
  if (type === "REVOKED" || type === "ADJUSTMENT_DEBIT")
    return <RotateCcw className="h-4 w-4" />;
  if (type === "ADJUSTMENT_REFUND") return <TrendingUp className="h-4 w-4" />;
  if (type === "EARNED_ADJUSTMENT" || type === "EARNED_SIGNUP" || type === "EARNED_BIRTHDAY")
    return <Gift className="h-4 w-4" />;
  return <ArrowDownToLine className="h-4 w-4" />;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function RewardsTransactionList({
  initialRows,
  initialNextCursor,
  initialHasMore,
}: Props) {
  const [rows, setRows] = useState<RewardTxnRow[]>(initialRows);
  const [cursor, setCursor] = useState<string | null>(initialNextCursor);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loading, setLoading] = useState(false);

  async function loadMore() {
    if (!cursor || loading) return;
    setLoading(true);
    try {
      const data = await getMyRewardTransactions({ before: cursor, limit: 20 });
      if (!data) {
        setHasMore(false);
        return;
      }
      setRows((prev) => [...prev, ...data.rows]);
      setCursor(data.nextCursor);
      setHasMore(data.hasMore);
    } finally {
      setLoading(false);
    }
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-800 bg-zinc-900/30 py-12 px-6 text-center">
        <div className="rounded-full bg-zinc-800/80 p-4 mb-4">
          <TrendingDown className="h-6 w-6 text-zinc-600" />
        </div>
        <p className="text-sm font-medium text-zinc-400">No activity yet</p>
        <p className="mt-1 text-xs text-zinc-600">
          Your points history will show up here
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {rows.map((r) => {
        const credit = isCredit(r.type);
        return (
          <div
            key={r.id}
            className="flex items-center gap-3 rounded-xl border border-zinc-800/80 bg-zinc-900/50 p-4"
          >
            <div
              className={`shrink-0 rounded-lg p-2 ${
                credit
                  ? "bg-emerald-500/15 text-emerald-400"
                  : "bg-zinc-800 text-zinc-400"
              }`}
            >
              {txnIcon(r.type)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">
                {txnLabel(r.type)}
              </p>
              <p className="text-[11px] text-zinc-500">
                {formatDate(r.createdAt)}
                {r.reason ? ` • ${r.reason}` : ""}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p
                className={`text-sm font-bold ${
                  credit ? "text-emerald-400" : "text-zinc-300"
                }`}
              >
                {credit ? "+" : ""}
                {r.points.toLocaleString("en-IN")}
              </p>
              <p className="text-[10px] text-zinc-600">pts</p>
            </div>
          </div>
        );
      })}

      {hasMore && (
        <button
          type="button"
          onClick={loadMore}
          disabled={loading}
          className="w-full rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-3 text-sm text-zinc-400 transition-colors hover:bg-zinc-900 disabled:opacity-50"
        >
          {loading ? "Loading…" : "Load more"}
        </button>
      )}
    </div>
  );
}
