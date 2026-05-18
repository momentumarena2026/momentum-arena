"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Clock,
  Coffee,
  ExternalLink,
  Gift,
  Hash,
  Receipt,
  RotateCcw,
  ShoppingBag,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { getMyRewardTransactions, type RewardTxnRow } from "@/actions/rewards";

interface Props {
  initialRows: RewardTxnRow[];
  initialNextCursor: string | null;
  initialHasMore: boolean;
}

// Display metadata for every RewardTransaction.type the API can emit.
// Centralised so the icon + label + tone stay in lock-step — earlier
// the list had label + icon defined in separate switches and they
// drifted when a new enum value was added.
const TXN_META: Record<
  string,
  {
    label: string;
    /** Plain-English caption shown under the label. */
    desc: string;
    /** "credit" → emerald (earn); "debit" → yellow (redeem);
     *  "neutral" → zinc (expired / reversed / adjustments). */
    tone: "credit" | "debit" | "neutral";
    Icon: React.ComponentType<{ className?: string }>;
  }
> = {
  EARNED_BOOKING: {
    label: "Booking reward",
    desc: "Points earned from a confirmed booking",
    tone: "credit",
    Icon: ArrowDownToLine,
  },
  EARNED_CAFE: {
    label: "Cafe reward",
    desc: "Points earned on a cafe order",
    tone: "credit",
    Icon: Coffee,
  },
  EARNED_SIGNUP: {
    label: "Welcome bonus",
    desc: "Onboarding gift — thanks for signing up",
    tone: "credit",
    Icon: Sparkles,
  },
  EARNED_REFERRAL: {
    label: "Referral bonus",
    desc: "A friend you referred booked their first slot",
    tone: "credit",
    Icon: Gift,
  },
  EARNED_BIRTHDAY: {
    label: "Birthday bonus",
    desc: "Happy birthday from Momentum Arena",
    tone: "credit",
    Icon: Gift,
  },
  EARNED_ADJUSTMENT: {
    label: "Bonus points",
    desc: "Manual credit by the venue admin",
    tone: "credit",
    Icon: Gift,
  },
  ADJUSTMENT_REFUND: {
    label: "Refund credit",
    desc: "Points returned after a refund",
    tone: "credit",
    Icon: TrendingUp,
  },
  REDEEMED_BOOKING: {
    label: "Booking discount",
    desc: "Points spent on a booking checkout",
    tone: "debit",
    Icon: ArrowUpFromLine,
  },
  REDEEMED_CAFE: {
    label: "Cafe discount",
    desc: "Points spent on a cafe order",
    tone: "debit",
    Icon: ArrowUpFromLine,
  },
  REVOKED: {
    label: "Reversed",
    desc: "An earlier credit was reversed (e.g. booking cancellation)",
    tone: "neutral",
    Icon: RotateCcw,
  },
  EXPIRED: {
    label: "Expired",
    desc: "Points expired — past the 12-month window",
    tone: "neutral",
    Icon: Clock,
  },
  ADJUSTMENT_DEBIT: {
    label: "Adjustment",
    desc: "Manual debit by the venue admin",
    tone: "neutral",
    Icon: RotateCcw,
  },
};

const FALLBACK_META = TXN_META.EARNED_ADJUSTMENT;

const TONE_STYLES = {
  credit: {
    iconBg: "bg-emerald-500/15",
    iconRing: "ring-emerald-500/30",
    iconText: "text-emerald-400",
    pointsText: "text-emerald-400",
    rupeesText: "text-emerald-300/80",
  },
  debit: {
    iconBg: "bg-yellow-500/15",
    iconRing: "ring-yellow-500/30",
    iconText: "text-yellow-300",
    pointsText: "text-yellow-300",
    rupeesText: "text-yellow-200/80",
  },
  neutral: {
    iconBg: "bg-zinc-800",
    iconRing: "ring-zinc-700",
    iconText: "text-zinc-400",
    pointsText: "text-zinc-300",
    rupeesText: "text-zinc-500",
  },
} as const;

type Filter = "ALL" | "EARNED" | "REDEEMED";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });
}

/** "in 3 days", "today", "in 2 months" — for expiry hints. Approximate
 *  on purpose; the user just needs urgency, not exact decay timestamps. */
function relativeFromNow(iso: string): string {
  const target = new Date(iso).getTime();
  const now = Date.now();
  const diffDays = Math.round((target - now) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return "expired";
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "tomorrow";
  if (diffDays < 30) return `in ${diffDays} days`;
  const months = Math.round(diffDays / 30);
  return months === 1 ? "in 1 month" : `in ${months} months`;
}

function formatPaiseAsRupees(paise: number): string {
  if (!paise) return "₹0";
  const rupees = Math.abs(paise) / 100;
  // Show paise when value isn't a whole rupee — e.g. ₹1.50
  const isWhole = rupees === Math.floor(rupees);
  return `₹${rupees.toLocaleString("en-IN", {
    minimumFractionDigits: isWhole ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Short, copy-friendly transaction ID — "TXN · 1A2B3C". The full id
 *  is a long cuid, useless for the user but handy for support; we
 *  show the last 6 chars uppercased. */
function shortTxnId(id: string): string {
  return id.slice(-6).toUpperCase();
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
  const [filter, setFilter] = useState<Filter>("ALL");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Quick this-month tally for the header strip. Computed client-side
  // off the loaded rows — paginated load-more will keep increasing the
  // window naturally without a separate aggregate fetch.
  const monthTotals = useMemo(() => {
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${now.getMonth()}`;
    let earned = 0;
    let redeemed = 0;
    for (const r of rows) {
      const d = new Date(r.createdAt);
      if (`${d.getFullYear()}-${d.getMonth()}` !== monthKey) continue;
      if (r.points > 0) earned += r.points;
      else if (r.points < 0) redeemed += Math.abs(r.points);
    }
    return { earned, redeemed };
  }, [rows]);

  const filteredRows = useMemo(() => {
    if (filter === "ALL") return rows;
    if (filter === "EARNED") return rows.filter((r) => r.points > 0);
    if (filter === "REDEEMED") return rows.filter((r) => r.points < 0);
    return rows;
  }, [rows, filter]);

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

  async function copyId(id: string) {
    try {
      await navigator.clipboard.writeText(id);
      setCopiedId(id);
      setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1500);
    } catch {
      // Clipboard refusal (insecure context, permission) — silently
      // skip; the user can still tap-and-hold to copy on mobile.
    }
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/30 py-12 px-6 text-center">
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
    <div className="space-y-4">
      {/* This month strip — gives the user a glanceable summary above
          the long list. earned is emerald, redeemed is yellow — matches
          the per-row color coding below so the values are obvious. */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-emerald-300/80">
            Earned this month
          </p>
          <p className="mt-1 text-xl font-bold text-emerald-300">
            +{monthTotals.earned.toLocaleString("en-IN")}
            <span className="ml-1 text-xs font-medium text-emerald-400/70">
              pts
            </span>
          </p>
        </div>
        <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/5 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-yellow-300/80">
            Redeemed this month
          </p>
          <p className="mt-1 text-xl font-bold text-yellow-300">
            −{monthTotals.redeemed.toLocaleString("en-IN")}
            <span className="ml-1 text-xs font-medium text-yellow-400/70">
              pts
            </span>
          </p>
        </div>
      </div>

      {/* Filter pills — All / Earned / Redeemed. Filters the loaded
          window only; pagination still loads the full chronological
          stream so a filter change can reveal more rows on next
          load-more. */}
      <div className="flex items-center gap-2">
        {(["ALL", "EARNED", "REDEEMED"] as const).map((f) => {
          const active = filter === f;
          const label =
            f === "ALL" ? "All" : f === "EARNED" ? "Earned" : "Redeemed";
          return (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                active
                  ? f === "EARNED"
                    ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-300"
                    : f === "REDEEMED"
                      ? "border-yellow-500/50 bg-yellow-500/15 text-yellow-300"
                      : "border-zinc-600 bg-zinc-800 text-white"
                  : "border-zinc-800 bg-zinc-900/40 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Detailed transaction rows */}
      <div className="space-y-2">
        {filteredRows.map((r) => {
          const meta = TXN_META[r.type] ?? FALLBACK_META;
          const tone = TONE_STYLES[meta.tone];
          const Icon = meta.Icon;
          const rupeesValue = formatPaiseAsRupees(r.pointsValuePaise);
          const isEarn = r.points > 0;
          const isRedeem = r.points < 0;

          return (
            <div
              key={r.id}
              className="group rounded-2xl border border-zinc-800/80 bg-zinc-900/50 p-4 transition-colors hover:border-zinc-700"
            >
              <div className="flex items-start gap-3">
                <div
                  className={`shrink-0 rounded-lg p-2.5 ring-1 ${tone.iconBg} ${tone.iconRing}`}
                >
                  <Icon className={`h-4 w-4 ${tone.iconText}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-white truncate">
                      {meta.label}
                    </p>
                    <div className="shrink-0 text-right">
                      <p className={`text-base font-bold ${tone.pointsText}`}>
                        {isEarn ? "+" : isRedeem ? "−" : ""}
                        {Math.abs(r.points).toLocaleString("en-IN")}
                        <span className="ml-1 text-[10px] font-medium text-zinc-500">
                          pts
                        </span>
                      </p>
                      {r.pointsValuePaise > 0 && (
                        <p className={`text-[11px] ${tone.rupeesText}`}>
                          {isEarn ? "worth " : isRedeem ? "saved " : ""}
                          {rupeesValue}
                        </p>
                      )}
                    </div>
                  </div>
                  <p className="mt-0.5 text-xs text-zinc-400">{meta.desc}</p>

                  {/* Metadata strip — date · txn id · linked booking / cafe order.
                      Renders only the relevant chips so EXPIRED rows
                      don't get a dangling "Booking #—". */}
                  <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-zinc-500">
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {formatDate(r.createdAt)}
                    </span>

                    <span className="text-zinc-700">·</span>

                    <button
                      type="button"
                      onClick={() => copyId(r.id)}
                      className="inline-flex items-center gap-1 rounded text-zinc-500 hover:text-zinc-300 transition-colors"
                      title="Tap to copy the full transaction ID"
                    >
                      <Hash className="h-3 w-3" />
                      TXN&nbsp;{shortTxnId(r.id)}
                      {copiedId === r.id && (
                        <span className="ml-1 text-emerald-400">copied</span>
                      )}
                    </button>

                    {r.bookingId && (
                      <>
                        <span className="text-zinc-700">·</span>
                        <Link
                          href={`/book/confirmation?id=${r.bookingId}`}
                          className="inline-flex items-center gap-1 text-zinc-400 hover:text-emerald-300 transition-colors"
                          title="View this booking"
                        >
                          <Receipt className="h-3 w-3" />
                          Booking&nbsp;{shortTxnId(r.bookingId)}
                          <ExternalLink className="h-2.5 w-2.5 opacity-60 group-hover:opacity-100" />
                        </Link>
                      </>
                    )}

                    {r.cafeOrderId && (
                      <>
                        <span className="text-zinc-700">·</span>
                        <span className="inline-flex items-center gap-1 text-zinc-400">
                          <ShoppingBag className="h-3 w-3" />
                          Cafe&nbsp;{shortTxnId(r.cafeOrderId)}
                        </span>
                      </>
                    )}

                    {r.reason && (
                      <>
                        <span className="text-zinc-700">·</span>
                        <span className="italic text-zinc-500 truncate">
                          {r.reason}
                        </span>
                      </>
                    )}

                    {/* Expiry hint — only on earn rows that haven't been
                        fully spent / expired. Yellow when close (under
                        30 days) to nudge the user to redeem. */}
                    {meta.tone === "credit" && r.expiresAt && (() => {
                      const target = new Date(r.expiresAt).getTime();
                      const diffDays = Math.round(
                        (target - Date.now()) / (1000 * 60 * 60 * 24),
                      );
                      const isUrgent = diffDays >= 0 && diffDays < 30;
                      return (
                        <>
                          <span className="text-zinc-700">·</span>
                          <span
                            className={`inline-flex items-center gap-1 ${
                              isUrgent
                                ? "text-yellow-300"
                                : "text-zinc-500"
                            }`}
                          >
                            <Clock className="h-3 w-3" />
                            expires {relativeFromNow(r.expiresAt)}
                          </span>
                        </>
                      );
                    })()}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {filter !== "ALL" && filteredRows.length === 0 && rows.length > 0 && (
        <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/30 py-8 px-6 text-center">
          <p className="text-sm text-zinc-400">
            No {filter === "EARNED" ? "earned" : "redeemed"} entries in the
            loaded window.
          </p>
          <p className="mt-1 text-xs text-zinc-600">
            Load more below to scan further back.
          </p>
        </div>
      )}

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
