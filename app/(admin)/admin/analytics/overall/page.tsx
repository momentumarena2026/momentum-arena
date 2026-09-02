import { getProfitAndLoss } from "@/actions/admin-pnl";
import { PnlTable } from "./pnl-table";

// Money moves on every booking, order and expense entry — never cache.
export const dynamic = "force-dynamic";

/**
 * Overall — the whole-business P&L.
 *
 * The one analytics surface that subtracts costs from income. Sports and
 * Cafe each report their own revenue and neither knows what the month
 * cost to run, so until this page existed the admin could not answer
 * "did we make money".
 *
 * Superadmin-only, enforced inside getProfitAndLoss rather than here, so
 * the gate holds no matter who calls the action.
 */
export default async function OverallAnalyticsPage() {
  const res = await getProfitAndLoss("month");

  if (!res.success) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-white">Overall</h1>
        <p className="rounded-xl border border-red-900/50 bg-red-950/20 p-4 text-sm text-red-400">
          {res.error}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Overall</h1>
        <p className="mt-1 text-zinc-400">
          Whole-business profit and loss — sports and cafe income against the
          running monthly expenses. Superadmin only.
        </p>
      </div>
      <PnlTable initial={res.data} />
    </div>
  );
}
