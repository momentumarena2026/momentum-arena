import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { footballClockSeconds } from "@/lib/tournament-live";

export const dynamic = "force-dynamic";

/** Public live-match state, polled by audience screens (web + app).
 *
 *  PLATFORM GATE: the tournament's liveScreenPlatform decides who may see
 *  live data. `?platform=web|app` declares the caller; APP_ONLY + web →
 *  a gated response that carries only the store links (the admin's
 *  drive-app-downloads lever). The check is server-side — the gated
 *  response contains no live data at all. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ matchId: string }> }
) {
  const { matchId } = await params;
  const platform = request.nextUrl.searchParams.get("platform") === "app" ? "app" : "web";

  const match = await db.tournamentMatch.findUnique({
    where: { id: matchId },
    select: {
      id: true,
      status: true,
      stage: true,
      roundLabel: true,
      scheduledAt: true,
      homeScore: true,
      awayScore: true,
      homeScoreNote: true,
      awayScoreNote: true,
      isDraw: true,
      winnerTeamId: true,
      liveState: true,
      clockStartedAt: true,
      clockElapsedSec: true,
      homeTeam: { select: { id: true, name: true, color: true, logoUrl: true } },
      awayTeam: { select: { id: true, name: true, color: true, logoUrl: true } },
      playerOfMatch: { select: { name: true } },
      tournament: {
        select: {
          id: true,
          slug: true,
          name: true,
          sport: true,
          liveScoringEnabled: true,
          liveScreenPlatform: true,
        },
      },
    },
  });
  if (!match) return NextResponse.json({ error: "Match not found" }, { status: 404 });

  const gate = match.tournament.liveScreenPlatform;
  const gated =
    !match.tournament.liveScoringEnabled ||
    gate === "OFF" ||
    (gate === "APP_ONLY" && platform === "web") ||
    (gate === "WEB_ONLY" && platform === "app");
  if (gated) {
    return NextResponse.json({
      gated: true,
      reason: gate === "APP_ONLY" ? "APP_ONLY" : "OFF",
      tournament: { name: match.tournament.name, slug: match.tournament.slug },
      stores: {
        android: "https://play.google.com/store/apps/details?id=com.momentumarena",
        ios: "https://apps.apple.com/app/id6783955158",
      },
    });
  }

  const events = await db.tournamentMatchEvent.findMany({
    where: { matchId },
    orderBy: { seq: "desc" },
    take: 30,
    select: {
      seq: true,
      kind: true,
      teamId: true,
      data: true,
      createdAt: true,
      member: { select: { name: true } },
    },
  });

  return NextResponse.json({
    gated: false,
    match: {
      id: match.id,
      status: match.status,
      stage: match.stage,
      roundLabel: match.roundLabel,
      scheduledAt: match.scheduledAt,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      homeScore: match.homeScore,
      awayScore: match.awayScore,
      homeScoreNote: match.homeScoreNote,
      awayScoreNote: match.awayScoreNote,
      isDraw: match.isDraw,
      winnerTeamId: match.winnerTeamId,
      liveState: match.liveState,
      clockSeconds:
        match.tournament.sport === "FOOTBALL" ? footballClockSeconds(match) : null,
      clockRunning: !!match.clockStartedAt,
      playerOfMatch: match.playerOfMatch?.name || null,
    },
    tournament: {
      slug: match.tournament.slug,
      name: match.tournament.name,
      sport: match.tournament.sport,
    },
    events,
  });
}
