import { getProfitAndLoss } from "@/actions/admin-pnl";
import { getCollections } from "@/actions/admin-collections";
import { getTodayIST } from "@/lib/ist-date";
import { PnlTable } from "./pnl-table";
import { CollectionsPanel } from "./collections-panel";

/** Shift an IST "YYYY-MM-DD" by whole days without touching a timezone. */
function shiftDays(key: string, delta: number): string {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

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
export default async function OverallAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const params = await searchParams;
  const today = getTodayIST();

  // Quick ranges, all inclusive and all anchored on the IST day — the
  // venue runs past midnight, so "last 7 days" read off a UTC clock
  // would start and end in the wrong place.
  const monthStart = `${today.slice(0, 7)}-01`;
  const lastMonthEnd = shiftDays(monthStart, -1);
  const lastMonthStart = `${lastMonthEnd.slice(0, 7)}-01`;
  const RANGES: { key: string; label: string; from: string; to: string }[] = [
    { key: "today", label: "Today", from: today, to: today },
    { key: "7", label: "Last 7 days", from: shiftDays(today, -6), to: today },
    { key: "15", label: "Last 15 days", from: shiftDays(today, -14), to: today },
    { key: "30", label: "Last 30 days", from: shiftDays(today, -29), to: today },
    { key: "month", label: "This month", from: monthStart, to: today },
    { key: "last-month", label: "Last month", from: lastMonthStart, to: lastMonthEnd },
  ];

  // Default to the month in progress: the common question is "how is
  // this month tallying so far".
  const from = params.from || monthStart;
  const to = params.to || today;
  const activeChip =
    RANGES.find((r) => r.from === from && r.to === to)?.key ?? null;

  const [res, collections] = await Promise.all([
    getProfitAndLoss("month"),
    getCollections({ from, to }),
  ]);

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

      {collections.success ? (
        <CollectionsPanel
          data={collections.data}
          chips={RANGES.map((r) => ({
            key: r.key,
            label: r.label,
            href: `/admin/analytics/overall?from=${r.from}&to=${r.to}`,
          }))}
          activeChip={activeChip}
        />
      ) : (
        <p className="rounded-xl border border-red-900/50 bg-red-950/20 p-4 text-sm text-red-400">
          {collections.error}
        </p>
      )}
    </div>
  );
}
