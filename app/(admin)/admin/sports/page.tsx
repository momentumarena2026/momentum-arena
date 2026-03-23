import { getAllSportsWithConfigs } from "@/actions/admin-slots";
import { SPORT_INFO, SIZE_INFO } from "@/lib/court-config";
import { SportsToggle } from "./sports-toggle";

export default async function AdminSportsPage() {
  const configs = await getAllSportsWithConfigs();

  // Group by sport
  const configsBySport = configs.reduce((acc, config) => {
    if (!acc[config.sport]) acc[config.sport] = [];
    acc[config.sport].push(config);
    return acc;
  }, {} as Record<string, typeof configs>);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Sports Management</h1>
        <p className="mt-1 text-zinc-400">
          Enable or disable sports and court configurations
        </p>
      </div>

      {Object.entries(configsBySport).map(([sport, sportConfigs]) => {
        const sportInfo = SPORT_INFO[sport as keyof typeof SPORT_INFO];
        const allActive = sportConfigs.every((c) => c.isActive);

        return (
          <div
            key={sport}
            className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 space-y-4"
          >
            <SportsToggle
              sport={sport}
              sportName={sportInfo?.name || sport}
              configs={sportConfigs.map((c) => ({
                id: c.id,
                label: c.label,
                size: c.size,
                sizeName: SIZE_INFO[c.size]?.name || c.size,
                isActive: c.isActive,
                widthFt: c.widthFt,
                lengthFt: c.lengthFt,
              }))}
              allActive={allActive}
            />
          </div>
        );
      })}
    </div>
  );
}
