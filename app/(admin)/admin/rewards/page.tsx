import {
  getAdminRewardsOverview,
  getAdminRewardConfigFull,
  getAdminRewardsAnalytics,
  listRewardAlerts,
  searchUsersForRewards,
} from "@/actions/admin-rewards";
import { RewardsAdminTabs } from "./rewards-tabs";

export const dynamic = "force-dynamic";

export default async function AdminRewardsPage() {
  // Fetch all five tabs' initial data in parallel so switching tabs feels
  // instant — same pattern as /admin/coupons.
  const [overview, config, alerts, users, analytics] = await Promise.all([
    getAdminRewardsOverview(),
    getAdminRewardConfigFull(),
    listRewardAlerts({ status: "OPEN", limit: 100 }),
    searchUsersForRewards({ limit: 25 }),
    getAdminRewardsAnalytics(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Momentum Rewards</h1>
        <p className="mt-1 text-zinc-400">
          Earn / redeem ledger, config, user balances, alerts, and 30-day analytics.
        </p>
      </div>

      <RewardsAdminTabs
        overview={overview}
        config={config}
        alerts={alerts}
        initialUsers={users}
        analytics={analytics}
      />
    </div>
  );
}
