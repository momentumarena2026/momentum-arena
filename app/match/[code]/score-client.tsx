"use client";

import { useCallback, useEffect, useState } from "react";
import { Undo2, Flag, Share2, Radio } from "lucide-react";

type State = {
  innings: number;
  runsA: number;
  runsB: number;
  wicketsA: number;
  wicketsB: number;
  ballsA: number;
  ballsB: number;
};

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
          {/* Scoring pad */}
          <div className="mt-4 grid grid-cols-4 gap-2">
            {cricket
              ? [
                  ...[0, 1, 2, 3, 4, 6].map((n) =>
                    pad(String(n), { action: "score", event: { t: "RUN", runs: n } }),
                  ),
                  pad("Wd", { action: "score", event: { t: "WIDE" } }),
                  pad("Nb", { action: "score", event: { t: "NO_BALL" } }),
                  pad(
                    "Wicket",
                    { action: "score", event: { t: "WICKET" } },
                    "col-span-2 border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20",
                  ),
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
    </div>
  );
}
