import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { computeStandings, inningsFromLiveState, standingsConfig } from "@/lib/tournament-points";
import { getTournamentLeaderboards } from "@/lib/tournament-leaderboards";
import { areTournamentsEnabled, applyScheduledTransitions } from "@/lib/tournaments";
import { parsePrizes } from "@/lib/tournament-config";
import { poolMatchesArePublic, rosterIsPublic } from "@/lib/tournament-config";

export const dynamic = "force-dynamic";

/** One public JSON payload powering every tournament screen (web + app):
 *  status/timeline, pools (ONLY once revealed — the reveal screen polls
 *  this waiting for the flip), standings per pool/league, fixtures with
 *  live scores, bracket rounds and stat leaderboards. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  if (!(await areTournamentsEnabled())) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const t = await db.tournament.findUnique({
    where: { slug },
    include: {
      slots: {
        orderBy: [{ date: "asc" }, { startHour: "asc" }],
        select: {
          id: true, date: true, startHour: true, endHour: true, label: true,
          courtConfig: { select: { label: true } },
        },
      },
      pools: {
        orderBy: { order: "asc" },
        select: { id: true, name: true, order: true },
      },
      teams: {
        where: { status: "CONFIRMED" },
        select: { id: true, name: true, color: true, logoUrl: true, poolId: true },
      },
      matches: {
        orderBy: [{ scheduledAt: "asc" }, { sequence: "asc" }],
        select: {
          id: true,
          stage: true,
          status: true,
          sequence: true,
          roundLabel: true,
          poolId: true,
          homeTeamId: true,
          awayTeamId: true,
          homeSourceLabel: true,
          awaySourceLabel: true,
          // The bracket is drawn by following these back from the final,
          // so the connectors match how the rounds are actually wired.
          homeSourceMatchId: true,
          awaySourceMatchId: true,
          homeScore: true,
          awayScore: true,
          homeScoreNote: true,
          awayScoreNote: true,
          isDraw: true,
          winnerTeamId: true,
          scheduledAt: true,
          // Feeds the pinned live card's "30/1 (2.0 ov)" line.
          liveState: true,
          courtConfig: { select: { label: true } },
          playerOfMatch: { select: { name: true } },
        },
      },
    },
  });
  if (!t || t.status === "DRAFT" || t.status === "CANCELLED") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  t.status = (await applyScheduledTransitions(t)) as typeof t.status;

  const poolsRevealed = poolMatchesArePublic(t.status);
  // Who has entered becomes public when registration CLOSES; which pool
  // they landed in waits for the reveal. Two questions, two gates.
  const rosterPublic = rosterIsPublic(t.status);
  const teamNames = new Map(t.teams.map((x) => [x.id, x.name]));
  const isCricket = t.sport === "CRICKET";
  const cfg = standingsConfig(t);

  // Standings per pool (or one league table).
  const completedRR = (poolId: string | null) =>
    t.matches
      .filter(
        (m) =>
          (poolId ? m.poolId === poolId : m.stage === "LEAGUE") &&
          (m.status === "COMPLETED" || m.status === "WALKOVER") &&
          m.homeTeamId &&
          m.awayTeamId &&
          m.homeScore != null &&
          m.awayScore != null
      )
      .map((m) => ({
        homeTeamId: m.homeTeamId!,
        awayTeamId: m.awayTeamId!,
        homeScore: m.homeScore!,
        awayScore: m.awayScore!,
        isDraw: m.isDraw,
        winnerTeamId: m.winnerTeamId,
        // The scorer's ball-by-ball fold, still on the row after the match
        // completes. Only cricket has a run rate to speak of.
        innings: isCricket ? inningsFromLiveState(m.liveState) : undefined,
      }));

  let standings: { poolId: string | null; poolName: string | null; rows: unknown[] }[] = [];
  if (t.format === "LEAGUE") {
    standings = [
      {
        poolId: null,
        poolName: null,
        rows: computeStandings(t.teams.map((x) => x.id), completedRR(null), cfg, teamNames),
      },
    ];
  } else if (t.format === "POOLS_KNOCKOUT" && poolsRevealed) {
    standings = t.pools.map((p) => ({
      poolId: p.id,
      poolName: p.name,
      rows: computeStandings(
        t.teams.filter((x) => x.poolId === p.id).map((x) => x.id),
        completedRR(p.id),
        cfg,
        teamNames
      ),
    }));
  }

  // Leaderboards per stat key.
  const statFields = (Array.isArray(t.statFields) ? t.statFields : []) as {
    key: string;
    label: string;
  }[];
  const leaderboards = await getTournamentLeaderboards(t.id, statFields);

  return NextResponse.json({
    tournament: {
      id: t.id,
      slug: t.slug,
      name: t.name,
      sport: t.sport,
      status: t.status,
      format: t.format,
      totalTeams: t.totalTeams,
      poolCount: t.poolCount,
      teamsPerPool: t.teamsPerPool,
      advancePerPool: t.advancePerPool,
      bracketSeeding: t.bracketSeeding,
      revealAt: t.revealAt,
      regOpenAt: t.regOpenAt,
      regCloseAt: t.regCloseAt,
      startDate: t.startDate,
      prizePool: t.prizePool,
      // Who runs it. The app hides registration and shows "Hosted by …"
      // on THIRD_PARTY, matching the web page.
      host: t.host,
      organizerName: t.organizerName,
      entryFee: t.entryFee,
      feeMode: t.feeMode,
      advancePct: t.advancePct,
      allowRewardPoints: t.allowRewardPoints,
      allowCoupons: t.allowCoupons,
      liveScoringEnabled: t.liveScoringEnabled,
      liveScreenPlatform: t.liveScreenPlatform,
      // The app's detail screen had none of these, so "about / rules /
      // prizes / when / squad size" were web-only. Public fields the
      // web page already renders from its own DB read.
      description: t.description,
      rules: t.rules,
      // Same parser the web page uses, so the app can't drift from it —
      // entries are {place, label} with label as free text.
      prizes: parsePrizes(t.prizes),
      bannerImageUrl: t.bannerImageUrl,
      endDate: t.endDate,
      membersPerTeamMax: t.membersPerTeamMax,
      thirdPlaceMatch: t.thirdPlaceMatch,
      matchDurationMinutes: t.matchDurationMinutes,
    },
    // Pre-decided match windows. Public from the moment the admin adds
    // them — a team deciding whether to enter needs to know when it
    // would have to turn up. Semi-final and final are not in here.
    matchSlots: t.slots.map((s2) => ({
      id: s2.id,
      date: s2.date.toISOString(),
      startHour: s2.startHour,
      endHour: s2.endHour,
      label: s2.label,
      courtLabel: s2.courtConfig?.label ?? null,
    })),
    poolsRevealed,
    pools: poolsRevealed ? t.pools : [],
    // WHO HAS ENTERED IS NOT PUBLIC UNTIL THE DRAW.
    //
    // The venue's decision, and the same gate the pools and the pool
    // fixtures below already sit behind. A roster of entrants on an open
    // tournament tells every rival captain exactly who they would be up
    // against and how full the draw is before they commit — and the
    // count is the more sensitive half, because "4 of 16" reads as a
    // tournament nobody wants.
    //
    // Enforced HERE rather than by hiding it in the two clients, because
    // hiding it in a client leaves the names one curl away and leaves
    // every app install that has not updated still rendering them. That
    // lesson is written down in §9 of PROJECT-CONTEXT and cost this
    // codebase a real bug on the challenge board.
    //
    // After the reveal the names are public by necessity: the pools, the
    // fixtures and the points table are all made of them.
    teams: rosterPublic
      ? t.teams.map((x) => ({
          id: x.id,
          name: x.name,
          color: x.color,
          logoUrl: x.logoUrl,
          // Still the draw's secret, even once the roster is out.
          poolId: poolsRevealed ? x.poolId : null,
        }))
      : [],
    standings,
    // Before the reveal, the fixtures ARE the draw: grouping matches by
    // poolId (and reading "Pool A · Match 1" off the label) reconstructs
    // exactly what the ceremony is meant to unveil. Pool-stage fixtures
    // stay hidden until the flip; knockout fixtures are unaffected.
    matches: poolsRevealed ? t.matches : t.matches.filter((m) => m.stage !== "POOL"),
    leaderboards,
  });
}
