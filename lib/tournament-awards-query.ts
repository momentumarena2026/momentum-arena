/**
 * Awards, resolved against the database and shaped for display.
 *
 * lib/tournament-awards.ts holds the engine and knows nothing about Prisma
 * or about names. This file is the seam: it loads the event logs, runs the
 * engine over them, and attaches the names, teams and summary lines the UI
 * needs. Both web and the app read the same output, via
 * app/api/tournaments/[slug]/public and the match-centre payload, so the
 * two surfaces cannot disagree about who won an award.
 *
 * No new tables and no cached columns. Awards are a pure function of the
 * event log, and the moment they are stored they can contradict it — a
 * corrected ball or an undo would leave a stale trophy on the page. The
 * cost is one events query per tournament page; see getTournamentAwards
 * for why that is acceptable.
 */
import { db } from "@/lib/db";
import {
  computeMatchAwards,
  computeTournamentAwards,
  deriveMatchPerfs,
  isRacketSport,
  MVP_MIN_MATCHES,
  type MatchPerf,
  type PointsBreakdown,
  type TournamentTally,
} from "@/lib/tournament-awards";

export type AwardPlayer = {
  memberId: string;
  name: string;
  teamName: string;
  teamColor: string | null;
  points: number;
  /** e.g. "102 (60)" or "5/18 (4.0)" — the line a results post would quote. */
  summary: string;
  /** Itemised points, for the "How is this calculated?" panel. */
  lines: { label: string; points: number }[];
};

export type MatchAwardsView = {
  playerOfMatch: AwardPlayer | null;
  /** True when an admin named the Player of the Match by hand. */
  playerOfMatchIsManual: boolean;
  bestBatter: AwardPlayer | null;
  bestBowler: AwardPlayer | null;
};

export type TournamentAwardsView = {
  sport: string;
  minMatches: number;
  /** Null when no match has any player-tagged scoring yet. */
  mvp: AwardRow[];
  bestBatters: AwardRow[];
  bestBowlers: AwardRow[];
  /** How many completed matches actually carried player attribution. */
  scoredMatches: number;
  totalMatches: number;
};

export type AwardRow = {
  memberId: string;
  name: string;
  teamName: string;
  teamColor: string | null;
  /** The headline number: points per match played. */
  rating: number;
  totalPoints: number;
  matches: number;
  qualified: boolean;
  summary: string;
};

type MemberRef = { id: string; name: string; teamId: string; teamName: string; teamColor: string | null };

const oversOf = (balls: number) => `${Math.floor(balls / 6)}.${balls % 6}`;

/** The one-line stat quote under a player's name. */
function summarise(sport: string, p: MatchPerf): string {
  if (sport === "CRICKET") {
    const bits: string[] = [];
    if (p.batBalls > 0 || p.batRuns > 0) bits.push(`${p.batRuns}${p.out ? "" : "*"} (${p.batBalls})`);
    if (p.bowlBalls > 0) bits.push(`${p.wickets}/${p.bowlRuns} (${oversOf(p.bowlBalls)})`);
    const field = p.catches + p.stumpings + p.runOuts;
    if (field > 0) {
      const f: string[] = [];
      if (p.catches) f.push(`${p.catches} ct`);
      if (p.stumpings) f.push(`${p.stumpings} st`);
      if (p.runOuts) f.push(`${p.runOuts} ro`);
      bits.push(f.join(", "));
    }
    return bits.join(" · ") || "—";
  }
  if (sport === "FOOTBALL") {
    const bits: string[] = [];
    if (p.goals) bits.push(`${p.goals} goal${p.goals === 1 ? "" : "s"}`);
    if (p.assists) bits.push(`${p.assists} assist${p.assists === 1 ? "" : "s"}`);
    if (p.redCards) bits.push("red card");
    else if (p.yellowCards) bits.push(`${p.yellowCards} yellow`);
    return bits.join(" · ") || "—";
  }
  if (isRacketSport(sport)) return p.pointsWon ? `${p.pointsWon} points won` : "—";
  return "—";
}

/** Aggregate summary across the whole tournament. */
function summariseTally(sport: string, t: TournamentTally): string {
  if (sport === "CRICKET") {
    const bits: string[] = [];
    if (t.runs > 0) bits.push(`${t.runs} runs`);
    if (t.wickets > 0) bits.push(`${t.wickets} wkts`);
    return bits.join(" · ") || "—";
  }
  if (sport === "FOOTBALL") {
    const bits: string[] = [];
    if (t.goals) bits.push(`${t.goals} goals`);
    if (t.assists) bits.push(`${t.assists} assists`);
    return bits.join(" · ") || "—";
  }
  if (isRacketSport(sport)) return t.pointsWon ? `${t.pointsWon} points` : "—";
  return "—";
}

const toPlayer = (
  sport: string,
  memberId: string,
  points: number,
  breakdown: PointsBreakdown,
  perf: MatchPerf | undefined,
  members: Map<string, MemberRef>,
): AwardPlayer | null => {
  const m = members.get(memberId);
  if (!m) return null;
  return {
    memberId,
    name: m.name,
    teamName: m.teamName,
    teamColor: m.teamColor,
    points,
    summary: perf ? summarise(sport, perf) : "—",
    lines: breakdown.lines,
  };
};

// ── Match awards ────────────────────────────────────────────────────

/**
 * Awards for one match, computed from its event log.
 *
 * `manualPlayerOfMatchId` wins when set. An admin naming someone is a
 * judgement the maths cannot make — a match-turning catch, a spell that
 * broke a partnership without taking the wicket — and the engine should
 * not overrule it. The computed winner is still returned to admin as a
 * suggestion; this only decides what the public page shows.
 */
export function awardsForMatch(args: {
  sport: string;
  events: { kind: string; teamId: string | null; memberId: string | null; data: unknown }[];
  members: Map<string, MemberRef>;
  manualPlayerOfMatchId?: string | null;
}): MatchAwardsView {
  const { sport, events, members, manualPlayerOfMatchId } = args;
  const memberTeam = new Map([...members.values()].map((m) => [m.id, m.teamId]));
  const perfs = deriveMatchPerfs(sport, events, memberTeam);
  const perfOf = new Map(perfs.map((p) => [p.memberId, p]));
  const a = computeMatchAwards(sport, perfs);

  let playerOfMatch = a.playerOfMatch
    ? toPlayer(sport, a.playerOfMatch.memberId, a.playerOfMatch.points, a.playerOfMatch.breakdown, perfOf.get(a.playerOfMatch.memberId), members)
    : null;
  let playerOfMatchIsManual = false;

  if (manualPlayerOfMatchId && members.has(manualPlayerOfMatchId)) {
    const row = a.rows.find((r) => r.memberId === manualPlayerOfMatchId);
    playerOfMatch = toPlayer(
      sport,
      manualPlayerOfMatchId,
      row?.points ?? 0,
      row?.breakdown ?? { batting: 0, bowling: 0, fielding: 0, total: 0, lines: [] },
      perfOf.get(manualPlayerOfMatchId),
      members,
    );
    playerOfMatchIsManual = true;
  }

  return {
    playerOfMatch,
    playerOfMatchIsManual,
    bestBatter: a.bestBatter
      ? toPlayer(sport, a.bestBatter.memberId, a.bestBatter.points, a.bestBatter.breakdown, perfOf.get(a.bestBatter.memberId), members)
      : null,
    bestBowler: a.bestBowler
      ? toPlayer(sport, a.bestBowler.memberId, a.bestBowler.points, a.bestBowler.breakdown, perfOf.get(a.bestBowler.memberId), members)
      : null,
  };
}

// ── Tournament awards ───────────────────────────────────────────────

/**
 * The tournament MVP, best batter and best bowler tables.
 *
 * COST. This reads every event of every completed match in the tournament
 * — one indexed query on (matchId), a few thousand rows for a full cup —
 * and folds them in memory. It is deliberately not cached in a column:
 * awards must never contradict the log they come from, and an undo in the
 * scorer console has to be reflected immediately. If a tournament ever
 * grows large enough for this to hurt, cache the RESULT with a short TTL
 * rather than denormalising per-player points into a table, or the stale
 * trophy problem comes back.
 */
export async function getTournamentAwards(
  tournamentId: string,
  take = 25,
): Promise<TournamentAwardsView | null> {
  const t = await db.tournament.findUnique({
    where: { id: tournamentId },
    select: { id: true, sport: true },
  });
  if (!t) return null;

  const matches = await db.tournamentMatch.findMany({
    where: { tournamentId, status: "COMPLETED" },
    select: { id: true },
  });
  const matchIds = matches.map((m) => m.id);

  const teams = await db.tournamentTeam.findMany({
    where: { tournamentId },
    select: {
      id: true,
      name: true,
      color: true,
      members: { select: { id: true, name: true } },
    },
  });
  const members = new Map<string, MemberRef>();
  for (const team of teams) {
    for (const m of team.members) {
      members.set(m.id, { id: m.id, name: m.name, teamId: team.id, teamName: team.name, teamColor: team.color });
    }
  }
  const memberTeam = new Map([...members.values()].map((m) => [m.id, m.teamId]));

  const events = matchIds.length
    ? await db.tournamentMatchEvent.findMany({
        where: { matchId: { in: matchIds } },
        orderBy: [{ matchId: "asc" }, { seq: "asc" }],
        select: { matchId: true, kind: true, teamId: true, memberId: true, data: true },
      })
    : [];

  const byMatch = new Map<string, typeof events>();
  for (const e of events) {
    const list = byMatch.get(e.matchId);
    if (list) list.push(e);
    else byMatch.set(e.matchId, [e]);
  }

  const perfsByMatch: MatchPerf[][] = [];
  let scoredMatches = 0;
  for (const list of byMatch.values()) {
    const perfs = deriveMatchPerfs(t.sport, list, memberTeam);
    if (perfs.length) {
      perfsByMatch.push(perfs);
      scoredMatches += 1;
    }
  }

  const { mvp, bestBatters, bestBowlers } = computeTournamentAwards(t.sport, perfsByMatch);

  const toRow = (tally: TournamentTally, rating: number): AwardRow | null => {
    const m = members.get(tally.memberId);
    if (!m) return null;
    return {
      memberId: tally.memberId,
      name: m.name,
      teamName: m.teamName,
      teamColor: m.teamColor,
      rating,
      totalPoints: tally.totalPoints,
      matches: tally.matches,
      qualified: tally.qualified,
      summary: summariseTally(t.sport, tally),
    };
  };
  const perMatch = (v: number, m: number) => (m > 0 ? Math.round((v / m) * 100) / 100 : 0);

  return {
    sport: t.sport,
    minMatches: MVP_MIN_MATCHES,
    scoredMatches,
    totalMatches: matchIds.length,
    mvp: mvp.slice(0, take).flatMap((t2) => toRow(t2, t2.rating) ?? []),
    bestBatters: bestBatters
      .slice(0, take)
      .flatMap((t2) => toRow(t2, perMatch(t2.battingPoints, t2.matches)) ?? []),
    bestBowlers: bestBowlers
      .slice(0, take)
      .flatMap((t2) => toRow(t2, perMatch(t2.bowlingPoints, t2.matches)) ?? []),
  };
}
