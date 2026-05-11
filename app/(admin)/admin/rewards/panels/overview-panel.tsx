"use client";

import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  Clock,
  Sparkles,
  Users,
} from "lucide-react";
import type { AdminRewardsOverview } from "@/actions/admin-rewards";

function formatPaiseAsRupees(paise: number): string {
  return `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;
}

export function RewardsOverviewPanel({
  overview,
}: {
  overview: AdminRewardsOverview;
}) {
  const cfg = overview.config;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          icon={<Sparkles className="h-4 w-4" />}
          accent="emerald"
          label="Points outstanding"
          value={overview.totalPointsOutstanding.toLocaleString("en-IN")}
          sub={`Liability ${formatPaiseAsRupees(overview.totalPaiseOutstanding)}`}
        />
        <Stat
          icon={<Users className="h-4 w-4" />}
          accent="zinc"
          label="Users with balance"
          value={overview.totalUsersWithBalance.toLocaleString("en-IN")}
          sub="non-zero rewardBalance rows"
        />
        <Stat
          icon={<ArrowDownToLine className="h-4 w-4" />}
          accent="emerald"
          label="Earned (30d)"
          value={overview.pointsEarnedLast30d.toLocaleString("en-IN")}
          sub="all EARNED_* rows"
        />
        <Stat
          icon={<ArrowUpFromLine className="h-4 w-4" />}
          accent="sky"
          label="Redeemed (30d)"
          value={overview.pointsRedeemedLast30d.toLocaleString("en-IN")}
          sub="REDEEMED_BOOKING + REDEEMED_CAFE"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Stat
          icon={<Clock className="h-4 w-4" />}
          accent="zinc"
          label="Expired (30d)"
          value={overview.pointsExpiredLast30d.toLocaleString("en-IN")}
          sub="EXPIRED rows"
        />
        <Stat
          icon={<AlertTriangle className="h-4 w-4" />}
          accent={overview.openAlerts > 0 ? "amber" : "zinc"}
          label="Open alerts"
          value={overview.openAlerts.toLocaleString("en-IN")}
          sub="OPEN status only"
        />
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Engine status
          </p>
          <p
            className={`mt-2 text-sm font-medium ${
              cfg.enabled ? "text-emerald-400" : "text-amber-400"
            }`}
          >
            {cfg.enabled ? "Enabled" : "Paused"}
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            Earn {cfg.earnRateBookingBps / 100}% bookings ·{" "}
            {cfg.earnRateCafeBps / 100}% cafe
          </p>
          <p className="mt-0.5 text-xs text-zinc-500">
            Redeem ≤ {cfg.maxRedemptionPctOfBill}% of bill · min{" "}
            {cfg.minPointsToRedeem} pts · {cfg.earnToRedeemMinHours}h hold
          </p>
        </div>
      </div>
    </div>
  );
}

interface StatProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  accent: "emerald" | "sky" | "amber" | "zinc";
}

function Stat({ icon, label, value, sub, accent }: StatProps) {
  const tone = {
    emerald: "text-emerald-400 bg-emerald-500/10",
    sky: "text-sky-400 bg-sky-500/10",
    amber: "text-amber-400 bg-amber-500/10",
    zinc: "text-zinc-400 bg-zinc-800",
  }[accent];
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
      <div className="flex items-center gap-2">
        <span className={`rounded-lg p-1.5 ${tone}`}>{icon}</span>
        <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          {label}
        </p>
      </div>
      <p className="mt-2 text-2xl font-bold text-white">{value}</p>
      <p className="mt-0.5 text-xs text-zinc-600">{sub}</p>
    </div>
  );
}
