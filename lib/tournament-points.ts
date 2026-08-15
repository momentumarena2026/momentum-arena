// Standings computation for round-robin stages (POOL / LEAGUE).
// Pure: feed completed matches in, get sorted table rows out. Used by the
// admin Scores tab, the public points table and the knockout seeding
// resolution (pool ranks).

/** One completed innings, for net run rate. Cricket only. */
export type InningsLine = {
  teamId: string;
  runs: number;
  balls: number;
  wickets: number;
};

export type CompletedRR = {
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number;
  awayScore: number;
  isDraw: boolean;
  winnerTeamId: string | null;
  /** Both innings of a cricket match. Absent for other sports, and for
   *  results an admin typed in by hand — those carry no ball count, so
   *  they cannot contribute to NRR. */
  innings?: InningsLine[];
};

export type StandingRow = {
  teamId: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  scoreFor: number;
  scoreAgainst: number;
  scoreDiff: number;
  points: number;
  /** Net run rate, cricket only. null when no match had ball-by-ball data.
   *  Runs/balls below are the NRR subtotals — they count only the matches
   *  that carried innings data, so they deliberately differ from
   *  scoreFor/scoreAgainst, which count every completed match. */
  nrr: number | null;
  nrrRunsFor: number;
  nrrBallsFor: number;
  nrrRunsAgainst: number;
  nrrBallsAgainst: number;
  /** Matches that fed the NRR. Less than `played` means the rest were
   *  scored by hand; the UI flags that rather than quietly implying the
   *  figure covers everything, and the NRR tiebreaker abstains rather
   *  than ranking a team on a figure it does not have. */
  nrrMatches: number;
};

export type PointsConfig = {
  pointsWin: number;
  pointsDraw: number;
  pointsLoss: number;
  tiebreakers: string[]; // H2H | SCORE_DIFF | SCORE_FOR | NRR | NAME
  /** Cricket: overs per side, 0 = unlimited. Drives the all-out rule. */
  oversPerInnings?: number;
  /** Cricket: wickets per side. Omitted = the standard ten. */
  wicketsPerInnings?: number;
};

/**
 * Standings config for a tournament, with the cricket convention applied.
 *
 * Cricket separates teams level on points by net run rate before anything
 * else — that is how every cricket table people have seen is ordered. So
 * NRR is prepended for cricket rather than left to each organiser to
 * remember. An organiser who has deliberately placed NRR somewhere in the
 * chain keeps their position; nothing is moved.
 *
 * Every caller must go through this. Standings are computed in three
 * places — the public table, knockout seeding and prize allocation — and
 * if one of them ranked on a different chain the table would show one
 * team qualifying while the bracket advanced another.
 */
export function standingsConfig(t: {
  sport: string;
  pointsWin: number;
  pointsDraw: number;
  pointsLoss: number;
  tiebreakers: string[];
  oversPerInnings?: number | null;
  wicketsPerInnings?: number | null;
}): PointsConfig {
  const cricket = t.sport === "CRICKET";
  return {
    pointsWin: t.pointsWin,
    pointsDraw: t.pointsDraw,
    pointsLoss: t.pointsLoss,
    tiebreakers:
      cricket && !t.tiebreakers.includes("NRR")
        ? ["NRR", ...t.tiebreakers]
        : t.tiebreakers,
    oversPerInnings: t.oversPerInnings ?? 0,
    wicketsPerInnings: t.wicketsPerInnings ?? DEFAULT_WICKETS_PER_INNINGS,
  };
}

/** Matches the live scoring engine's default all-out threshold. */
const DEFAULT_WICKETS_PER_INNINGS = 10;

/**
 * Overs a side is charged with for NRR.
 *
 * The one rule people get wrong: a side bowled out is charged its FULL
 * quota, not the overs it actually used. Without that, collapsing for 40
 * in 6 of 20 overs would score as a 6.67 run rate and *improve* the NRR of
 * the team that just got skittled. The same figure is used on both sides
 * of the innings, so the bowling team is credited with the full quota too.
 *
 * With no over limit configured (oversPerInnings 0) there is no quota to
 * charge, so actual balls are all we can use.
 */
function chargedBalls(
  line: InningsLine,
  quotaBalls: number,
  maxWickets: number,
): number {
  if (quotaBalls > 0 && line.wickets >= maxWickets) return quotaBalls;
  return line.balls;
}

/** Runs per over from a ball count, or null when nothing was bowled. */
function runRate(runs: number, balls: number): number | null {
  return balls > 0 ? runs / (balls / 6) : null;
}

/**
 * Pull the two innings out of a match's persisted `liveState`.
 *
 * The scorer folds every ball into liveState.innings and it survives the
 * match being completed, so the points table gets NRR off the row it has
 * already loaded — no event-log replay, no extra query.
 */
export function inningsFromLiveState(liveState: unknown): InningsLine[] | undefined {
  if (!liveState || typeof liveState !== "object") return undefined;
  const raw = (liveState as { innings?: unknown }).innings;
  if (!Array.isArray(raw)) return undefined;
  const lines: InningsLine[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.teamId !== "string") continue;
    if (typeof e.runs !== "number" || typeof e.balls !== "number") continue;
    lines.push({
      teamId: e.teamId,
      runs: e.runs,
      balls: e.balls,
      wickets: typeof e.wickets === "number" ? e.wickets : 0,
    });
  }
  return lines.length ? lines : undefined;
}

export function computeStandings(
  teamIds: string[],
  matches: CompletedRR[],
  cfg: PointsConfig,
  teamNames?: Map<string, string>
): StandingRow[] {
  const quotaBalls = (cfg.oversPerInnings ?? 0) * 6;
  // A short-format cup is all out well before ten down. Reading this off
  // the tournament rather than a constant is what makes the full-quota
  // charge fire at all — at ten it simply never did for an 8-wicket game.
  const maxWickets = cfg.wicketsPerInnings || DEFAULT_WICKETS_PER_INNINGS;
  const rows = new Map<string, StandingRow>();
  for (const id of teamIds) {
    rows.set(id, {
      teamId: id,
      played: 0,
      won: 0,
      drawn: 0,
      lost: 0,
      scoreFor: 0,
      scoreAgainst: 0,
      scoreDiff: 0,
      points: 0,
      nrr: null,
      nrrRunsFor: 0,
      nrrBallsFor: 0,
      nrrRunsAgainst: 0,
      nrrBallsAgainst: 0,
      nrrMatches: 0,
    });
  }

  for (const m of matches) {
    const home = rows.get(m.homeTeamId);
    const away = rows.get(m.awayTeamId);
    if (!home || !away) continue;
    home.played++;
    away.played++;
    home.scoreFor += m.homeScore;
    home.scoreAgainst += m.awayScore;
    away.scoreFor += m.awayScore;
    away.scoreAgainst += m.homeScore;
    if (m.isDraw) {
      home.drawn++;
      away.drawn++;
      home.points += cfg.pointsDraw;
      away.points += cfg.pointsDraw;
    } else if (m.winnerTeamId === m.homeTeamId) {
      home.won++;
      away.lost++;
      home.points += cfg.pointsWin;
      away.points += cfg.pointsLoss;
    } else if (m.winnerTeamId === m.awayTeamId) {
      away.won++;
      home.lost++;
      away.points += cfg.pointsWin;
      home.points += cfg.pointsLoss;
    }

    // NRR needs both innings of the match. A half-recorded match is left
    // out entirely rather than charging one side runs the other never
    // conceded -- a lopsided ledger is worse than a smaller sample.
    const lines = m.innings;
    if (!lines || lines.length !== 2) continue;
    const sides = [m.homeTeamId, m.awayTeamId];
    if (!lines.every((l) => sides.includes(l.teamId))) continue;
    if (lines[0].teamId === lines[1].teamId) continue;
    const charged = lines.map((l) => chargedBalls(l, quotaBalls, maxWickets));
    if (charged.some((b) => b <= 0)) continue;

    lines.forEach((line, i) => {
      const bat = rows.get(line.teamId);
      const bowl = rows.get(line.teamId === m.homeTeamId ? m.awayTeamId : m.homeTeamId);
      if (!bat || !bowl) return;
      bat.nrrRunsFor += line.runs;
      bat.nrrBallsFor += charged[i];
      bowl.nrrRunsAgainst += line.runs;
      bowl.nrrBallsAgainst += charged[i];
    });
    home.nrrMatches++;
    away.nrrMatches++;
  }
  for (const r of rows.values()) {
    r.scoreDiff = r.scoreFor - r.scoreAgainst;
    const scored = runRate(r.nrrRunsFor, r.nrrBallsFor);
    const conceded = runRate(r.nrrRunsAgainst, r.nrrBallsAgainst);
    r.nrr = scored != null && conceded != null ? scored - conceded : null;
  }

  const list = [...rows.values()];

  // Head-to-head points among a tied group.
  const h2hPoints = (group: StandingRow[]): Map<string, number> => {
    const ids = new Set(group.map((g) => g.teamId));
    const pts = new Map<string, number>();
    for (const id of ids) pts.set(id, 0);
    for (const m of matches) {
      if (!ids.has(m.homeTeamId) || !ids.has(m.awayTeamId)) continue;
      if (m.isDraw) {
        pts.set(m.homeTeamId, (pts.get(m.homeTeamId) || 0) + cfg.pointsDraw);
        pts.set(m.awayTeamId, (pts.get(m.awayTeamId) || 0) + cfg.pointsDraw);
      } else if (m.winnerTeamId) {
        pts.set(m.winnerTeamId, (pts.get(m.winnerTeamId) || 0) + cfg.pointsWin);
      }
    }
    return pts;
  };

  // Sort: points desc, then the tiebreaker chain applied to tied groups.
  const name = (id: string) => teamNames?.get(id) || id;
  list.sort((a, b) => b.points - a.points);

  // Stable multi-pass: group by points, order each group via tiebreakers.
  const out: StandingRow[] = [];
  let i = 0;
  while (i < list.length) {
    let j = i;
    while (j < list.length && list[j].points === list[i].points) j++;
    const group = list.slice(i, j);
    if (group.length > 1) {
      const h2h = cfg.tiebreakers.includes("H2H") ? h2hPoints(group) : null;
      group.sort((a, b) => {
        for (const tb of cfg.tiebreakers) {
          let d = 0;
          if (tb === "H2H" && h2h) d = (h2h.get(b.teamId) || 0) - (h2h.get(a.teamId) || 0);
          else if (tb === "SCORE_DIFF") d = b.scoreDiff - a.scoreDiff;
          else if (tb === "SCORE_FOR") d = b.scoreFor - a.scoreFor;
          else if (tb === "NRR") {
            // Rank on NRR only when BOTH sides have one. Treating a missing
            // NRR as 0.000 would put a team with no data above anyone
            // genuinely negative; sorting it last instead is just as
            // invented — it would drop a team purely because its matches
            // happened not to be scored ball-by-ball, which says nothing
            // about how it played. So when either side is missing, this
            // key abstains and the next tiebreaker decides.
            const x = a.nrr;
            const y = b.nrr;
            d = x == null || y == null ? 0 : y - x;
          }
          else if (tb === "NAME") d = name(a.teamId).localeCompare(name(b.teamId));
          if (d !== 0) return d;
        }
        return name(a.teamId).localeCompare(name(b.teamId));
      });
    }
    out.push(...group);
    i = j;
  }
  return out;
}
