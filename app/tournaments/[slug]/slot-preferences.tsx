"use client";

import { useState } from "react";
import { CalendarClock, Check, Loader2 } from "lucide-react";

type Slot = {
  id: string;
  date: string;
  startHour: number;
  endHour: number;
  label: string | null;
};

const hourLabel = (h: number) => {
  const hr = h % 24;
  const am = hr < 12;
  const v = hr % 12 === 0 ? 12 : hr % 12;
  return `${v}${am ? "am" : "pm"}`;
};

/**
 * Captain picks every window their team can play. Multi-select on
 * purpose — the more a team ticks, the better the generator can group
 * pools and the fewer fixtures land outside anyone's availability.
 */
export function SlotPreferences({
  teamId,
  slots,
  initial,
  locked,
}: {
  teamId: string;
  slots: Slot[];
  initial: string[];
  locked: boolean;
}) {
  const [picked, setPicked] = useState<string[]>(initial);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (slots.length === 0) return null;

  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/tournaments/slot-preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId, slotIds: picked }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't save");
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
      <h2 className="flex items-center gap-2 font-semibold text-white">
        <CalendarClock className="h-5 w-5 text-emerald-400" /> Your preferred slots
      </h2>
      <p className="mt-1 text-xs text-zinc-500">
        Tick every window your team can play. Pools and match times are built
        around these — the more you tick, the better your chances of getting
        times that suit you. Leave all unticked if any time works.
      </p>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {slots.map((s) => {
          const on = picked.includes(s.id);
          return (
            <button
              key={s.id}
              type="button"
              disabled={locked}
              onClick={() => toggle(s.id)}
              className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm transition ${
                on
                  ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-200"
                  : "border-zinc-700 bg-zinc-950/40 text-zinc-300 hover:border-zinc-600"
              } disabled:cursor-not-allowed disabled:opacity-60`}
            >
              <span
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                  on ? "border-emerald-400 bg-emerald-500" : "border-zinc-600"
                }`}
              >
                {on && <Check className="h-3 w-3 text-zinc-950" />}
              </span>
              <span>
                {new Date(s.date).toLocaleDateString("en-IN", {
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                  timeZone: "Asia/Kolkata",
                })}{" "}
                <span className="font-medium">
                  {hourLabel(s.startHour)}–{hourLabel(s.endHour)}
                </span>
                {s.label && (
                  <span className="ml-1 text-xs text-zinc-500">{s.label}</span>
                )}
              </span>
            </button>
          );
        })}
      </div>

      {locked ? (
        <p className="mt-3 text-xs text-zinc-500">
          The schedule has been published — contact the venue to change slots.
        </p>
      ) : (
        <div className="mt-3 flex items-center gap-3">
          <button
            onClick={save}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Save slots
          </button>
          {saved && <span className="text-xs text-emerald-400">Saved</span>}
          {error && <span className="text-xs text-red-400">{error}</span>}
        </div>
      )}
    </div>
  );
}
