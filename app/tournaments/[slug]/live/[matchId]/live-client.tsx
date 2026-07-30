"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Radio, Smartphone, Trophy } from "lucide-react";

type TeamLite = { id: string; name: string; color: string | null; logoUrl: string | null };
type LiveEvent = {
  seq: number;
  kind: string;
  teamId: string | null;
  data: Record<string, unknown> | null;
  createdAt: string;
  member: { name: string } | null;
};
type LivePayload = {
  gated: boolean;
  reason?: string;
  stores?: { android: string; ios: string };
  tournament?: { slug: string; name: string; sport?: string };
  match?: {
    id: string;
    status: string;
    roundLabel: string | null;
    homeTeam: TeamLite | null;
    awayTeam: TeamLite | null;
    homeScore: number | null;
    awayScore: number | null;
    homeScoreNote: string | null;
    awayScoreNote: string | null;
    winnerTeamId: string | null;
    isDraw: boolean;
    liveState: unknown;
    clockSeconds: number | null;
    clockRunning: boolean;
    playerOfMatch: string | null;
  };
  events?: LiveEvent[];
};

type CricketState = {
  inning: number;
  battingTeamId: string | null;
  innings: { teamId: string; runs: number; wickets: number; balls: number }[];
  target: number | null;
};
type PickleState = { games: { home: number; away: number }[]; current: { home: number; away: number }; gamesWon: { home: number; away: number } };

const overs = (balls: number) => `${Math.floor(balls / 6)}.${balls % 6}`;

function eventLine(e: LiveEvent, teams: Map<string, string>): string | null {
  const d = e.data || {};
  const team = e.teamId ? teams.get(e.teamId) || "" : "";
  switch (e.kind) {
    case "BALL": {
      const runs = Number(d.runs) || 0;
      if (d.wicket) return `🔴 WICKET!${e.member ? ` ${e.member.name}` : ""}`;
      if (d.extra === "wd") return "Wide +1";
      if (d.extra === "nb") return "No ball +1";
      if (runs === 4) return "🏏 FOUR!";
      if (runs === 6) return "💥 SIX!";
      return runs === 0 ? "Dot ball" : `${runs} run${runs > 1 ? "s" : ""}`;
    }
    case "INNINGS_START":
      return `🏏 ${team} start their innings`;
    case "GOAL":
      return `⚽ GOAL! ${team}${e.member ? ` — ${e.member.name}` : ""}`;
    case "CARD":
      return `${d.card === "R" ? "🟥" : "🟨"} Card — ${team}${e.member ? ` (${e.member.name})` : ""}`;
    case "CLOCK_START":
      return "▶ Clock started";
    case "CLOCK_STOP":
      return "⏸ Clock stopped";
    case "POINT":
      return `+1 point ${team}`;
    case "GAME_END":
      return "— Game over —";
    default:
      return null;
  }
}

export function LiveMatchClient({ matchId, tvMode }: { matchId: string; tvMode: boolean }) {
  const [data, setData] = useState<LivePayload | null>(null);
  const [clock, setClock] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/tournaments/live/${matchId}?platform=web`, { cache: "no-store" });
      if (!res.ok) return;
      const payload = (await res.json()) as LivePayload;
      setData(payload);
      if (payload.match?.clockSeconds != null) setClock(payload.match.clockSeconds);
    } catch {
      /* transient */
    }
  }, [matchId]);

  useEffect(() => {
    load();
    const iv = setInterval(load, 4000);
    return () => clearInterval(iv);
  }, [load]);

  // Local 1s tick keeps the football clock smooth between polls.
  useEffect(() => {
    const iv = setInterval(() => {
      setClock((c) => (c != null && data?.match?.clockRunning ? c + 1 : c));
    }, 1000);
    return () => clearInterval(iv);
  }, [data?.match?.clockRunning]);

  if (!data) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-500" />
      </div>
    );
  }

  // ── APP-ONLY upsell (the download driver) ──
  if (data.gated) {
    return (
      <div className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center px-6 text-center">
        <Smartphone className="h-14 w-14 text-emerald-400" />
        <h1 className="mt-4 text-2xl font-bold text-white">Watch it LIVE on the app</h1>
        <p className="mt-2 text-zinc-400">
          {data.reason === "APP_ONLY"
            ? `Live ball-by-ball coverage of ${data.tournament?.name || "this tournament"} is exclusive to the Momentum Arena app.`
            : "The live screen isn't available right now."}
        </p>
        {data.reason === "APP_ONLY" && data.stores && (
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <a
              href={data.stores.android}
              className="rounded-xl bg-emerald-600 px-6 py-3 text-sm font-semibold text-white hover:bg-emerald-500"
            >
              Get it on Google Play
            </a>
            <a
              href={data.stores.ios}
              className="rounded-xl border border-zinc-700 px-6 py-3 text-sm font-semibold text-zinc-200 hover:bg-zinc-800"
            >
              Download on the App Store
            </a>
          </div>
        )}
      </div>
    );
  }

  const m = data.match!;
  const teams = new Map<string, string>();
  if (m.homeTeam) teams.set(m.homeTeam.id, m.homeTeam.name);
  if (m.awayTeam) teams.set(m.awayTeam.id, m.awayTeam.name);
  const cs = data.tournament?.sport === "CRICKET" ? (m.liveState as CricketState | null) : null;
  const ps = data.tournament?.sport === "PICKLEBALL" ? (m.liveState as PickleState | null) : null;
  const clockStr =
    clock != null ? `${Math.floor(clock / 60)}:${String(clock % 60).padStart(2, "0")}` : null;

  const scale = tvMode ? "scale-125 origin-top" : "";

  const teamCol = (team: TeamLite | null, score: number | null, note: string | null) => (
    <div className="flex flex-col items-center gap-2">
      <span
        className={`flex items-center justify-center overflow-hidden rounded-full font-bold text-white ${tvMode ? "h-20 w-20 text-2xl" : "h-14 w-14 text-lg"}`}
        style={{ backgroundColor: team?.color || "#3f3f46" }}
      >
        {team?.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={team.logoUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          (team?.name || "?").slice(0, 2).toUpperCase()
        )}
      </span>
      <span className={`text-center font-medium text-white ${tvMode ? "text-xl" : "text-sm"}`}>
        {team?.name || "TBD"}
      </span>
      <span className={`font-bold text-emerald-400 ${tvMode ? "text-7xl" : "text-5xl"}`}>
        {score ?? 0}
      </span>
      {note && <span className="text-xs text-zinc-400">{note}</span>}
    </div>
  );

  return (
    <div className={`mx-auto max-w-3xl px-4 py-8 ${scale}`}>
      {/* Status strip */}
      <div className="mb-4 flex items-center justify-center gap-2 text-sm">
        {m.status === "LIVE" ? (
          <span className="flex items-center gap-1.5 rounded-full border border-red-500/40 bg-red-500/10 px-3 py-1 font-semibold text-red-400">
            <Radio className="h-3.5 w-3.5 animate-pulse" /> LIVE
          </span>
        ) : (
          <span className="rounded-full border border-zinc-700 px-3 py-1 text-zinc-400">
            {m.status === "COMPLETED" ? "Full Time" : m.status}
          </span>
        )}
        <span className="text-zinc-500">
          {data.tournament?.name} · {m.roundLabel}
        </span>
      </div>

      {/* Scoreboard */}
      <div className="rounded-3xl border border-zinc-800 bg-gradient-to-b from-zinc-900 to-zinc-950 p-6 sm:p-8">
        <div className="grid grid-cols-3 items-center">
          {teamCol(m.homeTeam, m.homeScore, m.homeScoreNote)}
          <div className="text-center">
            {clockStr ? (
              <div className={`font-mono ${m.clockRunning ? "text-emerald-400" : "text-zinc-500"} ${tvMode ? "text-4xl" : "text-2xl"}`}>
                {clockStr}
              </div>
            ) : (
              <div className={`text-zinc-600 ${tvMode ? "text-3xl" : "text-xl"}`}>vs</div>
            )}
          </div>
          {teamCol(m.awayTeam, m.awayScore, m.awayScoreNote)}
        </div>

        {/* Cricket innings strip */}
        {cs && cs.inning > 0 && (
          <div className="mt-5 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 border-t border-zinc-800 pt-4 text-sm text-zinc-300">
            {cs.innings.map((inn, i) => (
              <span key={i} className={i === cs.innings.length - 1 && m.status === "LIVE" ? "font-semibold text-white" : ""}>
                {teams.get(inn.teamId)}: {inn.runs}/{inn.wickets} ({overs(inn.balls)})
              </span>
            ))}
            {cs.target != null && m.status === "LIVE" && (
              <span className="text-amber-400">Target {cs.target}</span>
            )}
          </div>
        )}

        {/* Pickleball games strip */}
        {ps && (
          <div className="mt-5 flex items-center justify-center gap-4 border-t border-zinc-800 pt-4 text-sm text-zinc-300">
            <span>
              Games: <span className="text-white">{ps.gamesWon.home}–{ps.gamesWon.away}</span>
            </span>
            {m.status === "LIVE" && (
              <span>
                Current game: <span className="font-semibold text-white">{ps.current.home}–{ps.current.away}</span>
              </span>
            )}
          </div>
        )}

        {m.status === "COMPLETED" && (
          <div className="mt-5 border-t border-zinc-800 pt-4 text-center">
            <p className="flex items-center justify-center gap-2 text-emerald-400">
              <Trophy className="h-4 w-4" />
              {m.isDraw
                ? "Match drawn"
                : m.winnerTeamId
                  ? `${teams.get(m.winnerTeamId)} win!`
                  : "Result recorded"}
            </p>
            {m.playerOfMatch && (
              <p className="mt-1 text-sm text-amber-400">🏅 Player of the Match: {m.playerOfMatch}</p>
            )}
          </div>
        )}
      </div>

      {/* Event timeline */}
      {!tvMode && (data.events?.length || 0) > 0 && (
        <div className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-400">
            Live feed
          </h2>
          <ul className="space-y-2">
            {data.events!.map((e) => {
              const line = eventLine(e, teams);
              if (!line) return null;
              return (
                <li key={e.seq} className="flex items-baseline gap-3 text-sm">
                  <span className="w-12 shrink-0 text-right font-mono text-xs text-zinc-600">
                    {new Date(e.createdAt).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" })}
                  </span>
                  <span className="text-zinc-200">{line}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
