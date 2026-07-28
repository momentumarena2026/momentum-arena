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

type CricketCurrent = {
  strikerId: string | null;
  nonStrikerId: string | null;
  bowlerId: string | null;
  batters: { id: string; runs: number; balls: number }[];
  bowler: { id: string; balls: number; runs: number; wickets: number } | null;
  thisOver: string[];
  ballsThisOver: number;
  partnership: { runs: number; balls: number };
  needsBatter: boolean;
  needsBowler: boolean;
};
type CricketState = {
  inning: number;
  battingTeamId: string | null;
  innings: { teamId: string; runs: number; wickets: number; balls: number }[];
  target: number | null;
  current?: CricketCurrent;
};
type PickleState = {
  games: { home: number; away: number }[];
  current: { home: number; away: number };
  gamesWon: { home: number; away: number };
  servingTeamId?: string | null;
  gameNumber?: number;
};
type FootballLive = {
  current?: {
    lastGoal: { teamId: string; memberId: string | null; assistId: string | null } | null;
  };
};

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
  // Who's out there is owned by the SERVER (folded from the event log), so
  // it survives a reload and two scorers see the same thing. These locals
  // only fill the gap while a new batter/bowler hasn't been chosen yet.
  const [pickStriker, setPickStriker] = useState<string>("");
  const [pickNonStriker, setPickNonStriker] = useState<string>("");
  const [pickBowler, setPickBowler] = useState<string>("");

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/tournaments/scorer/${code}`, { cache: "no-store" });
      if (!res.ok) {
        // 404 = wrong/rotated code. Anything else (429, a blip) must not
        // masquerade as an invalid code, and must not kill a live console.
        if (res.status === 404) setNotFound(true);
        else if (res.status === 429) setError("Too many attempts — wait a minute and reload.");
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

  // ── The crease, server-first ──
  // The fold already knows who faced the last ball, who's at the other
  // end, who's bowling and whether a wicket/over just ended. Local picks
  // are only consulted when the server has a gap to fill.
  const liveCur = (match?.liveState as CricketState | null)?.current;
  const strikerId = liveCur?.strikerId || pickStriker;
  const nonStrikerId = liveCur?.nonStrikerId || pickNonStriker;
  const bowlerId = liveCur?.bowlerId || pickBowler;
  const needsBatter = !!liveCur?.needsBatter && !pickStriker;
  const needsBowler = !!liveCur?.needsBowler && !pickBowler;

  /** A cricket delivery, attributed to the striker + bowler. Strike
   *  rotation and the over/wicket bookkeeping happen in the fold, so the
   *  pad just reports who did what. */
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
    // Odd runs swap the ends. The server can't infer this (it only sees
    // who faced), so the pad nominates the new striker for the next ball.
    if (!data.extra && data.runs % 2 === 1 && nonStrikerId) {
      setPickStriker(nonStrikerId);
      setPickNonStriker(strikerId);
    } else {
      setPickStriker("");
      setPickNonStriker("");
    }
  };

  const resetPlayers = () => {
    setPickStriker("");
    setPickNonStriker("");
    setPickBowler("");
  };

  const swapStrike = () => {
    setPickStriker(nonStrikerId);
    setPickNonStriker(strikerId);
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
              Game {ps.gameNumber ?? 1} · Games {ps.gamesWon.home}–{ps.gamesWon.away} · Current{" "}
              <span className="text-white">
                {ps.current.home}–{ps.current.away}
              </span>
              {ps.servingTeamId && (
                <span className="ml-1 text-emerald-400">
                  · Serving:{" "}
                  {ps.servingTeamId === match.homeTeam.id ? match.homeTeam.name : match.awayTeam.name}
                </span>
              )}
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
                    {/* ── At the crease ──
                        Who's batting, who's on strike, who's bowling and
                        how the over is going. Driven by the server's fold,
                        so it's the same picture the audience sees. */}
                    {(() => {
                      const batting =
                        cs?.battingTeamId === match.awayTeam.id ? match.awayTeam : match.homeTeam;
                      const bowling =
                        batting.id === match.homeTeam.id ? match.awayTeam : match.homeTeam;
                      const nameOf = (id: string | null) =>
                        [...batting.members, ...bowling.members].find((m) => m.id === id)?.name || null;
                      const figs = (id: string | null) =>
                        liveCur?.batters.find((b) => b.id === id) || null;
                      const chip = (active: boolean, on: boolean) =>
                        `rounded-full border px-3 py-1.5 text-xs transition ${
                          on
                            ? "border-emerald-500/50 bg-emerald-600/15 text-emerald-300"
                            : active
                              ? "border-amber-500/50 bg-amber-500/10 text-amber-300"
                              : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
                        }`;
                      return (
                        <div className="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-3">
                          {/* Live crease read-out */}
                          <div className="space-y-1.5">
                            {[
                              { id: strikerId, onStrike: true },
                              { id: nonStrikerId, onStrike: false },
                            ].map((row, i) =>
                              row.id ? (
                                <div key={i} className="flex items-baseline justify-between text-sm">
                                  <span className={row.onStrike ? "font-semibold text-white" : "text-zinc-300"}>
                                    {nameOf(row.id)}
                                    {row.onStrike && <span className="ml-1 text-emerald-400">*</span>}
                                  </span>
                                  <span className="font-mono text-zinc-400">
                                    {figs(row.id)?.runs ?? 0}
                                    <span className="text-zinc-600"> ({figs(row.id)?.balls ?? 0})</span>
                                  </span>
                                </div>
                              ) : null
                            )}
                            {liveCur?.bowler && (
                              <div className="flex items-baseline justify-between border-t border-zinc-800 pt-1.5 text-sm">
                                <span className="text-zinc-300">{nameOf(liveCur.bowler.id)}</span>
                                <span className="font-mono text-zinc-400">
                                  {overs(liveCur.bowler.balls)}–{liveCur.bowler.runs}–{liveCur.bowler.wickets}
                                </span>
                              </div>
                            )}
                          </div>

                          {/* This over */}
                          {(liveCur?.thisOver.length ?? 0) > 0 && (
                            <div className="flex items-center gap-1.5">
                              <span className="text-[11px] text-zinc-500">This over</span>
                              {liveCur!.thisOver.map((b, i) => (
                                <span
                                  key={i}
                                  className={`flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-[11px] font-bold ${
                                    b === "W"
                                      ? "bg-red-500/20 text-red-300"
                                      : b === "4" || b === "6"
                                        ? "bg-emerald-500/20 text-emerald-300"
                                        : "bg-zinc-800 text-zinc-300"
                                  }`}
                                >
                                  {b}
                                </span>
                              ))}
                            </div>
                          )}

                          {/* Prompts + pickers */}
                          {needsBatter && (
                            <p className="text-[11px] font-medium text-amber-400">
                              Wicket! Pick the new batter.
                            </p>
                          )}
                          {needsBowler && (
                            <p className="text-[11px] font-medium text-amber-400">
                              Over complete — pick the next bowler.
                            </p>
                          )}
                          {!strikerId && !needsBatter && (
                            <p className="text-[11px] text-amber-400/80">
                              Pick a striker to build the batting card — scoring works either way.
                            </p>
                          )}

                          <div>
                            <p className="mb-1 text-[11px] text-zinc-500">
                              Striker {needsBatter && <span className="text-amber-400">· needed</span>}
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                              {batting.members.map((m) => (
                                <button
                                  key={m.id}
                                  onClick={() => setPickStriker(m.id === strikerId ? "" : m.id)}
                                  className={chip(needsBatter, m.id === strikerId)}
                                >
                                  {m.name}
                                </button>
                              ))}
                            </div>
                          </div>

                          <div>
                            <p className="mb-1 text-[11px] text-zinc-500">Non-striker</p>
                            <div className="flex flex-wrap gap-1.5">
                              {batting.members.map((m) => (
                                <button
                                  key={m.id}
                                  onClick={() => setPickNonStriker(m.id === nonStrikerId ? "" : m.id)}
                                  className={chip(false, m.id === nonStrikerId)}
                                >
                                  {m.name}
                                </button>
                              ))}
                            </div>
                          </div>

                          <div>
                            <p className="mb-1 text-[11px] text-zinc-500">
                              Bowler · {bowling.name}{" "}
                              {needsBowler && <span className="text-amber-400">· needed</span>}
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                              {bowling.members.map((m) => (
                                <button
                                  key={m.id}
                                  onClick={() => setPickBowler(m.id === bowlerId ? "" : m.id)}
                                  className={chip(needsBowler, m.id === bowlerId)}
                                >
                                  {m.name}
                                </button>
                              ))}
                            </div>
                          </div>

                          <div className="flex items-center justify-between">
                            <button
                              onClick={swapStrike}
                              disabled={!nonStrikerId}
                              className="rounded-xl border border-zinc-700 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
                            >
                              ⇄ Swap strike
                            </button>
                            {liveCur && (liveCur.partnership.balls > 0) && (
                              <span className="text-[11px] text-zinc-500">
                                P&apos;ship {liveCur.partnership.runs} ({liveCur.partnership.balls})
                              </span>
                            )}
                          </div>
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
                {/* Who's just scored — football's "who's on strike". */}
                {(() => {
                  const lg = (match.liveState as FootballLive | null)?.current?.lastGoal;
                  if (!lg) return null;
                  const team = lg.teamId === match.homeTeam.id ? match.homeTeam : match.awayTeam;
                  const who = [...match.homeTeam.members, ...match.awayTeam.members].find(
                    (m) => m.id === lg.memberId
                  );
                  return (
                    <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/5 p-3 text-sm">
                      <span className="text-zinc-500">Last goal · </span>
                      <span className="text-emerald-300">{team.name}</span>
                      {who && <span className="text-zinc-300"> — {who.name}</span>}
                    </div>
                  );
                })()}
                <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-3">
                  <label className="mb-1 block text-[11px] text-zinc-500">Goal scorer (optional)</label>
                  <select
                    className="w-full rounded-xl border border-zinc-700 bg-zinc-900 p-2.5 text-sm text-white focus:border-emerald-500/50 focus:outline-none"
                    value={pickStriker}
                    onChange={(e) => setPickStriker(e.target.value)}
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
                        const scorer = team.members.some((m) => m.id === pickStriker) ? pickStriker : "";
                        await send({
                          action: "event",
                          event: { kind: "GOAL", teamId: team.id, memberId: scorer || undefined },
                        });
                        setPickStriker("");
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
