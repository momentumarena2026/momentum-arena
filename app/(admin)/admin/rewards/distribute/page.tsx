import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { searchUsersForRewards } from "@/actions/admin-rewards";
import { DistributeForm } from "./distribute-form";

export const dynamic = "force-dynamic";

export default async function AdminRewardsDistributePage() {
  // Seed the search box with the most recently created 50 users — the
  // common case is granting bonuses to recent signups. The "Select all"
  // checkbox works on whatever the current search result set is, so
  // admins can also paste a search string first to scope the grant.
  const users = await searchUsersForRewards({ limit: 50 });

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/rewards"
          className="inline-flex items-center gap-1 text-sm text-zinc-400 hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to rewards
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-white">
          Distribute points
        </h1>
        <p className="mt-1 text-zinc-400">
          Manually grant Momentum Points to one user, several selected
          users, or every user in the current search result. Each grant
          raises an ADJUSTMENT_AUDIT alert so the action is traceable.
        </p>
      </div>

      <DistributeForm initialUsers={users} />
    </div>
  );
}
