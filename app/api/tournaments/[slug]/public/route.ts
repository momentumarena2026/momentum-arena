import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { computeStandings } from "@/lib/tournament-points";
import { areTournamentsEnabled, applyScheduledTransitions } from "@/lib/tournaments";
import { parsePrizes } from "@/lib/tournament-config";
import { poolMatchesArePublic } from "@/lib/tournament-config";

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
  const teamNames = new Map(t.teams.map((x) => [x.id, x.name]));
  const cfg = {
    pointsWin: t.pointsWin,
    pointsDraw: t.pointsDraw,
    pointsLoss: t.pointsLoss,
    tiebreakers: t.tiebreakers,
  };

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
  const leaderboards = await Promise.all(
    statFields.map(async (sf) => {
      const rows = await db.tournamentPlayerStat.groupBy({
        by: ["memberId"],
        where: { tournamentId: t.id, statKey: sf.key },
        _sum: { value: true },
        orderBy: { _sum: { value: "desc" } },
        take: 10,
      });
      const members = await db.tournamentTeamMember.findMany({
        where: { id: { in: rows.map((r) => r.memberId) } },
        select: { id: true, name: true, team: { select: { name: true, color: true } } },
      });
      const memberMap = new Map(members.map((m) => [m.id, m]));
      return {
        key: sf.key,
        label: sf.label,
        rows: rows
          .map((r) => {
            const mem = memberMap.get(r.memberId);
            return mem
              ? {
                  memberId: r.memberId,
                  name: mem.name,
                  teamName: mem.team.name,
                  teamColor: mem.team.color,
                  value: r._sum.value || 0,
                }
              : null;
          })
          .filter(Boolean),
      };
    })
  );

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
    teams: t.teams.map((x) => ({
      id: x.id,
      name: x.name,
      color: x.color,
      logoUrl: x.logoUrl,
      poolId: poolsRevealed ? x.poolId : null,
    })),
    standings,
    // Before the reveal, the fixtures ARE the draw: grouping matches by
    // poolId (and reading "Pool A · Match 1" off the label) reconstructs
    // exactly what the ceremony is meant to unveil. Pool-stage fixtures
    // stay hidden until the flip; knockout fixtures are unaffected.
    matches: poolsRevealed ? t.matches : t.matches.filter((m) => m.stage !== "POOL"),
    leaderboards,
  });
}
