import Link from "next/link";
import { Sparkles } from "lucide-react";
import { readBalance } from "@/lib/rewards/balance";
import { getRewardConfig } from "@/lib/rewards/config";

/**
 * Header chip showing the user's available points balance. Always
 * links to /rewards. Renders a muted "0 pts" state when the user has
 * no balance — keeps the header layout stable while still nudging
 * users to discover the rewards page.
 *
 * Hidden entirely when rewards are disabled in config.
 */
export async function RewardsChip({ userId }: { userId: string }) {
  const [balance, cfg] = await Promise.all([
    readBalance(userId),
    getRewardConfig(),
  ]);

  if (!cfg.enabled) return null;

  const pts = balance.pointsAvailable;
  const isEmpty = pts <= 0;

  return (
    <Link
      href="/rewards"
      title={`${pts} reward points`}
      aria-label={`Reward points: ${pts}`}
      className={`group hidden sm:inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
        isEmpty
          ? "border-zinc-700 bg-zinc-900/60 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"
          : "border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/15"
      }`}
    >
      <Sparkles className={`h-3.5 w-3.5 ${isEmpty ? "text-zinc-500" : "text-emerald-400"}`} />
      <span>{pts.toLocaleString("en-IN")}</span>
      <span className="text-[10px] uppercase tracking-wider opacity-70">pts</span>
    </Link>
  );
}
