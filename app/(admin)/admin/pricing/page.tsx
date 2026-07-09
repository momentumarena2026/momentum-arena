import { getAllPricingData } from "@/actions/admin-pricing";
import { getArenaSettings, getRainBannerConfig } from "@/actions/admin-arena-settings";
import { SPORT_INFO, SIZE_INFO } from "@/lib/court-config";
import { ArenaHoursEditor } from "./arena-hours-editor";
import { RainBannerEditor } from "./rain-banner-editor";
import { PricingEditor } from "./pricing-editor";
import { TimeClassificationsEditor } from "./time-classifications-editor";

export default async function AdminPricingPage() {
  const [{ configs, rules, classifications }, arenaHours, rainBanner] =
    await Promise.all([
      getAllPricingData(),
      getArenaSettings(),
      getRainBannerConfig(),
    ]);

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

      {/* Arena open/close window — drives the customer slot picker,
          the admin calendar, the pricing rule generator, and every
          path that calls getAllSlotHoursLive() on the server.
          Sits above time classifications because peak/off-peak
          bands are SUBSETS of this window. */}
      <ArenaHoursEditor
        initialOpenHour={arenaHours.openHour}
        initialCloseHour={arenaHours.closeHour}
      />

      {/* "Rain doesn't slow us down" all-weather banner control. */}
      <RainBannerEditor
        initialMode={rainBanner.mode}
        initialText={rainBanner.text}
      />

      {/* Peak / Off-Peak Hours editor — replaces the previous read-only
          summary. Edits hit the existing updateTimeClassification +
          deleteTimeClassification server actions. Pricing rule prices
          (Weekday/Weekend × PEAK/OFF_PEAK) read from these bands at
          slot-lookup time, so changes here propagate to every customer
          and admin pricing surface on next request. */}
      <TimeClassificationsEditor classifications={classifications} />

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
