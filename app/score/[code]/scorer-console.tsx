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
  tournament: {
    id: string;
    name: string;
    sport: string;
    status: string;
    /** Overs one bowler may bowl in a match; 0 = no limit. */
    maxOversPerBowler?: number;
    /** Overs per side; 0 = unlimited. */
    oversPerInnings?: number;
  };
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
  dismissed: string[];
  spells: { id: string; balls: number }[];
  lastOverBowlerId: string | null;
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
  "flex items-center justify-center text-center leading-none rounded-2xl border text-lg font-bold transition active:scale-95 disabled:opacity-40";

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
  // Player selection is occasional (new batter on a wicket, new bowler each
  // over) — it belongs in a sheet that opens on demand, not in a permanent
  // wall of chips that pushes the run pad off the screen.
  const [picker, setPicker] = useState<"striker" | "nonStriker" | "bowler" | "goal" | null>(null);
  // Add-a-player, inline in the picker. A team that registered without
  // a squad used to dead-end here with "add them from the admin
  // console" — no use to whoever is scoring at the boundary.
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);

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

  // The fold is the authority on who is out there; these locals are only
  // an optimistic echo. When the over ends, the fold clears the bowler —
  // but `bowlerId` above falls back to the local pick, which still held
  // LAST over's bowler. The console therefore believed someone was still
  // bowling, so the prompt never fired and the scorer had to go and tap
  // "change bowler" by hand. Drop the stale echo the moment the server
  // says the seat is empty.
  useEffect(() => {
    if (liveCur?.needsBowler) setPickBowler("");
  }, [liveCur?.needsBowler]);
  useEffect(() => {
    if (liveCur?.needsBatter) {
      setPickStriker("");
      setPickNonStriker("");
    }
  }, [liveCur?.needsBatter]);
  const allPlayers = match ? [...match.homeTeam.members, ...match.awayTeam.members] : [];
  const nameOfPlayer = (id: string | null) => allPlayers.find((p) => p.id === id)?.name || null;
  const creaseFigs = (id: string | null) => liveCur?.batters.find((b) => b.id === id) || null;

  // What the next delivery is still missing. needsBatter/needsBowler only
  // fire AFTER a wicket or a completed over — at the start of an innings
  // both ends are simply empty, which is how runs used to get logged with
  // nobody on strike and nobody bowling. This covers every case.
  const inningsUnderway =
    ((match?.liveState as CricketState | null)?.inning ?? 0) > 0;
  // Innings closed by the overs limit — the server refuses further balls,
  // so the pad shows that rather than letting the tap fail.
  const oversCap = boot?.tournament.oversPerInnings || 0;
  const liveInn = (match?.liveState as CricketState | null)?.innings?.slice(-1)[0];
  const inningsDone = oversCap > 0 && !!liveInn && liveInn.balls >= oversCap * 6;
  const missing: "striker" | "bowler" | null =
    boot?.tournament.sport === "CRICKET" && inningsUnderway && !inningsDone
      ? !strikerId
        ? "striker"
        : !bowlerId
          ? "bowler"
          : null
      : null;

  // Ask for what's needed the moment it's needed, rather than making the
  // scorer hunt for it. Keyed on `missing`, so closing the sheet doesn't
  // immediately reopen it — the pad stays disabled with a hint instead.
  useEffect(() => {
    if (missing) setPicker(missing);
  }, [missing]);

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

  const battingTeam = cs?.battingTeamId === match.awayTeam.id ? match.awayTeam : match.homeTeam;
  const currentInn = cs?.innings?.[cs.innings.length - 1];

  return (
    <div className="min-h-screen bg-zinc-950 pb-24">
      <div className="mx-auto max-w-md">
        {/* ══ PINNED SCOREBOARD — stays put while the controls scroll ══ */}
        <div className="sticky top-0 z-20 mx-3 mt-3 rounded-2xl border border-zinc-800 bg-zinc-900/95 px-4 py-3 shadow-lg shadow-black/40 backdrop-blur">
          <div className="flex items-center justify-between">
            <button onClick={() => setMatchId(null)} className="flex items-center gap-1 text-sm text-zinc-400">
              <ChevronLeft className="h-4 w-4" /> Matches
            </button>
            <span className="truncate text-xs text-zinc-500">{match.roundLabel}</span>
            {match.status === "LIVE" && (
              <span className="flex items-center gap-1 text-xs font-semibold text-red-400">
                <Radio className="h-3 w-3 animate-pulse" /> LIVE
              </span>
            )}
          </div>

          {sport === "CRICKET" ? (
            <div className="mt-2 flex items-baseline justify-between gap-3">
              <span className="truncate text-[15px] font-semibold text-zinc-300">{battingTeam.name}</span>
              <span className="whitespace-nowrap text-3xl font-extrabold leading-none text-emerald-400">
                {currentInn ? `${currentInn.runs}/${currentInn.wickets}` : "0/0"}
                <span className="ml-1.5 text-sm font-medium text-zinc-500">
                  ({currentInn ? overs(currentInn.balls) : "0.0"})
                </span>
              </span>
            </div>
          ) : (
            <div className="mt-2 grid grid-cols-3 items-center">
              <div>
                <div className="truncate text-xs text-zinc-400">{match.homeTeam.name}</div>
                <div className="text-3xl font-extrabold leading-none text-emerald-400">{match.homeScore ?? 0}</div>
              </div>
              <div className="text-center text-zinc-600">
                {sport === "FOOTBALL" ? (
                  <span className={`font-mono text-lg ${match.clockStartedAt ? "text-emerald-400" : "text-zinc-500"}`}>
                    {clockDisplay(match)}
                  </span>
                ) : (
                  "vs"
                )}
              </div>
              <div className="text-right">
                <div className="truncate text-xs text-zinc-400">{match.awayTeam.name}</div>
                <div className="text-3xl font-extrabold leading-none text-emerald-400">{match.awayScore ?? 0}</div>
              </div>
            </div>
          )}

          {sport === "CRICKET" && cs?.target != null && (
            <div className="mt-1 text-xs text-amber-400">
              Target {cs.target} · need {Math.max(0, cs.target - (currentInn?.runs ?? 0))} more
            </div>
          )}
          {sport === "PICKLEBALL" && ps && (
            <div className="mt-1 text-xs text-zinc-400">
              Game {ps.gameNumber ?? 1} · {ps.current.home}–{ps.current.away}
              {ps.servingTeamId && (
                <span className="text-emerald-400">
                  {" "}· serving {ps.servingTeamId === match.homeTeam.id ? match.homeTeam.name : match.awayTeam.name}
                </span>
              )}
            </div>
          )}

          {/* Crease — click a name to change who's out there */}
          {sport === "CRICKET" && cs && cs.inning > 0 && (
            <div className="mt-2 space-y-0.5 border-t border-zinc-800 pt-2 text-sm">
              {[
                { id: strikerId, kind: "striker" as const, onStrike: true },
                { id: nonStrikerId, kind: "nonStriker" as const, onStrike: false },
              ].map((row) => (
                <button
                  key={row.kind}
                  onClick={() => setPicker(row.kind)}
                  className="flex w-full items-baseline justify-between gap-3 rounded px-1 py-0.5 text-left hover:bg-zinc-900"
                >
                  <span className={`truncate ${row.onStrike ? "font-semibold text-white" : "text-zinc-300"}`}>
                    {row.id ? nameOfPlayer(row.id) : row.onStrike ? "Pick striker" : "Pick non-striker"}
                    {row.id && row.onStrike && <span className="ml-1 text-emerald-400">*</span>}
                  </span>
                  <span className="whitespace-nowrap font-mono text-xs text-zinc-400">
                    {row.id ? `${creaseFigs(row.id)?.runs ?? 0} (${creaseFigs(row.id)?.balls ?? 0})` : "—"}
                  </span>
                </button>
              ))}
              <button
                onClick={() => setPicker("bowler")}
                className="flex w-full items-baseline justify-between gap-3 rounded border-t border-zinc-800 px-1 pt-1.5 text-left hover:bg-zinc-900"
              >
                <span className="truncate text-zinc-300">
                  {bowlerId ? nameOfPlayer(bowlerId) : "Pick bowler"}
                </span>
                <span className="whitespace-nowrap font-mono text-xs text-zinc-400">
                  {liveCur?.bowler
                    ? `${overs(liveCur.bowler.balls)}–${liveCur.bowler.runs}–${liveCur.bowler.wickets}`
                    : "—"}
                </span>
              </button>

              <div className="flex items-center justify-between gap-2 pt-1.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  {(liveCur?.thisOver.length ?? 0) === 0 ? (
                    <span className="text-[11px] text-zinc-600">New over</span>
                  ) : (
                    liveCur!.thisOver.map((b, i) => (
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
                    ))
                  )}
                </div>
                <button
                  onClick={swapStrike}
                  disabled={!nonStrikerId}
                  className="shrink-0 text-xs text-zinc-400 hover:text-zinc-200 disabled:opacity-40"
                >
                  ⇄ Swap
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="p-4">
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
                    {inningsDone && (
                      <div className="w-full rounded-xl border border-sky-500/40 bg-sky-600/10 px-4 py-3 text-center text-sm text-sky-300">
                        Innings complete — {oversCap} overs bowled. End the innings.
                      </div>
                    )}
                    {missing && (
                      <button
                        onClick={() => setPicker(missing)}
                        className="w-full rounded-xl border border-amber-500/40 bg-amber-600/10 px-4 py-3 text-sm text-amber-300"
                      >
                        {missing === "striker"
                          ? "Pick the batter on strike to start scoring"
                          : "Pick the bowler to start scoring"}
                      </button>
                    )}
                    <div className="grid grid-cols-4 gap-2">
                      {[0, 1, 2, 3, 4, 6].map((r) => (
                        <button
                          key={r}
                          onClick={() => ball({ runs: r })}
                          disabled={busy || !!missing || inningsDone}
                          className={`${bigBtn} h-16 ${r === 4 || r === 6 ? "border-emerald-500/40 bg-emerald-600/15 text-emerald-300" : "border-zinc-700 bg-zinc-900 text-white"} disabled:opacity-40`}
                        >
                          {r}
                        </button>
                      ))}
                      <button
                        onClick={() => ball({ runs: 0, wicket: true })}
                        disabled={busy || !!missing || inningsDone}
                        className={`${bigBtn} h-16 border-red-500/40 bg-red-600/15 text-red-300 disabled:opacity-40`}
                      >
                        W
                      </button>
                      <button
                        onClick={() => ball({ runs: 1, extra: "wd" })}
                        disabled={busy || !!missing || inningsDone}
                        className={`${bigBtn} h-16 border-amber-500/40 bg-amber-600/15 text-sm text-amber-300 disabled:opacity-40`}
                      >
                        Wd
                      </button>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <button onClick={() => ball({ runs: 1, extra: "nb" })} disabled={busy || !!missing || inningsDone} className={`${bigBtn} h-12 border-amber-500/40 bg-amber-600/10 text-sm text-amber-300 disabled:opacity-40`}>
                        No Ball +1
                      </button>
                      <button onClick={() => ball({ runs: 1, extra: "b" })} disabled={busy || !!missing || inningsDone} className={`${bigBtn} h-12 border-zinc-700 bg-zinc-900 text-sm text-zinc-300 disabled:opacity-40`}>
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

      {/* ══ Player sheet — opens itself when a batter/bowler is needed ══ */}
      {picker && (
        <div
          className="fixed inset-0 z-40 flex items-end justify-center bg-black/60"
          onClick={() => setPicker(null)}
        >
          <div
            className="max-h-[75vh] w-full max-w-md overflow-hidden rounded-t-3xl border-t border-zinc-800 bg-zinc-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-zinc-800 p-4">
              <h3 className="font-semibold text-white">
                {picker === "striker"
                  ? needsBatter
                    ? "Wicket — who's in?"
                    : "Striker"
                  : picker === "nonStriker"
                    ? "Non-striker"
                    : picker === "bowler"
                      ? needsBowler
                        ? "Over complete — next bowler"
                        : "Bowler"
                      : "Goal scorer"}
              </h3>
              <button onClick={() => setPicker(null)} className="text-zinc-400 hover:text-white">
                ✕
              </button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto">
              {(() => {
                const batting =
                  cs?.battingTeamId === match.awayTeam.id ? match.awayTeam : match.homeTeam;
                const bowling = batting.id === match.homeTeam.id ? match.awayTeam : match.homeTeam;
                const list =
                  picker === "bowler" ? bowling.members : picker === "goal" ? allPlayers : batting.members;
                const selected =
                  picker === "striker"
                    ? strikerId
                    : picker === "nonStriker"
                      ? nonStrikerId
                      : picker === "bowler"
                        ? bowlerId
                        : pickStriker;
                const apply = (id: string) => {
                  if (picker === "striker") setPickStriker(id);
                  else if (picker === "nonStriker") setPickNonStriker(id);
                  else if (picker === "bowler") setPickBowler(id);
                  else setPickStriker(id);
                  // Tell the server who is standing where. Without this the
                  // pair would live only in this component and the fold
                  // could never rotate them on its own — which is exactly
                  // why strike used to stay put through a single. The
                  // bowler needs no event: it rides along on each BALL.
                  if (picker === "striker" || picker === "nonStriker") {
                    void ev("CREASE", {
                      data:
                        picker === "striker"
                          ? { strikerId: id }
                          : { nonStrikerId: id },
                    });
                  }
                  setPicker(null);
                };
                if (list.length === 0) {
                  return (
                    <p className="px-5 pb-1 pt-5 text-sm text-zinc-500">
                      No squad entered for this team — add players as they come in.
                    </p>
                  );
                }
                // Mirror of the server's rules (lib/tournament-live
                // validateLiveEvent) so the scorer sees them before tapping:
                // a dismissed batter can't come back in, and a bowler can
                // neither exceed the quota nor bowl two overs in a row.
                const maxOvers = boot.tournament.maxOversPerBowler || 0;
                const startingOver = (liveCur?.thisOver.length ?? 0) === 0;
                const blockedFor = (id: string): string | null => {
                  if (picker === "striker" || picker === "nonStriker") {
                    return liveCur?.dismissed.includes(id) ? "out" : null;
                  }
                  if (picker === "bowler") {
                    if (startingOver && liveCur?.lastOverBowlerId === id) return "bowled last over";
                    if (maxOvers > 0) {
                      const balls = liveCur?.spells.find((sp) => sp.id === id)?.balls ?? 0;
                      if (balls >= maxOvers * 6) return `${maxOvers} ov bowled`;
                    }
                  }
                  return null;
                };
                return list.map((m) => {
                  const blocked = blockedFor(m.id);
                  const spellBalls = liveCur?.spells.find((sp) => sp.id === m.id)?.balls ?? 0;
                  return (
                    <button
                      key={m.id}
                      onClick={() => !blocked && apply(m.id)}
                      disabled={!!blocked}
                      className={`flex w-full items-center justify-between border-b border-zinc-800/60 px-5 py-4 text-left ${
                        blocked
                          ? "cursor-not-allowed opacity-40"
                          : m.id === selected
                            ? "bg-emerald-500/10"
                            : "hover:bg-zinc-800/60"
                      }`}
                    >
                      <span className={m.id === selected && !blocked ? "font-semibold text-emerald-400" : "text-zinc-200"}>
                        {m.name}
                      </span>
                      {blocked ? (
                        <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-400">
                          {blocked}
                        </span>
                      ) : picker === "bowler" ? (
                        <span className="font-mono text-xs text-zinc-400">
                          {Math.floor(spellBalls / 6)}.{spellBalls % 6} ov
                          {maxOvers > 0 && <span className="text-zinc-600"> / {maxOvers}</span>}
                        </span>
                      ) : (
                        creaseFigs(m.id) && (
                          <span className="font-mono text-xs text-zinc-400">
                            {creaseFigs(m.id)!.runs} ({creaseFigs(m.id)!.balls})
                          </span>
                        )
                      )}
                    </button>
                  );
                });
              })()}
              {/* Always available, not only when the squad is empty: a
                  substitute arrives, or a name is spelled differently on
                  the day, and neither should send the scorer to a laptop
                  in the middle of an over. */}
              {picker !== "goal" && (
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const name = newName.trim();
                    const batting =
                      cs?.battingTeamId === match.awayTeam.id ? match.awayTeam : match.homeTeam;
                    const bowling =
                      batting.id === match.homeTeam.id ? match.awayTeam : match.homeTeam;
                    const team = picker === "bowler" ? bowling : batting;
                    if (!name || adding) return;
                    setAdding(true);
                    try {
                      const res = await fetch(
                        `/api/tournaments/scorer/${encodeURIComponent(code)}/player`,
                        {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ teamId: team.id, name }),
                        },
                      );
                      const data = await res.json();
                      if (!res.ok || !data.member) {
                        setError(data.error || "Couldn't add that player");
                        return;
                      }
                      setNewName("");
                      // Refetch so the new name appears in the list with
                      // everyone else rather than being spliced in locally
                      // and drifting from the server's ordering.
                      await refresh();
                    } finally {
                      setAdding(false);
                    }
                  }}
                  className="flex items-center gap-2 border-t border-zinc-800 px-5 py-4"
                >
                  <input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="Add a player…"
                    disabled={adding}
                    className="flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white placeholder-zinc-600"
                  />
                  <button
                    type="submit"
                    disabled={adding || !newName.trim()}
                    className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-400 disabled:opacity-40"
                  >
                    {adding ? "Adding…" : "Add"}
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
