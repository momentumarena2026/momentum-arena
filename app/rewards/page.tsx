import { auth } from "@/lib/auth";
import { getMyRewardBalance, getRewardConfig } from "@/actions/reward-points";
import { Trophy, Star, ArrowUp, Gift, Clock, Zap, Shield } from "lucide-react";

const TIER_COLORS: Record<string, string> = {
  BRONZE: "#CD7F32",
  SILVER: "#C0C0C0",
  GOLD: "#FFD700",
  PLATINUM: "#E5E4E2",
};

const TIER_LABELS: Record<string, string> = {
  BRONZE: "Bronze",
  SILVER: "Silver",
  GOLD: "Gold",
  PLATINUM: "Platinum",
};

const TIER_BENEFITS: Record<string, string[]> = {
  BRONZE: ["Earn 1 point per ₹1 on bookings", "Earn 2 points per ₹1 at cafe", "Redeem points for discounts"],
  SILVER: ["1.25x points multiplier", "All Bronze benefits", "Priority booking support"],
  GOLD: ["1.5x points multiplier", "All Silver benefits", "Exclusive offers and early access"],
  PLATINUM: ["2x points multiplier", "All Gold benefits", "VIP lounge access and premium perks"],
};

function TransactionTypeLabel({ type }: { type: string }) {
  const labels: Record<string, { label: string; color: string }> = {
    EARNED_BOOKING: { label: "Booking", color: "text-emerald-400" },
    EARNED_CAFE: { label: "Cafe", color: "text-emerald-400" },
    EARNED_REFERRAL: { label: "Referral", color: "text-blue-400" },
    EARNED_BONUS: { label: "Bonus", color: "text-amber-400" },
    REDEEMED_BOOKING: { label: "Redeemed", color: "text-red-400" },
    REDEEMED_CAFE: { label: "Redeemed", color: "text-red-400" },
    EXPIRED: { label: "Expired", color: "text-zinc-500" },
    ADJUSTMENT: { label: "Adjustment", color: "text-purple-400" },
  };
  const item = labels[type] || { label: type, color: "text-zinc-400" };
  return <span className={`text-xs font-medium ${item.color}`}>{item.label}</span>;
}

export default async function RewardsPage() {
  const session = await auth();
  const isLoggedIn = !!session?.user?.id;

  if (isLoggedIn) {
    const data = await getMyRewardBalance();

    if (!data.success || !data.balance) {
      return (
        <div className="min-h-screen bg-black p-8 text-white">
          <p>Unable to load rewards. Please try again.</p>
        </div>
      );
    }

    const { balance, nextTier, nextThreshold, progressPercent, transactions, config } = data;
    const tierColor = TIER_COLORS[balance.tier];

    return (
      <div className="min-h-screen bg-black">
        <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
          <h1 className="mb-8 text-2xl font-bold text-white">My Rewards</h1>

          {/* Tier Card */}
          <div
            className="relative overflow-hidden rounded-2xl border p-6"
            style={{
              borderColor: `${tierColor}40`,
              background: `linear-gradient(135deg, ${tierColor}10 0%, rgba(0,0,0,0.8) 100%)`,
            }}
          >
            <div className="absolute right-4 top-4 opacity-10">
              <Trophy className="h-24 w-24" style={{ color: tierColor }} />
            </div>

            <div className="relative">
              <div className="flex items-center gap-3">
                <div
                  className="flex h-12 w-12 items-center justify-center rounded-full"
                  style={{ backgroundColor: `${tierColor}20` }}
                >
                  <Star className="h-6 w-6" style={{ color: tierColor }} />
                </div>
                <div>
                  <span
                    className="text-xl font-bold"
                    style={{ color: tierColor }}
                  >
                    {TIER_LABELS[balance.tier]} Member
                  </span>
                </div>
              </div>

              <div className="mt-6">
                <div className="text-4xl font-bold text-white">
                  {balance.currentBalance.toLocaleString()}
                </div>
                <div className="text-sm text-zinc-400">Available Points</div>
              </div>

              <div className="mt-4 flex gap-6 text-sm">
                <div>
                  <span className="text-zinc-500">Total Earned</span>
                  <div className="font-medium text-emerald-400">
                    {balance.totalEarned.toLocaleString()}
                  </div>
                </div>
                <div>
                  <span className="text-zinc-500">Total Redeemed</span>
                  <div className="font-medium text-amber-400">
                    {balance.totalRedeemed.toLocaleString()}
                  </div>
                </div>
              </div>

              {/* Progress to next tier */}
              {nextTier && nextThreshold > 0 && (
                <div className="mt-6">
                  <div className="mb-2 flex items-center justify-between text-xs">
                    <span className="text-zinc-400">
                      Progress to {nextTier}
                    </span>
                    <span className="text-zinc-400">
                      {balance.totalEarned.toLocaleString()} /{" "}
                      {nextThreshold.toLocaleString()} pts
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${progressPercent}%`,
                        backgroundColor:
                          TIER_COLORS[nextTier] || "#10b981",
                      }}
                    />
                  </div>
                </div>
              )}

              {!nextTier && (
                <div className="mt-6 rounded-lg bg-zinc-800/50 p-3 text-center text-sm text-zinc-300">
                  You have reached the highest tier!
                </div>
              )}
            </div>
          </div>

          {/* How it works */}
          <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <InfoCard
              icon={<Zap className="h-5 w-5 text-emerald-400" />}
              title="Earn Points"
              description={`${config!.sportsEarnRate} pt/₹1 on bookings, ${config!.cafeEarnRate} pt/₹1 at cafe`}
            />
            <InfoCard
              icon={<Gift className="h-5 w-5 text-amber-400" />}
              title="Redeem"
              description={`${config!.pointsPerRupee} points = ₹1 discount`}
            />
            <InfoCard
              icon={<ArrowUp className="h-5 w-5 text-purple-400" />}
              title="Level Up"
              description="Higher tiers earn more points per spend"
            />
          </div>

          {/* Transaction History */}
          <div className="mt-8">
            <h2 className="mb-4 text-lg font-semibold text-white">
              Recent Activity
            </h2>
            {transactions!.length === 0 ? (
              <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-8 text-center text-sm text-zinc-500">
                No transactions yet. Start earning by booking a court or
                ordering from the cafe!
              </div>
            ) : (
              <div className="space-y-2">
                {transactions!.map((t) => (
                  <div
                    key={t.id}
                    className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3"
                  >
                    <div>
                      <div className="text-sm text-white">{t.description}</div>
                      <div className="mt-0.5 flex items-center gap-2">
                        <TransactionTypeLabel type={t.type} />
                        <span className="text-xs text-zinc-500">
                          {new Date(t.createdAt).toLocaleDateString("en-IN", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })}
                        </span>
                        {t.expiresAt && (
                          <span className="flex items-center gap-1 text-xs text-zinc-600">
                            <Clock className="h-3 w-3" />
                            Expires{" "}
                            {new Date(t.expiresAt).toLocaleDateString("en-IN", {
                              day: "numeric",
                              month: "short",
                            })}
                          </span>
                        )}
                      </div>
                    </div>
                    <span
                      className={`text-sm font-bold ${
                        t.points > 0 ? "text-emerald-400" : "text-red-400"
                      }`}
                    >
                      {t.points > 0 ? "+" : ""}
                      {t.points}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Not logged in — show general info
  const config = await getRewardConfig();

  return (
    <div className="min-h-screen bg-black">
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <div className="text-center">
          <Trophy className="mx-auto h-16 w-16 text-amber-400" />
          <h1 className="mt-4 text-3xl font-bold text-white">
            Momentum Rewards
          </h1>
          <p className="mt-2 text-zinc-400">
            Earn points on every booking and cafe order. Redeem for discounts.
            Level up for bigger rewards.
          </p>
        </div>

        {/* How it works */}
        <div className="mt-12 grid grid-cols-1 gap-6 sm:grid-cols-3">
          <InfoCard
            icon={<Zap className="h-6 w-6 text-emerald-400" />}
            title="Earn Points"
            description={`Get ${config.sportsEarnRate} point per ₹1 on sports bookings and ${config.cafeEarnRate} points per ₹1 at the cafe`}
          />
          <InfoCard
            icon={<Gift className="h-6 w-6 text-amber-400" />}
            title="Redeem & Save"
            description={`Use ${config.pointsPerRupee} points to save ₹1 on your next booking or cafe order`}
          />
          <InfoCard
            icon={<ArrowUp className="h-6 w-6 text-purple-400" />}
            title="Level Up"
            description="Higher tiers unlock bigger multipliers so you earn points even faster"
          />
        </div>

        {/* Tier Info */}
        <div className="mt-12">
          <h2 className="mb-6 text-center text-xl font-bold text-white">
            Membership Tiers
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {(["BRONZE", "SILVER", "GOLD", "PLATINUM"] as const).map(
              (tier) => {
                const color = TIER_COLORS[tier];
                const thresholds: Record<string, number> = {
                  BRONZE: 0,
                  SILVER: config.silverThreshold,
                  GOLD: config.goldThreshold,
                  PLATINUM: config.platinumThreshold,
                };

                return (
                  <div
                    key={tier}
                    className="rounded-xl border p-5"
                    style={{
                      borderColor: `${color}30`,
                      background: `linear-gradient(135deg, ${color}08 0%, transparent 100%)`,
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <Shield className="h-5 w-5" style={{ color }} />
                      <span className="font-bold" style={{ color }}>
                        {TIER_LABELS[tier]}
                      </span>
                      {thresholds[tier] > 0 && (
                        <span className="text-xs text-zinc-500">
                          ({thresholds[tier].toLocaleString()} pts)
                        </span>
                      )}
                    </div>
                    <ul className="mt-3 space-y-1">
                      {TIER_BENEFITS[tier].map((benefit, i) => (
                        <li
                          key={i}
                          className="flex items-start gap-2 text-sm text-zinc-400"
                        >
                          <span className="mt-1 text-emerald-500">*</span>
                          {benefit}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              }
            )}
          </div>
        </div>

        {/* CTA */}
        <div className="mt-12 text-center">
          <a
            href="/book"
            className="inline-block rounded-lg bg-emerald-600 px-8 py-3 font-medium text-white hover:bg-emerald-500"
          >
            Book Now & Start Earning
          </a>
        </div>
      </div>
    </div>
  );
}

function InfoCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
      <div className="mb-2">{icon}</div>
      <h3 className="text-sm font-semibold text-white">{title}</h3>
      <p className="mt-1 text-xs text-zinc-400">{description}</p>
    </div>
  );
}
