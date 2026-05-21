"use client";

import { useSearchParams, useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import {
  BarChart3,
  Bell,
  LayoutDashboard,
  ListOrdered,
  Settings,
  Users,
} from "lucide-react";
import {
  type AdminRewardConfigFull,
  type AdminRewardsAnalytics,
  type AdminRewardsOverview,
  type AdminUserBalanceRow,
} from "@/actions/admin-rewards";
import { RewardsOverviewPanel } from "./panels/overview-panel";
import { RewardsConfigPanel } from "./panels/config-panel";
import { RewardsUsersPanel } from "./panels/users-panel";
import { RewardsAlertsPanel, type AlertRow } from "./panels/alerts-panel";
import { RewardsAnalyticsPanel } from "./panels/analytics-panel";
import { RewardsTransactionsPanel } from "./panels/transactions-panel";

type TabKey = "overview" | "config" | "users" | "transactions" | "alerts" | "analytics";

interface Props {
  overview: AdminRewardsOverview;
  config: AdminRewardConfigFull;
  alerts: AlertRow[];
  initialUsers: AdminUserBalanceRow[];
  analytics: AdminRewardsAnalytics;
}

const TABS: { key: TabKey; label: string; icon: React.ReactNode }[] = [
  { key: "overview", label: "Overview", icon: <LayoutDashboard className="h-4 w-4" /> },
  { key: "config", label: "Config", icon: <Settings className="h-4 w-4" /> },
  { key: "users", label: "Users", icon: <Users className="h-4 w-4" /> },
  { key: "transactions", label: "Transactions", icon: <ListOrdered className="h-4 w-4" /> },
  { key: "alerts", label: "Alerts", icon: <Bell className="h-4 w-4" /> },
  { key: "analytics", label: "Analytics", icon: <BarChart3 className="h-4 w-4" /> },
];

export function RewardsAdminTabs({
  overview,
  config,
  alerts,
  initialUsers,
  analytics,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const rawTab = searchParams.get("tab");
  const active: TabKey =
    rawTab === "config" ||
    rawTab === "users" ||
    rawTab === "transactions" ||
    rawTab === "alerts" ||
    rawTab === "analytics"
      ? rawTab
      : "overview";

  const setTab = (t: TabKey) => {
    const params = new URLSearchParams(searchParams.toString());
    if (t === "overview") params.delete("tab");
    else params.set("tab", t);
    // Clear filter params when switching tabs so an old tab's filter
    // state doesn't leak into the next tab's URL.
    for (const k of ["q", "from", "to", "types", "dir", "src", "actor", "page"]) {
      if (t !== "transactions") params.delete(k);
    }
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 border-b border-zinc-800">
        <div className="flex items-center gap-1 overflow-x-auto">
          {TABS.map((t) => (
            <TabButton
              key={t.key}
              active={active === t.key}
              onClick={() => setTab(t.key)}
              icon={t.icon}
              label={t.label}
              count={
                t.key === "alerts"
                  ? alerts.length
                  : t.key === "users"
                    ? initialUsers.length
                    : undefined
              }
            />
          ))}
        </div>
        <Link
          href="/admin/rewards/distribute"
          className="hidden sm:inline-flex shrink-0 items-center gap-2 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500"
        >
          Distribute points
        </Link>
      </div>

      {active === "overview" && <RewardsOverviewPanel overview={overview} />}
      {active === "config" && <RewardsConfigPanel config={config} />}
      {active === "users" && <RewardsUsersPanel initial={initialUsers} />}
      {active === "transactions" && <RewardsTransactionsPanel />}
      {active === "alerts" && <RewardsAlertsPanel alerts={alerts} />}
      {active === "analytics" && (
        <RewardsAnalyticsPanel analytics={analytics} />
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2 border-b-2 px-3 py-2 text-sm transition-colors ${
        active
          ? "border-emerald-500 text-white"
          : "border-transparent text-zinc-400 hover:text-zinc-200"
      }`}
    >
      {icon}
      <span>{label}</span>
      {count !== undefined && (
        <span
          className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
            active ? "bg-emerald-500/20 text-emerald-300" : "bg-zinc-800 text-zinc-400"
          }`}
        >
          {count}
        </span>
      )}
    </button>
  );
}
