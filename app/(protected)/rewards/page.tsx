import { redirect } from "next/navigation";
import Link from "next/link";
import {
  getMyRewardOverview,
  getMyRewardTransactions,
} from "@/actions/rewards";
import { RewardsTransactionList } from "@/components/rewards/transaction-list";
import { TrackRewardsView } from "@/components/rewards/track-rewards-view";
import {
  Gift,
  Clock,
  ArrowDownToLine,
  ArrowUpFromLine,
  Sparkles,
  Info,
  BookOpen,
} from "lucide-react";

export const dynamic = "force-dynamic";

function formatPaiseAsRupees(paise: number): string {
  const rupees = Math.round(paise / 100);
  return `₹${rupees.toLocaleString("en-IN")}`;
}

// Lives under (protected) so the shared header + auth gate apply.
// The route group is invisible in the URL — this still renders at
// /rewards. The page used to wrap itself in <main> + min-h-screen +
// max-w + padding; the protected layout already supplies all of
// that, so we now render flush content (max-w-3xl mx-auto) inside
// the layout's max-w-7xl main.
export default async function RewardsPage() {
  const [overview, firstPage] = await Promise.all([
    getMyRewardOverview(),
    getMyRewardTransactions({ limit: 20 }),
  ]);

  if (!overview || !firstPage) redirect("/login");

  return (
    <>
      <TrackRewardsView pointsAvailable={overview.pointsAvailable} />
      <div className="mx-auto max-w-3xl space-y-6">
        {/* Hero balance card */}
        <div className="relative overflow-hidden rounded-2xl border border-emerald-500/20 bg-gradient-to-br from-emerald-950/60 via-zinc-950 to-zinc-950 p-6 sm:p-8">
          <div className="absolute top-0 right-0 h-72 w-72 -translate-y-1/3 translate-x-1/3 rounded-full bg-emerald-500/10 blur-3xl" />
          <div className="relative">
            <div className="flex items-center gap-2 text-emerald-400">
              <Sparkles className="h-4 w-4" />
              <span className="text-xs font-semibold uppercase tracking-widest">
                Momentum Points
              </span>
            </div>
            <h1 className="mt-3 text-5xl sm:text-6xl font-extrabold text-white">
              {overview.pointsAvailable.toLocaleString("en-IN")}
            </h1>
            <p className="mt-1 text-sm text-emerald-200/80">
              Worth {formatPaiseAsRupees(overview.pointsValuePaise)} towards your next booking
            </p>

            {overview.config.enabled ? null : (
              <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-300">
                <Info className="h-3.5 w-3.5" />
                Rewards are temporarily paused
              </div>
            )}

            {overview.expiringSoonPoints > 0 && (
              <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-300">
                <Clock className="h-3.5 w-3.5" />
                {overview.expiringSoonPoints.toLocaleString("en-IN")} points expiring in 30 days
              </div>
            )}
          </div>
        </div>

        {/* CTAs — Redeem (primary) + How it works (secondary). The
            How-it-works page renders all the config rules as a
            graphical breakdown; the inline bullet list that used to
            sit here was hard to scan. */}
        <div className="grid gap-3 sm:grid-cols-2">
          <Link
            href="/book"
            className="group flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-5 py-4 transition-all hover:bg-emerald-500/15"
          >
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-emerald-500/20 p-2">
                <Gift className="h-5 w-5 text-emerald-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-white">
                  Redeem on your next booking
                </p>
                <p className="text-xs text-zinc-400">
                  Use up to {overview.config.maxRedemptionPctOfBill}% of the bill
                </p>
              </div>
            </div>
            <span className="text-emerald-300 transition-transform group-hover:translate-x-1">
              →
            </span>
          </Link>
          <Link
            href="/rewards/how-it-works"
            className="group flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900/60 px-5 py-4 transition-all hover:border-zinc-700"
          >
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-zinc-800 p-2">
                <BookOpen className="h-5 w-5 text-zinc-300" />
              </div>
              <div>
                <p className="text-sm font-semibold text-white">
                  How it works
                </p>
                <p className="text-xs text-zinc-500">
                  Earn rates, caps, expiry — the full breakdown
                </p>
              </div>
            </div>
            <span className="text-zinc-400 transition-transform group-hover:translate-x-1">
              →
            </span>
          </Link>
        </div>

        {/* Lifetime stats */}
        <div className="grid gap-3 grid-cols-3">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
            <div className="flex items-center gap-2 text-emerald-400">
              <ArrowDownToLine className="h-3.5 w-3.5" />
              <p className="text-[10px] font-semibold uppercase tracking-wider">
                Earned
              </p>
            </div>
            <p className="mt-2 text-xl sm:text-2xl font-bold text-white">
              {overview.pointsLifetimeEarned.toLocaleString("en-IN")}
            </p>
            <p className="text-[10px] text-zinc-600">lifetime</p>
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
            <div className="flex items-center gap-2 text-sky-400">
              <ArrowUpFromLine className="h-3.5 w-3.5" />
              <p className="text-[10px] font-semibold uppercase tracking-wider">
                Redeemed
              </p>
            </div>
            <p className="mt-2 text-xl sm:text-2xl font-bold text-white">
              {overview.pointsLifetimeRedeemed.toLocaleString("en-IN")}
            </p>
            <p className="text-[10px] text-zinc-600">lifetime</p>
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
            <div className="flex items-center gap-2 text-zinc-400">
              <Clock className="h-3.5 w-3.5" />
              <p className="text-[10px] font-semibold uppercase tracking-wider">
                Expired
              </p>
            </div>
            <p className="mt-2 text-xl sm:text-2xl font-bold text-white">
              {overview.pointsLifetimeExpired.toLocaleString("en-IN")}
            </p>
            <p className="text-[10px] text-zinc-600">lifetime</p>
          </div>
        </div>

        {/* Transaction history */}
        <div>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">
            Activity
          </h2>
          <RewardsTransactionList
            initialRows={firstPage.rows}
            initialNextCursor={firstPage.nextCursor}
            initialHasMore={firstPage.hasMore}
          />
        </div>
      </div>
    </>
  );
}
