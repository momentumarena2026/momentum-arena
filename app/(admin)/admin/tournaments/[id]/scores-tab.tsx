"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ClipboardEdit, RotateCcw, Award } from "lucide-react";
import {
  enterMatchResult,
  reopenMatch,
  getMatchRosters,
} from "@/actions/admin-tournament-scores";
import type { MatchRow } from "./fixtures-tab";

type Roster = {
  homeTeam: { id: string; name: string; members: { id: string; name: string }[] } | null;
  awayTeam: { id: string; name: string; members: { id: string; name: string }[] } | null;
};

const inputCls =
  "rounded-lg border border-zinc-700 bg-zinc-800 p-2 text-sm text-white placeholder-zinc-500 focus:border-emerald-500/50 focus:outline-none";

export function ScoresTab({
  tournamentId,
  matches,
  statFields,
}: {
  tournamentId: string;
  matches: MatchRow[];
  statFields: { key: string; label: string }[];
}) {
  const router = useRouter();
  const [openFor, setOpenFor] = useState<string | null>(null);
  const [roster, setRoster] = useState<Roster | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    homeScore: "",
    awayScore: "",
    homeScoreNote: "",
    awayScoreNote: "",
    isDraw: false,
    winnerTeamId: "",
    resultNote: "",
    playerOfMatchId: "",
  });
  // statValues["memberId:statKey"] = value string
  const [statValues, setStatValues] = useState<Record<string, string>>({});

  void tournamentId;

  const ready = matches.filter(
    (m) => m.homeTeam && m.awayTeam && (m.status === "SCHEDULED" || m.status === "LIVE")
  );
  const completed = matches.filter((m) => m.status === "COMPLETED" || m.status === "WALKOVER");

  const openEntry = async (m: MatchRow) => {
    if (openFor === m.id) {
      setOpenFor(null);
      return;
    }
    setOpenFor(m.id);
    setError(null);
    // Seed from whatever live scoring already recorded. applyLiveEvent
    // keeps homeScore/awayScore current ball by ball, so a match that was
    // scored on the console arrives here filled in and the admin only has
    // to confirm it. A match nobody scored has nulls and stays blank for
    // manual entry — the form is deliberately not cleared to "0", which
    // would look like a recorded goalless result.
    setForm({
      homeScore: m.homeScore != null ? String(m.homeScore) : "",
      awayScore: m.awayScore != null ? String(m.awayScore) : "",
      homeScoreNote: m.homeScoreNote ?? "",
      awayScoreNote: m.awayScoreNote ?? "",
      isDraw: m.homeScore != null && m.homeScore === m.awayScore,
      winnerTeamId: "",
      resultNote: "",
      playerOfMatchId: "",
    });
    setStatValues({});
    setRoster(null);
    const r = await getMatchRosters(m.id);
    setRoster((r as Roster) || null);
  };

  const submit = async (m: MatchRow) => {
    setBusy(m.id);
    setError(null);
    try {
      const playerStats = Object.entries(statValues)
        .map(([key, raw]) => {
          const [memberId, statKey] = key.split(":");
          const value = parseInt(raw, 10);
          if (!value && value !== 0) return null;
          if (isNaN(value) || value <= 0) return null;
          const teamId = roster?.homeTeam?.members.some((x) => x.id === memberId)
            ? roster.homeTeam.id
            : roster?.awayTeam?.id;
          if (!teamId) return null;
          return { memberId, teamId, statKey, value };
        })
        .filter(Boolean) as { memberId: string; teamId: string; statKey: string; value: number }[];

      const res = await enterMatchResult(m.id, {
        homeScore: parseInt(form.homeScore, 10) || 0,
        awayScore: parseInt(form.awayScore, 10) || 0,
        homeScoreNote: form.homeScoreNote || undefined,
        awayScoreNote: form.awayScoreNote || undefined,
        isDraw: form.isDraw,
        winnerTeamId: form.winnerTeamId || undefined,
        resultNote: form.resultNote || undefined,
        playerOfMatchId: form.playerOfMatchId || undefined,
        playerStats,
      });
      if (!res.success) {
        setError(res.error || "Failed");
        return;
      }
      setOpenFor(null);
      router.refresh();
    } finally {
      setBusy(null);
    }
  };

  const reopen = async (m: MatchRow) => {
    setBusy(m.id);
    setError(null);
    try {
      const res = await reopenMatch(m.id);
      if (!res.success) setError(res.error || "Failed");
      else router.refresh();
    } finally {
      setBusy(null);
    }
  };

  const tied = form.homeScore !== "" && form.homeScore === form.awayScore;
  const isRR = (m: MatchRow) => m.stage === "POOL" || m.stage === "LEAGUE";

  const statGrid = (team: NonNullable<Roster["homeTeam"]>) => (
    <div className="min-w-0 flex-1">
      <div className="mb-1.5 text-xs font-medium text-zinc-300">{team.name}</div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-zinc-500">
              <th className="pb-1 pr-2 text-left font-normal">Player</th>
              {statFields.map((sf) => (
                <th key={sf.key} className="pb-1 pr-2 text-left font-normal">{sf.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {team.members.map((mem) => (
              <tr key={mem.id}>
                <td className="py-0.5 pr-2 text-zinc-300">{mem.name}</td>
                {statFields.map((sf) => (
                  <td key={sf.key} className="py-0.5 pr-2">
                    <input
                      className="w-14 rounded border border-zinc-700 bg-zinc-800 p-1 text-xs text-white"
                      inputMode="numeric"
                      placeholder="0"
                      value={statValues[`${mem.id}:${sf.key}`] || ""}
                      onChange={(e) =>
                        setStatValues((s) => ({ ...s, [`${mem.id}:${sf.key}`]: e.target.value }))
                      }
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <div className="space-y-5">
      {error && <p className="text-sm text-red-400">{error}</p>}

      <h4 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">
        Awaiting result ({ready.length})
      </h4>
      {ready.length === 0 && (
        <p className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 text-sm text-zinc-500">
          Nothing to score right now — matches appear here once both teams are decided.
        </p>
      )}
      <div className="space-y-2">
        {ready.map((m) => (
          <div key={m.id} className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs text-zinc-500">{m.roundLabel}</div>
                <div className="mt-0.5 text-sm text-zinc-100">
                  {m.homeTeam?.name} <span className="text-zinc-600">vs</span> {m.awayTeam?.name}
                </div>
                {/* A match already scored on the console shows its score
                    here, so an admin can tell at a glance which rows need
                    typing and which only need confirming. */}
                {m.homeScore != null && (
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                    <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 font-medium text-emerald-400">
                      Live scored
                    </span>
                    <span className="text-zinc-400">
                      {m.homeScoreNote || m.homeScore}
                      <span className="text-zinc-600"> — </span>
                      {m.awayScoreNote || m.awayScore}
                    </span>
                  </div>
                )}
              </div>
              <button
                onClick={() => openEntry(m)}
                className="flex items-center gap-1.5 rounded-lg border border-emerald-500/30 px-3 py-2 text-xs font-medium text-emerald-400 hover:bg-emerald-600/10"
              >
                <ClipboardEdit className="h-3.5 w-3.5" />
                {openFor === m.id
                  ? "Close"
                  : m.homeScore != null
                  ? "Confirm result"
                  : "Enter result"}
              </button>
            </div>

            {openFor === m.id && (
              <div className="mt-4 space-y-4 border-t border-zinc-800 pt-4">
                {m.homeScore != null && (
                  <p className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-300">
                    Filled in from live scoring. Check it against the scorer&apos;s
                    card and save — edit any field if the console got it wrong.
                  </p>
                )}
                {/* Scores */}
                <div className="grid gap-3 sm:grid-cols-2">
                  {(["home", "away"] as const).map((side) => (
                    <div key={side} className="rounded-lg border border-zinc-800 bg-zinc-800/40 p-3">
                      <div className="mb-2 text-xs font-medium text-zinc-300">
                        {side === "home" ? m.homeTeam?.name : m.awayTeam?.name}
                      </div>
                      <div className="flex gap-2">
                        <input
                          className={`${inputCls} w-24`}
                          inputMode="numeric"
                          placeholder="Score"
                          value={side === "home" ? form.homeScore : form.awayScore}
                          onChange={(e) =>
                            setForm((f) => ({
                              ...f,
                              [side === "home" ? "homeScore" : "awayScore"]: e.target.value.replace(/[^\d]/g, ""),
                            }))
                          }
                        />
                        <input
                          className={`${inputCls} flex-1`}
                          placeholder='Display note, e.g. "142/7 (16.0)"'
                          value={side === "home" ? form.homeScoreNote : form.awayScoreNote}
                          onChange={(e) =>
                            setForm((f) => ({
                              ...f,
                              [side === "home" ? "homeScoreNote" : "awayScoreNote"]: e.target.value,
                            }))
                          }
                        />
                      </div>
                    </div>
                  ))}
                </div>

                {/* Tie handling */}
                {tied && (
                  <div className="flex flex-wrap items-center gap-4 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
                    <span className="text-amber-400">Scores are level:</span>
                    {isRR(m) && (
                      <label className="flex items-center gap-2 text-zinc-300">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-emerald-500"
                          checked={form.isDraw}
                          onChange={(e) => setForm((f) => ({ ...f, isDraw: e.target.checked, winnerTeamId: "" }))}
                        />
                        Draw
                      </label>
                    )}
                    {!form.isDraw && (
                      <select
                        className={inputCls}
                        value={form.winnerTeamId}
                        onChange={(e) => setForm((f) => ({ ...f, winnerTeamId: e.target.value }))}
                      >
                        <option value="">Winner (super over / shootout)…</option>
                        {m.homeTeam && <option value={m.homeTeam.id}>{m.homeTeam.name}</option>}
                        {m.awayTeam && <option value={m.awayTeam.id}>{m.awayTeam.name}</option>}
                      </select>
                    )}
                  </div>
                )}

                {/* Player stats */}
                {statFields.length > 0 && roster?.homeTeam && roster?.awayTeam && (
                  <div>
                    <div className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
                      Player stats (leaderboards)
                    </div>
                    <div className="flex flex-col gap-4 lg:flex-row">
                      {statGrid(roster.homeTeam)}
                      {statGrid(roster.awayTeam)}
                    </div>
                  </div>
                )}

                {/* PoM + note + submit */}
                <div className="flex flex-wrap items-center gap-3">
                  {roster?.homeTeam && roster?.awayTeam && (
                    <div className="flex items-center gap-2">
                      <Award className="h-4 w-4 text-amber-400" />
                      <select
                        className={inputCls}
                        value={form.playerOfMatchId}
                        onChange={(e) => setForm((f) => ({ ...f, playerOfMatchId: e.target.value }))}
                      >
                        <option value="">Player of the Match…</option>
                        <optgroup label={roster.homeTeam.name}>
                          {roster.homeTeam.members.map((x) => (
                            <option key={x.id} value={x.id}>{x.name}</option>
                          ))}
                        </optgroup>
                        <optgroup label={roster.awayTeam.name}>
                          {roster.awayTeam.members.map((x) => (
                            <option key={x.id} value={x.id}>{x.name}</option>
                          ))}
                        </optgroup>
                      </select>
                    </div>
                  )}
                  <input
                    className={`${inputCls} flex-1`}
                    placeholder="Result note (optional)"
                    value={form.resultNote}
                    onChange={(e) => setForm((f) => ({ ...f, resultNote: e.target.value }))}
                  />
                  <button
                    onClick={() => submit(m)}
                    disabled={busy === m.id || form.homeScore === "" || form.awayScore === ""}
                    className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-600/10 px-4 py-2.5 text-sm font-medium text-emerald-400 hover:bg-emerald-600/20 disabled:opacity-40"
                  >
                    {busy === m.id && <Loader2 className="h-4 w-4 animate-spin" />}
                    Save result
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <h4 className="pt-2 text-sm font-semibold uppercase tracking-wide text-zinc-400">
        Completed ({completed.length})
      </h4>
      <div className="space-y-2">
        {completed.map((m) => (
          <div key={m.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-900 p-3.5">
            <div>
              <div className="text-xs text-zinc-500">{m.roundLabel}{m.status === "WALKOVER" ? " · walkover" : ""}</div>
              <div className="mt-0.5 text-sm text-zinc-100">
                {m.homeTeam?.name || "—"}{" "}
                <span className="font-semibold text-emerald-400">{m.homeScore ?? ""}</span>
                <span className="mx-1 text-zinc-600">–</span>
                <span className="font-semibold text-emerald-400">{m.awayScore ?? ""}</span>{" "}
                {m.awayTeam?.name || "—"}
              </div>
            </div>
            {m.status === "COMPLETED" && (
              <button
                onClick={() => reopen(m)}
                disabled={busy === m.id}
                className="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800 disabled:opacity-50"
              >
                <RotateCcw className="h-3 w-3" /> Reopen
              </button>
            )}
          </div>
        ))}
        {completed.length === 0 && <p className="text-sm text-zinc-600">No results yet.</p>}
      </div>
    </div>
  );
}
