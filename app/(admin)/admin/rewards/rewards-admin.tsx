"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  updateRewardConfig,
  searchUserPoints,
  adjustUserPoints,
} from "@/actions/admin-rewards";
import {
  Settings,
  Users,
  BarChart3,
  Loader2,
  Search,
  Plus,
  Minus,
  Trophy,
  Star,
  TrendingUp,
} from "lucide-react";

const TIER_COLORS: Record<string, string> = {
  BRONZE: "#CD7F32",
  SILVER: "#C0C0C0",
  GOLD: "#FFD700",
  PLATINUM: "#E5E4E2",
};

interface ConfigData {
  id: string;
  sportsEarnRate: number;
  cafeEarnRate: number;
  referralBonus: number;
  pointsPerRupee: number;
  minRedeemPoints: number;
  maxRedeemPercent: number;
  silverThreshold: number;
  goldThreshold: number;
  platinumThreshold: number;
  bronzeMultiplier: number;
  silverMultiplier: number;
  goldMultiplier: number;
  platinumMultiplier: number;
  pointsExpiryDays: number;
}

interface StatsData {
  totalPointsInCirculation: number;
  totalPointsEverEarned: number;
  totalPointsRedeemed: number;
  totalUsers: number;
  tierDistribution: { tier: string; count: number }[];
  topEarners: {
    userId: string;
    name: string | null;
    email: string | null;
    phone: string | null;
    totalEarned: number;
    currentBalance: number;
    tier: string;
  }[];
}

interface UserResult {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  balance: {
    currentBalance: number;
    totalEarned: number;
    totalRedeemed: number;
    tier: string;
    transactions: {
      id: string;
      type: string;
      points: number;
      description: string;
      createdAt: string;
    }[];
  } | null;
}

type Tab = "config" | "users" | "stats";

export function RewardsAdmin({
  initialConfig,
  initialStats,
}: {
  initialConfig: ConfigData;
  initialStats: StatsData;
}) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>("config");

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: "config", label: "Configuration", icon: <Settings className="h-4 w-4" /> },
    { key: "users", label: "Users", icon: <Users className="h-4 w-4" /> },
    { key: "stats", label: "Statistics", icon: <BarChart3 className="h-4 w-4" /> },
  ];

  return (
    <div>
      <div className="flex gap-1 rounded-lg bg-zinc-900 p-1">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition ${
              activeTab === tab.key
                ? "bg-zinc-800 text-white"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      <div className="mt-6">
        {activeTab === "config" && (
          <ConfigTab initialConfig={initialConfig} />
        )}
        {activeTab === "users" && <UsersTab />}
        {activeTab === "stats" && <StatsTab stats={initialStats} />}
      </div>
    </div>
  );
}

/* ─── Config Tab ─── */

function ConfigTab({ initialConfig }: { initialConfig: ConfigData }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [form, setForm] = useState({
    sportsEarnRate: initialConfig.sportsEarnRate,
    cafeEarnRate: initialConfig.cafeEarnRate,
    referralBonus: initialConfig.referralBonus,
    pointsPerRupee: initialConfig.pointsPerRupee,
    minRedeemPoints: initialConfig.minRedeemPoints,
    maxRedeemPercent: initialConfig.maxRedeemPercent,
    silverThreshold: initialConfig.silverThreshold,
    goldThreshold: initialConfig.goldThreshold,
    platinumThreshold: initialConfig.platinumThreshold,
    bronzeMultiplier: initialConfig.bronzeMultiplier,
    silverMultiplier: initialConfig.silverMultiplier,
    goldMultiplier: initialConfig.goldMultiplier,
    platinumMultiplier: initialConfig.platinumMultiplier,
    pointsExpiryDays: initialConfig.pointsExpiryDays,
  });

  const setField = (key: keyof typeof form, value: number) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccess(false);

    const result = await updateRewardConfig(form);
    if (result.success) {
      setSuccess(true);
      router.refresh();
      setTimeout(() => setSuccess(false), 3000);
    } else {
      setError(result.error || "Failed to save");
    }
    setSaving(false);
  };

  // Live preview: points earned for ₹1000 spend at Bronze tier
  const previewBookingPoints = Math.floor(
    (100000 / 100) * form.sportsEarnRate * (form.bronzeMultiplier / 10000)
  );
  const previewCafePoints = Math.floor(
    (100000 / 100) * form.cafeEarnRate * (form.bronzeMultiplier / 10000)
  );
  const previewRedeemValue = Math.floor(100 / form.pointsPerRupee);

  return (
    <div className="space-y-6">
      {/* Live Preview */}
      <div className="rounded-lg border border-emerald-800/50 bg-emerald-950/30 p-4">
        <h3 className="mb-2 text-sm font-medium text-emerald-400">
          Live Preview (Bronze tier, ₹1,000 spend)
        </h3>
        <div className="flex flex-wrap gap-6 text-sm text-zinc-300">
          <span>
            Sports booking: <strong className="text-white">{previewBookingPoints} pts</strong>
          </span>
          <span>
            Cafe order: <strong className="text-white">{previewCafePoints} pts</strong>
          </span>
          <span>
            100 pts = <strong className="text-white">₹{previewRedeemValue}</strong>
          </span>
        </div>
      </div>

      {/* Earn Rates */}
      <Section title="Earn Rates">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <NumberField
            label="Sports booking (pts/₹1)"
            value={form.sportsEarnRate}
            onChange={(v) => setField("sportsEarnRate", v)}
          />
          <NumberField
            label="Cafe order (pts/₹1)"
            value={form.cafeEarnRate}
            onChange={(v) => setField("cafeEarnRate", v)}
          />
          <NumberField
            label="Referral bonus (pts)"
            value={form.referralBonus}
            onChange={(v) => setField("referralBonus", v)}
          />
        </div>
      </Section>

      {/* Redemption */}
      <Section title="Redemption">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <NumberField
            label="Points per ₹1"
            value={form.pointsPerRupee}
            onChange={(v) => setField("pointsPerRupee", v)}
          />
          <NumberField
            label="Minimum redeem points"
            value={form.minRedeemPoints}
            onChange={(v) => setField("minRedeemPoints", v)}
          />
          <NumberField
            label="Max redeem % (basis pts)"
            value={form.maxRedeemPercent}
            onChange={(v) => setField("maxRedeemPercent", v)}
            hint={`${(form.maxRedeemPercent / 100).toFixed(0)}% of order`}
          />
        </div>
      </Section>

      {/* Tier Thresholds */}
      <Section title="Tier Thresholds (lifetime earned points)">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <NumberField
            label="Silver threshold"
            value={form.silverThreshold}
            onChange={(v) => setField("silverThreshold", v)}
          />
          <NumberField
            label="Gold threshold"
            value={form.goldThreshold}
            onChange={(v) => setField("goldThreshold", v)}
          />
          <NumberField
            label="Platinum threshold"
            value={form.platinumThreshold}
            onChange={(v) => setField("platinumThreshold", v)}
          />
        </div>
      </Section>

      {/* Tier Multipliers */}
      <Section title="Tier Multipliers (basis points: 10000 = 1x)">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <NumberField
            label="Bronze"
            value={form.bronzeMultiplier}
            onChange={(v) => setField("bronzeMultiplier", v)}
            hint={`${(form.bronzeMultiplier / 10000).toFixed(2)}x`}
          />
          <NumberField
            label="Silver"
            value={form.silverMultiplier}
            onChange={(v) => setField("silverMultiplier", v)}
            hint={`${(form.silverMultiplier / 10000).toFixed(2)}x`}
          />
          <NumberField
            label="Gold"
            value={form.goldMultiplier}
            onChange={(v) => setField("goldMultiplier", v)}
            hint={`${(form.goldMultiplier / 10000).toFixed(2)}x`}
          />
          <NumberField
            label="Platinum"
            value={form.platinumMultiplier}
            onChange={(v) => setField("platinumMultiplier", v)}
            hint={`${(form.platinumMultiplier / 10000).toFixed(2)}x`}
          />
        </div>
      </Section>

      {/* Expiry */}
      <Section title="Expiry">
        <NumberField
          label="Points expiry (days, 0 = never)"
          value={form.pointsExpiryDays}
          onChange={(v) => setField("pointsExpiryDays", v)}
        />
      </Section>

      {error && (
        <div className="rounded-lg border border-red-800 bg-red-950/50 p-3 text-sm text-red-300">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-lg border border-emerald-800 bg-emerald-950/50 p-3 text-sm text-emerald-300">
          Configuration saved successfully
        </div>
      )}

      <button
        onClick={handleSave}
        disabled={saving}
        className="flex items-center gap-2 rounded-lg bg-emerald-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
      >
        {saving && <Loader2 className="h-4 w-4 animate-spin" />}
        Save Configuration
      </button>
    </div>
  );
}

/* ─── Users Tab ─── */

function UsersTab() {
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [users, setUsers] = useState<UserResult[]>([]);
  const [selectedUser, setSelectedUser] = useState<UserResult | null>(null);
  const [adjustPoints, setAdjustPoints] = useState("");
  const [adjustReason, setAdjustReason] = useState("");
  const [adjusting, setAdjusting] = useState(false);
  const [adjustError, setAdjustError] = useState<string | null>(null);

  const handleSearch = async () => {
    if (query.trim().length < 2) return;
    setSearching(true);
    const result = await searchUserPoints(query.trim());
    if (result.success) {
      setUsers(result.users);
    }
    setSearching(false);
  };

  const handleAdjust = async () => {
    if (!selectedUser) return;
    const pts = parseInt(adjustPoints);
    if (isNaN(pts) || pts === 0) {
      setAdjustError("Enter a non-zero number");
      return;
    }
    if (adjustReason.trim().length < 3) {
      setAdjustError("Reason is required");
      return;
    }

    setAdjusting(true);
    setAdjustError(null);

    const result = await adjustUserPoints(
      selectedUser.id,
      pts,
      adjustReason.trim()
    );

    if (result.success) {
      setAdjustPoints("");
      setAdjustReason("");
      setSelectedUser(null);
      // Re-search to get updated data
      if (query.trim().length >= 2) {
        const refreshed = await searchUserPoints(query.trim());
        if (refreshed.success) setUsers(refreshed.users);
      }
    } else {
      setAdjustError(result.error || "Failed to adjust");
    }
    setAdjusting(false);
  };

  return (
    <div className="space-y-4">
      {/* Search */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            placeholder="Search by name, email, or phone..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 py-2 pl-10 pr-4 text-sm text-white placeholder-zinc-500 focus:border-emerald-600 focus:outline-none"
          />
        </div>
        <button
          onClick={handleSearch}
          disabled={searching}
          className="flex items-center gap-2 rounded-lg bg-zinc-800 px-4 py-2 text-sm text-white hover:bg-zinc-700 disabled:opacity-50"
        >
          {searching ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Search className="h-4 w-4" />
          )}
          Search
        </button>
      </div>

      {/* Results */}
      {users.length > 0 && (
        <div className="space-y-2">
          {users.map((user) => (
            <div
              key={user.id}
              className="rounded-lg border border-zinc-800 bg-zinc-900 p-4"
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-white">
                      {user.name || "Unnamed"}
                    </span>
                    {user.balance && (
                      <span
                        className="rounded-full px-2 py-0.5 text-xs font-bold"
                        style={{
                          backgroundColor: `${TIER_COLORS[user.balance.tier]}20`,
                          color: TIER_COLORS[user.balance.tier],
                          border: `1px solid ${TIER_COLORS[user.balance.tier]}40`,
                        }}
                      >
                        {user.balance.tier}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-zinc-400">
                    {user.email} {user.phone && `| ${user.phone}`}
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  {user.balance ? (
                    <div className="text-right">
                      <div className="text-lg font-bold text-emerald-400">
                        {user.balance.currentBalance.toLocaleString()} pts
                      </div>
                      <div className="text-xs text-zinc-400">
                        Earned: {user.balance.totalEarned.toLocaleString()} |
                        Redeemed: {user.balance.totalRedeemed.toLocaleString()}
                      </div>
                    </div>
                  ) : (
                    <span className="text-sm text-zinc-500">No points yet</span>
                  )}
                  <button
                    onClick={() =>
                      setSelectedUser(
                        selectedUser?.id === user.id ? null : user
                      )
                    }
                    className="rounded-lg bg-amber-600/20 px-3 py-1.5 text-xs font-medium text-amber-400 hover:bg-amber-600/30"
                  >
                    Adjust Points
                  </button>
                </div>
              </div>

              {/* Adjust form */}
              {selectedUser?.id === user.id && (
                <div className="mt-4 rounded-lg border border-zinc-700 bg-zinc-950 p-4">
                  <h4 className="mb-3 text-sm font-medium text-zinc-300">
                    Adjust Points for {user.name}
                  </h4>
                  <div className="flex flex-wrap gap-3">
                    <input
                      type="number"
                      placeholder="Points (+/-)"
                      value={adjustPoints}
                      onChange={(e) => setAdjustPoints(e.target.value)}
                      className="w-32 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white focus:border-emerald-600 focus:outline-none"
                    />
                    <input
                      type="text"
                      placeholder="Reason for adjustment"
                      value={adjustReason}
                      onChange={(e) => setAdjustReason(e.target.value)}
                      className="flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white focus:border-emerald-600 focus:outline-none"
                    />
                    <button
                      onClick={handleAdjust}
                      disabled={adjusting}
                      className="flex items-center gap-1 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                    >
                      {adjusting && (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      )}
                      Apply
                    </button>
                  </div>
                  {adjustError && (
                    <p className="mt-2 text-xs text-red-400">{adjustError}</p>
                  )}
                </div>
              )}

              {/* Recent transactions */}
              {user.balance &&
                user.balance.transactions.length > 0 &&
                selectedUser?.id === user.id && (
                  <div className="mt-3 space-y-1">
                    <h5 className="text-xs font-medium text-zinc-400">
                      Recent Transactions
                    </h5>
                    {user.balance.transactions.map((t) => (
                      <div
                        key={t.id}
                        className="flex items-center justify-between rounded bg-zinc-950 px-3 py-1.5 text-xs"
                      >
                        <span className="text-zinc-300">{t.description}</span>
                        <div className="flex items-center gap-3">
                          <span className="text-zinc-500">
                            {new Date(t.createdAt).toLocaleDateString()}
                          </span>
                          <span
                            className={
                              t.points > 0
                                ? "font-medium text-emerald-400"
                                : "font-medium text-red-400"
                            }
                          >
                            {t.points > 0 ? "+" : ""}
                            {t.points}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
            </div>
          ))}
        </div>
      )}

      {users.length === 0 && query.length >= 2 && !searching && (
        <p className="py-8 text-center text-sm text-zinc-500">
          No users found. Try a different search.
        </p>
      )}
    </div>
  );
}

/* ─── Stats Tab ─── */

function StatsTab({ stats }: { stats: StatsData }) {
  const totalTierUsers = stats.tierDistribution.reduce(
    (sum, t) => sum + t.count,
    0
  );

  return (
    <div className="space-y-6">
      {/* Overview Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <StatCard
          icon={<Star className="h-5 w-5 text-amber-400" />}
          label="Points in Circulation"
          value={stats.totalPointsInCirculation.toLocaleString()}
        />
        <StatCard
          icon={<TrendingUp className="h-5 w-5 text-emerald-400" />}
          label="Total Earned"
          value={stats.totalPointsEverEarned.toLocaleString()}
        />
        <StatCard
          icon={<Minus className="h-5 w-5 text-red-400" />}
          label="Total Redeemed"
          value={stats.totalPointsRedeemed.toLocaleString()}
        />
        <StatCard
          icon={<Users className="h-5 w-5 text-blue-400" />}
          label="Active Users"
          value={stats.totalUsers.toLocaleString()}
        />
      </div>

      {/* Tier Distribution */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
        <h3 className="mb-4 text-sm font-medium text-white">
          Tier Distribution
        </h3>
        <div className="space-y-3">
          {(["BRONZE", "SILVER", "GOLD", "PLATINUM"] as const).map((tier) => {
            const entry = stats.tierDistribution.find((t) => t.tier === tier);
            const count = entry?.count ?? 0;
            const percent = totalTierUsers > 0 ? (count / totalTierUsers) * 100 : 0;

            return (
              <div key={tier} className="flex items-center gap-3">
                <span
                  className="w-20 text-xs font-bold"
                  style={{ color: TIER_COLORS[tier] }}
                >
                  {tier}
                </span>
                <div className="flex-1">
                  <div className="h-6 overflow-hidden rounded-full bg-zinc-800">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${Math.max(percent, 1)}%`,
                        backgroundColor: TIER_COLORS[tier],
                        opacity: 0.6,
                      }}
                    />
                  </div>
                </div>
                <span className="w-16 text-right text-sm text-zinc-300">
                  {count} ({percent.toFixed(0)}%)
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Top Earners */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
        <h3 className="mb-4 text-sm font-medium text-white">
          Top 10 Earners
        </h3>
        {stats.topEarners.length === 0 ? (
          <p className="py-4 text-center text-sm text-zinc-500">
            No data yet
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 text-left text-xs text-zinc-400">
                  <th className="pb-2 pr-4">#</th>
                  <th className="pb-2 pr-4">User</th>
                  <th className="pb-2 pr-4">Tier</th>
                  <th className="pb-2 pr-4 text-right">Total Earned</th>
                  <th className="pb-2 text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                {stats.topEarners.map((earner, i) => (
                  <tr
                    key={earner.userId}
                    className="border-b border-zinc-800/50"
                  >
                    <td className="py-2 pr-4 text-zinc-500">{i + 1}</td>
                    <td className="py-2 pr-4">
                      <div className="text-white">
                        {earner.name || "Unnamed"}
                      </div>
                      <div className="text-xs text-zinc-500">
                        {earner.email || earner.phone}
                      </div>
                    </td>
                    <td className="py-2 pr-4">
                      <span
                        className="rounded-full px-2 py-0.5 text-xs font-bold"
                        style={{
                          backgroundColor: `${TIER_COLORS[earner.tier]}20`,
                          color: TIER_COLORS[earner.tier],
                        }}
                      >
                        {earner.tier}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-right font-medium text-emerald-400">
                      {earner.totalEarned.toLocaleString()}
                    </td>
                    <td className="py-2 text-right text-zinc-300">
                      {earner.currentBalance.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Shared Components ─── */

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
      <h3 className="mb-4 text-sm font-medium text-white">{title}</h3>
      {children}
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  hint?: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs text-zinc-400">{label}</label>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value) || 0)}
        className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white focus:border-emerald-600 focus:outline-none"
      />
      {hint && <p className="mt-1 text-xs text-zinc-500">{hint}</p>}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
      <div className="flex items-center gap-2 text-zinc-400">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <div className="mt-2 text-2xl font-bold text-white">{value}</div>
    </div>
  );
}
