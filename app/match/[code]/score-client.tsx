"use client";

import { EXTRA_RUN_OPTIONS, type WicketKind } from "@/lib/cricket-rules";
import type { PublicMatchState, ScoreEvent } from "@/lib/public-match";

import { useCallback, useEffect, useState } from "react";
import { Undo2, Flag, Share2, Radio } from "lucide-react";

/** The board the API already sends — the page used to declare a trimmed
 *  copy of it, which is why none of the crease was reachable here. */
type State = PublicMatchState;

type Match = {
  code: string;
  sport: "CRICKET" | "FOOTBALL" | "PICKLEBALL";
  status: string;
  teamAName: string;
  teamBName: string;
  oversPerInnings: number | null;
  state: State;
  canScore: boolean;
};

const WICKET_KINDS: { k: WicketKind; label: string }[] = [
  { k: "BOWLED", label: "Bowled" },
  { k: "CAUGHT", label: "Caught" },
  { k: "LBW", label: "LBW" },
  { k: "RUN_OUT", label: "Run out" },
  { k: "STUMPED", label: "Stumped" },
  { k: "HIT_WICKET", label: "Hit wicket" },
  { k: "OBSTRUCTING_FIELD", label: "Obstructing the field" },
  { k: "HIT_BALL_TWICE", label: "Hit the ball twice" },
  { k: "TIMED_OUT", label: "Timed out" },
  { k: "OTHER", label: "Other" },
];

const overs = (balls: number) => `${Math.floor(balls / 6)}.${balls % 6}`;

/**
 * The scoreboard. The same page serves the scorer and the spectators —
 * `canScore` decides whether the pad renders, so a shared code is safe
 * to hand around.
 *
 * Spectators poll; the scorer doesn't (their own taps are the source of
 * truth, and refetching under their thumb would fight the optimistic UI).
 */
export function MatchScoreClient({ initial }: { initial: Match }) {
  const [match, setMatch] = useState<Match>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  /** One generic chooser, the way the app scorer does it — a title and a
   *  list. Every multi-step flow below is a chain of these. */
  const [pick, setPick] = useState<
    { title: string; hint?: string; options: { label: string; meta?: string; onPick: () => void }[] } | null
  >(null);
  /** Free-text roster entry, because a casual side has no roster anywhere. */
  const [squadDraft, setSquadDraft] = useState("");
  const [squadFor, setSquadFor] = useState<"A" | "B" | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/match?code=${match.code}`, { cache: "no-store" });
      const data = await res.json();
      if (res.ok && data.match) setMatch(data.match);
    } catch {
      /* transient — the next tick retries */
    }
  }, [match.code]);

  useEffect(() => {
    if (match.canScore || match.status !== "LIVE") return;
    const id = setInterval(refresh, 8000);
    return () => clearInterval(id);
  }, [match.canScore, match.status, refresh]);

  const send = async (body: Record<string, unknown>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: match.code, ...body }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't update the score");
      if (data.state) setMatch((m) => ({ ...m, state: data.state }));
      else await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  const s = match.state;
  const push = (event: ScoreEvent) => send({ action: "score", event });

  // Who is batting, and therefore which roster the next batter comes from.
  const batting = s.innings === 0 ? s.squadA : s.squadB;
  const bowling = s.innings === 0 ? s.squadB : s.squadA;
  const battingSide: "A" | "B" = s.innings === 0 ? "A" : "B";
  /** Not at the crease and not out — a batter who retired HURT is
   *  included, since that was never a dismissal. */
  const availableBatters = batting.filter((n) => {
    if (n === s.striker || n === s.nonStriker) return false;
    const mark = s.batting[n]?.out;
    return !mark || mark === "RETIRED_HURT";
  });

  /** Ask who walks in, then log the wicket. */
  const askNewBatter = (extra: Partial<Extract<ScoreEvent, { t: "WICKET" }>>) => {
    if (availableBatters.length === 0) {
      push({ t: "WICKET", ...extra });
      setPick(null);
      return;
    }
    setPick({
      title: "Next batter in",
      options: availableBatters.map((n) => ({
        label: n,
        onPick: () => {
          push({ t: "WICKET", newBatter: n, ...extra });
          setPick(null);
        },
      })),
    });
  };

  /**
   * A run out, in full. Everything else is one tap, because the batter is
   * the striker, dismissed at their own end, off a ball that scored
   * nothing. A run out is none of those things by default.
   */
  const askRunOut = (delivery: "WIDE" | "NO_BALL" | null) => {
    if (!s.striker || !s.nonStriker) return;
    const onExtra = delivery !== null;
    const combos = [
      { batter: s.striker, end: "STRIKER" as const },
      { batter: s.striker, end: "NON_STRIKER" as const },
      { batter: s.nonStriker, end: "NON_STRIKER" as const },
      { batter: s.nonStriker, end: "STRIKER" as const },
    ];
    setPick({
      title: "Run out — who, and at which end?",
      hint: "A striker run out at the non-striker's end has crossed, so the other batter keeps strike.",
      options: combos.map((c) => ({
        label: `${c.batter} — out at the ${c.end === "STRIKER" ? "striker's" : "non-striker's"} end`,
        meta: c.end === "STRIKER" ? "batting end" : "bowler's end",
        onPick: () => {
          const askRuns = () =>
            setPick({
              title:
                delivery === "WIDE"
                  ? "Runs they ran, besides the wide"
                  : delivery === "NO_BALL"
                    ? "Runs off the bat before the run out"
                    : "Runs completed before the run out",
              options: [0, 1, 2, 3].map((n) => ({
                label: n === 0 ? "None" : `${n} run${n > 1 ? "s" : ""}`,
                onPick: () =>
                  askNewBatter({
                    kind: "RUN_OUT",
                    batter: c.batter,
                    outAtEnd: c.end,
                    ...(delivery ? { delivery } : {}),
                    ...(n > 0 ? { runs: n } : {}),
                  }),
              })),
            });
          // Only the non-striker at their own end can be Mankaded, and a
          // Mankad is no delivery, so it cannot be a wide or a no-ball.
          if (onExtra || c.batter !== s.nonStriker || c.end !== "NON_STRIKER") {
            askRuns();
            return;
          }
          setPick({
            title: "Had the bowler delivered the ball?",
            options: [
              { label: "Yes — run out going for a run", onPick: askRuns },
              {
                label: "No — backing up, before the delivery",
                meta: "costs no ball",
                onPick: () =>
                  askNewBatter({
                    kind: "RUN_OUT",
                    batter: c.batter,
                    outAtEnd: c.end,
                    beforeDelivery: true,
                  }),
              },
            ],
          });
        },
      })),
    });
  };

  /** A retirement, then who comes in. No ball is bowled either way. */
  const askRetire = (out: boolean) => {
    const who = [s.striker, s.nonStriker].filter((x): x is string => !!x);
    setPick({
      title: "Which batter?",
      options: who.map((n) => ({
        label: n,
        meta: n === s.striker ? "on strike" : "non-striker",
        onPick: () => {
          if (availableBatters.length === 0) {
            push({ t: "RETIRE", batter: n, ...(out ? { out } : {}) });
            setPick(null);
            return;
          }
          setPick({
            title: "Who comes in?",
            options: availableBatters.map((m2) => ({
              label: m2,
              onPick: () => {
                push({ t: "RETIRE", batter: n, newBatter: m2, ...(out ? { out } : {}) });
                setPick(null);
              },
            })),
          });
        },
      })),
    });
  };

  const askWicket = () =>
    setPick({
      title: "How was the wicket?",
      options: WICKET_KINDS.map((w) => ({
        label: w.label,
        onPick: () => {
          if (w.k !== "RUN_OUT" || !s.striker || !s.nonStriker) {
            askNewBatter({ kind: w.k });
            return;
          }
          setPick({
            title: "What was the delivery?",
            options: [
              { label: "Legal ball", onPick: () => askRunOut(null) },
              { label: "Wide", onPick: () => askRunOut("WIDE") },
              { label: "No-ball", onPick: () => askRunOut("NO_BALL") },
            ],
          });
        },
      })),
    });
  const cricket = match.sport === "CRICKET";
  const batA = s.innings === 0;
  const done = match.status !== "LIVE";

  const pad = (label: string, body: Record<string, unknown>, tone?: string) => (
    <button
      key={label}
      onClick={() => send(body)}
      disabled={busy || done}
      className={`rounded-xl border py-4 text-lg font-bold transition-colors disabled:opacity-40 ${
        tone ??
        "border-zinc-700 bg-zinc-900 text-white hover:border-emerald-500/50 hover:bg-zinc-800"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="mx-auto max-w-lg px-4 py-8">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-emerald-400">
          {match.status === "LIVE" ? (
            <>
              <Radio className="h-3.5 w-3.5" /> Live
            </>
          ) : (
            match.status
          )}
        </span>
        <button
          onClick={() => {
            void navigator.clipboard?.writeText(
              `${window.location.origin}/match/${match.code}`,
            );
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
        >
          <Share2 className="h-3.5 w-3.5" />
          {copied ? "Copied" : match.code}
        </button>
      </div>

      {/* Scoreboard */}
      <div className="mt-4 rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
        {[
          {
            name: match.teamAName,
            runs: s.runsA,
            wkts: s.wicketsA,
            balls: s.ballsA,
            striking: cricket && batA,
          },
          {
            name: match.teamBName,
            runs: s.runsB,
            wkts: s.wicketsB,
            balls: s.ballsB,
            striking: cricket && !batA,
          },
        ].map((t) => (
          <div
            key={t.name}
            className={`flex items-baseline justify-between border-zinc-800 py-3 ${
              t.striking ? "" : "opacity-70"
            }`}
          >
            <span className="min-w-0 truncate text-base font-medium text-white">
              {t.name}
              {t.striking && (
                <span className="ml-2 text-[10px] uppercase tracking-wider text-emerald-400">
                  batting
                </span>
              )}
            </span>
            <span className="shrink-0 text-2xl font-bold text-white">
              {cricket ? `${t.runs}/${t.wkts}` : t.runs}
              {cricket && (
                <span className="ml-2 text-sm font-normal text-zinc-500">
                  ({overs(t.balls)}
                  {match.oversPerInnings ? `/${match.oversPerInnings}` : ""})
                </span>
              )}
            </span>
          </div>
        ))}
      </div>

      {error && (
        <p className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      {!match.canScore ? (
        <p className="mt-4 text-center text-sm text-zinc-500">
          Watching live — the scorer updates this from their phone.
        </p>
      ) : done ? (
        <p className="mt-4 text-center text-sm text-zinc-500">
          This match has finished.
        </p>
      ) : (
        <>
          {/* ── Setup ────────────────────────────────────────────────
              None of this existed, and the engine refuses every ball
              without it — "Set the openers before scoring a ball". So the
              cricket half of this page could not score a single delivery.
              Rosters first, then the pair, then the bowler. */}
          {cricket && batting.length === 0 && (
            <div className="mt-4 rounded-xl border border-amber-500/40 bg-amber-500/5 p-4">
              <p className="text-sm font-semibold text-amber-300">
                Add the batting side&apos;s players to start
              </p>
              <p className="mt-1 text-xs text-zinc-400">
                One name per line. You can add more later — a latecomer is normal.
              </p>
              <button
                onClick={() => {
                  setSquadFor(battingSide);
                  setSquadDraft(batting.join("\n"));
                }}
                className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm font-semibold text-amber-300"
              >
                Add players
              </button>
            </div>
          )}

          {cricket && batting.length > 0 && !s.striker && (
            <button
              onClick={() =>
                setPick({
                  title: "Who's on strike?",
                  options: batting.map((n) => ({
                    label: n,
                    onPick: () =>
                      setPick({
                        title: "Non-striker",
                        options: batting
                          .filter((x) => x !== n)
                          .map((m2) => ({
                            label: m2,
                            onPick: () =>
                              setPick({
                                title: "Opening bowler",
                                options: (bowling.length ? bowling : ["Bowler"]).map((b) => ({
                                  label: b,
                                  onPick: () => {
                                    push({ t: "OPEN", striker: n, nonStriker: m2, bowler: b });
                                    setPick(null);
                                  },
                                })),
                              }),
                          })),
                      }),
                  })),
                })
              }
              className="mt-4 w-full rounded-xl border border-emerald-500/40 bg-emerald-600/10 py-3 text-sm font-semibold text-emerald-300"
            >
              Set the openers
            </button>
          )}

          {cricket && s.striker && !s.bowler && (
            <button
              onClick={() =>
                setPick({
                  title: "Who's bowling this over?",
                  options: (bowling.length ? bowling : ["Bowler"]).map((b) => ({
                    label: b,
                    meta: s.lastOverBowler === b ? "bowled the last over" : undefined,
                    onPick: () => {
                      push({ t: "BOWLER", name: b });
                      setPick(null);
                    },
                  })),
                })
              }
              className="mt-4 w-full rounded-xl border border-sky-500/40 bg-sky-600/10 py-3 text-sm font-semibold text-sky-300"
            >
              Pick the bowler for this over
            </button>
          )}

          {/* ── The crease ───────────────────────────────────────────── */}
          {cricket && s.striker && (
            <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 text-sm">
              <div className="flex justify-between text-zinc-300">
                <span>
                  {s.striker} <span className="text-emerald-400">*</span>
                </span>
                <span className="font-mono text-xs text-zinc-400">
                  {s.batting[s.striker]?.runs ?? 0} ({s.batting[s.striker]?.balls ?? 0})
                </span>
              </div>
              {s.nonStriker && (
                <div className="mt-1 flex justify-between text-zinc-400">
                  <span>{s.nonStriker}</span>
                  <span className="font-mono text-xs text-zinc-500">
                    {s.batting[s.nonStriker]?.runs ?? 0} ({s.batting[s.nonStriker]?.balls ?? 0})
                  </span>
                </div>
              )}
              {s.bowler && (
                <div className="mt-2 flex justify-between border-t border-zinc-800 pt-2 text-zinc-400">
                  <span>{s.bowler}</span>
                  <span className="font-mono text-xs text-zinc-500">
                    {overs(s.bowling[s.bowler]?.balls ?? 0)}–{s.bowling[s.bowler]?.runs ?? 0}–
                    {s.bowling[s.bowler]?.wickets ?? 0}
                  </span>
                </div>
              )}
              {s.thisOver.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5 border-t border-zinc-800 pt-2">
                  {s.thisOver.map((b, i) => (
                    <span
                      key={`${b}-${i}`}
                      className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[11px] text-zinc-300"
                    >
                      {b}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* A free hit the scorer can't see is one they will score wrong,
              and the error is silent — the bowler takes a wicket the batter
              was protected from. */}
          {cricket && s.freeHit && (
            <div className="mt-3 rounded-lg border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-xs font-bold tracking-wide text-amber-300">
              FREE HIT — only a run out, obstructing the field or hitting the ball twice
            </div>
          )}

          {/* Scoring pad */}
          <div className="mt-4 grid grid-cols-4 gap-2">
            {cricket
              ? [
                  ...[0, 1, 2, 3, 4, 6].map((n) =>
                    pad(String(n), { action: "score", event: { t: "RUN", runs: n } }),
                  ),
                  <button
                    key="wicket"
                    onClick={askWicket}
                    disabled={busy || done || !s.striker}
                    className="col-span-2 rounded-xl border border-red-500/40 bg-red-500/10 py-4 text-lg font-bold text-red-300 transition-colors hover:bg-red-500/20 disabled:opacity-40"
                  >
                    Wicket
                  </button>,
                  pad(
                    batA ? "End innings" : "—",
                    { action: "score", event: { t: "END_INNINGS" } },
                    "col-span-2 border-zinc-700 bg-zinc-900 text-sm text-zinc-300 hover:bg-zinc-800",
                  ),
                ]
              : [
                  pad(
                    `+1 ${match.teamAName}`,
                    { action: "score", event: { t: "POINT", side: "A" } },
                    "col-span-2 border-emerald-500/40 bg-emerald-500/10 text-base text-emerald-300 hover:bg-emerald-500/20",
                  ),
                  pad(
                    `+1 ${match.teamBName}`,
                    { action: "score", event: { t: "POINT", side: "B" } },
                    "col-span-2 border-sky-500/40 bg-sky-500/10 text-base text-sky-300 hover:bg-sky-500/20",
                  ),
                ]}
          </div>

          {cricket && (
            <div className="mt-3 space-y-1.5">
              {EXTRA_RUN_OPTIONS.map((row) => (
                <div key={row.kind} className="flex items-center gap-2">
                  <span className="w-16 shrink-0 text-[11px] uppercase tracking-wide text-zinc-500">
                    {row.label}
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {row.options.map((opt) => (
                      <button
                        key={opt.text}
                        onClick={() =>
                          send({
                            action: "score",
                            event: { t: row.kind, runs: opt.ran },
                          })
                        }
                        disabled={busy || done}
                        className={`min-w-11 rounded-lg border px-3 py-1.5 text-sm font-semibold transition-colors disabled:opacity-40 ${
                          row.kind === "WIDE" || row.kind === "NO_BALL"
                            ? "border-amber-500/40 bg-amber-500/5 text-amber-300 hover:bg-amber-500/15"
                            : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
                        }`}
                      >
                        {opt.text}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              <div className="flex items-center gap-2">
                <span className="w-16 shrink-0 text-[11px] uppercase tracking-wide text-zinc-500">
                  Nb + byes
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {[1, 2, 3, 4].map((n) => (
                    <button
                      key={n}
                      onClick={() =>
                        send({ action: "score", event: { t: "NO_BALL", byes: n } })
                      }
                      disabled={busy || done}
                      className="min-w-11 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-1.5 text-sm font-semibold text-amber-300 transition-colors hover:bg-amber-500/15 disabled:opacity-40"
                    >
                      {`+${n}b`}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* The rest of what the app scorer can do, and this could not. */}
          {cricket && s.striker && (
            <div className="mt-3 grid grid-cols-3 gap-2">
              <button
                onClick={() => push({ t: "SWAP" })}
                disabled={busy || done}
                className="rounded-lg border border-zinc-700 bg-zinc-900 py-2.5 text-xs font-semibold text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
              >
                Swap ends
              </button>
              <button
                onClick={() =>
                  setPick({
                    title: "Retiring how?",
                    hint: "Hurt is not a dismissal — the batter keeps their runs and may resume.",
                    options: [
                      { label: "Hurt", meta: "can come back", onPick: () => askRetire(false) },
                      { label: "Out", meta: "counts as a wicket", onPick: () => askRetire(true) },
                    ],
                  })
                }
                disabled={busy || done}
                className="rounded-lg border border-zinc-700 bg-zinc-900 py-2.5 text-xs font-semibold text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
              >
                Retire
              </button>
              <button
                onClick={() =>
                  setPick({
                    title: "Five penalty runs to…",
                    hint: "Law 41. They belong to neither bat nor bowler and cost nobody a ball.",
                    options: (["A", "B"] as const).map((side) => ({
                      label: side === "A" ? match.teamAName : match.teamBName,
                      onPick: () => {
                        push({ t: "PENALTY", side, runs: 5 });
                        setPick(null);
                      },
                    })),
                  })
                }
                disabled={busy || done}
                className="rounded-lg border border-zinc-700 bg-zinc-900 py-2.5 text-xs font-semibold text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
              >
                Penalty 5
              </button>
              <button
                onClick={() => {
                  setSquadFor(battingSide);
                  setSquadDraft(batting.join("\n"));
                }}
                disabled={busy || done}
                className="col-span-3 rounded-lg border border-zinc-800 py-2 text-[11px] text-zinc-500 hover:text-zinc-300 disabled:opacity-40"
              >
                Edit players
              </button>
            </div>
          )}

          <div className="mt-3 flex gap-2">
            <button
              onClick={() => send({ action: "undo" })}
              disabled={busy}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-zinc-700 py-2.5 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
            >
              <Undo2 className="h-4 w-4" /> Undo
            </button>
            <button
              onClick={() => {
                if (confirm("End this match?")) void send({ action: "finish" });
              }}
              disabled={busy}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-zinc-700 py-2.5 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
            >
              <Flag className="h-4 w-4" /> End match
            </button>
          </div>
        </>
      )}

      {/* ── One chooser for every multi-step flow ────────────────────
          The app scorer works the same way: a title and a list, chained.
          Anything more elaborate is a thing a scorer has to learn while a
          bowler is running in. */}
      {pick && (
        <div
          className="fixed inset-0 z-50 flex items-end bg-black/70"
          onClick={() => setPick(null)}
        >
          <div
            className="max-h-[80vh] w-full overflow-y-auto rounded-t-3xl border-t border-zinc-800 bg-zinc-950 pb-8"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 border-b border-zinc-800 bg-zinc-950 px-5 py-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-semibold text-white">{pick.title}</h3>
                <button onClick={() => setPick(null)} className="text-zinc-400 hover:text-white">
                  Close
                </button>
              </div>
              {pick.hint && <p className="mt-1 text-xs text-zinc-500">{pick.hint}</p>}
            </div>
            {pick.options.map((o) => (
              <button
                key={o.label}
                onClick={o.onPick}
                className="flex w-full items-center justify-between gap-3 border-b border-zinc-800/60 px-5 py-4 text-left text-zinc-200 hover:bg-zinc-800/60"
              >
                <span>{o.label}</span>
                {o.meta && <span className="shrink-0 text-xs text-zinc-500">{o.meta}</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Who is playing ───────────────────────────────────────────
          A casual side has no roster anywhere, so it is typed here.
          Editable mid-match on purpose: somebody always turns up late. */}
      {squadFor && (
        <div
          className="fixed inset-0 z-50 flex items-end bg-black/70"
          onClick={() => setSquadFor(null)}
        >
          <div
            className="w-full rounded-t-3xl border-t border-zinc-800 bg-zinc-950 p-5 pb-8"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-white">
                {squadFor === "A" ? match.teamAName : match.teamBName} players
              </h3>
              <button onClick={() => setSquadFor(null)} className="text-zinc-400 hover:text-white">
                Close
              </button>
            </div>
            <p className="mt-1 text-xs text-zinc-500">One name per line.</p>
            <textarea
              value={squadDraft}
              onChange={(e) => setSquadDraft(e.target.value)}
              rows={8}
              className="mt-3 w-full rounded-xl border border-zinc-700 bg-zinc-900 p-3 text-sm text-white outline-none focus:border-emerald-500/50"
              placeholder={"Rahul\nPriya\nAman"}
            />
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => {
                  const players = squadDraft
                    .split("\n")
                    .map((n) => n.trim())
                    .filter(Boolean);
                  push({ t: "SQUAD", side: squadFor, players });
                  setSquadFor(null);
                }}
                disabled={busy}
                className="flex-1 rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                Save players
              </button>
              <button
                onClick={() => {
                  const other = squadFor === "A" ? "B" : "A";
                  setSquadFor(other);
                  setSquadDraft((other === "A" ? s.squadA : s.squadB).join("\n"));
                }}
                className="rounded-xl border border-zinc-700 px-4 text-sm text-zinc-300 hover:bg-zinc-800"
              >
                Other side
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
