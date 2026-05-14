"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Save, Trash2 } from "lucide-react";
import {
  setBowlingMachineHalf,
  updateBowlingMachineWindows,
  type BowlingHalf,
} from "@/actions/admin-bowling-machine";
import type { DayType } from "@prisma/client";

interface Window {
  id: string;
  dayType: DayType;
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
}

interface Settings {
  id: string;
  label: string;
  half: BowlingHalf;
  slotDurationMinutes: number;
  isActive: boolean;
  windows: Window[];
}

/**
 * Edits the two pieces of state unique to the bowling-machine court:
 *
 *   - half: LEFT vs RIGHT toggle that flips the underlying zones[]
 *     array. Saved immediately on click — there's only one bit of
 *     state and confirming feels heavy.
 *   - windows: per-day-type list of open-hours ranges. Edited
 *     locally and saved as a single replace-all transaction so
 *     overlap validation runs against the final intended state.
 *
 * The minute step is hard-locked at 30 to mirror the half-hour
 * slot grid (slotDurationMinutes = 30 for this court).
 */
export function BowlingMachineEditor({ settings }: { settings: Settings }) {
  const router = useRouter();
  const [halfPending, startHalfTransition] = useTransition();
  const [windowsPending, startWindowsTransition] = useTransition();

  // Local editable copy of the window list. Re-seeded from the
  // server payload on initial mount; user edits stay local until
  // they hit Save.
  const [draftWindows, setDraftWindows] = useState<Window[]>(settings.windows);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // ─── Half toggle ──────────────────────────────────────────────
  function flipHalf(next: BowlingHalf) {
    if (next === settings.half) return;
    setError(null);
    startHalfTransition(async () => {
      const r = await setBowlingMachineHalf(next);
      if (!r.success) {
        setError(r.error ?? "Couldn't save");
      } else {
        router.refresh();
      }
    });
  }

  // ─── Window list edits ────────────────────────────────────────
  function addWindow(dayType: DayType) {
    setDraftWindows((prev) => [
      ...prev,
      {
        id: `tmp-${Math.random().toString(36).slice(2, 8)}`,
        dayType,
        startHour: 9,
        startMinute: 0,
        endHour: 17,
        endMinute: 0,
      },
    ]);
  }
  function removeWindow(id: string) {
    setDraftWindows((prev) => prev.filter((w) => w.id !== id));
  }
  function patchWindow(id: string, patch: Partial<Window>) {
    setDraftWindows((prev) =>
      prev.map((w) => (w.id === id ? { ...w, ...patch } : w)),
    );
  }

  function saveWindows() {
    setError(null);
    startWindowsTransition(async () => {
      const r = await updateBowlingMachineWindows(
        draftWindows.map((w) => ({
          dayType: w.dayType,
          startHour: w.startHour,
          startMinute: w.startMinute,
          endHour: w.endHour,
          endMinute: w.endMinute,
        })),
      );
      if (!r.success) {
        setError(r.error ?? "Couldn't save");
        return;
      }
      setSavedAt(Date.now());
      router.refresh();
    });
  }

  const weekday = draftWindows.filter((w) => w.dayType === "WEEKDAY");
  const weekend = draftWindows.filter((w) => w.dayType === "WEEKEND");

  return (
    <div className="space-y-6">
      {/* ── Half-court picker ─────────────────────────────────── */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 space-y-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
            Which physical half does the machine block?
          </h2>
          <p className="mt-1 text-xs text-zinc-500">
            Picks the zones the bowling court occupies. The opposite
            half remains bookable for Box Cricket; the full pitch is
            automatically blocked (zone overlap) whenever a bowling
            slot is booked.
          </p>
        </div>
        <div className="flex gap-2">
          <HalfButton
            label="LEFT half"
            sub="Zones LEATHER_1 · BOX_A"
            active={settings.half === "LEFT"}
            pending={halfPending && settings.half !== "LEFT"}
            onClick={() => flipHalf("LEFT")}
          />
          <HalfButton
            label="RIGHT half"
            sub="Zones LEATHER_2 · BOX_B"
            active={settings.half === "RIGHT"}
            pending={halfPending && settings.half !== "RIGHT"}
            onClick={() => flipHalf("RIGHT")}
          />
        </div>
      </section>

      {/* ── Operating windows ─────────────────────────────────── */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 space-y-5">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
            Open-hours windows
          </h2>
          <p className="mt-1 text-xs text-zinc-500">
            Add one or more disjoint windows per day-type. Times are
            in 30-min steps to match the bowling-machine slot grid.
            Leave a list empty to mark that day-type closed.
          </p>
        </div>

        <DaySection
          title="Weekdays"
          windows={weekday}
          onAdd={() => addWindow("WEEKDAY")}
          onRemove={removeWindow}
          onPatch={patchWindow}
        />
        <DaySection
          title="Weekends"
          windows={weekend}
          onAdd={() => addWindow("WEEKEND")}
          onRemove={removeWindow}
          onPatch={patchWindow}
        />

        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}

        <div className="flex items-center gap-3 pt-1">
          <button
            type="button"
            onClick={saveWindows}
            disabled={windowsPending}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:opacity-60"
          >
            <Save className="h-4 w-4" />
            {windowsPending ? "Saving…" : "Save windows"}
          </button>
          {savedAt && !windowsPending && (
            <span className="text-xs text-emerald-400">Saved ✓</span>
          )}
        </div>
      </section>
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────

function HalfButton({
  label,
  sub,
  active,
  pending,
  onClick,
}: {
  label: string;
  sub: string;
  active: boolean;
  pending: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded-lg border px-4 py-3 text-left transition-colors ${
        active
          ? "border-emerald-500/50 bg-emerald-500/10"
          : "border-zinc-800 bg-zinc-950 hover:border-zinc-700"
      } ${pending ? "opacity-60" : ""}`}
    >
      <p className={`text-sm font-semibold ${active ? "text-emerald-200" : "text-zinc-200"}`}>
        {label}
      </p>
      <p className="mt-0.5 text-xs text-zinc-500">{sub}</p>
    </button>
  );
}

function DaySection({
  title,
  windows,
  onAdd,
  onRemove,
  onPatch,
}: {
  title: string;
  windows: Window[];
  onAdd: () => void;
  onRemove: (id: string) => void;
  onPatch: (id: string, patch: Partial<Window>) => void;
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-zinc-200">{title}</h3>
        <button
          type="button"
          onClick={onAdd}
          className="inline-flex items-center gap-1 rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-xs text-zinc-300 hover:border-zinc-600"
        >
          <Plus className="h-3 w-3" />
          Add window
        </button>
      </div>
      {windows.length === 0 ? (
        <p className="text-xs text-zinc-600">Closed — no bookable slots.</p>
      ) : (
        <div className="space-y-2">
          {windows.map((w) => (
            <WindowRow
              key={w.id}
              window={w}
              onRemove={() => onRemove(w.id)}
              onPatch={(patch) => onPatch(w.id, patch)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function WindowRow({
  window,
  onRemove,
  onPatch,
}: {
  window: Window;
  onRemove: () => void;
  onPatch: (patch: Partial<Window>) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <TimePicker
        hour={window.startHour}
        minute={window.startMinute}
        onChange={(h, m) => onPatch({ startHour: h, startMinute: m })}
      />
      <span className="text-xs text-zinc-500">to</span>
      <TimePicker
        hour={window.endHour}
        minute={window.endMinute}
        onChange={(h, m) => onPatch({ endHour: h, endMinute: m })}
      />
      <button
        type="button"
        onClick={onRemove}
        className="ml-auto rounded-md p-1.5 text-zinc-500 hover:bg-red-500/10 hover:text-red-400"
        aria-label="Remove window"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function TimePicker({
  hour,
  minute,
  onChange,
}: {
  hour: number;
  minute: number;
  onChange: (h: number, m: number) => void;
}) {
  // 0..24 hours and only the two 30-min slots.
  return (
    <div className="flex items-center rounded-md border border-zinc-800 bg-zinc-900 text-sm">
      <select
        value={hour}
        onChange={(e) => onChange(parseInt(e.target.value, 10), minute)}
        className="bg-transparent px-2 py-1 text-white focus:outline-none"
      >
        {Array.from({ length: 25 }, (_, i) => (
          <option key={i} value={i}>
            {i.toString().padStart(2, "0")}
          </option>
        ))}
      </select>
      <span className="text-zinc-600">:</span>
      <select
        value={minute}
        onChange={(e) => onChange(hour, parseInt(e.target.value, 10))}
        className="bg-transparent px-2 py-1 text-white focus:outline-none"
      >
        <option value={0}>00</option>
        <option value={30}>30</option>
      </select>
    </div>
  );
}
