import { NextRequest, NextResponse } from "next/server";
import { getMatchCentre } from "@/lib/tournament-scorecard";
import { areTournamentsEnabled } from "@/lib/tournaments";

export const dynamic = "force-dynamic";

/** ESPN-style match centre: header, innings scorecards, ball-by-ball
 *  commentary and the player stat tables. Public (no auth) and shared by
 *  web + app; the live screens poll it while a match is in progress. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ matchId: string }> }
) {
  const { matchId } = await params;
  if (!(await areTournamentsEnabled())) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const data = await getMatchCentre(matchId);
  if (!data) return NextResponse.json({ error: "Match not found" }, { status: 404 });
  return NextResponse.json(data);
}
