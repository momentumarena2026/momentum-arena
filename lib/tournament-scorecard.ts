import { db } from "@/lib/db";
import {
  batterRunsOf,
  bowlerRunsOf,
  footballClockSeconds,
} from "@/lib/tournament-live";
import {
  creditsBowler,
  dismissalCommentary,
  dismissalLine,
} from "@/lib/cricket-dismissal";

// ESPNcricinfo-style match centre data.
//
// The event log is already the source of truth for the score; this module
// folds the SAME log a second time into the per-player cards a cricket
// (or football / pickleball) follower expects: batting R/B/4s/6s/SR,
// bowling O/M/R/W/Econ, fall of wickets, over-by-over commentary.
//
// Everything here is derived — no new tables. A match scored without
// tagging players still produces innings totals and commentary; the
// player rows simply stay empty, and the admin's manually entered stats
// are shown instead (mirroring how refoldMatch leaves them alone).

export type BattingRow = {
  memberId: string;
  name: string;
  runs: number;
  balls: number;
  fours: number;
  sixes: number;
  strikeRate: number;
  out: boolean;
  dismissal: string | null;
};

export type BowlingRow = {
  memberId: string;
  name: string;
  balls: number;
  overs: string; // "3.2"
  runs: number;
  wickets: number;
  economy: number;
};

export type FallOfWicket = { wicket: number; runs: number; over: string; batter: string | null };

export type InningsCard = {
  teamId: string;
  teamName: string;
  teamColor: string | null;
  runs: number;
  wickets: number;
  balls: number;
  overs: string;
  runRate: number;
  extras: number;
  batting: BattingRow[];
  bowling: BowlingRow[];
  fallOfWickets: FallOfWicket[];
};

export type CommentaryBall = {
  seq: number;
  over: string; // "2.4"
  text: string;
  runs: number;
  wicket: boolean;
  boundary: 0 | 4 | 6;
  createdAt: string;
};

/** "Who's out there right now" — names resolved, ready to render. Present
 *  only while a match is LIVE; every surface (web, app, TV) shows the same
 *  thing the scorer is looking at. */
export type LiveNow = {
  sport: string;
  cricket?: {
    battingTeamName: string | null;
    striker: { name: string; runs: number; balls: number } | null;
    nonStriker: { name: string; runs: number; balls: number } | null;
    bowler: { name: string; overs: string; runs: number; wickets: number } | null;
    thisOver: string[];
    partnership: { runs: number; balls: number };
  };
  football?: {
    lastGoal: { teamName: string | null; scorer: string | null; assist: string | null } | null;
    scorers: { teamName: string | null; name: string | null }[];
  };
  pickleball?: { servingTeamName: string | null; gameNumber: number };
};

export type MatchCentre = {
  match: {
    id: string;
    status: string;
    stage: string;
    roundLabel: string | null;
    scheduledAt: string | null;
    venue: string | null;
    sport: string;
    homeTeam: TeamBrief | null;
    awayTeam: TeamBrief | null;
    homeScore: number | null;
    awayScore: number | null;
    homeScoreNote: string | null;
    awayScoreNote: string | null;
    isDraw: boolean;
    winnerTeamId: string | null;
    playerOfMatch: string | null;
    resultText: string;
    clockSeconds: number | null;
    clockRunning: boolean;
  };
  tournament: { slug: string; name: string; sport: string };
  /** Null unless the match is in progress. */
  liveNow: LiveNow | null;
  innings: InningsCard[];
  commentary: CommentaryBall[];
  /** Fallback per-player stat table for non-cricket sports and for
   *  matches whose result was entered by hand. */
  statTable: { teamId: string; teamName: string; rows: { name: string; values: Record<string, number> }[] }[];
  statFields: { key: string; label: string }[];
};

type TeamBrief = { id: string; name: string; color: string | null; logoUrl: string | null };

const oversOf = (balls: number) => `${Math.floor(balls / 6)}.${balls % 6}`;
const rate = (runs: number, balls: number) => (balls > 0 ? Number(((runs / balls) * 6).toFixed(2)) : 0);

/** Resolve the fold's current-players block into display-ready names. */
function buildLiveNow(args: {
  sport: string;
  liveState: unknown;
  nameOf: Map<string, string>;
  teamName: (id: string | null) => string | null;
}): LiveNow | null {
  const { sport, liveState, nameOf, teamName } = args;
  const st = liveState as Record<string, unknown> | null;
  if (!st) return null;

  if (sport === "CRICKET") {
    const cur = st.current as
      | {
          strikerId: string | null;
          nonStrikerId: string | null;
          batters: { id: string; runs: number; balls: number }[];
          bowler: { id: string; balls: number; runs: number; wickets: number } | null;
          thisOver: string[];
          partnership: { runs: number; balls: number };
        }
      | undefined;
    if (!cur) return null;
    const batter = (id: string | null) => {
      if (!id) return null;
      const f = cur.batters.find((b) => b.id === id);
      return { name: nameOf.get(id) || "Unknown", runs: f?.runs ?? 0, balls: f?.balls ?? 0 };
    };
    return {
      sport,
      cricket: {
        battingTeamName: teamName((st.battingTeamId as string) || null),
        striker: batter(cur.strikerId),
        nonStriker: batter(cur.nonStrikerId),
        bowler: cur.bowler
          ? {
              name: nameOf.get(cur.bowler.id) || "Unknown",
              overs: oversOf(cur.bowler.balls),
              runs: cur.bowler.runs,
              wickets: cur.bowler.wickets,
            }
          : null,
        thisOver: cur.thisOver || [],
        partnership: cur.partnership || { runs: 0, balls: 0 },
      },
    };
  }

  if (sport === "FOOTBALL") {
    const cur = st.current as
      | {
          lastGoal: { teamId: string; memberId: string | null; assistId: string | null } | null;
          scorers: { teamId: string; memberId: string | null }[];
        }
      | undefined;
    if (!cur) return null;
    return {
      sport,
      football: {
        lastGoal: cur.lastGoal
          ? {
              teamName: teamName(cur.lastGoal.teamId),
              scorer: cur.lastGoal.memberId ? nameOf.get(cur.lastGoal.memberId) || null : null,
              assist: cur.lastGoal.assistId ? nameOf.get(cur.lastGoal.assistId) || null : null,
            }
          : null,
        scorers: (cur.scorers || []).slice(0, 8).map((s) => ({
          teamName: teamName(s.teamId),
          name: s.memberId ? nameOf.get(s.memberId) || null : null,
        })),
      },
    };
  }

  const serving = (st.servingTeamId as string) || null;
  return {
    sport,
    pickleball: {
      servingTeamName: teamName(serving),
      gameNumber: Number(st.gameNumber) || 1,
    },
  };
}

/** "Chasing 142 · need 23 off 18" / "Won by 5 wickets" etc. */
function resultText(args: {
  status: string;
  sport: string;
  home: TeamBrief | null;
  away: TeamBrief | null;
  homeScore: number | null;
  awayScore: number | null;
  isDraw: boolean;
  winnerTeamId: string | null;
  liveState: unknown;
  /** Wickets a side has in THIS tournament — 8 in a short-format cup. */
  wicketsPerInnings: number;
}): string {
  const { status, home, away, isDraw, winnerTeamId } = args;
  if (status === "COMPLETED" || status === "WALKOVER") {
    if (isDraw) return "Match drawn";
    const winner = winnerTeamId === home?.id ? home : winnerTeamId === away?.id ? away : null;
    if (!winner) return "Result recorded";
    const margin = Math.abs((args.homeScore ?? 0) - (args.awayScore ?? 0));
    if (args.sport === "CRICKET") {
      // Cricket states a margin in the currency the winner had left over.
      // Defend a total and you win by the RUNS the chase fell short by;
      // chase one down and you win by the WICKETS still standing, because
      // the runs margin is meaningless — the innings stopped the moment
      // the target was passed. Saying "won by 6 runs" for a successful
      // chase, as this did, is the one way to get the sentence wrong.
      const st = args.liveState as {
        innings?: { teamId: string; wickets: number }[];
      } | null;
      const chase = st?.innings?.[1];
      if (chase && chase.teamId === winner.id) {
        const inHand = Math.max(0, args.wicketsPerInnings - (chase.wickets ?? 0));
        return `${winner.name} won by ${inHand} wicket${inHand === 1 ? "" : "s"}`;
      }
      return `${winner.name} won by ${margin} run${margin === 1 ? "" : "s"}`;
    }
    if (args.sport === "FOOTBALL") return `${winner.name} won ${args.homeScore}–${args.awayScore}`;
    return `${winner.name} won`;
  }
  if (status === "LIVE") {
    const st = args.liveState as { target?: number | null; innings?: { runs: number; balls: number }[] } | null;
    if (args.sport === "CRICKET" && st?.target && st.innings?.length === 2) {
      const chase = st.innings[1]!;
      const need = st.target - chase.runs;
      return need > 0 ? `Need ${need} run${need === 1 ? "" : "s"} to win` : "Target reached";
    }
    return "Live";
  }
  if (status === "SCHEDULED") return "Upcoming";
  return status;
}

/** Human commentary line for one delivery — the ESPN ball-by-ball voice. */
function ballText(d: {
  runs: number;
  extra?: string | null;
  wicket?: boolean;
  batter?: string | null;
  bowler?: string | null;
  dismissal?: string | null;
  /** Who went — differs from `batter` on a run-out at the other end. */
  outBatter?: string | null;
  fielder?: string | null;
}): string {
  const who = d.bowler && d.batter ? `${d.bowler} to ${d.batter}, ` : "";
  if (d.wicket) {
    return `${who}${dismissalCommentary({
      dismissal: d.dismissal,
      bowlerName: creditsBowler(d.dismissal) ? d.bowler : null,
      fielderName: d.fielder,
      // Name the batter only when it wasn't the one facing — "X to Y,
      // OUT! Y run out" repeats itself for the ordinary case.
      batterName: d.outBatter && d.outBatter !== d.batter ? d.outBatter : null,
    })}`;
  }
  if (d.extra === "wd") return `${who}wide${d.runs > 1 ? ` + ${d.runs - 1}` : ""}`;
  if (d.extra === "nb") return `${who}no ball${d.runs > 1 ? ` + ${d.runs - 1}` : ""}`;
  if (d.runs === 0) return `${who}no run`;
  if (d.runs === 4) return `${who}FOUR`;
  if (d.runs === 6) return `${who}SIX`;
  return `${who}${d.runs} run${d.runs === 1 ? "" : "s"}`;
}

/** Full match-centre payload: header, innings scorecards, commentary. */
export async function getMatchCentre(matchId: string): Promise<MatchCentre | null> {
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
      courtConfig: { select: { label: true } },
      playerOfMatch: { select: { name: true } },
      homeTeam: {
        select: {
          id: true, name: true, color: true, logoUrl: true,
          members: { orderBy: { order: "asc" }, select: { id: true, name: true } },
        },
      },
      awayTeam: {
        select: {
          id: true, name: true, color: true, logoUrl: true,
          members: { orderBy: { order: "asc" }, select: { id: true, name: true } },
        },
      },
      tournament: {
        select: {
          id: true, slug: true, name: true, sport: true, status: true,
          statFields: true, wicketsPerInnings: true,
        },
      },
    },
  });
  if (!match) return null;
  if (["DRAFT", "CANCELLED"].includes(match.tournament.status)) return null;

  const events = await db.tournamentMatchEvent.findMany({
    where: { matchId },
    orderBy: { seq: "asc" },
    select: { seq: true, kind: true, teamId: true, memberId: true, data: true, createdAt: true },
  });

  const nameOf = new Map<string, string>();
  for (const m of match.homeTeam?.members || []) nameOf.set(m.id, m.name);
  for (const m of match.awayTeam?.members || []) nameOf.set(m.id, m.name);
  const teamOf = (id: string | null) =>
    id === match.homeTeam?.id ? match.homeTeam : id === match.awayTeam?.id ? match.awayTeam : null;

  const innings: InningsCard[] = [];
  const commentary: CommentaryBall[] = [];

  if (match.tournament.sport === "CRICKET") {
    type Acc = {
      teamId: string;
      runs: number; wickets: number; balls: number; extras: number;
      bat: Map<string, BattingRow>;
      bowl: Map<string, BowlingRow>;
      fow: FallOfWicket[];
    };
    let cur: Acc | null = null;
    const accs: Acc[] = [];

    for (const e of events) {
      const d = (e.data || {}) as Record<string, unknown>;
      if (e.kind === "INNINGS_START" && e.teamId) {
        cur = {
          teamId: e.teamId,
          runs: 0, wickets: 0, balls: 0, extras: 0,
          bat: new Map(), bowl: new Map(), fow: [],
        };
        accs.push(cur);
        continue;
      }
      if (!cur) continue;

      // A batting row that may not exist yet. A non-striker run out on a
      // ball they never faced still needs a line on the card, otherwise
      // the wicket falls against nobody.
      const battingRow = (id: string): BattingRow => {
        const row = cur!.bat.get(id) || {
          memberId: id, name: nameOf.get(id) || "Unknown",
          runs: 0, balls: 0, fours: 0, sixes: 0, strikeRate: 0, out: false, dismissal: null,
        };
        cur!.bat.set(id, row);
        return row;
      };

      if (e.kind === "RETIRE") {
        // Not a dismissal: no wicket, no bowler credit. It belongs on the
        // card only so the batter's line explains why it stopped.
        const id = (d.batterId as string) || e.memberId || null;
        if (id) battingRow(id).dismissal = "retired hurt";
        continue;
      }
      if (e.kind !== "BALL") continue;

      const runs = Math.max(0, Number(d.runs) || 0);
      const extra = (d.extra as string) || null;
      const isWicket = !!d.wicket;
      const legal = extra !== "wd" && extra !== "nb";
      const batterId = (d.batterId as string) || e.memberId || null;
      const bowlerId = (d.bowlerId as string) || null;
      const dismissal = (d.dismissal as string) || null;
      const fielderId = (d.fielderId as string) || null;
      // Whose wicket it was. Only a run-out can take the batter who wasn't
      // facing, so the scorer names them; everything else is the striker.
      const outId = isWicket ? (d.outBatterId as string) || batterId : null;

      cur.runs += runs;
      if (isWicket) cur.wickets += 1;
      if (legal) cur.balls += 1;
      if (extra) cur.extras += extra === "wd" || extra === "nb" ? Math.max(1, runs) : runs;

      if (batterId) {
        const row = battingRow(batterId);
        // Wides aren't charged to the batter; everything else is a ball faced.
        if (extra !== "wd") row.balls += 1;
        // Boundaries count off what the BATTER made, so a no-ball hit for
        // four is a four — and four byes are not.
        const batterRuns = batterRunsOf(runs, extra);
        row.runs += batterRuns;
        if (batterRuns === 4) row.fours += 1;
        if (batterRuns === 6) row.sixes += 1;
        row.strikeRate = row.balls > 0 ? Number(((row.runs / row.balls) * 100).toFixed(2)) : 0;
      }

      // Written against the batter who actually went, which on a run-out is
      // often the one at the other end.
      if (outId) {
        const row = battingRow(outId);
        row.out = true;
        row.dismissal = dismissalLine({
          dismissal,
          // A run-out is nobody's delivery to claim, so the bowler is left
          // out of the line as well as out of the figures.
          bowlerName: creditsBowler(dismissal) && bowlerId ? nameOf.get(bowlerId) : null,
          fielderName: fielderId ? nameOf.get(fielderId) : null,
        });
      }

      if (bowlerId) {
        const row = cur.bowl.get(bowlerId) || {
          memberId: bowlerId, name: nameOf.get(bowlerId) || "Unknown",
          balls: 0, overs: "0.0", runs: 0, wickets: 0, economy: 0,
        };
        if (legal) row.balls += 1;
        row.runs += bowlerRunsOf(runs, extra);
        if (isWicket && creditsBowler(dismissal)) row.wickets += 1;
        row.overs = oversOf(row.balls);
        row.economy = rate(row.runs, row.balls);
        cur.bowl.set(bowlerId, row);
      }

      if (isWicket) {
        cur.fow.push({
          wicket: cur.wickets,
          runs: cur.runs,
          over: oversOf(cur.balls),
          batter: outId ? nameOf.get(outId) || null : null,
        });
      }

      commentary.push({
        seq: e.seq,
        over: oversOf(cur.balls),
        text: ballText({
          runs, extra, wicket: isWicket,
          batter: batterId ? nameOf.get(batterId) || null : null,
          bowler: bowlerId ? nameOf.get(bowlerId) || null : null,
          dismissal,
          outBatter: outId ? nameOf.get(outId) || null : null,
          fielder: fielderId ? nameOf.get(fielderId) || null : null,
        }),
        runs,
        wicket: isWicket,
        boundary: !extra && runs === 6 ? 6 : !extra && runs === 4 ? 4 : 0,
        createdAt: e.createdAt.toISOString(),
      });
    }

    for (const a of accs) {
      const team = teamOf(a.teamId);
      innings.push({
        teamId: a.teamId,
        teamName: team?.name || "—",
        teamColor: team?.color || null,
        runs: a.runs,
        wickets: a.wickets,
        balls: a.balls,
        overs: oversOf(a.balls),
        runRate: rate(a.runs, a.balls),
        extras: a.extras,
        batting: [...a.bat.values()],
        bowling: [...a.bowl.values()],
        fallOfWickets: a.fow,
      });
    }
  } else {
    // Football / pickleball: the timeline IS the scorecard.
    for (const e of events) {
      const d = (e.data || {}) as Record<string, unknown>;
      const team = teamOf(e.teamId);
      const who = e.memberId ? nameOf.get(e.memberId) : null;
      let text: string;
      if (e.kind === "GOAL") {
        const assist = d.assistId ? nameOf.get(d.assistId as string) : null;
        text = `⚽ GOAL — ${team?.name || ""}${who ? ` · ${who}` : ""}${assist ? ` (assist ${assist})` : ""}`;
      } else if (e.kind === "CARD") {
        text = `${d.card === "red" ? "🟥" : "🟨"} ${who || team?.name || ""}`;
      } else if (e.kind === "POINT") {
        text = `Point — ${team?.name || ""}`;
      } else if (e.kind === "GAME_END") {
        text = "Game complete";
      } else if (e.kind === "CLOCK_START") {
        text = "Clock started";
      } else {
        text = "Clock stopped";
      }
      commentary.push({
        seq: e.seq,
        over: "",
        text,
        runs: 0,
        wicket: false,
        boundary: 0,
        createdAt: e.createdAt.toISOString(),
      });
    }
  }

  // Stored per-player stats (admin entry, or the live derivation) — shown
  // for non-cricket sports and as the fallback when no balls were tagged.
  const statFields = (Array.isArray(match.tournament.statFields) ? match.tournament.statFields : []) as {
    key: string;
    label: string;
  }[];
  const stats = await db.tournamentPlayerStat.findMany({
    where: { matchId },
    select: { teamId: true, statKey: true, value: true, member: { select: { id: true, name: true } } },
  });
  const byTeam = new Map<string, Map<string, { name: string; values: Record<string, number> }>>();
  for (const s of stats) {
    const teamMap = byTeam.get(s.teamId) || new Map();
    const row = teamMap.get(s.member.id) || { name: s.member.name, values: {} };
    row.values[s.statKey] = s.value;
    teamMap.set(s.member.id, row);
    byTeam.set(s.teamId, teamMap);
  }
  const statTable = [...byTeam.entries()].map(([teamId, rows]) => ({
    teamId,
    teamName: teamOf(teamId)?.name || "—",
    rows: [...rows.values()],
  }));

  const brief = (t: typeof match.homeTeam): TeamBrief | null =>
    t ? { id: t.id, name: t.name, color: t.color, logoUrl: t.logoUrl } : null;

  return {
    match: {
      id: match.id,
      status: match.status,
      stage: match.stage,
      roundLabel: match.roundLabel,
      scheduledAt: match.scheduledAt?.toISOString() || null,
      venue: match.courtConfig?.label || null,
      sport: match.tournament.sport,
      homeTeam: brief(match.homeTeam),
      awayTeam: brief(match.awayTeam),
      homeScore: match.homeScore,
      awayScore: match.awayScore,
      homeScoreNote: match.homeScoreNote,
      awayScoreNote: match.awayScoreNote,
      isDraw: match.isDraw,
      winnerTeamId: match.winnerTeamId,
      playerOfMatch: match.playerOfMatch?.name || null,
      resultText: resultText({
        status: match.status,
        sport: match.tournament.sport,
        home: brief(match.homeTeam),
        away: brief(match.awayTeam),
        homeScore: match.homeScore,
        awayScore: match.awayScore,
        isDraw: match.isDraw,
        winnerTeamId: match.winnerTeamId,
        liveState: match.liveState,
        wicketsPerInnings: match.tournament.wicketsPerInnings,
      }),
      clockSeconds:
        match.tournament.sport === "FOOTBALL" ? footballClockSeconds(match) : null,
      clockRunning: !!match.clockStartedAt,
    },
    tournament: {
      slug: match.tournament.slug,
      name: match.tournament.name,
      sport: match.tournament.sport,
    },
    liveNow:
      match.status === "LIVE"
        ? buildLiveNow({
            sport: match.tournament.sport,
            liveState: match.liveState,
            nameOf,
            teamName: (id) => teamOf(id)?.name || null,
          })
        : null,
    innings,
    commentary: commentary.slice(-120).reverse(), // newest first, bounded
    statTable,
    statFields,
  };
}
