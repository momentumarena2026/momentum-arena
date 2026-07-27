import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Scorer console bootstrap: the tournament behind a scorer code + its
 *  scoreable matches (live first, then scheduled with decided teams).
 *  The unguessable code IS the auth — admin shares it with the on-field
 *  scorer; regenerating the code (edit tournament) revokes access. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;
  const t = await db.tournament.findUnique({
    where: { scorerCode: code.toUpperCase() },
    select: {
      id: true,
      name: true,
      sport: true,
      status: true,
      liveScoringEnabled: true,
      matches: {
        where: {
          status: { in: ["LIVE", "SCHEDULED"] },
          homeTeamId: { not: null },
          awayTeamId: { not: null },
        },
        orderBy: [{ status: "desc" }, { scheduledAt: "asc" }],
        select: {
          id: true,
          status: true,
          roundLabel: true,
          scheduledAt: true,
          homeScore: true,
          awayScore: true,
          homeTeam: {
            select: { id: true, name: true, color: true, members: { orderBy: { order: "asc" }, select: { id: true, name: true } } },
          },
          awayTeam: {
            select: { id: true, name: true, color: true, members: { orderBy: { order: "asc" }, select: { id: true, name: true } } },
          },
          liveState: true,
          clockStartedAt: true,
          clockElapsedSec: true,
          stage: true,
        },
      },
    },
  });
  if (!t || !t.liveScoringEnabled) {
    return NextResponse.json({ error: "Invalid scorer code" }, { status: 404 });
  }
  return NextResponse.json({
    tournament: { id: t.id, name: t.name, sport: t.sport, status: t.status },
    matches: t.matches,
  });
}
