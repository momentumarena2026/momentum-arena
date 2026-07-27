import { NextResponse } from "next/server";
import { listPublicTournaments } from "@/lib/tournaments";

export const dynamic = "force-dynamic";

/** Lightweight tournament hub list for the mobile app (public). */
export async function GET() {
  const rows = await listPublicTournaments();
  return NextResponse.json(
    rows.map((t) => ({
      id: t.id,
      slug: t.slug,
      name: t.name,
      sport: t.sport,
      status: t.status,
      format: t.format,
      bannerImageUrl: t.bannerImageUrl,
      totalTeams: t.totalTeams,
      entryFee: t.entryFee,
      feeMode: t.feeMode,
      prizePool: t.prizePool,
      startDate: t.startDate,
      liveScoringEnabled: t.liveScoringEnabled,
      confirmedTeams: t._count.teams,
    }))
  );
}
