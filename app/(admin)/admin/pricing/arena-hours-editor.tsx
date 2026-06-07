"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateArenaSettings } from "@/actions/admin-arena-settings";
import { formatHour } from "@/lib/court-config";
import { Clock, Loader2 } from "lucide-react";

/**
 * Arena operating-hours editor. Sits at the top of /admin/pricing —
 * the values flow through every slot-availability + pricing path
 * via lib/court-config.ts → getAllSlotHoursLive().
 *
 * Constraints (mirror the action):
 *   - opening hour: 0..23 (inclusive)
 *   - closing hour: 1..25 (25 = midnight–1am next day, matching
 *     the legacy convention)
 *   - opening must be strictly before closing
 *
 * Closing hour 25 is rendered as "1am (next day)" so the operator
 * doesn't think it's a typo. The picker exposes the full 0..25
 * range and the action enforces the same bounds server-side.
 */
const OPEN_OPTIONS: number[] = Array.from({ length: 24 }, (_, i) => i);
const CLOSE_OPTIONS: number[] = Array.from({ length: 25 }, (_, i) => i + 1);

function labelHour(h: number): string {
  // hour 24 → 12am, hour 25 → 1am next day. formatHour wraps mod
  // 24 for display; we tack on " (next day)" for closing slots
  // ≥ 24 so the operator understands the overnight semantic.
  if (h >= 24) return `${formatHour(h)} (next day)`;
  return formatHour(h);
}

export function ArenaHoursEditor({
  initialOpenHour,
  initialCloseHour,
}: {
  initialOpenHour: number;
  initialCloseHour: number;
}) {
  const router = useRouter();
  const [openHour, setOpenHour] = useState(initialOpenHour);
  const [closeHour, setCloseHour] = useState(initialCloseHour);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const slotsCount = Math.max(0, closeHour - openHour);
  const dirty =
    openHour !== initialOpenHour || closeHour !== initialCloseHour;
  const valid = openHour < closeHour;

  async function handleSave() {
    if (!dirty || !valid) return;
    setSaving(true);
    setError(null);
    const result = await updateArenaSettings({ openHour, closeHour });
    setSaving(false);
    if (result.ok) {
      setSavedAt(new Date());
      router.refresh();
    } else {
      setError(result.error);
    }
  }

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
            <Clock className="h-4 w-4 text-amber-400" />
            Arena Operating Hours
          </h2>
          <p className="mt-1 text-xs text-zinc-400 max-w-xl">
            The bookable window — drives the customer slot picker, the
            admin calendar, and pricing rule generation. Set the
            closing hour past midnight ({" "}
            <span className="font-mono">12am</span> → {" "}
            <span className="font-mono">1am next day</span>) for
            overnight venues.
          </p>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs">
          <span className="text-zinc-500">Current window:</span>{" "}
          <span className="font-semibold text-amber-300">
            {labelHour(initialOpenHour)} → {labelHour(initialCloseHour)}
          </span>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
            Opens at
          </span>
          <select
            value={openHour}
            onChange={(e) => setOpenHour(Number(e.target.value))}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800 p-2.5 text-sm text-white focus:border-amber-500 focus:outline-none"
          >
            {OPEN_OPTIONS.map((h) => (
              <option key={h} value={h}>
                {labelHour(h)}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
            Closes at
          </span>
          <select
            value={closeHour}
            onChange={(e) => setCloseHour(Number(e.target.value))}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800 p-2.5 text-sm text-white focus:border-amber-500 focus:outline-none"
          >
            {CLOSE_OPTIONS.map((h) => (
              <option key={h} value={h}>
                {labelHour(h)}
              </option>
            ))}
          </select>
        </label>

        <div className="block">
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
            Bookable slots / day
          </span>
          <div
            className={`rounded-lg border p-2.5 text-sm font-semibold ${
              valid
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                : "border-red-500/30 bg-red-500/10 text-red-300"
            }`}
          >
            {valid ? `${slotsCount} slot${slotsCount === 1 ? "" : "s"}` : "Invalid"}
          </div>
        </div>
      </div>

      {!valid ? (
        <p className="text-xs text-red-400">
          Closing hour must be after opening hour.
        </p>
      ) : null}
      {error ? <p className="text-xs text-red-400">{error}</p> : null}
      {savedAt && !dirty ? (
        <p className="text-xs text-emerald-400">
          Saved at {savedAt.toLocaleTimeString("en-IN")}. Changes
          apply to the next request.
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={!dirty || !valid || saving}
          className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Save hours
        </button>
        {dirty ? (
          <button
            type="button"
            onClick={() => {
              setOpenHour(initialOpenHour);
              setCloseHour(initialCloseHour);
              setError(null);
            }}
            className="text-xs text-zinc-400 hover:text-zinc-200"
          >
            Reset
          </button>
        ) : null}
      </div>
    </section>
  );
}
