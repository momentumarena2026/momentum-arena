import { getCohortRetention } from "@/actions/admin-insights";

const ABSENT_BG = "#0a0a0a";

function colorForRate(pct: number): string {
  // Linear emerald gradient capped at 60% (anything higher is solid).
  if (pct === 0) return "#18181b";
  const intensity = Math.min(pct / 60, 1);
  // base alpha 0.15 → 0.95 across the [0, 1] range
  const alpha = 0.15 + 0.8 * intensity;
  return `rgba(16, 185, 129, ${alpha.toFixed(3)})`;
}

function formatCohortLabel(iso: string): string {
  const d = new Date(iso);
  // Display the cohort week as the Mon date in IST. The stored value is
  // already Mon-aligned in IST (see ensureUserCohort in /api/events).
  return d.toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
  });
}

export default async function CohortsPage() {
  const data = await getCohortRetention(8);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Cohorts</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Week-on-week retention. Each row is a cohort of users who first
          appeared in that week; columns show the % of that cohort that
          fired any event in week-N afterward.
        </p>
      </div>

      {data.cohorts.length === 0 ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-8 text-center text-sm text-zinc-500">
          No cohorts yet. The cohort-backfill cron runs daily at 04:30 UTC
          — once it&apos;s assigned weeks for your existing users, this
          grid will populate.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900/40">
          <table className="w-full text-xs">
            <thead className="bg-zinc-950 text-left uppercase text-zinc-500">
              <tr>
                <th className="px-3 py-3">Cohort (week of)</th>
                <th className="px-3 py-3 text-right">Size</th>
                {Array.from({ length: data.weeks }, (_, i) => (
                  <th key={i} className="px-3 py-3 text-center">
                    Wk {i}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {data.cohorts.map((c) => (
                <tr key={c.cohortStart}>
                  <td className="whitespace-nowrap px-3 py-2 font-medium text-white">
                    {formatCohortLabel(c.cohortStart)}
                  </td>
                  <td className="px-3 py-2 text-right text-zinc-300">
                    {c.cohortSize}
                  </td>
                  {Array.from({ length: data.weeks }, (_, i) => {
                    const cell = c.cells[i];
                    if (!cell) {
                      return (
                        <td
                          key={i}
                          className="px-3 py-2 text-center text-zinc-700"
                          style={{ backgroundColor: ABSENT_BG }}
                        >
                          —
                        </td>
                      );
                    }
                    return (
                      <td
                        key={i}
                        className="px-3 py-2 text-center text-white"
                        style={{ backgroundColor: colorForRate(cell.ratePct) }}
                        title={`${cell.retainedUsers} of ${cell.cohortSize} users`}
                      >
                        {cell.ratePct === 0 ? "—" : `${cell.ratePct}%`}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 text-xs text-zinc-400">
        <p className="font-semibold text-zinc-300">How to read this grid</p>
        <ul className="mt-2 list-inside list-disc space-y-1">
          <li>
            <strong>Wk 0</strong> is the cohort itself — every cohort hits
            100% there by definition (we filter to users who fired at
            least one event ever).
          </li>
          <li>
            <strong>Wk 1, Wk 2, …</strong> = % of that cohort who came
            back and fired ANY event in that follow-up week.
          </li>
          <li>
            Greener cells = better retention. Empty cells = the cohort
            isn&apos;t old enough to have that follow-up week yet.
          </li>
        </ul>
      </div>
    </div>
  );
}
