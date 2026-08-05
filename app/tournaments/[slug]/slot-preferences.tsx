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
        Tick every hour your team can play. Pools and match times are built
        around these — the more you tick, the better your chances of getting
        times that suit you. Leave all unticked if any time works.
      </p>

      <div className="mt-3 space-y-4">
        {slots.map((w) => {
          const hours = Array.from(
            { length: w.endHour - w.startHour },
            (_, i) => w.startHour + i,
          );
          const dayLabel = new Date(w.date).toLocaleDateString("en-IN", {
            weekday: "short",
            day: "numeric",
            month: "short",
            timeZone: "Asia/Kolkata",
          });
          const allOn = hours.every((h) => picked.includes(`${w.id}#${h}`));
          return (
            <div key={w.id}>
              <div className="mb-1.5 flex items-center justify-between gap-3">
                <span className="text-xs font-semibold text-zinc-300">
                  {dayLabel}
                  <span className="ml-2 font-normal text-zinc-500">
                    {hourLabel(w.startHour)}–{hourLabel(w.endHour)}
                    {w.label ? ` · ${w.label}` : ""}
                  </span>
                </span>
                <button
                  type="button"
                  disabled={locked}
                  onClick={() =>
                    setPicked((p) => {
                      const keys = hours.map((h) => `${w.id}#${h}`);
                      return allOn
                        ? p.filter((x) => !keys.includes(x))
                        : Array.from(new Set([...p, ...keys]));
                    })
                  }
                  className="text-[11px] text-emerald-400 hover:underline disabled:opacity-50"
                >
                  {allOn ? "Clear all" : "Select all"}
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {hours.map((h) => {
                  const key = `${w.id}#${h}`;
                  const on = picked.includes(key);
                  return (
                    <button
                      key={key}
                      type="button"
                      disabled={locked}
                      onClick={() => toggle(key)}
                      className={`flex items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-xs font-medium transition ${
                        on
                          ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-200"
                          : "border-zinc-700 bg-zinc-950/40 text-zinc-300 hover:border-zinc-600"
                      } disabled:cursor-not-allowed disabled:opacity-60`}
                    >
                      {on && <Check className="h-3 w-3" />}
                      {hourLabel(h)}–{hourLabel(h + 1)}
                    </button>
                  );
                })}
              </div>
            </div>
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
