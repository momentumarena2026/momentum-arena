import { batterRunsOf, bowlerRunsOf } from "@/lib/tournament-live";
import { creditsBowler } from "@/lib/cricket-dismissal";

/**
 * Match and tournament awards: Player of the Match, Best Batter, Best Bowler,
 * and the tournament MVP rating.
 *
 * ── Why this is a separate fold from lib/tournament-scorecard.ts ───────────
 *
 * The scorecard already folds the event log into the batting and bowling
 * cards a follower reads. It deliberately does NOT carry maidens, catches,
 * stumpings or run-out credit, because no scorecard line needs them. An
 * awards formula does: dropping fielding would mean a keeper who made four
 * dismissals scored zero, and dropping maidens would make a bowler who
 * conceded nothing for three overs worth less than one who went for 30 and
 * got a wicket.
 *
 * So this module folds the SAME log a third time, for the fields awards need.
 * That is a real divergence risk — two folds of one log can drift apart — and
 * it is guarded: `tests/tournament-awards.test.ts` asserts that batting runs,
 * balls, boundaries and bowling figures derived here equal the ones the
 * scorecard derives from the identical log. If someone changes how a no-ball
 * is charged in one place and not the other, that test fails.
 *
 * ── Why points, and why these points ──────────────────────────────────────
 *
 * The weights are not arbitrary. The anchor is the long-standing cricket
 * equivalence that ONE WICKET IS WORTH ABOUT 25 RUNS — it is why a batting
 * average of 25 and a bowling average of 25 are both ordinary. Everything
 * else is scaled off that anchor so a batter and a bowler can be compared on
 * one axis at all, which is the whole point of an MVP table.
 *
 * Rate adjustments (strike rate, economy) only apply above a minimum sample,
 * because a 6-ball 12 is not a 200 strike rate worth rewarding and a single
 * tidy over is not an economy of 2. Small samples are noise, and without the
 * floor the table fills up with cameos.
 *
 * Every weight lives in AWARD_WEIGHTS so it is tunable in one place and shows
 * up as one diff in review, rather than being scattered through the maths.
 */

export type AwardSport = "CRICKET" | "FOOTBALL" | "PICKLEBALL" | "TABLE_TENNIS";

/** The racket sports share one engine; they differ only in label. */
export const isRacketSport = (s: string) => s === "PICKLEBALL" || s === "TABLE_TENNIS";

/**
 * One player's contribution in ONE match, normalised across sports.
 *
 * Every counter is zero-based so a formula never has to null-check. The
 * `appeared` flag is what separates "played and did nothing" from "was not
 * involved in this match", which matters because the tournament rating
 * divides by matches played.
 */
export type MatchPerf = {
  memberId: string;
  teamId: string;
  appeared: boolean;

  // Cricket — batting
  batRuns: number;
  batBalls: number;
  fours: number;
  sixes: number;
  out: boolean;

  // Cricket — bowling
  bowlBalls: number;
  bowlRuns: number;
  wickets: number;
  maidens: number;

  // Cricket — fielding
  catches: number;
  stumpings: number;
  runOuts: number;

  // Football
  goals: number;
  assists: number;
  yellowCards: number;
  redCards: number;

  // Pickleball / table tennis
  pointsWon: number;
};

export const emptyPerf = (memberId: string, teamId: string): MatchPerf => ({
  memberId,
  teamId,
  appeared: false,
  batRuns: 0,
  batBalls: 0,
  fours: 0,
  sixes: 0,
  out: false,
  bowlBalls: 0,
  bowlRuns: 0,
  wickets: 0,
  maidens: 0,
  catches: 0,
  stumpings: 0,
  runOuts: 0,
  goals: 0,
  assists: 0,
  yellowCards: 0,
  redCards: 0,
  pointsWon: 0,
});

// ── Weights ─────────────────────────────────────────────────────────

export const AWARD_WEIGHTS = {
  cricket: {
    perRun: 1,
    perFour: 1,
    perSix: 2,
    /** Reaching a milestone pays once, at the highest one reached. */
    battingMilestones: [
      { runs: 100, bonus: 32 },
      { runs: 50, bonus: 16 },
      { runs: 30, bonus: 8 },
    ],
    /** Out for nought having faced a ball. Not applied to a no-score not-out. */
    duckPenalty: -5,
    /** Below this many balls faced, strike rate is noise and is ignored. */
    strikeRateMinBalls: 10,
    strikeRateBands: [
      { atLeast: 200, points: 12 },
      { atLeast: 150, points: 8 },
      { atLeast: 120, points: 4 },
      { atLeast: 80, points: 0 },
      { atLeast: 60, points: -2 },
      { atLeast: 0, points: -6 },
    ],

    /** The anchor: one wicket ≈ 25 runs. Every other weight scales off this. */
    perWicket: 25,
    wicketHauls: [
      { wickets: 5, bonus: 25 },
      { wickets: 3, bonus: 10 },
    ],
    perMaiden: 12,
    /** Two overs. Below it, economy is noise and is ignored. */
    economyMinBalls: 12,
    economyBands: [
      { below: 3, points: 12 },
      { below: 4.5, points: 8 },
      { below: 6, points: 4 },
      { below: 8, points: 0 },
      { below: 10, points: -2 },
      { below: Infinity, points: -6 },
    ],

    perCatch: 10,
    perStumping: 12,
    perRunOut: 10,
  },

  football: {
    perGoal: 40,
    perAssist: 25,
    yellowCard: -5,
    redCard: -20,
  },

  racket: {
    perPointWon: 1,
  },
} as const;

/**
 * How many matches a player must have appeared in before their average
 * rating is eligible for the tournament table.
 *
 * Without this, one player who turned up for a single match, scored a
 * quick 40 and never played again outranks someone who carried a side
 * through six games — which is the opposite of "most valuable".
 */
export const MVP_MIN_MATCHES = 2;

// ── Per-match points ────────────────────────────────────────────────

export type PointsBreakdown = {
  batting: number;
  bowling: number;
  fielding: number;
  total: number;
  /** Human-readable lines, for the "How is this calculated?" panel. */
  lines: { label: string; points: number }[];
};

const band = <T extends { points: number }>(bands: readonly T[], pick: (b: T) => boolean) =>
  bands.find(pick)?.points ?? 0;

function cricketPoints(p: MatchPerf): PointsBreakdown {
  const W = AWARD_WEIGHTS.cricket;
  const lines: { label: string; points: number }[] = [];
  const add = (label: string, points: number) => {
    if (points !== 0) lines.push({ label, points });
  };

  // — Batting —
  let batting = 0;
  if (p.batBalls > 0 || p.batRuns > 0) {
    const runPts = p.batRuns * W.perRun;
    batting += runPts;
    add(`${p.batRuns} run${p.batRuns === 1 ? "" : "s"}`, runPts);

    const boundaryPts = p.fours * W.perFour + p.sixes * W.perSix;
    batting += boundaryPts;
    if (boundaryPts) add(`${p.fours}×4, ${p.sixes}×6`, boundaryPts);

    const milestone = W.battingMilestones.find((m) => p.batRuns >= m.runs);
    if (milestone) {
      batting += milestone.bonus;
      add(`${milestone.runs}+ milestone`, milestone.bonus);
    }

    if (p.out && p.batRuns === 0 && p.batBalls > 0) {
      batting += W.duckPenalty;
      add("Duck", W.duckPenalty);
    }

    if (p.batBalls >= W.strikeRateMinBalls) {
      const sr = (p.batRuns / p.batBalls) * 100;
      const pts = band(W.strikeRateBands, (b) => sr >= b.atLeast);
      batting += pts;
      if (pts) add(`Strike rate ${sr.toFixed(1)}`, pts);
    }
  }

  // — Bowling —
  let bowling = 0;
  if (p.bowlBalls > 0) {
    const wktPts = p.wickets * W.perWicket;
    bowling += wktPts;
    if (wktPts) add(`${p.wickets} wicket${p.wickets === 1 ? "" : "s"}`, wktPts);

    const haul = W.wicketHauls.find((h) => p.wickets >= h.wickets);
    if (haul) {
      bowling += haul.bonus;
      add(`${haul.wickets}-wicket haul`, haul.bonus);
    }

    const maidenPts = p.maidens * W.perMaiden;
    bowling += maidenPts;
    if (maidenPts) add(`${p.maidens} maiden${p.maidens === 1 ? "" : "s"}`, maidenPts);

    if (p.bowlBalls >= W.economyMinBalls) {
      const econ = (p.bowlRuns / p.bowlBalls) * 6;
      const pts = band(W.economyBands, (b) => econ < b.below);
      bowling += pts;
      if (pts) add(`Economy ${econ.toFixed(2)}`, pts);
    }
  }

  // — Fielding —
  const fielding =
    p.catches * W.perCatch + p.stumpings * W.perStumping + p.runOuts * W.perRunOut;
  if (p.catches) add(`${p.catches} catch${p.catches === 1 ? "" : "es"}`, p.catches * W.perCatch);
  if (p.stumpings) add(`${p.stumpings} stumping${p.stumpings === 1 ? "" : "s"}`, p.stumpings * W.perStumping);
  if (p.runOuts) add(`${p.runOuts} run-out${p.runOuts === 1 ? "" : "s"}`, p.runOuts * W.perRunOut);

  return { batting, bowling, fielding, total: batting + bowling + fielding, lines };
}

function footballPoints(p: MatchPerf): PointsBreakdown {
  const W = AWARD_WEIGHTS.football;
  const lines: { label: string; points: number }[] = [];
  const add = (label: string, points: number) => {
    if (points !== 0) lines.push({ label, points });
  };

  const attack = p.goals * W.perGoal + p.assists * W.perAssist;
  if (p.goals) add(`${p.goals} goal${p.goals === 1 ? "" : "s"}`, p.goals * W.perGoal);
  if (p.assists) add(`${p.assists} assist${p.assists === 1 ? "" : "s"}`, p.assists * W.perAssist);

  const discipline = p.yellowCards * W.yellowCard + p.redCards * W.redCard;
  if (p.yellowCards) add(`${p.yellowCards} yellow`, p.yellowCards * W.yellowCard);
  if (p.redCards) add(`${p.redCards} red`, p.redCards * W.redCard);

  // Football has no batting/bowling split; attack carries the "batting" slot
  // so the shared shape stays usable, and nothing reads those two for a
  // non-cricket sport anyway.
  return { batting: attack, bowling: 0, fielding: discipline, total: attack + discipline, lines };
}

function racketPoints(p: MatchPerf): PointsBreakdown {
  const W = AWARD_WEIGHTS.racket;
  const total = p.pointsWon * W.perPointWon;
  return {
    batting: total,
    bowling: 0,
    fielding: 0,
    total,
    lines: total ? [{ label: `${p.pointsWon} points won`, points: total }] : [],
  };
}

/** Award points for one player in one match. */
export function awardPoints(sport: string, p: MatchPerf): PointsBreakdown {
  if (sport === "CRICKET") return cricketPoints(p);
  if (sport === "FOOTBALL") return footballPoints(p);
  if (isRacketSport(sport)) return racketPoints(p);
  return { batting: 0, bowling: 0, fielding: 0, total: 0, lines: [] };
}

// ── Match awards ────────────────────────────────────────────────────

export type AwardWinner = {
  memberId: string;
  points: number;
  breakdown: PointsBreakdown;
};

export type MatchAwards = {
  /** Highest total points. Null when nothing was attributed to any player. */
  playerOfMatch: AwardWinner | null;
  /** Cricket only — highest batting points, and only if they actually batted. */
  bestBatter: AwardWinner | null;
  /** Cricket only — highest bowling points, and only if they actually bowled. */
  bestBowler: AwardWinner | null;
  /** Every player's points, highest first. */
  rows: AwardWinner[];
};

/**
 * Pick the winners for one match.
 *
 * Ties break on the richer contribution rather than arbitrarily: for Player
 * of the Match a genuine all-round game (points from more than one
 * discipline) beats a single-discipline one on equal points, and after that
 * memberId breaks the tie so the result is STABLE. An unstable tiebreak
 * would let a page refresh change who won the award.
 */
export function computeMatchAwards(sport: string, perfs: MatchPerf[]): MatchAwards {
  const scored = perfs
    .filter((p) => p.appeared)
    .map((p) => ({ memberId: p.memberId, perf: p, breakdown: awardPoints(sport, p) }));

  const disciplines = (b: PointsBreakdown) =>
    [b.batting, b.bowling, b.fielding].filter((v) => v > 0).length;

  const best = (
    pool: typeof scored,
    value: (b: PointsBreakdown) => number,
    rank: (a: (typeof scored)[number], b: (typeof scored)[number]) => number,
  ): AwardWinner | null => {
    const eligible = pool.filter((s) => value(s.breakdown) > 0);
    if (!eligible.length) return null;
    const top = [...eligible].sort(rank)[0];
    return { memberId: top.memberId, points: round2(value(top.breakdown)), breakdown: top.breakdown };
  };

  const playerOfMatch = best(
    scored,
    (b) => b.total,
    (a, b) =>
      b.breakdown.total - a.breakdown.total ||
      disciplines(b.breakdown) - disciplines(a.breakdown) ||
      a.memberId.localeCompare(b.memberId),
  );

  const isCricket = sport === "CRICKET";
  const bestBatter = isCricket
    ? best(
        scored.filter((s) => s.perf.batBalls > 0 || s.perf.batRuns > 0),
        (b) => b.batting,
        (a, b) =>
          b.breakdown.batting - a.breakdown.batting ||
          b.perf.batRuns - a.perf.batRuns ||
          a.memberId.localeCompare(b.memberId),
      )
    : null;
  const bestBowler = isCricket
    ? best(
        scored.filter((s) => s.perf.bowlBalls > 0),
        (b) => b.bowling,
        (a, b) =>
          b.breakdown.bowling - a.breakdown.bowling ||
          b.perf.wickets - a.perf.wickets ||
          a.memberId.localeCompare(b.memberId),
      )
    : null;

  return {
    playerOfMatch,
    bestBatter,
    bestBowler,
    rows: scored
      .map((s) => ({ memberId: s.memberId, points: round2(s.breakdown.total), breakdown: s.breakdown }))
      .sort((a, b) => b.points - a.points || a.memberId.localeCompare(b.memberId)),
  };
}

// ── Tournament awards ───────────────────────────────────────────────

/** What one player did across the whole tournament. */
export type TournamentTally = {
  memberId: string;
  matches: number;
  totalPoints: number;
  battingPoints: number;
  bowlingPoints: number;
  fieldingPoints: number;
  /** The ranking number: total points per match played, to 2dp. */
  rating: number;
  /** False when they have not yet played MVP_MIN_MATCHES. */
  qualified: boolean;
  // Carried through for the supporting columns a leaderboard shows.
  runs: number;
  balls: number;
  wickets: number;
  bowlBalls: number;
  bowlRuns: number;
  goals: number;
  assists: number;
  pointsWon: number;
};

export const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Roll per-match performances up into the tournament table.
 *
 * `perfsByMatch` is one entry per match, each holding that match's player
 * performances. Matches are kept separate rather than pre-summed because
 * the rating divides by matches PLAYED, and because milestone bonuses are
 * per-innings: summing a player's runs across six matches and then asking
 * "is that a fifty?" would pay a century bonus for six steady 20s.
 */
export function computeTournamentAwards(
  sport: string,
  perfsByMatch: MatchPerf[][],
  opts: { minMatches?: number } = {},
): {
  mvp: TournamentTally[];
  bestBatters: TournamentTally[];
  bestBowlers: TournamentTally[];
} {
  const minMatches = opts.minMatches ?? MVP_MIN_MATCHES;
  const byMember = new Map<string, TournamentTally>();

  for (const matchPerfs of perfsByMatch) {
    for (const p of matchPerfs) {
      if (!p.appeared) continue;
      const b = awardPoints(sport, p);
      const t =
        byMember.get(p.memberId) ??
        {
          memberId: p.memberId,
          matches: 0,
          totalPoints: 0,
          battingPoints: 0,
          bowlingPoints: 0,
          fieldingPoints: 0,
          rating: 0,
          qualified: false,
          runs: 0,
          balls: 0,
          wickets: 0,
          bowlBalls: 0,
          bowlRuns: 0,
          goals: 0,
          assists: 0,
          pointsWon: 0,
        };
      t.matches += 1;
      t.totalPoints += b.total;
      t.battingPoints += b.batting;
      t.bowlingPoints += b.bowling;
      t.fieldingPoints += b.fielding;
      t.runs += p.batRuns;
      t.balls += p.batBalls;
      t.wickets += p.wickets;
      t.bowlBalls += p.bowlBalls;
      t.bowlRuns += p.bowlRuns;
      t.goals += p.goals;
      t.assists += p.assists;
      t.pointsWon += p.pointsWon;
      byMember.set(p.memberId, t);
    }
  }

  const all = [...byMember.values()].map((t) => ({
    ...t,
    totalPoints: round2(t.totalPoints),
    battingPoints: round2(t.battingPoints),
    bowlingPoints: round2(t.bowlingPoints),
    fieldingPoints: round2(t.fieldingPoints),
    rating: t.matches > 0 ? round2(t.totalPoints / t.matches) : 0,
    qualified: t.matches >= minMatches,
  }));

  // Qualified players always rank above unqualified ones, whatever the
  // rating — an unqualified player is shown for completeness, not ranked
  // against people who have actually played the tournament.
  const by = (value: (t: TournamentTally) => number) => (a: TournamentTally, b: TournamentTally) =>
    Number(b.qualified) - Number(a.qualified) ||
    value(b) - value(a) ||
    b.matches - a.matches ||
    a.memberId.localeCompare(b.memberId);

  const perMatch = (v: number, m: number) => (m > 0 ? v / m : 0);

  return {
    mvp: [...all].sort(by((t) => t.rating)),
    bestBatters: [...all]
      .filter((t) => t.battingPoints > 0)
      .sort(by((t) => perMatch(t.battingPoints, t.matches))),
    bestBowlers: [...all]
      .filter((t) => t.bowlingPoints > 0)
      .sort(by((t) => perMatch(t.bowlingPoints, t.matches))),
  };
}

// ── Deriving performances from the event log ────────────────────────

/**
 * Fold a match's event log into per-player performances.
 *
 * Run attribution reuses `batterRunsOf` / `bowlerRunsOf` from
 * lib/tournament-live.ts rather than restating the rules, so a change to
 * how a no-ball or a leg-bye is charged lands here automatically. That is
 * the main thing this fold could have drifted on, and it is now shared.
 *
 * KNOWN LIMIT — what "appeared" can mean. The event log records
 * involvement, not team sheets: a player who fielded all match, batted at
 * eleven and never faced a ball leaves no trace. So an appearance here
 * means "did something the log captured". The consequence is that the
 * per-match rating divides by matches a player was INVOLVED in, not
 * matches they were selected for, which flatters a specialist who only
 * shows up in the games that went well. MVP_MIN_MATCHES limits how far
 * that can carry someone; fixing it properly needs a playing-XI record,
 * which the scorer console does not collect today.
 */
export function deriveMatchPerfs(
  sport: string,
  events: { kind: string; teamId: string | null; memberId: string | null; data: unknown }[],
  memberTeam: Map<string, string>,
): MatchPerf[] {
  const perfs = new Map<string, MatchPerf>();
  const get = (memberId: string | null | undefined): MatchPerf | null => {
    if (!memberId) return null;
    const teamId = memberTeam.get(memberId);
    if (!teamId) return null; // not on either side of this match — ignore
    let p = perfs.get(memberId);
    if (!p) {
      p = emptyPerf(memberId, teamId);
      perfs.set(memberId, p);
    }
    p.appeared = true;
    return p;
  };

  if (sport === "CRICKET") {
    // Maidens need over boundaries, and overs are per innings. Reset the
    // over accumulator whenever a new innings starts, or a bowler who was
    // mid-over when the innings ended would carry those balls into the next.
    let overBowlerId: string | null = null;
    let overLegalBalls = 0;
    let overConceded = 0;

    const closeOver = () => {
      if (overBowlerId && overLegalBalls === 6 && overConceded === 0) {
        const p = get(overBowlerId);
        if (p) p.maidens += 1;
      }
      overBowlerId = null;
      overLegalBalls = 0;
      overConceded = 0;
    };

    for (const e of events) {
      const d = (e.data || {}) as Record<string, unknown>;
      if (e.kind === "INNINGS_START") {
        // Abandon any part-over in progress; it was never completed.
        overBowlerId = null;
        overLegalBalls = 0;
        overConceded = 0;
        continue;
      }
      if (e.kind !== "BALL") continue;

      const runs = Math.max(0, Number(d.runs) || 0);
      const extra = (d.extra as string) || null;
      const legal = extra !== "wd" && extra !== "nb";
      const batterId = (d.batterId as string) || e.memberId || null;
      const bowlerId = (d.bowlerId as string) || null;
      const dismissal = (d.dismissal as string) || null;
      const fielderId = (d.fielderId as string) || null;
      const isWicket = !!d.wicket;
      const outId = isWicket ? (d.outBatterId as string) || batterId : null;

      // — Batting —
      const bat = get(batterId);
      if (bat) {
        // Wides aren't charged to the batter; everything else is a ball faced.
        if (extra !== "wd") bat.batBalls += 1;
        const made = batterRunsOf(runs, extra);
        bat.batRuns += made;
        if (made === 4) bat.fours += 1;
        if (made === 6) bat.sixes += 1;
      }
      const outPerf = get(outId);
      if (outPerf) outPerf.out = true;

      // — Bowling —
      const bowl = get(bowlerId);
      if (bowl) {
        if (legal) bowl.bowlBalls += 1;
        bowl.bowlRuns += bowlerRunsOf(runs, extra);
        if (isWicket && creditsBowler(dismissal)) bowl.wickets += 1;
      }

      // — Maiden tracking —
      if (bowlerId) {
        if (overBowlerId !== bowlerId) {
          // A different bowler means the previous over ended (or the log
          // is mid-over after an undo); settle it before starting the new one.
          closeOver();
          overBowlerId = bowlerId;
        }
        // Byes and leg-byes are not charged to the bowler and so do not
        // break a maiden; a wide or no-ball is, and does.
        overConceded += bowlerRunsOf(runs, extra);
        if (legal) overLegalBalls += 1;
        if (overLegalBalls === 6) closeOver();
      }

      // — Fielding —
      const field = get(fielderId);
      if (field && isWicket) {
        if (dismissal === "caught") field.catches += 1;
        else if (dismissal === "stumped") field.stumpings += 1;
        else if (dismissal === "runout") field.runOuts += 1;
      }
    }
    closeOver();
  } else if (sport === "FOOTBALL") {
    for (const e of events) {
      const d = (e.data || {}) as Record<string, unknown>;
      if (e.kind === "GOAL") {
        const scorer = get(e.memberId);
        if (scorer) scorer.goals += 1;
        const assist = get(d.assistId as string);
        if (assist) assist.assists += 1;
      } else if (e.kind === "CARD") {
        const p = get(e.memberId);
        if (p) {
          const card = String(d.card || "").toLowerCase();
          if (card === "red") p.redCards += 1;
          else p.yellowCards += 1;
        }
      }
    }
  } else if (isRacketSport(sport)) {
    // POINT carries teamId always and memberId only when the scorer tagged
    // the player. An untagged match yields no performances at all, which is
    // correct: there is nobody to give an award to.
    for (const e of events) {
      if (e.kind !== "POINT") continue;
      const p = get(e.memberId);
      if (p) p.pointsWon += 1;
    }
  }

  return [...perfs.values()];
}
