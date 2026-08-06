"use client";

import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import {
  createManualMatch,
  MANUAL_STAGES,
  type ManualFixtureInput,
} from "@/actions/admin-tournament-manual-fixtures";

/**
 * Add one fixture by hand.
 *
 * For a third-party tournament the organiser has already decided the
 * schedule, so we enter what they gave us instead of generating and then
 * arguing with the result. Also useful on our own events for anything the
 * generator can't express — a second leg, an extra semi-final.
 *
 * Either side can be a real team OR a placeholder label ("Winner SF1",
 * "Finalist 1") for a fixture whose teams aren't known yet.
 */

const STAGE_LABEL: Record<string, string> = {
  LEAGUE: "League",
  POOL: "Pool",
  R16: "Round of 16",
  QF: "Quarter-final",
  SF: "Semi-final",
  THIRD_PLACE: "Third place",
  FINAL: "Final",
};

export function AddFixture({
  tournamentId,
  teams,
  onAdded,
}: {
  tournamentId: string;
  teams: { id: string; name: string }[];
  onAdded?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [stage, setStage] = useState<(typeof MANUAL_STAGES)[number]>("LEAGUE");
  const [roundLabel, setRoundLabel] = useState("");
  const [homeTeamId, setHomeTeamId] = useState("");
  const [awayTeamId, setAwayTeamId] = useState("");
  const [homeLabel, setHomeLabel] = useState("");
  const [awayLabel, setAwayLabel] = useState("");

  function submit() {
    setError(null);
    startTransition(async () => {
      const payload: ManualFixtureInput = {
        tournamentId,
        stage,
        roundLabel: roundLabel.trim() || STAGE_LABEL[stage] || stage,
        homeTeamId: homeTeamId || undefined,
        awayTeamId: awayTeamId || undefined,
        homeSourceLabel: homeTeamId ? undefined : homeLabel.trim() || undefined,
        awaySourceLabel: awayTeamId ? undefined : awayLabel.trim() || undefined,
      };
      const res = await createManualMatch(payload);
      if (!res.success) {
        setError(res.error);
        return;
      }
      setRoundLabel("");
      setHomeTeamId("");
      setAwayTeamId("");
      setHomeLabel("");
      setAwayLabel("");
      setOpen(false);
      onAdded?.();
    });
  }

  const input =
    "w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white";
  const label = "mb-1 block text-xs text-zinc-400";

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:border-emerald-500/40 hover:text-white"
      >
        <Plus className="h-4 w-4" /> Add match by hand
      </button>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
      <p className="text-sm font-semibold text-white">Add a match</p>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={label}>Stage</label>
          <select
            className={input}
            value={stage}
            onChange={(e) => setStage(e.target.value as typeof stage)}
          >
            {MANUAL_STAGES.map((s) => (
              <option key={s} value={s}>
                {STAGE_LABEL[s] ?? s}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={label}>Label</label>
          <input
            className={input}
            placeholder={STAGE_LABEL[stage]}
            value={roundLabel}
            onChange={(e) => setRoundLabel(e.target.value)}
          />
        </div>
      </div>

      {/* Team OR placeholder per side. Choosing a team wins — the label is
          only meaningful while the team is still unknown. */}
      {(
        [
          ["Home", homeTeamId, setHomeTeamId, homeLabel, setHomeLabel, "Winner SF1"],
          ["Away", awayTeamId, setAwayTeamId, awayLabel, setAwayLabel, "Winner SF2"],
        ] as const
      ).map(([side, teamId, setTeamId, lbl, setLbl, placeholder]) => (
        <div key={side} className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={label}>{side} team</label>
            <select
              className={input}
              value={teamId}
              onChange={(e) => setTeamId(e.target.value)}
            >
              <option value="">— not decided yet —</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={label}>…or show as</label>
            <input
              className={input}
              placeholder={placeholder}
              disabled={!!teamId}
              value={teamId ? "" : lbl}
              onChange={(e) => setLbl(e.target.value)}
            />
          </div>
        </div>
      ))}

      {error && (
        <p className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      <p className="text-xs text-zinc-500">
        Set the date and court afterwards with the schedule control on the fixture row.
      </p>

      <div className="flex gap-2">
        <button
          onClick={submit}
          disabled={pending}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {pending ? "Adding…" : "Add match"}
        </button>
        <button
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
