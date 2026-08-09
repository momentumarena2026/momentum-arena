"use client";

import { useMemo } from "react";
import { Medal } from "lucide-react";
import {
  computeStandings,
  inningsFromLiveState,
  standingsConfig,
  type StandingRow,
} from "@/lib/tournament-points";
import type { Leaderboard } from "@/lib/tournament-leaderboards";
import { BracketView, type BracketTeam } from "@/components/tournaments/BracketView";
import type { MatchRow } from "./fixtures-tab";

/**
 * The three read-only views the organiser previously had to leave the
 * admin for: bracket, points table and leaderboards.
 *
 * They are deliberately computed from the same lib the public page uses
 * (computeStandings + standingsConfig, getTournamentLeaderboards) rather
 * than re-derived here. An admin table that ranked teams even slightly
 * differently from the one the captains are refreshing would be worse
 * than not having the tab at all.
 */

type TeamLite = {
  id: string;
  name: string;
  color: string | null;
  logoUrl: string | null;
  poolId: string | null;
  status: string;
};

export function TeamDot({ team, size = 22 }: { team: BracketTeam | null; size?: number }) {
  if (!team) {
    return (
      <span
        className="shrink-0 rounded-full bg-zinc-800"
        style={{ width: size, height: size }}
      />
    );
  }
  if (team.logoUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={team.logoUrl}
        alt=""
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white"
      style={{ width: size, height: size, background: team.color || "#3f3f46" }}
    >
      {team.name.slice(0, 2).toUpperCase()}
    </span>
  );
}

function teamMap(teams: TeamLite[]) {
  return new Map<string, BracketTeam>(
    teams.map((t) => [t.id, { id: t.id, name: t.name, color: t.color, logoUrl: t.logoUrl }]),
  );
}

// ── Bracket ──────────────────────────────────────────────────────────
export function BracketTab({
  matches,
  teams,
  pools,
  advancePerPool,
  bracketSeeding,
  onMatchClick,
}: {
  matches: MatchRow[];
  teams: TeamLite[];
  pools: { id: string; name: string }[];
  advancePerPool: number;
  bracketSeeding: "POOL_ORDER" | "OVERALL_RANK";
  onMatchClick?: (matchId: string) => void;
}) {
  const lookup = useMemo(() => teamMap(teams), [teams]);
  return (
    <BracketView
      matches={matches.map((m) => ({
        id: m.id,
        stage: m.stage,
        sequence: m.sequence,
        roundLabel: m.roundLabel,
        status: m.status,
        homeTeamId: m.homeTeam?.id ?? null,
        awayTeamId: m.awayTeam?.id ?? null,
        homeSourceMatchId: m.homeSourceMatchId,
        awaySourceMatchId: m.awaySourceMatchId,
        homeSourceLabel: m.homeSourceLabel,
        awaySourceLabel: m.awaySourceLabel,
        homeScore: m.homeScore,
        awayScore: m.awayScore,
        homeScoreNote: m.homeScoreNote,
        awayScoreNote: m.awayScoreNote,
        winnerTeamId: m.winnerTeamId,
        poolId: m.poolId,
      }))}
      teams={lookup}
      pools={pools}
      advancePerPool={advancePerPool}
      bracketSeeding={bracketSeeding}
      renderBadge={(team) => <TeamDot team={team} size={18} />}
      onMatchClick={onMatchClick ? (m) => onMatchClick(m.id) : undefined}
      // A slot still reading "Winner SF1" has nothing to score, so it
      // stays inert instead of offering a click that goes nowhere.
      canClick={(m) => !!m.homeTeamId && !!m.awayTeamId}
      emptyText="No fixtures yet — generate them from the Fixtures tab."
    />
  );
}

// ── Points table ─────────────────────────────────────────────────────
export function PointsTableTab({
  tournament,
  matches,
  teams,
  pools,
}: {
  tournament: {
    sport: string;
    format: string;
    advancePerPool: number;
    pointsWin: number;
    pointsDraw: number;
    pointsLoss: number;
    tiebreakers: string[];
    oversPerInnings: number;
  };
  matches: MatchRow[];
  teams: TeamLite[];
  pools: { id: string; name: string }[];
}) {
  const lookup = useMemo(() => teamMap(teams), [teams]);
  const isCricket = tournament.sport === "CRICKET";

  const groups = useMemo(() => {
    const confirmed = teams.filter((t) => t.status === "CONFIRMED");
    const cfg = standingsConfig(tournament);
    const names = new Map(teams.map((t) => [t.id, t.name]));

    const rowsFor = (poolId: string | null) => {
      const rr = matches
        .filter(
          (m) =>
            (poolId ? m.poolId === poolId : m.stage === "LEAGUE") &&
            (m.status === "COMPLETED" || m.status === "WALKOVER") &&
            m.homeTeam &&
            m.awayTeam &&
            m.homeScore != null &&
            m.awayScore != null,
        )
        .map((m) => ({
          homeTeamId: m.homeTeam!.id,
          awayTeamId: m.awayTeam!.id,
          homeScore: m.homeScore!,
          awayScore: m.awayScore!,
          isDraw: m.isDraw,
          winnerTeamId: m.winnerTeamId,
          innings: isCricket ? inningsFromLiveState(m.liveState) : undefined,
        }));
      const ids = confirmed
        .filter((t) => (poolId ? t.poolId === poolId : true))
        .map((t) => t.id);
      return computeStandings(ids, rr, cfg, names);
    };

    return tournament.format === "LEAGUE"
      ? [{ id: null as string | null, name: null as string | null, rows: rowsFor(null) }]
      : pools.map((p) => ({ id: p.id, name: p.name, rows: rowsFor(p.id) }));
  }, [tournament, matches, teams, pools, isCricket]);

  if (groups.length === 0 || groups.every((g) => g.rows.length === 0)) {
    return (
      <p className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-8 text-center text-sm text-zinc-500">
        The points table fills in once pools are drawn and results are recorded.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <div
          key={g.id || "league"}
          className="overflow-hidden rounded-2xl border border-zinc-800"
        >
          {g.name && (
            <div className="border-b border-zinc-800 bg-violet-500/5 px-4 py-2.5 text-sm font-semibold text-violet-300">
              {g.name}
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 bg-zinc-900 text-left text-[11px] uppercase tracking-wide text-zinc-500">
                  <th className="px-4 py-2.5 font-medium">#</th>
                  <th className="py-2.5 pr-4 font-medium">Team</th>
                  <th className="py-2.5 pr-3 text-center font-medium">P</th>
                  <th className="py-2.5 pr-3 text-center font-medium">W</th>
                  <th className="py-2.5 pr-3 text-center font-medium">D</th>
                  <th className="py-2.5 pr-3 text-center font-medium">L</th>
                  <th className="py-2.5 pr-3 text-center font-medium">+/−</th>
                  {isCricket && (
                    <th className="py-2.5 pr-3 text-center font-medium">NRR</th>
                  )}
                  <th className="py-2.5 pr-4 text-center font-medium">Pts</th>
                </tr>
              </thead>
              <tbody>
                {g.rows.map((r: StandingRow, i: number) => {
                  const qualifies =
                    tournament.format === "POOLS_KNOCKOUT" &&
                    i < tournament.advancePerPool;
                  return (
                    <tr
                      key={r.teamId}
                      className={`border-b border-zinc-800/60 ${
                        qualifies ? "bg-emerald-500/[0.06]" : ""
                      }`}
                    >
                      <td className="px-4 py-2.5">
                        <span
                          className={`font-semibold ${
                            qualifies ? "text-emerald-400" : "text-zinc-500"
                          }`}
                        >
                          {i + 1}
                        </span>
                      </td>
                      <td className="py-2.5 pr-4">
                        <span className="flex items-center gap-2.5">
                          <TeamDot team={lookup.get(r.teamId) ?? null} />
                          <span className="font-medium text-white">
                            {lookup.get(r.teamId)?.name || "—"}
                          </span>
                        </span>
                      </td>
                      <td className="py-2.5 pr-3 text-center text-zinc-300">{r.played}</td>
                      <td className="py-2.5 pr-3 text-center text-zinc-300">{r.won}</td>
                      <td className="py-2.5 pr-3 text-center text-zinc-300">{r.drawn}</td>
                      <td className="py-2.5 pr-3 text-center text-zinc-300">{r.lost}</td>
                      <td
                        className={`py-2.5 pr-3 text-center ${
                          r.scoreDiff > 0
                            ? "text-emerald-400"
                            : r.scoreDiff < 0
                              ? "text-red-400"
                              : "text-zinc-400"
                        }`}
                      >
                        {r.scoreDiff > 0 ? "+" : ""}
                        {r.scoreDiff}
                      </td>
                      {isCricket && (
                        <td
                          className={`py-2.5 pr-3 text-center tabular-nums ${
                            r.nrr == null
                              ? "text-zinc-600"
                              : r.nrr > 0
                                ? "text-emerald-400"
                                : r.nrr < 0
                                  ? "text-red-400"
                                  : "text-zinc-400"
                          }`}
                          title={
                            r.nrr == null
                              ? "No ball-by-ball data for this team's matches"
                              : r.nrrMatches < r.played
                                ? `From ${r.nrrMatches} of ${r.played} matches — the rest were scored by hand`
                                : undefined
                          }
                        >
                          {r.nrr == null
                            ? "—"
                            : `${r.nrr > 0 ? "+" : r.nrr < 0 ? "−" : ""}${Math.abs(r.nrr).toFixed(3)}`}
                          {r.nrr != null && r.nrrMatches < r.played && (
                            <span className="text-zinc-600">*</span>
                          )}
                        </td>
                      )}
                      <td className="py-2.5 pr-4 text-center">
                        <span className="font-bold text-white">{r.points}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      {tournament.format === "POOLS_KNOCKOUT" && (
        <p className="text-center text-xs text-zinc-500">
          Highlighted rows are the qualification zone — top {tournament.advancePerPool}{" "}
          advance. This is the same order the bracket seeds from.
        </p>
      )}
    </div>
  );
}

// ── Leaderboards ─────────────────────────────────────────────────────
export function LeadersTab({ leaderboards }: { leaderboards: Leaderboard[] }) {
  const withRows = leaderboards.filter((l) => l.rows.length > 0);
  if (withRows.length === 0) {
    return (
      <p className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-8 text-center text-sm text-zinc-500">
        {leaderboards.length === 0
          ? "No stat fields configured — add them under Settings to collect player stats."
          : "No player stats recorded yet. They appear as match results are entered."}
      </p>
    );
  }
  const MEDAL = ["text-amber-400", "text-zinc-300", "text-amber-700"];
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {withRows.map((lb) => (
        <div key={lb.key} className="overflow-hidden rounded-2xl border border-zinc-800">
          <div className="border-b border-zinc-800 bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-zinc-200">
            {lb.label}
          </div>
          <div className="divide-y divide-zinc-800/60">
            {lb.rows.map((r, i) => (
              <div key={r.memberId} className="flex items-center gap-3 px-4 py-2.5">
                <span className="w-5 text-center text-xs font-semibold text-zinc-500">
                  {i < 3 ? <Medal className={`h-4 w-4 ${MEDAL[i]}`} /> : i + 1}
                </span>
                <span
                  className="h-6 w-1 shrink-0 rounded-sm"
                  style={{ background: r.teamColor || "#3f3f46" }}
                />
                <span className="flex-1 truncate">
                  <span className="text-sm text-zinc-100">{r.name}</span>
                  <span className="ml-2 text-xs text-zinc-500">{r.teamName}</span>
                </span>
                <span className="text-sm font-bold text-white">{r.value}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
