import Link from "next/link";
import { ArrowRight, Target } from "lucide-react";
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

      {/* Bowling-machine sub-page — owns the half-court picker +
          per-day-type operating windows. Linked here so admins
          discover it from /admin/sports without a dedicated nav
          entry (it's a niche surface). */}
      <Link
        href="/admin/sports/bowling-machine"
        className="group flex items-center gap-4 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 transition-colors hover:bg-emerald-500/10"
      >
        <div className="rounded-lg bg-emerald-500/15 p-2.5">
          <Target className="h-5 w-5 text-emerald-400" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold text-white">
            Bowling Machine practice
          </p>
          <p className="text-xs text-zinc-400">
            Pick LEFT vs RIGHT half + configure open-hours windows
          </p>
        </div>
        <ArrowRight className="h-4 w-4 text-emerald-400 transition-transform group-hover:translate-x-0.5" />
      </Link>

      {Object.entries(configsBySport).map(([sport, sportConfigs]) => {
        const sportInfo = SPORT_INFO[sport as keyof typeof SPORT_INFO];
        // Parent toggle reflects "is this sport operating at all" so a
        // mixed-state sport (some configs on, some off) reads as ON.
        // The child rows below surface the per-config state, so the
        // admin still sees which specific configs are disabled.
        const someActive = sportConfigs.some((c) => c.isActive);

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
              someActive={someActive}
            />
          </div>
        );
      })}
    </div>
  );
}
