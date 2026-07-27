// Standings computation for round-robin stages (POOL / LEAGUE).
// Pure: feed completed matches in, get sorted table rows out. Used by the
// admin Scores tab, the public points table and the knockout seeding
// resolution (pool ranks).

export type CompletedRR = {
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number;
  awayScore: number;
  isDraw: boolean;
  winnerTeamId: string | null;
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
};

export type PointsConfig = {
  pointsWin: number;
  pointsDraw: number;
  pointsLoss: number;
  tiebreakers: string[]; // H2H | SCORE_DIFF | SCORE_FOR | NAME
};

export function computeStandings(
  teamIds: string[],
  matches: CompletedRR[],
  cfg: PointsConfig,
  teamNames?: Map<string, string>
): StandingRow[] {
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
  }
  for (const r of rows.values()) r.scoreDiff = r.scoreFor - r.scoreAgainst;

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
