import { FUNNELS, type FunnelKey, getFunnel, getInsightsOverview } from "@/actions/admin-insights";
import { FunnelsClient } from "./funnels-client";

const VALID_KEYS = Object.keys(FUNNELS) as FunnelKey[];

function pickKey(value: string | undefined): FunnelKey {
  return VALID_KEYS.includes(value as FunnelKey) ? (value as FunnelKey) : "booking";
}

function defaultDateRange(): { from: string; to: string } {
  const now = new Date();
  const to = now.toISOString().split("T")[0];
  const fromDate = new Date(now);
  fromDate.setUTCDate(fromDate.getUTCDate() - 29);
  const from = fromDate.toISOString().split("T")[0];
  return { from, to };
}

export default async function FunnelsPage({
  searchParams,
}: {
  searchParams: Promise<{
    funnel?: string;
    from?: string;
    to?: string;
  }>;
}) {
  const sp = await searchParams;
  const funnelKey = pickKey(sp.funnel);
  const range = (() => {
    const def = defaultDateRange();
    return { from: sp.from || def.from, to: sp.to || def.to };
  })();

  const [funnel, overview] = await Promise.all([
    getFunnel(funnelKey, range.from, range.to),
    getInsightsOverview(range.from, range.to),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Funnels</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Step-by-step conversion across the booking, cafe, waitlist,
          and auth flows. Sessions, not users — anon visitors count
          until they sign in.
        </p>
      </div>

      <FunnelsClient
        initialFunnel={funnel}
        funnelKey={funnelKey}
        range={range}
        availableFunnels={VALID_KEYS.map((k) => ({ key: k, label: FUNNELS[k].label }))}
        overview={overview}
      />
    </div>
  );
}
