import { getAllPricingData } from "@/actions/admin-pricing";
import { SPORT_INFO, SIZE_INFO, formatHour } from "@/lib/court-config";
import { PricingEditor } from "./pricing-editor";

export default async function AdminPricingPage() {
  const { configs, rules, classifications } = await getAllPricingData();

  // Group configs by sport
  const configsBySport = configs.reduce((acc, config) => {
    if (!acc[config.sport]) acc[config.sport] = [];
    acc[config.sport].push(config);
    return acc;
  }, {} as Record<string, typeof configs>);

  // Build pricing map: configId -> dayType_timeType -> price
  const pricingMap = new Map<string, Record<string, number>>();
  for (const rule of rules) {
    const key = rule.courtConfigId;
    if (!pricingMap.has(key)) pricingMap.set(key, {});
    pricingMap.get(key)![`${rule.dayType}_${rule.timeType}`] = rule.pricePerSlot;
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Pricing Management</h1>
        <p className="mt-1 text-zinc-400">
          Set prices per slot for each court configuration
        </p>
      </div>

      {/* Time Classifications */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
        <h2 className="mb-3 text-sm font-medium text-zinc-500 uppercase tracking-wider">
          Time Classifications
        </h2>
        <div className="space-y-2">
          {classifications.map((c) => (
            <div
              key={c.id}
              className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-sm"
            >
              <span className="text-zinc-400">
                {c.dayType} • {formatHour(c.startHour)} - {formatHour(c.endHour)}
              </span>
              <span
                className={`rounded-full border px-2 py-0.5 text-xs ${
                  c.timeType === "PEAK"
                    ? "border-red-500/30 bg-red-500/10 text-red-400"
                    : "border-blue-500/30 bg-blue-500/10 text-blue-400"
                }`}
              >
                {c.timeType.replace("_", " ")}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Pricing Grid by Sport */}
      {Object.entries(configsBySport).map(([sport, sportConfigs]) => {
        const sportInfo = SPORT_INFO[sport as keyof typeof SPORT_INFO];

        return (
          <div key={sport} className="space-y-4">
            <h2 className="text-lg font-semibold text-white">
              {sportInfo?.name || sport}
            </h2>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-800">
                    <th className="pb-3 pr-4 text-left text-zinc-500 font-medium">
                      Configuration
                    </th>
                    <th className="pb-3 px-4 text-right text-zinc-500 font-medium">
                      Weekday Off-Peak
                    </th>
                    <th className="pb-3 px-4 text-right text-zinc-500 font-medium">
                      Weekday Peak
                    </th>
                    <th className="pb-3 px-4 text-right text-zinc-500 font-medium">
                      Weekend Off-Peak
                    </th>
                    <th className="pb-3 pl-4 text-right text-zinc-500 font-medium">
                      Weekend Peak
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sportConfigs.map((config) => {
                    const prices = pricingMap.get(config.id) || {};
                    const sizeInfo = SIZE_INFO[config.size];

                    return (
                      <PricingEditor
                        key={config.id}
                        configId={config.id}
                        configLabel={`${sizeInfo.name} (${config.label})`}
                        prices={{
                          WEEKDAY_OFF_PEAK: prices.WEEKDAY_OFF_PEAK || 0,
                          WEEKDAY_PEAK: prices.WEEKDAY_PEAK || 0,
                          WEEKEND_OFF_PEAK: prices.WEEKEND_OFF_PEAK || 0,
                          WEEKEND_PEAK: prices.WEEKEND_PEAK || 0,
                        }}
                      />
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}
