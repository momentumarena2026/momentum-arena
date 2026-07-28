"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Undo2, Play, Square, ChevronLeft, Radio } from "lucide-react";

type Member = { id: string; name: string };
type Team = { id: string; name: string; color: string | null; members: Member[] };
type Match = {
  id: string;
  status: string;
  stage: string;
  roundLabel: string | null;
  scheduledAt: string | null;
  homeScore: number | null;
  awayScore: number | null;
  homeTeam: Team;
  awayTeam: Team;
  liveState: unknown;
  clockStartedAt: string | null;
  clockElapsedSec: number;
};
type Boot = {
  tournament: { id: string; name: string; sport: string; status: string };
  matches: Match[];
};

type CricketState = {
  inning: number;
  battingTeamId: string | null;
  innings: { teamId: string; runs: number; wickets: number; balls: number }[];
  target: number | null;
};
type PickleState = { games: { home: number; away: number }[]; current: { home: number; away: number }; gamesWon: { home: number; away: number } };

const bigBtn =
  "flex items-center justify-center rounded-2xl border text-lg font-bold transition active:scale-95 disabled:opacity-40";

function overs(balls: number): string {
  return `${Math.floor(balls / 6)}.${balls % 6}`;
}

function clockDisplay(m: Match): string {
  const base = m.clockElapsedSec + (m.clockStartedAt ? Math.max(0, Math.round((Date.now() - new Date(m.clockStartedAt).getTime()) / 1000)) : 0);
  const mm = Math.floor(base / 60);
  const ss = base % 60;
  return `${mm}:${String(ss).padStart(2, "0")}`;
}

export function ScorerConsole({ code }: { code: string }) {
  const [boot, setBoot] = useState<Boot | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [matchId, setMatchId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsWinner, setNeedsWinner] = useState(false);
  const [, setTick] = useState(0); // re-render for the football clock
  // Who's on strike / bowling. Tagging every delivery is what turns the
  // event log into a real scorecard (batting + bowling cards, commentary),
  // so the pad keeps these selected between balls.
  const [strikerId, setStrikerId] = useState<string>("");
  const [nonStrikerId, setNonStrikerId] = useState<string>("");
  const [bowlerId, setBowlerId] = useState<string>("");

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/tournaments/scorer/${code}`, { cache: "no-store" });
      if (!res.ok) {
        setNotFound(true);
        return;
      }
      setBoot(await res.json());
      setNotFound(false);
    } catch {
      /* transient */
    }
  }, [code]);

  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, 5000);
    const clock = setInterval(() => setTick((x) => x + 1), 1000);
    return () => {
      clearInterval(iv);
      clearInterval(clock);
    };
  }, [refresh]);

  const match = useMemo(
    () => boot?.matches.find((m) => m.id === matchId) || null,
    [boot, matchId]
  );

  const send = async (payload: Record<string, unknown>) => {
    if (!matchId || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/tournaments/scorer/${code}/event`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId, ...payload }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.needsWinner) setNeedsWinner(true);
        setError(data.error || "Failed");
        return;
      }
      setNeedsWinner(false);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const ev = (kind: string, extra: Record<string, unknown> = {}) =>
    send({ action: "event", event: { kind, ...extra } });

  /** A cricket delivery, attributed to the selected striker + bowler.
   *  Strike rotates on odd runs the way it does on the field, so the
   *  scorer doesn't have to remember to swap. */
  const ball = async (data: { runs: number; extra?: string; wicket?: boolean }) => {
    await send({
      action: "event",
      event: {
        kind: "BALL",
        memberId: strikerId || undefined,
        data: {
          ...data,
          ...(strikerId ? { batterId: strikerId } : {}),
          ...(bowlerId ? { bowlerId } : {}),
        },
      },
    });
    if (!data.extra && data.runs % 2 === 1 && nonStrikerId) swapStrike();
  };

  const resetPlayers = () => {
    setStrikerId("");
    setNonStrikerId("");
    setBowlerId("");
  };

  const swapStrike = () => {
    setStrikerId((s) => {
      setNonStrikerId(s);
      return nonStrikerId;
    });
  };

  if (notFound) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 p-6 text-center">
        <div>
          <p className="text-xl font-semibold text-white">Invalid scorer code</p>
          <p className="mt-2 text-sm text-zinc-500">Check the link with the tournament admin.</p>
        </div>
      </div>
    );
  }
  if (!boot) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-500" />
      </div>
    );
  }

  // ── Match picker ──
  if (!match) {
    return (
      <div className="min-h-screen bg-zinc-950 p-4">
        <div className="mx-auto max-w-md">
          <p className="text-xs uppercase tracking-wide text-emerald-500">Scorer Console</p>
          <h1 className="text-xl font-bold text-white">{boot.tournament.name}</h1>
          <p className="mb-4 mt-1 text-sm text-zinc-500">Pick a match to score.</p>
          <div className="space-y-2">
            {boot.matches.map((m) => (
              <button
                key={m.id}
                onClick={() => setMatchId(m.id)}
                className="w-full rounded-2xl border border-zinc-800 bg-zinc-900 p-4 text-left hover:border-emerald-500/40"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs text-zinc-500">{m.roundLabel}</span>
                  {m.status === "LIVE" && (
                    <span className="flex items-center gap-1 text-xs font-semibold text-red-400">
                      <Radio className="h-3 w-3" /> LIVE
                    </span>
                  )}
                </div>
                <div className="mt-1 font-medium text-white">
                  {m.homeTeam.name} <span className="text-zinc-600">vs</span> {m.awayTeam.name}
                </div>
                {m.scheduledAt && (
                  <div className="mt-0.5 text-xs text-zinc-500">
                    {new Date(m.scheduledAt).toLocaleString("en-IN", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" })}
                  </div>
                )}
              </button>
            ))}
            {boot.matches.length === 0 && (
              <p className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6 text-center text-sm text-zinc-500">
                No scoreable matches right now.
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  const sport = boot.tournament.sport;
  const cs = (match.liveState || null) as CricketState | null;
  const ps = (match.liveState || null) as PickleState | null;

  return (
    <div className="min-h-screen bg-zinc-950 p-4 pb-24">
      <div className="mx-auto max-w-md">
        {/* Header */}
        <div className="mb-3 flex items-center justify-between">
          <button onClick={() => setMatchId(null)} className="flex items-center gap-1 text-sm text-zinc-400">
            <ChevronLeft className="h-4 w-4" /> Matches
          </button>
          {match.status === "LIVE" && (
            <span className="flex items-center gap-1 text-xs font-semibold text-red-400">
              <Radio className="h-3 w-3 animate-pulse" /> LIVE
            </span>
          )}
        </div>

        {/* Scoreboard */}
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4 text-center">
          <div className="text-xs text-zinc-500">{match.roundLabel}</div>
          <div className="mt-2 grid grid-cols-3 items-center">
            <div>
              <div className="mx-auto mb-1 h-3 w-3 rounded-full" style={{ backgroundColor: match.homeTeam.color || "#52525b" }} />
              <div className="text-sm font-medium text-white">{match.homeTeam.name}</div>
              <div className="text-3xl font-bold text-emerald-400">{match.homeScore ?? 0}</div>
            </div>
            <div className="text-zinc-600">
              {sport === "FOOTBALL" ? (
                <div className={`text-lg font-mono ${match.clockStartedAt ? "text-emerald-400" : "text-zinc-500"}`}>
                  {clockDisplay(match)}
                </div>
              ) : (
                "vs"
              )}
            </div>
            <div>
              <div className="mx-auto mb-1 h-3 w-3 rounded-full" style={{ backgroundColor: match.awayTeam.color || "#52525b" }} />
              <div className="text-sm font-medium text-white">{match.awayTeam.name}</div>
              <div className="text-3xl font-bold text-emerald-400">{match.awayScore ?? 0}</div>
            </div>
          </div>
          {/* Sport sub-state */}
          {sport === "CRICKET" && cs && cs.inning > 0 && (
            <div className="mt-2 text-sm text-zinc-400">
              {cs.innings.map((inn, i) => {
                const team = inn.teamId === match.homeTeam.id ? match.homeTeam : match.awayTeam;
                return (
                  <span key={i} className={i === cs.innings.length - 1 ? "text-white" : ""}>
                    {i > 0 && " · "}
                    {team.name}: {inn.runs}/{inn.wickets} ({overs(inn.balls)})
                  </span>
                );
              })}
              {cs.target != null && <span className="ml-1 text-amber-400">Target {cs.target}</span>}
            </div>
          )}
          {sport === "PICKLEBALL" && ps && (
            <div className="mt-2 text-sm text-zinc-400">
              Games {ps.gamesWon.home}–{ps.gamesWon.away} · Current{" "}
              <span className="text-white">
                {ps.current.home}–{ps.current.away}
              </span>
            </div>
          )}
        </div>

        {error && <p className="mt-3 text-center text-sm text-red-400">{error}</p>}

        {/* Controls */}
        {match.status === "SCHEDULED" && (
          <button
            onClick={() => send({ action: "start" })}
            disabled={busy}
            className={`${bigBtn} mt-4 h-16 w-full gap-2 border-emerald-500/40 bg-emerald-600/15 text-emerald-300`}
          >
            <Play className="h-5 w-5" /> Start Match
          </button>
        )}

        {match.status === "LIVE" && (
          <div className="mt-4 space-y-4">
            {/* CRICKET */}
            {sport === "CRICKET" && (
              <>
                {(!cs || cs.inning === 0 || (cs.inning === 1 && false)) && null}
                {(!cs || cs.inning === 0) ? (
                  <div className="grid grid-cols-2 gap-3">
                    {[match.homeTeam, match.awayTeam].map((team) => (
                      <button
                        key={team.id}
                        onClick={() => {
                          resetPlayers();
                          ev("INNINGS_START", { teamId: team.id });
                        }}
                        disabled={busy}
                        className={`${bigBtn} h-16 border-sky-500/40 bg-sky-600/15 text-sm text-sky-300`}
                      >
                        {team.name} bat first
                      </button>
                    ))}
                  </div>
                ) : (
                  <>
                    {/* Who's on strike / bowling — every ball is tagged to
                        them, which is what builds the live scorecard. */}
                    {(() => {
                      const batting =
                        cs?.battingTeamId === match.awayTeam.id ? match.awayTeam : match.homeTeam;
                      const bowling =
                        batting.id === match.homeTeam.id ? match.awayTeam : match.homeTeam;
                      const sel =
                        "w-full rounded-xl border border-zinc-700 bg-zinc-900 p-2.5 text-sm text-white focus:border-emerald-500/50 focus:outline-none";
                      return (
                        <div className="space-y-2 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-3">
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="mb-1 block text-[11px] text-zinc-500">Striker</label>
                              <select className={sel} value={strikerId} onChange={(e) => setStrikerId(e.target.value)}>
                                <option value="">— pick batter —</option>
                                {batting.members.map((m) => (
                                  <option key={m.id} value={m.id}>{m.name}</option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="mb-1 block text-[11px] text-zinc-500">Non-striker</label>
                              <select className={sel} value={nonStrikerId} onChange={(e) => setNonStrikerId(e.target.value)}>
                                <option value="">— optional —</option>
                                {batting.members.map((m) => (
                                  <option key={m.id} value={m.id}>{m.name}</option>
                                ))}
                              </select>
                            </div>
                          </div>
                          <div className="flex items-end gap-2">
                            <div className="flex-1">
                              <label className="mb-1 block text-[11px] text-zinc-500">Bowler ({bowling.name})</label>
                              <select className={sel} value={bowlerId} onChange={(e) => setBowlerId(e.target.value)}>
                                <option value="">— pick bowler —</option>
                                {bowling.members.map((m) => (
                                  <option key={m.id} value={m.id}>{m.name}</option>
                                ))}
                              </select>
                            </div>
                            <button
                              onClick={swapStrike}
                              disabled={!nonStrikerId}
                              className="shrink-0 rounded-xl border border-zinc-700 px-3 py-2.5 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
                            >
                              ⇄ Swap
                            </button>
                          </div>
                          {!strikerId && (
                            <p className="text-[11px] text-amber-400/80">
                              Pick a striker to build the batting card — scoring works either way.
                            </p>
                          )}
                        </div>
                      );
                    })()}
                    <div className="grid grid-cols-4 gap-2">
                      {[0, 1, 2, 3, 4, 6].map((r) => (
                        <button
                          key={r}
                          onClick={() => ball({ runs: r })}
                          disabled={busy}
                          className={`${bigBtn} h-16 ${r === 4 || r === 6 ? "border-emerald-500/40 bg-emerald-600/15 text-emerald-300" : "border-zinc-700 bg-zinc-900 text-white"}`}
                        >
                          {r}
                        </button>
                      ))}
                      <button
                        onClick={() => ball({ runs: 0, wicket: true })}
                        disabled={busy}
                        className={`${bigBtn} h-16 border-red-500/40 bg-red-600/15 text-red-300`}
                      >
                        W
                      </button>
                      <button
                        onClick={() => ball({ runs: 1, extra: "wd" })}
                        disabled={busy}
                        className={`${bigBtn} h-16 border-amber-500/40 bg-amber-600/15 text-sm text-amber-300`}
                      >
                        Wd
                      </button>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <button onClick={() => ball({ runs: 1, extra: "nb" })} disabled={busy} className={`${bigBtn} h-12 border-amber-500/40 bg-amber-600/10 text-sm text-amber-300`}>
                        No Ball +1
                      </button>
                      <button onClick={() => ball({ runs: 1, extra: "b" })} disabled={busy} className={`${bigBtn} h-12 border-zinc-700 bg-zinc-900 text-sm text-zinc-300`}>
                        Bye +1
                      </button>
                      {cs && cs.inning === 1 && (
                        <button
                          onClick={() => {
                            const other =
                              cs.battingTeamId === match.homeTeam.id ? match.awayTeam.id : match.homeTeam.id;
                            resetPlayers(); // sides swap — clear the old strike/bowler pair
                            ev("INNINGS_START", { teamId: other });
                          }}
                          disabled={busy}
                          className={`${bigBtn} h-12 border-sky-500/40 bg-sky-600/10 text-sm text-sky-300`}
                        >
                          End Innings
                        </button>
                      )}
                    </div>
                  </>
                )}
              </>
            )}

            {/* FOOTBALL */}
            {sport === "FOOTBALL" && (
              <>
                <button
                  onClick={() => ev(match.clockStartedAt ? "CLOCK_STOP" : "CLOCK_START")}
                  disabled={busy}
                  className={`${bigBtn} h-14 w-full gap-2 ${match.clockStartedAt ? "border-amber-500/40 bg-amber-600/15 text-amber-300" : "border-emerald-500/40 bg-emerald-600/15 text-emerald-300"}`}
                >
                  {match.clockStartedAt ? (
                    <>
                      <Square className="h-4 w-4" /> Stop Clock
                    </>
                  ) : (
                    <>
                      <Play className="h-4 w-4" /> Start Clock
                    </>
                  )}
                </button>
                {/* Optional scorer — tagging it builds the goals
                    leaderboard and names the scorer in commentary. */}
                <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-3">
                  <label className="mb-1 block text-[11px] text-zinc-500">Goal scorer (optional)</label>
                  <select
                    className="w-full rounded-xl border border-zinc-700 bg-zinc-900 p-2.5 text-sm text-white focus:border-emerald-500/50 focus:outline-none"
                    value={strikerId}
                    onChange={(e) => setStrikerId(e.target.value)}
                  >
                    <option value="">— not recorded —</option>
                    {[match.homeTeam, match.awayTeam].map((team) => (
                      <optgroup key={team.id} label={team.name}>
                        {team.members.map((m) => (
                          <option key={m.id} value={m.id}>{m.name}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {[match.homeTeam, match.awayTeam].map((team) => (
                    <button
                      key={team.id}
                      onClick={async () => {
                        const scorer = team.members.some((m) => m.id === strikerId) ? strikerId : "";
                        await send({
                          action: "event",
                          event: { kind: "GOAL", teamId: team.id, memberId: scorer || undefined },
                        });
                        setStrikerId("");
                      }}
                      disabled={busy}
                      className={`${bigBtn} h-20 flex-col border-emerald-500/40 bg-emerald-600/15 text-emerald-300`}
                    >
                      <span className="text-2xl">⚽</span>
                      <span className="text-xs">{team.name}</span>
                    </button>
                  ))}
                </div>
              </>
            )}

            {/* PICKLEBALL */}
            {sport === "PICKLEBALL" && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  {[match.homeTeam, match.awayTeam].map((team) => (
                    <button
                      key={team.id}
                      onClick={() => ev("POINT", { teamId: team.id })}
                      disabled={busy}
                      className={`${bigBtn} h-20 flex-col border-emerald-500/40 bg-emerald-600/15 text-emerald-300`}
                    >
                      <span className="text-2xl">+1</span>
                      <span className="text-xs">{team.name}</span>
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => ev("GAME_END")}
                  disabled={busy}
                  className={`${bigBtn} h-12 w-full border-sky-500/40 bg-sky-600/10 text-sm text-sky-300`}
                >
                  End Game
                </button>
              </>
            )}

            {/* Undo + end */}
            <div className="grid grid-cols-2 gap-3 border-t border-zinc-800 pt-4">
              <button
                onClick={() => send({ action: "undo" })}
                disabled={busy}
                className={`${bigBtn} h-12 gap-2 border-zinc-700 bg-zinc-900 text-sm text-zinc-300`}
              >
                <Undo2 className="h-4 w-4" /> Undo
              </button>
              <button
                onClick={() => send({ action: "end" })}
                disabled={busy}
                className={`${bigBtn} h-12 border-red-500/40 bg-red-600/10 text-sm text-red-300`}
              >
                End Match
              </button>
            </div>
            {needsWinner && (
              <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3">
                <p className="mb-2 text-center text-sm text-amber-300">Scores level — who won?</p>
                <div className="grid grid-cols-2 gap-2">
                  {[match.homeTeam, match.awayTeam].map((team) => (
                    <button
                      key={team.id}
                      onClick={() => send({ action: "end", winnerTeamId: team.id })}
                      disabled={busy}
                      className={`${bigBtn} h-12 border-amber-500/40 bg-amber-600/15 text-sm text-amber-200`}
                    >
                      {team.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {(match.status === "COMPLETED" || match.status === "WALKOVER") && (
          <div className="mt-6 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-5 text-center">
            <p className="font-semibold text-emerald-300">Match completed ✓</p>
            <button onClick={() => setMatchId(null)} className="mt-3 text-sm text-zinc-300 underline">
              Back to matches
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
