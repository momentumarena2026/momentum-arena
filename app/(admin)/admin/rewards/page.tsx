import { getAdminRewardConfig, getRewardStats } from "@/actions/admin-rewards";
import { RewardsAdmin } from "./rewards-admin";

export default async function AdminRewardsPage() {
  const [config, stats] = await Promise.all([
    getAdminRewardConfig(),
    getRewardStats(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Reward Points</h1>
        <p className="mt-1 text-zinc-400">
          Configure the reward points system, manage user points, and view
          statistics
        </p>
      </div>

      <RewardsAdmin initialConfig={config} initialStats={stats} />
    </div>
  );
}
