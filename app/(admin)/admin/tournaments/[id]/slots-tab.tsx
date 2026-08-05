"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Loader2, Plus, Trash2, Wand2, Check, AlertTriangle } from "lucide-react";
import {
  addTournamentSlot,
  deleteTournamentSlot,
  setMatchDuration,
  getSlotPlanning,
  generateScheduleCandidates,
  approveSchedule,
} from "@/actions/admin-tournament-slots";

type Planning = Awaited<ReturnType<typeof getSlotPlanning>>;
type Candidates = Awaited<ReturnType<typeof generateScheduleCandidates>>;

const hourLabel = (h: number) => {
  const hr = h % 24;
  const am = hr < 12;
  const v = hr % 12 === 0 ? 12 : hr % 12;
  return `${v}${am ? "am" : "pm"}`;
};

const istDay = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Asia/Kolkata",
  });

/**
 * Pre-decided match windows, and the draw they feed.
 *
 * Windows cover pool/league matches only — semi-final and final are
 * scheduled by hand from the Fixtures tab once real names exist.
 */
export function SlotsTab({
  tournamentId,
  courts,
}: {
  tournamentId: string;
  courts: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [plan, setPlan] = useState<Planning>(null);
  const [cands, setCands] = useState<Candidates | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    date: "",
    startHour: 6,
    endHour: 10,
    courtConfigId: courts[0]?.id ?? "",
    label: "",
  });

  const load = useCallback(() => {
    getSlotPlanning(tournamentId).then(setPlan).catch(() => {});
  }, [tournamentId]);
  useEffect(load, [load]);

  const run = (fn: () => Promise<{ success: boolean; error?: string }>) => {
    setError(null);
    start(async () => {
      const r = await fn();
      if (!r.success) setError(r.error ?? "Something went wrong");
      else {
        load();
        router.refresh();
      }
    });
  };

  const capacityShort =
    plan && plan.capacity < plan.poolMatchesNeeded
      ? plan.poolMatchesNeeded - plan.capacity
      : 0;

  return (
    <div className="space-y-6">
      {error && (
        <p className="flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          <AlertTriangle className="h-4 w-4" /> {error}
        </p>
      )}

      {/* Match length */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
        <h3 className="text-sm font-semibold text-white">Match length</h3>
        <p className="mt-1 text-xs text-zinc-500">
          One length for every pool match. A 6–10am window then holds{" "}
          {plan ? Math.floor(240 / plan.matchDurationMinutes) : 4} matches — the
          venue runs one tournament match at a time.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {[30, 45, 60, 90, 120].map((m) => (
            <button
              key={m}
              disabled={pending}
              onClick={() => run(() => setMatchDuration(tournamentId, m))}
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                plan?.matchDurationMinutes === m
                  ? "border-emerald-500/50 bg-emerald-600/20 text-emerald-300"
                  : "border-zinc-700 text-zinc-300 hover:bg-zinc-800"
              } disabled:opacity-50`}
            >
              {m} min
            </button>
          ))}
        </div>
      </div>

      {/* Windows */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
          <CalendarClock className="h-4 w-4 text-emerald-400" /> Match windows
        </h3>
        <p className="mt-1 text-xs text-zinc-500">
          Customers see these on the tournament page, and captains pick which
          ones their team can play.
        </p>

        {plan && plan.slots.length > 0 && (
          <ul className="mt-3 space-y-2">
            {plan.slots.map((s) => (
              <li
                key={s.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-sm"
              >
                <span className="text-zinc-200">
                  {istDay(s.date)}{" "}
                  <span className="font-medium text-emerald-300">
                    {hourLabel(s.startHour)} – {hourLabel(s.endHour)}
                  </span>
                  {s.label && <span className="ml-2 text-xs text-zinc-500">{s.label}</span>}
                  {s.courtLabel && (
                    <span className="ml-2 text-xs text-zinc-600">· {s.courtLabel}</span>
                  )}
                </span>
                <span className="flex items-center gap-3">
                  <span className="text-xs text-zinc-500">
                    {s.preferredBy} team{s.preferredBy === 1 ? "" : "s"} picked
                  </span>
                  <button
                    disabled={pending}
                    onClick={() => run(() => deleteTournamentSlot(s.id))}
                    className="text-zinc-500 hover:text-red-400 disabled:opacity-50"
                    aria-label="Delete window"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}

        {/* Add */}
        <div className="mt-4 grid gap-2 sm:grid-cols-5">
          <input
            type="date"
            value={form.date}
            onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
            className="rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-white"
          />
          <select
            value={form.startHour}
            onChange={(e) => setForm((f) => ({ ...f, startHour: Number(e.target.value) }))}
            className="rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-white"
          >
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>From {hourLabel(h)}</option>
            ))}
          </select>
          <select
            value={form.endHour}
            onChange={(e) => setForm((f) => ({ ...f, endHour: Number(e.target.value) }))}
            className="rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-white"
          >
            {Array.from({ length: 24 }, (_, i) => i + 1).map((h) => (
              <option key={h} value={h}>To {hourLabel(h)}</option>
            ))}
          </select>
          <select
            value={form.courtConfigId}
            onChange={(e) => setForm((f) => ({ ...f, courtConfigId: e.target.value }))}
            className="rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-white"
          >
            <option value="">No court</option>
            {courts.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
          <input
            placeholder="Label (optional)"
            value={form.label}
            onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
            className="rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-white placeholder:text-zinc-600"
          />
        </div>
        <button
          disabled={pending || !form.date}
          onClick={() =>
            run(async () => {
              const r = await addTournamentSlot({ tournamentId, ...form });
              if (r.success) setForm((f) => ({ ...f, label: "" }));
              return r;
            })
          }
          className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-600/10 px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-600/20 disabled:opacity-50"
        >
          <Plus className="h-3.5 w-3.5" /> Add window
        </button>
      </div>

      {/* Capacity + generate */}
      {plan && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
          <h3 className="text-sm font-semibold text-white">Draw &amp; schedule</h3>
          <div className="mt-2 grid gap-2 text-xs text-zinc-400 sm:grid-cols-3">
            <span>Confirmed teams: <b className="text-zinc-200">{plan.confirmedTeams}</b></span>
            <span>Pool matches needed: <b className="text-zinc-200">{plan.poolMatchesNeeded}</b></span>
            <span>
              Slot capacity:{" "}
              <b className={capacityShort ? "text-red-300" : "text-emerald-300"}>
                {plan.capacity}
              </b>
            </span>
          </div>
          {capacityShort > 0 && (
            <p className="mt-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {capacityShort} more match slot{capacityShort === 1 ? "" : "s"} needed —
              add a window or shorten the match length.
            </p>
          )}
          {plan.scheduleApprovedAt && (
            <p className="mt-2 flex items-center gap-1.5 text-xs text-emerald-300">
              <Check className="h-3.5 w-3.5" />
              Schedule approved{" "}
              {new Date(plan.scheduleApprovedAt).toLocaleString("en-IN", {
                day: "numeric", month: "short", hour: "numeric", minute: "2-digit",
                timeZone: "Asia/Kolkata",
              })}
            </p>
          )}

          <button
            disabled={pending || plan.slots.length === 0}
            onClick={() => {
              setError(null);
              start(async () => {
                const r = await generateScheduleCandidates(tournamentId);
                if (!r.success) setError(r.error);
                else setCands(r);
              });
            }}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
            Generate pools &amp; times
          </button>

          {cands?.success && (
            <div className="mt-4 space-y-3">
              {cands.plans.map((p, i) => (
                <div key={i} className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-white">Option {i + 1}</span>
                    <span className="flex items-center gap-3 text-xs">
                      <span className="text-emerald-300">{p.scheduled} scheduled</span>
                      {p.unscheduled > 0 && (
                        <span className="text-red-300">{p.unscheduled} unplaced</span>
                      )}
                      <span className={p.compromises ? "text-amber-300" : "text-zinc-500"}>
                        {p.compromises} outside a team&apos;s picks
                      </span>
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-zinc-400">
                    {p.pools.map((pool, pi) => (
                      <span key={pi} className="rounded border border-zinc-800 px-2 py-1">
                        Pool {String.fromCharCode(65 + pi)}: {pool.map((x) => x.name).join(", ")}
                      </span>
                    ))}
                  </div>
                  <ul className="mt-2 space-y-1 text-xs text-zinc-400">
                    {p.matches.map((m, mi) => (
                      <li key={mi} className="flex justify-between gap-3">
                        <span>{m.home} v {m.away}</span>
                        <span className={m.slot ? "text-zinc-300" : "text-red-300"}>
                          {m.slot
                            ? `${istDay(m.slot.date)} ${hourLabel(m.slot.startHour)}${
                                m.slot.startMinute ? `:${String(m.slot.startMinute).padStart(2, "0")}` : ""
                              }`
                            : "no slot"}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <button
                    disabled={pending}
                    onClick={() =>
                      run(async () => {
                        const r = await approveSchedule(tournamentId, i);
                        if (r.success) setCands(null);
                        return r;
                      })
                    }
                    className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-3 py-1.5 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/25 disabled:opacity-50"
                  >
                    <Check className="h-3.5 w-3.5" /> Approve this draw
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
