import { db } from "@/lib/db";
import { SPORT_INFO, SIZE_INFO } from "@/lib/court-config";
import { CourtDiagram, SharedCourtDiagram } from "@/components/booking/court-diagram";
import { BowlingMachineDiagram } from "@/components/booking/bowling-machine-diagram";
import { Maximize2, Target } from "lucide-react";
import { Sport, CourtZone, BookingCategory } from "@prisma/client";
import Image from "next/image";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { BackButton } from "@/components/back-button";
import { getActiveSportPromo } from "@/actions/sport-promo";

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

  const rawConfigs = await db.courtConfig.findMany({
    where: { sport: sportKey, isActive: true },
    orderBy: [{ size: "asc" }, { position: "asc" }],
  });

  // Within CRICKET, the bowling-machine config lives in its own
  // section ("Bowling Machine practice"). Pull it out of the
  // regular tile list so the Box Cricket section only shows Full
  // Field + Half Court tiles. Non-cricket sports never see this
  // split because their configs all have category=null.
  const bowlingConfig = rawConfigs.find(
    (c) => c.category === ("BOWLING_MACHINE" as BookingCategory),
  );
  const boxConfigs = rawConfigs.filter(
    (c) => c.category !== ("BOWLING_MACHINE" as BookingCategory),
  );

  // Collapse MEDIUM LEFT + MEDIUM RIGHT into a single "Half Court (40×90)"
  // tile. The customer never picks a side — the venue assigns one at game
  // time. We keep the first MEDIUM config's metadata (zones/dimensions) for
  // the tile's visuals and route to /book/[sport]/medium for slot selection.
  const mediumConfigs = boxConfigs.filter((c) => c.size === "MEDIUM");
  const nonMedium = boxConfigs.filter((c) => c.size !== "MEDIUM");

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

  // Auto-redirect logic for sports with only one path. We
  // intentionally NEVER auto-redirect on the cricket page even
  // when the box-cricket section happens to have a single tile —
  // the bowling-machine choice must remain visible.
  if (sportKey !== "CRICKET") {
    if (rawConfigs.length === 1) {
      redirect(`/book/${sport}/${rawConfigs[0].id}`);
    }
    if (tiles.length === 1 && tiles[0].kind === "medium") {
      redirect(`/book/${sport}/medium`);
    }
    if (tiles.length === 1 && tiles[0].kind === "config") {
      redirect(`/book/${sport}/${tiles[0].config.id}`);
    }
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
  const isCricket = sportKey === "CRICKET";

  // Live promo lookup for the launch banner below. Only run for
  // pickleball (the only sport with a banner today); other sports
  // skip the DB roundtrip. When admin disables PICKLEBALL25 in
  // /admin/coupons, this returns null and the banner disappears on
  // the next request.
  const sportPromo =
    sportKey === "PICKLEBALL"
      ? await getActiveSportPromo(sportKey).catch(() => null)
      : null;

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <BackButton className="mb-4 inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white transition-colors" label="Back" />
        <h1 className="text-2xl font-bold text-white">
          {SPORT_INFO[sportKey].name}
        </h1>
        <p className="mt-1 text-zinc-400">
          {isSharedCourt
            ? "Single court — select to book"
            : isCricket
              ? "Pick a Box Cricket field or jump into Bowling Machine practice"
              : "Choose your preferred field size"}
        </p>
      </div>

      {/* Pickleball launch promo banner. Gated on the live PICKLEBALL25
          coupon — when admin disables it in /admin/coupons this
          disappears on the next request. Same image asset web ships
          on the landing page + the slot page (single source of truth
          for the discount copy + pricing). */}
      {sportPromo?.percentOff != null && (
        <div className="overflow-hidden rounded-2xl border border-yellow-500/30 shadow-lg shadow-yellow-500/10">
          <Image
            src="/pickleball-promo-banner.jpg"
            alt={`Pickleball Launch Offer: flat ${sportPromo.percentOff}% off every slot — auto-applied at checkout`}
            width={1200}
            height={400}
            priority
            className="h-auto w-full"
            sizes="(min-width: 768px) 768px, calc(100vw - 32px)"
          />
        </div>
      )}

      {/* Box Cricket / regular field tiles. Title only shows on the
          cricket page where there's a second section below; for
          football/pickleball this renders as a single ungrouped
          grid like before. */}
      {isCricket && tiles.length > 0 && (
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
          Box Cricket
        </h2>
      )}

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

      {/* Bowling-Machine practice — only on the Cricket page.
          Renders as a dedicated section below Box Cricket so the
          customer sees the split at-a-glance instead of mixing it
          into the same grid. Auto-hidden if the bowling-machine
          config is disabled or missing. */}
      {isCricket && bowlingConfig && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
            Bowling Machine practice
          </h2>
          <Link
            href={`/book/${sport}/${bowlingConfig.id}`}
            className="group flex items-stretch gap-4 rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-5 transition-all duration-300 hover:border-emerald-400/60 hover:bg-emerald-500/10"
          >
            <div className="shrink-0 flex items-center">
              <BowlingMachineDiagram size="md" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <Target className="h-4 w-4 text-emerald-400" />
                <h3 className="text-lg font-semibold text-white">
                  Bowling Machine
                </h3>
                <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-300">
                  30-min slots
                </span>
              </div>
              <p className="mt-1 text-sm text-zinc-300">
                {bowlingConfig.widthFt}×{bowlingConfig.lengthFt} ft strip on the
                corner. Practice batting against the machine for as long as you
                like, in 30-minute blocks.
              </p>
              <p className="mt-2 text-xs text-zinc-500">
                Rent kit, bat, or L-guard at checkout.
              </p>
              <div className="mt-3 flex items-center justify-end text-emerald-400 text-sm font-medium opacity-0 transition-opacity group-hover:opacity-100">
                Pick a time →
              </div>
            </div>
          </Link>
        </div>
      )}
    </div>
  );
}
