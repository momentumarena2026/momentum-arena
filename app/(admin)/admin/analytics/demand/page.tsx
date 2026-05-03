import { getDemandHeatmap } from "@/actions/admin-insights";
import { DemandClient } from "./demand-client";

function defaultDateRange(): { from: string; to: string } {
  const now = new Date();
  const to = now.toISOString().split("T")[0];
  const fromDate = new Date(now);
  fromDate.setUTCDate(fromDate.getUTCDate() - 89);
  const from = fromDate.toISOString().split("T")[0];
  return { from, to };
}

export default async function DemandPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; sport?: string }>;
}) {
  const sp = await searchParams;
  const def = defaultDateRange();
  const from = sp.from || def.from;
  const to = sp.to || def.to;

  const data = await getDemandHeatmap(from, to);
  const sports = Array.from(new Set(data.cells.map((c) => c.sport)))
    .filter((s) => s !== "_")
    .sort();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Unmet demand</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Day-of-week × hour heatmap of users who tried to book a
          slot that was unavailable. Combines waitlist joins and raw
          unavailable-slot taps. Brighter = stronger demand for slots
          you don&apos;t have capacity for.
        </p>
      </div>

      <DemandClient
        data={data}
        from={from}
        to={to}
        sports={sports}
        selectedSport={sp.sport ?? "all"}
      />
    </div>
  );
}
