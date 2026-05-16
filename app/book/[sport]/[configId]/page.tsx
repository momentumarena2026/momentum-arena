import { db } from "@/lib/db";
import { SPORT_INFO, SIZE_INFO } from "@/lib/court-config";
import { CourtZone } from "@prisma/client";
import { notFound } from "next/navigation";
import { Maximize2 } from "lucide-react";
import { CourtDiagram, SharedCourtDiagram } from "@/components/booking/court-diagram";
import { BowlingMachineDiagram } from "@/components/booking/bowling-machine-diagram";
import { SlotSelectionClient } from "./slot-selection-client";
import { BowlingSlotPickerClient } from "./bowling-slot-picker-client";
import { auth } from "@/lib/auth";
import { BackButton } from "@/components/back-button";

export default async function SlotSelectionPage({
  params,
}: {
  params: Promise<{ sport: string; configId: string }>;
}) {
  const { sport, configId } = await params;
  const session = await auth();

  const config = await db.courtConfig.findUnique({
    where: { id: configId },
  });

  if (!config || config.sport !== sport.toUpperCase()) {
    notFound();
  }

  const sportInfo = SPORT_INFO[config.sport];
  const sizeInfo = SIZE_INFO[config.size];
  const isBowling = config.category === "BOWLING_MACHINE";
  // Pickleball has its own court geometry (26x50 surface, 20x44
  // playable area) — the generic CourtDiagram draws the 80x90 cricket
  // 4-zone layout which is wrong for pickleball. Mirrors the same
  // dispatch we do on the sport-selection page.
  const isSharedCourt = (config.sport as string) === "PICKLEBALL";

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <BackButton className="mb-4 inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white transition-colors" label="Back" />
        <h1 className="text-2xl font-bold text-white">
          {isBowling
            ? `${sportInfo.name} — Bowling Machine practice`
            : `${sportInfo.name} — ${sizeInfo.name}`}
        </h1>
        <p className="mt-1 text-zinc-400">
          {isBowling
            ? "30-minute slots · use the picker below"
            : config.label}
        </p>
      </div>

      {/* Config Info Card — bowling uses its own SVG / copy so the
          customer immediately sees the 10×90 strip context. */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {isBowling ? (
              <BowlingMachineDiagram size="sm" />
            ) : isSharedCourt ? (
              <SharedCourtDiagram sport={config.sport as "PICKLEBALL"} />
            ) : (
              <CourtDiagram
                highlightedZones={config.zones as CourtZone[]}
                size="sm"
              />
            )}
            <div>
              <p className="font-medium text-white">
                {isBowling ? "Bowling Machine" : config.label}
              </p>
              <p className="flex items-center gap-1 text-sm text-zinc-400">
                <Maximize2 className="h-3 w-3" />
                {config.widthFt} x {config.lengthFt} ft
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Dispatch to the bowling picker (30-min) vs the regular
          slot-selection client (hour). Both shells share this page
          frame so the back button + sticky title stay consistent. */}
      {isBowling ? (
        <BowlingSlotPickerClient
          configId={configId}
          sport={sport}
          userId={session?.user?.id}
        />
      ) : (
        <SlotSelectionClient
          configId={configId}
          sport={sport}
          sportName={sportInfo.name}
          courtLabel={config.label}
          courtSize={sizeInfo.name}
          userId={session?.user?.id}
          userPhone={(session?.user as { phone?: string })?.phone}
        />
      )}
    </div>
  );
}
