import { db } from "@/lib/db";
import { SPORT_INFO, SIZE_INFO } from "@/lib/court-config";
import { CourtDiagram, SharedCourtDiagram } from "@/components/booking/court-diagram";
import { Maximize2 } from "lucide-react";
import { Sport, CourtZone } from "@prisma/client";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { BackButton } from "@/components/back-button";

export default async function SportConfigPage({
  params,
}: {
  params: Promise<{ sport: string }>;
}) {
  const { sport } = await params;
  const sportKey = sport.toUpperCase() as Sport;

  if (!SPORT_INFO[sportKey]) {
    notFound();
  }

  if (sportKey === "PICKLEBALL") {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <BackButton label="Back" />
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-12 text-center">
          <h2 className="text-2xl font-bold text-white">
            {SPORT_INFO[sportKey].name}
          </h2>
          <p className="mt-2 text-amber-400 font-semibold">Coming Soon</p>
          <p className="mt-3 text-sm text-zinc-400">
            We&apos;re getting the courts ready. Stay tuned!
          </p>
        </div>
      </div>
    );
  }

  const rawConfigs = await db.courtConfig.findMany({
    where: { sport: sportKey, isActive: true },
    orderBy: [{ size: "asc" }, { position: "asc" }],
  });

  // Collapse MEDIUM LEFT + MEDIUM RIGHT into a single "Half Court (40×90)"
  // tile. The customer never picks a side — the venue assigns one at game
  // time. We keep the first MEDIUM config's metadata (zones/dimensions) for
  // the tile's visuals and route to /book/[sport]/medium for slot selection.
  const mediumConfigs = rawConfigs.filter((c) => c.size === "MEDIUM");
  const nonMedium = rawConfigs.filter((c) => c.size !== "MEDIUM");

  type Tile =
    | { kind: "config"; config: (typeof rawConfigs)[number] }
    | {
        kind: "medium";
        representative: (typeof rawConfigs)[number];
      };

  const tiles: Tile[] = [
    ...nonMedium.map((config) => ({ kind: "config" as const, config })),
    ...(mediumConfigs.length > 0
      ? [{ kind: "medium" as const, representative: mediumConfigs[0] }]
      : []),
  ];

  // Auto-redirect to slot selection if only one choice available
  if (rawConfigs.length === 1) {
    redirect(`/book/${sport}/${rawConfigs[0].id}`);
  }
  if (tiles.length === 1 && tiles[0].kind === "medium") {
    redirect(`/book/${sport}/medium`);
  }
  if (tiles.length === 1 && tiles[0].kind === "config") {
    redirect(`/book/${sport}/${tiles[0].config.id}`);
  }

  if (rawConfigs.length === 0) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <BackButton label="Back" />
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-12 text-center">
          <p className="text-zinc-400">No configurations available for {SPORT_INFO[sportKey].name}.</p>
        </div>
      </div>
    );
  }

  const isSharedCourt = (sportKey as string) === "PICKLEBALL";

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <BackButton className="mb-4 inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white transition-colors" label="Back" />
        <h1 className="text-2xl font-bold text-white">
          {SPORT_INFO[sportKey].name}
        </h1>
        <p className="mt-1 text-zinc-400">
          {isSharedCourt
            ? "Single court — select to book"
            : "Choose your preferred field size"}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {tiles.map((tile) => {
          if (tile.kind === "medium") {
            const rep = tile.representative;
            const sizeInfo = SIZE_INFO[rep.size];
            return (
              <Link
                key="medium"
                href={`/book/${sport}/medium`}
                className="group rounded-2xl border border-zinc-800 bg-zinc-900 p-5 transition-all duration-300 hover:border-emerald-500/30 hover:bg-zinc-900/80"
              >
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-white">
                    {sizeInfo.name}
                  </h3>
                  <div className="flex items-center gap-1 text-xs text-zinc-500">
                    <Maximize2 className="h-3 w-3" />
                    {rep.widthFt} x {rep.lengthFt} ft
                  </div>
                </div>
                <div className="mb-3 flex justify-center">
                  <CourtDiagram
                    highlightedZones={rep.zones as CourtZone[]}
                    size="sm"
                  />
                </div>
                <p className="text-sm text-zinc-400">Half Court (40×90)</p>
                <p className="mt-1 text-xs text-zinc-500">
                  {sizeInfo.description}
                </p>
                <div className="mt-3 flex items-center justify-end text-emerald-500 text-sm font-medium opacity-0 transition-opacity group-hover:opacity-100">
                  Select →
                </div>
              </Link>
            );
          }

          const config = tile.config;
          const sizeInfo = SIZE_INFO[config.size];

          return (
            <Link
              key={config.id}
              href={`/book/${sport}/${config.id}`}
              className="group rounded-2xl border border-zinc-800 bg-zinc-900 p-5 transition-all duration-300 hover:border-emerald-500/30 hover:bg-zinc-900/80"
            >
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-lg font-semibold text-white">
                  {sizeInfo.name}
                </h3>
                <div className="flex items-center gap-1 text-xs text-zinc-500">
                  <Maximize2 className="h-3 w-3" />
                  {config.widthFt} x {config.lengthFt} ft
                </div>
              </div>

              {/* Court Diagram */}
              <div className="mb-3 flex justify-center">
                {isSharedCourt ? (
                  <SharedCourtDiagram sport={sportKey as "PICKLEBALL"} />
                ) : (
                  <CourtDiagram
                    highlightedZones={config.zones as CourtZone[]}
                    size="sm"
                  />
                )}
              </div>

              <p className="text-sm text-zinc-400">{config.label}</p>
              <p className="mt-1 text-xs text-zinc-500">
                {sizeInfo.description}
              </p>

              <div className="mt-3 flex items-center justify-end text-emerald-500 text-sm font-medium opacity-0 transition-opacity group-hover:opacity-100">
                Select →
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
