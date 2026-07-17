import Link from "next/link";
import { ArrowLeft, Sparkles } from "lucide-react";
import { getMyPasses } from "@/actions/passes";
import { MyPasses } from "@/components/passes/my-passes";

// Balances move at redemption time — always render fresh.
export const dynamic = "force-dynamic";

/**
 * Dedicated "My Passes" page — the pass content that used to sit inline
 * on the account page. Tabs (Active / Inactive), animated balance
 * clocks, and each ticket links through to its detail page (members,
 * booking history).
 */
export default async function MyPassesPage() {
  const myPasses = await getMyPasses().catch(() => []);

  return (
    <div className="space-y-6 pb-8">
      <div>
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1.5 text-sm text-zinc-400 transition-colors hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" /> Back to account
        </Link>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-white sm:text-3xl">
              My Passes 🎟️
            </h1>
            <p className="mt-1 text-sm text-zinc-500">
              Your prepaid hours — balances, shared members, and booking
              history. Tap a pass for its details.
            </p>
          </div>
          <Link
            href="/passes"
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-500"
          >
            <Sparkles className="h-4 w-4" /> Browse passes
          </Link>
        </div>
      </div>

      <MyPasses passes={myPasses} standalone />
    </div>
  );
}
