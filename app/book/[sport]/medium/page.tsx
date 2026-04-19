import { db } from "@/lib/db";
import { SPORT_INFO, SIZE_INFO } from "@/lib/court-config";
import { CourtZone, Sport } from "@prisma/client";
import { notFound } from "next/navigation";
import { Maximize2, Info } from "lucide-react";
import { CourtDiagram } from "@/components/booking/court-diagram";
import { SlotSelectionClient } from "../[configId]/slot-selection-client";
import { auth } from "@/lib/auth";
import { BackButton } from "@/components/back-button";

/**
 * Unified "Half Court (40×90)" customer flow.
 *
 * The physical venue has a LEFT and RIGHT 40×90 half; either can host a
 * half-court game and the two share no playing zones. From the customer's
 * perspective we expose a single "Half Court" tile: up to two different
 * customers can book the same hour, with the venue assigning concrete
 * sides at game time.
 *
 * Availability + locking happen against the merged LEFT+RIGHT view on the
 * server. When the hold is created the system picks a specific half
 * (preferring LEFT) and tags the hold + resulting Booking with
 * `wasBookedAsHalfCourt = true` so customer-facing screens render a neutral
 * "Half Court (40×90)" label while admin screens keep the concrete side.
 */
export default async function HalfCourtSlotSelectionPage({
  params,
}: {
  params: Promise<{ sport: string }>;
}) {
  const { sport } = await params;
  const sportKey = sport.toUpperCase() as Sport;
  const session = await auth();

  if (!SPORT_INFO[sportKey]) notFound();

  // Grab a representative MEDIUM config for the visual (both halves have
  // the same 40×90 dimensions; zones differ but either set is illustrative).
  const representative = await db.courtConfig.findFirst({
    where: { sport: sportKey, size: "MEDIUM", isActive: true },
    orderBy: { position: "asc" },
  });

  if (!representative) notFound();

  const sportInfo = SPORT_INFO[sportKey];
  const sizeInfo = SIZE_INFO[representative.size];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <BackButton
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white transition-colors"
          label="Back"
        />
        <h1 className="text-2xl font-bold text-white">
          {sportInfo.name} — {sizeInfo.name}
        </h1>
        <p className="mt-1 text-zinc-400">Half Court (40×90)</p>
      </div>

      {/* Config Info Card */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <div className="flex items-center gap-3">
          <CourtDiagram
            highlightedZones={representative.zones as CourtZone[]}
            size="sm"
          />
          <div>
            <p className="font-medium text-white">Half Court (40×90)</p>
            <p className="flex items-center gap-1 text-sm text-zinc-400">
              <Maximize2 className="h-3 w-3" />
              {representative.widthFt} x {representative.lengthFt} ft
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-sky-500/30 bg-sky-500/5 p-3">
        <p className="flex items-start gap-2 text-xs text-sky-200">
          <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
          <span>
            We have two 40×90 halves. The venue will assign you a side at
            check-in, so a slot stays available as long as one half is free.
          </span>
        </p>
      </div>

      {/* Client-side slot selection — mediumMode routes availability and
          locking through the unified half-court API. */}
      <SlotSelectionClient
        configId={`medium-${sportKey.toLowerCase()}`}
        sport={sport}
        sportName={sportInfo.name}
        courtLabel="Half Court (40×90)"
        courtSize={sizeInfo.name}
        userId={session?.user?.id}
        userPhone={(session?.user as { phone?: string })?.phone}
        mediumMode
      />
    </div>
  );
}
