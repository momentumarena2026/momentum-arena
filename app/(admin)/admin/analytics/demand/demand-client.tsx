"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import type { DemandResult } from "@/actions/admin-insights";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
// Match the venue's operating hours (5am–1am next day).
const HOURS = Array.from({ length: 21 }, (_, i) => (i + 5) % 24); // 5..24/0

function formatHour(h: number): string {
  if (h === 0 || h === 24) return "12am";
  if (h === 12) return "12pm";
  return h < 12 ? `${h}am` : `${h - 12}pm`;
}

function colorForIntensity(value: number, max: number): string {
  if (value === 0 || max === 0) return "#18181b";
  const t = Math.min(value / max, 1);
  // amber-400 → red-500 gradient mirroring the slot-grid "booked" tint.
  const r = Math.round(250 - (250 - 239) * t); // 250→239
  const g = Math.round(204 - (204 - 68) * t); // 204→68
  const b = Math.round(21 - (21 - 68) * t); // 21→68
  const alpha = 0.25 + 0.75 * t;
  return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
}

interface Props {
  data: DemandResult;
  from: string;
  to: string;
  sports: string[];
  selectedSport: string;
}

export function DemandClient({ data, from, to, sports, selectedSport }: Props) {
  const router = useRouter();

  function pushParams(updates: Record<string, string>) {
    const params = new URLSearchParams();
    params.set("from", from);
    params.set("to", to);
    if (selectedSport !== "all") params.set("sport", selectedSport);
    for (const [k, v] of Object.entries(updates)) {
      if (v) params.set(k, v);
      else params.delete(k);
    }
    router.push(`/admin/analytics/demand?${params.toString()}`);
  }

  // Filter cells to the selected sport (or sum across sports).
  const filteredCells = useMemo(
    () =>
      selectedSport === "all"
        ? data.cells
        : data.cells.filter((c) => c.sport === selectedSport),
    [data.cells, selectedSport],
  );

  // Aggregate to a 7×24 grid.
  const grid = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of filteredCells) {
      const key = `${c.dayOfWeek}-${c.hour}`;
      m.set(key, (m.get(key) ?? 0) + c.intensity);
    }
    return m;
  }, [filteredCells]);

  const max = useMemo(
    () => Math.max(0, ...Array.from(grid.values())),
    [grid],
  );
  const total = useMemo(
    () => Array.from(grid.values()).reduce((sum, v) => sum + v, 0),
    [grid],
  );

  // Top 5 (day, hour) cells — operationally the most useful "go fix
  // this" list. Sport is part of the cell because the same time slot
  // might be hot for cricket but dead for football.
  const topCells = useMemo(() => {
    const sorted = [...filteredCells].sort((a, b) => b.intensity - a.intensity);
    return sorted.slice(0, 5);
  }, [filteredCells]);

  return (
    <>
      <div className="flex flex-wrap items-end gap-4 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
        <div>
          <label className="block text-xs font-medium uppercase text-zinc-500">From</label>
          <input
            type="date"
            value={from}
            onChange={(e) => pushParams({ from: e.target.value })}
            className="mt-1 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white"
          />
        </div>
        <div>
          <label className="block text-xs font-medium uppercase text-zinc-500">To</label>
          <input
            type="date"
            value={to}
            onChange={(e) => pushParams({ to: e.target.value })}
            className="mt-1 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white"
          />
        </div>
        <div>
          <label className="block text-xs font-medium uppercase text-zinc-500">Sport</label>
          <select
            value={selectedSport}
            onChange={(e) =>
              pushParams({ sport: e.target.value === "all" ? "" : e.target.value })
            }
            className="mt-1 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white"
          >
            <option value="all">All sports</option>
            {sports.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </div>
        <div className="ml-auto rounded-md bg-zinc-900 px-3 py-2 text-xs text-zinc-400">
          <span className="text-zinc-500">Total demand signals:</span>{" "}
          <span className="font-semibold text-white">{total}</span>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
        <table className="w-full text-xs">
          <thead>
            <tr>
              <th className="px-2 py-1 text-left text-zinc-500"></th>
              {HOURS.map((h) => (
                <th
                  key={h}
                  className="px-1 py-1 text-center text-[10px] font-normal text-zinc-500"
                  style={{ minWidth: 32 }}
                >
                  {formatHour(h)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {DAYS.map((day, dow) => (
              <tr key={day}>
                <td className="px-2 py-1 text-zinc-400">{day}</td>
                {HOURS.map((h) => {
                  const v = grid.get(`${dow}-${h}`) ?? 0;
                  return (
                    <td
                      key={h}
                      className="px-1 py-1 text-center text-[11px] font-medium text-white"
                      style={{
                        backgroundColor: colorForIntensity(v, max),
                        minWidth: 32,
                        height: 32,
                      }}
                      title={`${day} ${formatHour(h)} — ${v} signals`}
                    >
                      {v > 0 ? v : ""}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {topCells.length > 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
          <h2 className="text-base font-semibold text-white">
            Top 5 unmet-demand slots
          </h2>
          <p className="mt-1 text-xs text-zinc-500">
            Where you&apos;re losing the most bookings to capacity. Add
            slots / surge price these first.
          </p>
          <ul className="mt-3 space-y-2">
            {topCells.map((c, i) => (
              <li
                key={`${c.dayOfWeek}-${c.hour}-${c.sport}`}
                className="flex items-center justify-between rounded-md bg-zinc-950 px-3 py-2 text-sm"
              >
                <span>
                  <span className="text-zinc-500">#{i + 1}</span>{" "}
                  <span className="font-medium text-white">
                    {DAYS[c.dayOfWeek]} {formatHour(c.hour)}
                  </span>{" "}
                  · <span className="text-zinc-400">{c.sport.replace(/_/g, " ")}</span>
                </span>
                <span className="font-mono text-amber-400">
                  {c.intensity} signals
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
