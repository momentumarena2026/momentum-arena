import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import {
  getMyRewardOverview,
  getMyRewardTransactions,
} from "@/actions/rewards";
import { RewardsTransactionList } from "@/components/rewards/transaction-list";
import { TrackRewardsView } from "@/components/rewards/track-rewards-view";
import {
  Gift,
  TrendingUp,
  Clock,
  ArrowDownToLine,
  ArrowUpFromLine,
  Sparkles,
  Info,
} from "lucide-react";

export const dynamic = "force-dynamic";

function formatPaiseAsRupees(paise: number): string {
  const rupees = Math.round(paise / 100);
  return `₹${rupees.toLocaleString("en-IN")}`;
}

export default async function RewardsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login?returnTo=/rewards");

  const [overview, firstPage] = await Promise.all([
    getMyRewardOverview(),
    getMyRewardTransactions({ limit: 20 }),
  ]);

  if (!overview || !firstPage) redirect("/login");

  const earnRatePct = (overview.config.earnRateBookingBps / 100).toFixed(0);

  return (
    <div className="min-h-screen bg-black text-white">
      <TrackRewardsView pointsAvailable={overview.pointsAvailable} />
      <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 py-8 space-y-6">
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

        {/* CTA */}
        <Link
          href="/book"
          className="group flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-5 py-4 transition-all hover:bg-emerald-500/15"
        >
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-emerald-500/20 p-2">
              <Gift className="h-5 w-5 text-emerald-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white">Redeem on your next booking</p>
              <p className="text-xs text-zinc-400">
                Use up to {overview.config.maxRedemptionPctOfBill}% of the bill
              </p>
            </div>
          </div>
          <span className="text-emerald-300 transition-transform group-hover:translate-x-1">→</span>
        </Link>

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

        {/* How it works */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 space-y-3">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-emerald-400" />
            <h2 className="text-sm font-semibold text-white">How it works</h2>
          </div>
          <ul className="space-y-2 text-xs text-zinc-400">
            <li className="flex gap-2">
              <span className="text-emerald-400">•</span>
              Earn <span className="text-white font-medium">{earnRatePct}%</span> back as points on every confirmed booking
              {overview.config.cafeEarnEnabled && (
                <>
                  {" "}and {(overview.config.earnRateCafeBps / 100).toFixed(0)}% on cafe orders
                </>
              )}
            </li>
            <li className="flex gap-2">
              <span className="text-emerald-400">•</span>
              1 point = {formatPaiseAsRupees(overview.config.pointValuePaise)} off your next bill
            </li>
            <li className="flex gap-2">
              <span className="text-emerald-400">•</span>
              Minimum {overview.config.minPointsToRedeem.toLocaleString("en-IN")} points to redeem
            </li>
            <li className="flex gap-2">
              <span className="text-emerald-400">•</span>
              Points expire 12 months after they're earned
            </li>
            <li className="flex gap-2">
              <span className="text-emerald-400">•</span>
              Points earned in the last {overview.config.earnToRedeemMinHours}h aren't redeemable yet
            </li>
          </ul>
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
    </div>
  );
}
