import { db } from "@/lib/db";
import { SPORT_INFO, SIZE_INFO } from "@/lib/court-config";
import { CourtZone } from "@prisma/client";
import { notFound } from "next/navigation";
import { Maximize2 } from "lucide-react";
import { CourtDiagram } from "@/components/booking/court-diagram";
import { SlotSelectionClient } from "./slot-selection-client";
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

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <BackButton className="mb-4 inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white transition-colors" label={`Back to ${sportInfo.name} Sizes`} />
        <h1 className="text-2xl font-bold text-white">
          {sportInfo.name} — {sizeInfo.name}
        </h1>
        <p className="mt-1 text-zinc-400">{config.label}</p>
      </div>

      {/* Config Info Card */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CourtDiagram
              highlightedZones={config.zones as CourtZone[]}
              size="sm"
            />
            <div>
              <p className="font-medium text-white">{config.label}</p>
              <p className="flex items-center gap-1 text-sm text-zinc-400">
                <Maximize2 className="h-3 w-3" />
                {config.widthFt} x {config.lengthFt} ft
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Client-side slot selection */}
      <SlotSelectionClient
        configId={configId}
        sport={sport}
        sportName={sportInfo.name}
        courtLabel={config.label}
        courtSize={sizeInfo.name}
        userId={session?.user?.id}
        userPhone={(session?.user as { phone?: string })?.phone}
      />
    </div>
  );
}
