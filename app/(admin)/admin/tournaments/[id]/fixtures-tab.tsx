"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Wand2, CalendarClock, X } from "lucide-react";
import {
  generateFixtures,
  scheduleMatch,
  unscheduleMatch,
} from "@/actions/admin-tournament-fixtures";

export type MatchRow = {
  id: string;
  stage: string;
  status: string;
  sequence: number;
  roundLabel: string | null;
  homeTeam: { id: string; name: string; color: string | null } | null;
  awayTeam: { id: string; name: string; color: string | null } | null;
  homeSourceLabel: string | null;
  awaySourceLabel: string | null;
  homeScore: number | null;
  awayScore: number | null;
  pool: { name: string } | null;
  courtConfig: { label: string } | null;
  scheduledAt: string | null;
  durationMins: number;
};

type Court = { id: string; label: string; size: string };

const STAGE_ORDER = ["POOL", "LEAGUE", "R16", "QF", "SF", "THIRD_PLACE", "FINAL"];
const STAGE_LABEL: Record<string, string> = {
  POOL: "Pool Stage",
  LEAGUE: "League",
  R16: "Round of 16",
  QF: "Quarter Finals",
  SF: "Semi Finals",
  THIRD_PLACE: "3rd Place",
  FINAL: "Final",
};

function fmtWhen(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });
}

export function FixturesTab({
  tournamentId,
  matches,
  courts,
}: {
  tournamentId: string;
  matches: MatchRow[];
  courts: Court[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [schedFor, setSchedFor] = useState<string | null>(null);
  const [form, setForm] = useState({ courtConfigId: "", date: "", startHour: 18, hours: 1 });

  const generate = async () => {
    setBusy("gen");
    setError(null);
    try {
      const res = await generateFixtures(tournamentId);
      if (!res.success) setError(res.error || "Failed");
      else router.refresh();
    } finally {
      setBusy(null);
    }
  };

  const doSchedule = async (matchId: string) => {
    if (!form.courtConfigId || !form.date) {
      setError("Pick a court and date");
      return;
    }
    setBusy(matchId);
    setError(null);
    try {
      const res = await scheduleMatch(matchId, form);
      if (!res.success) setError(res.error || "Failed");
      else {
        setSchedFor(null);
        router.refresh();
      }
    } finally {
      setBusy(null);
    }
  };

  const doUnschedule = async (matchId: string) => {
    setBusy(matchId);
    setError(null);
    try {
      const res = await unscheduleMatch(matchId);
      if (!res.success) setError(res.error || "Failed");
      else router.refresh();
    } finally {
      setBusy(null);
    }
  };

  const grouped = STAGE_ORDER.map((stage) => ({
    stage,
    items: matches.filter((m) => m.stage === stage),
  })).filter((g) => g.items.length > 0);

  const sideName = (m: MatchRow, side: "home" | "away") => {
    const team = side === "home" ? m.homeTeam : m.awayTeam;
    const label = side === "home" ? m.homeSourceLabel : m.awaySourceLabel;
    if (team) return <span className="text-zinc-100">{team.name}</span>;
    return <span className="italic text-zinc-500">{label || "TBD"}</span>;
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={generate}
          disabled={busy === "gen"}
          className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-600/10 px-4 py-2.5 text-sm font-medium text-emerald-400 hover:bg-emerald-600/20 disabled:opacity-40"
        >
          {busy === "gen" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
          {matches.length ? "Regenerate fixtures" : "Generate fixtures"}
        </button>
        <span className="text-xs text-zinc-500">
          Scheduling a match blocks that court&apos;s slots in the customer booking grid automatically.
        </span>
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}

      {grouped.length === 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-8 text-center text-sm text-zinc-500">
          No fixtures yet. Deal the pools (if pools format), then generate.
        </div>
      )}

      {grouped.map((g) => (
        <div key={g.stage}>
          <h4 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-400">
            {STAGE_LABEL[g.stage] || g.stage}
          </h4>
          <div className="space-y-2">
            {g.items.map((m) => (
              <div key={m.id} className="rounded-xl border border-zinc-800 bg-zinc-900 p-3.5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs text-zinc-500">
                      {m.roundLabel}
                      {m.pool && !m.roundLabel?.includes(m.pool.name) ? ` · ${m.pool.name}` : ""}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-sm">
                      {sideName(m, "home")}
                      <span className="text-zinc-600">vs</span>
                      {sideName(m, "away")}
                      {m.status === "COMPLETED" && (
                        <span className="ml-1 text-emerald-400">
                          {m.homeScore}–{m.awayScore}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {m.scheduledAt ? (
                      <>
                        <span className="flex items-center gap-1.5 rounded-lg bg-zinc-800 px-2.5 py-1.5 text-xs text-zinc-300">
                          <CalendarClock className="h-3.5 w-3.5 text-emerald-400" />
                          {fmtWhen(m.scheduledAt)} · {m.courtConfig?.label} · {m.durationMins / 60}h
                        </span>
                        {m.status === "SCHEDULED" && (
                          <button
                            onClick={() => doUnschedule(m.id)}
                            disabled={busy === m.id}
                            className="rounded-lg border border-zinc-700 p-1.5 text-zinc-400 hover:bg-zinc-800 disabled:opacity-50"
                            title="Unschedule (frees the slots)"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </>
                    ) : (
                      m.status === "SCHEDULED" && (
                        <button
                          onClick={() => {
                            setSchedFor(schedFor === m.id ? null : m.id);
                            setForm((f) => ({ ...f, courtConfigId: courts[0]?.id || "" }));
                          }}
                          className="rounded-lg border border-sky-500/30 px-3 py-1.5 text-xs text-sky-400 hover:bg-sky-600/10"
                        >
                          Schedule
                        </button>
                      )
                    )}
                  </div>
                </div>

                {schedFor === m.id && (
                  <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-zinc-800 pt-3">
                    <div>
                      <label className="mb-1 block text-[10px] uppercase text-zinc-500">Court</label>
                      <select
                        className="rounded-lg border border-zinc-700 bg-zinc-800 p-2 text-xs text-white"
                        value={form.courtConfigId}
                        onChange={(e) => setForm((f) => ({ ...f, courtConfigId: e.target.value }))}
                      >
                        {courts.map((c) => (
                          <option key={c.id} value={c.id}>{c.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-[10px] uppercase text-zinc-500">Date</label>
                      <input
                        type="date"
                        className="rounded-lg border border-zinc-700 bg-zinc-800 p-2 text-xs text-white"
                        value={form.date}
                        onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[10px] uppercase text-zinc-500">Start</label>
                      <select
                        className="rounded-lg border border-zinc-700 bg-zinc-800 p-2 text-xs text-white"
                        value={form.startHour}
                        onChange={(e) => setForm((f) => ({ ...f, startHour: Number(e.target.value) }))}
                      >
                        {Array.from({ length: 24 }, (_, h) => (
                          <option key={h} value={h}>
                            {h === 0 ? "12 AM" : h < 12 ? `${h} AM` : h === 12 ? "12 PM" : `${h - 12} PM`}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-[10px] uppercase text-zinc-500">Hours</label>
                      <select
                        className="rounded-lg border border-zinc-700 bg-zinc-800 p-2 text-xs text-white"
                        value={form.hours}
                        onChange={(e) => setForm((f) => ({ ...f, hours: Number(e.target.value) }))}
                      >
                        {[1, 2, 3, 4].map((h) => (
                          <option key={h} value={h}>{h}h</option>
                        ))}
                      </select>
                    </div>
                    <button
                      onClick={() => doSchedule(m.id)}
                      disabled={busy === m.id}
                      className="rounded-lg border border-emerald-500/30 bg-emerald-600/10 px-3 py-2 text-xs font-medium text-emerald-400 hover:bg-emerald-600/20 disabled:opacity-50"
                    >
                      {busy === m.id ? "Saving…" : "Confirm & block slots"}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
