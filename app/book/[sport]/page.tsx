import { db } from "@/lib/db";
import { SPORT_INFO, SIZE_INFO } from "@/lib/court-config";
import { CourtDiagram, SharedCourtDiagram } from "@/components/booking/court-diagram";
import { ArrowLeft, Maximize2 } from "lucide-react";
import { Sport, CourtZone } from "@prisma/client";
import Link from "next/link";
import { notFound } from "next/navigation";

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

  if (sportKey === "PICKLEBALL" || sportKey === "BADMINTON") {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <Link
          href="/book"
          className="inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Sports
        </Link>
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

  const configs = await db.courtConfig.findMany({
    where: { sport: sportKey, isActive: true },
    orderBy: [{ size: "asc" }, { position: "asc" }],
  });

  if (configs.length === 0) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <Link
          href="/book"
          className="inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Sports
        </Link>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-12 text-center">
          <p className="text-zinc-400">No configurations available for {SPORT_INFO[sportKey].name}.</p>
        </div>
      </div>
    );
  }

  const isSharedCourt = (sportKey as string) === "PICKLEBALL" || (sportKey as string) === "BADMINTON";

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link
          href="/book"
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Sports
        </Link>
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
        {configs.map((config) => {
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
                  <SharedCourtDiagram sport={sportKey as "PICKLEBALL" | "BADMINTON"} />
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
