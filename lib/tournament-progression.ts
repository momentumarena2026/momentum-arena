import { db } from "@/lib/db";
import {
  computeStandings,
  inningsFromLiveState,
  standingsConfig,
  type StandingRow,
} from "@/lib/tournament-points";

// Bracket progression: after any result lands, resolve every knockout slot
// that has become decidable. Idempotent — safe to run repeatedly:
//  1. winner-of / loser-of links whose source match is decided
//  2. pool-rank labels ("Winner Pool A", "Pool B #2") once that pool's
//     round-robin is fully completed
//  3. BYE walkovers: a match with one BYE side and a real team auto-
//     completes as a walkover for the team
export async function applyProgression(tournamentId: string): Promise<void> {
  const t = await db.tournament.findUnique({
    where: { id: tournamentId },
    include: {
      pools: { include: { teams: { where: { status: "CONFIRMED" }, select: { id: true } } } },
      teams: { where: { status: "CONFIRMED" }, select: { id: true, name: true } },
      matches: true,
    },
  });
  if (!t) return;

  const byId = new Map(t.matches.map((m) => [m.id, m]));
  const decidedWinner = (id: string | null): string | null => {
    if (!id) return null;
    const m = byId.get(id);
    if (!m) return null;
    if (m.status === "COMPLETED" || m.status === "WALKOVER") return m.winnerTeamId;
    return null;
  };
  const decidedLoser = (id: string | null): string | null => {
    if (!id) return null;
    const m = byId.get(id);
    if (!m || !(m.status === "COMPLETED" || m.status === "WALKOVER") || !m.winnerTeamId) return null;
    if (m.status === "WALKOVER") return null; // a bye has no loser to send onward
    return m.winnerTeamId === m.homeTeamId ? m.awayTeamId : m.homeTeamId;
  };

  // Pool standings (only for fully-completed pools).
  const poolRank = new Map<string, string[]>(); // pool NAME -> ordered teamIds
  const poolRows = new Map<string, StandingRow[]>(); // pool NAME -> ordered rows
  let allPoolsDone = t.pools.length > 0;
  for (const pool of t.pools) {
    const poolMatches = t.matches.filter((m) => m.poolId === pool.id && m.stage === "POOL");
    if (poolMatches.length === 0) continue;
    const done = poolMatches.every((m) => m.status === "COMPLETED" || m.status === "WALKOVER");
    if (!done) {
      allPoolsDone = false;
      continue;
    }
    const completed = poolMatches
      .filter((m) => m.homeTeamId && m.awayTeamId && m.homeScore != null && m.awayScore != null)
      .map((m) => ({
        homeTeamId: m.homeTeamId!,
        awayTeamId: m.awayTeamId!,
        homeScore: m.homeScore!,
        awayScore: m.awayScore!,
        isDraw: m.isDraw,
        winnerTeamId: m.winnerTeamId,
        // Seeding has to see the same innings the public table sees. Rank
        // the pools on a chain that includes NRR but without the run-rate
        // data behind it and the table would show one team qualifying
        // while the bracket advanced another.
        innings:
          t.sport === "CRICKET" ? inningsFromLiveState(m.liveState) : undefined,
      }));
    const standings = computeStandings(
      pool.teams.map((x) => x.id),
      completed,
      standingsConfig(t),
      new Map(t.teams.map((x) => [x.id, x.name]))
    );
    poolRank.set(pool.name, standings.map((s) => s.teamId));
    poolRows.set(pool.name, standings);
  }
  if (poolRank.size !== t.pools.length) allPoolsDone = false;

  // Cross-pool seeding (bracketSeeding = OVERALL_RANK). Every qualifier is
  // ranked against every other on their pool record, so the strongest team
  // in the tournament takes seed 1 — and with it any first-round bye —
  // instead of that falling to whoever happened to win Pool A. Only
  // decidable once EVERY pool is finished, since a later result can
  // reorder the seeds.
  const teamName = new Map(t.teams.map((x) => [x.id, x.name]));
  let overallSeeds: string[] = [];
  if (allPoolsDone && t.advancePerPool > 0) {
    const qualifiers: StandingRow[] = [];
    for (const rows of poolRows.values()) qualifiers.push(...rows.slice(0, t.advancePerPool));
    qualifiers.sort(
      (a, b) =>
        b.points - a.points ||
        b.scoreDiff - a.scoreDiff ||
        b.scoreFor - a.scoreFor ||
        (teamName.get(a.teamId) || "").localeCompare(teamName.get(b.teamId) || "")
    );
    overallSeeds = qualifiers.map((q) => q.teamId);
  }

  const resolveSeedLabel = (label: string | null): string | null => {
    const m = label?.match(/^Seed #(\d+)$/);
    if (!m) return null;
    return overallSeeds[parseInt(m[1], 10) - 1] ?? null;
  };

  const resolvePoolLabel = (label: string | null): string | null => {
    if (!label) return null;
    // "Winner Pool A" | "Runner-up Pool B" | "Pool C #3"
    let poolName: string | null = null;
    let rank = 0;
    let m = label.match(/^Winner (Pool .+)$/);
    if (m) {
      poolName = m[1];
      rank = 1;
    }
    if (!poolName) {
      m = label.match(/^Runner-up (Pool .+)$/);
      if (m) {
        poolName = m[1];
        rank = 2;
      }
    }
    if (!poolName) {
      m = label.match(/^(Pool .+) #(\d+)$/);
      if (m) {
        poolName = m[1];
        rank = parseInt(m[2], 10);
      }
    }
    if (!poolName || !rank) return null;
    const order = poolRank.get(poolName);
    return order?.[rank - 1] ?? null;
  };

  // Resolve slots + walkovers until nothing changes (chains can cascade).
  for (let pass = 0; pass < 8; pass++) {
    let changed = false;
    for (const match of t.matches) {
      const data: Record<string, unknown> = {};

      if (!match.homeTeamId) {
        const viaMatch = match.homeSourceLabel?.startsWith("Loser")
          ? decidedLoser(match.homeSourceMatchId)
          : decidedWinner(match.homeSourceMatchId);
        const resolved =
          viaMatch ?? resolvePoolLabel(match.homeSourceLabel) ?? resolveSeedLabel(match.homeSourceLabel);
        if (resolved) data.homeTeamId = resolved;
      }
      if (!match.awayTeamId) {
        const viaMatch = match.awaySourceLabel?.startsWith("Loser")
          ? decidedLoser(match.awaySourceMatchId)
          : decidedWinner(match.awaySourceMatchId);
        const resolved =
          viaMatch ?? resolvePoolLabel(match.awaySourceLabel) ?? resolveSeedLabel(match.awaySourceLabel);
        if (resolved) data.awayTeamId = resolved;
      }

      // BYE walkover once the real side is known.
      const homeAfter = (data.homeTeamId as string | undefined) ?? match.homeTeamId;
      const awayAfter = (data.awayTeamId as string | undefined) ?? match.awayTeamId;
      if (match.status === "SCHEDULED") {
        if (homeAfter && match.awaySourceLabel === "BYE") {
          data.status = "WALKOVER";
          data.winnerTeamId = homeAfter;
        } else if (awayAfter && match.homeSourceLabel === "BYE") {
          data.status = "WALKOVER";
          data.winnerTeamId = awayAfter;
        }
      }

      if (Object.keys(data).length > 0) {
        await db.tournamentMatch.update({ where: { id: match.id }, data: data as never });
        Object.assign(match, data);
        changed = true;
      }
    }
    if (!changed) break;
  }
}
