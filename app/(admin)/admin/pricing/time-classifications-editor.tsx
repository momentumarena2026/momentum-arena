"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  updateTimeClassification,
  deleteTimeClassification,
} from "@/actions/admin-pricing";
import { formatHourCompact } from "@/lib/court-config";
import {
  Plus,
  Pencil,
  Trash2,
  Save,
  X,
  Loader2,
  AlertCircle,
} from "lucide-react";
import type { DayType, TimeType } from "@prisma/client";

interface ClassificationRow {
  id: string;
  startHour: number;
  endHour: number;
  dayType: DayType;
  timeType: TimeType;
}

/**
 * Inline editor for TimeClassification rows on /admin/pricing.
 *
 * The data shape is "(startHour, dayType)" — the @@unique constraint
 * in the schema means a given (hour, weekday/weekend) combo can have
 * at most one PEAK/OFF_PEAK label. Edits go through the existing
 * upsert path; deletes use the new server action which falls back
 * gracefully to OFF_PEAK for any hour no longer covered (see
 * comment on deleteTimeClassification).
 *
 * UX: each row flips between read-only and an inline edit form;
 * a separate "Add band" form sits at the bottom. We don't try to
 * be cleverer than the existing pricing-editor pattern.
 */
export function TimeClassificationsEditor({
  classifications,
}: {
  classifications: ClassificationRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    startHour: 0,
    endHour: 0,
    dayType: "WEEKDAY" as DayType,
    timeType: "PEAK" as TimeType,
  });
  const [adding, setAdding] = useState(false);
  const [addForm, setAddForm] = useState({
    startHour: 17,
    endHour: 23,
    dayType: "WEEKDAY" as DayType,
    timeType: "PEAK" as TimeType,
  });

  function startEdit(c: ClassificationRow) {
    setEditingId(c.id);
    setEditForm({
      startHour: c.startHour,
      endHour: c.endHour,
      dayType: c.dayType,
      timeType: c.timeType,
    });
    setError(null);
  }

  function saveEdit() {
    setError(null);
    startTransition(async () => {
      const res = await updateTimeClassification(editForm);
      if (!res.success) {
        setError(res.error ?? "Save failed");
        return;
      }
      setEditingId(null);
      router.refresh();
    });
  }

  function saveNew() {
    setError(null);
    startTransition(async () => {
      const res = await updateTimeClassification(addForm);
      if (!res.success) {
        setError(res.error ?? "Save failed");
        return;
      }
      setAdding(false);
      router.refresh();
    });
  }

  function remove(c: ClassificationRow) {
    if (
      !confirm(
        `Delete the ${c.dayType} ${formatHourCompact(c.startHour)}–${formatHourCompact(c.endHour)} ${c.timeType} band? Hours in this range will fall back to OFF_PEAK pricing.`,
      )
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await deleteTimeClassification(c.id);
      if (!res.success) {
        setError(res.error ?? "Delete failed");
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-zinc-500 uppercase tracking-wider">
            Peak / Off-Peak Hours
          </h2>
          <p className="mt-1 text-xs text-zinc-500">
            Hour bands that drive PEAK / OFF_PEAK pricing per slot.
            Ranges are half-open <code>[start, end)</code> — a band of{" "}
            <code>17–23</code> covers 5pm through 10:59pm.
          </p>
        </div>
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-500/15 disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" />
            Add band
          </button>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/10 p-2.5 text-xs text-red-200">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="space-y-2">
        {classifications.map((c) =>
          editingId === c.id ? (
            <EditRow
              key={c.id}
              value={editForm}
              onChange={setEditForm}
              onSave={saveEdit}
              onCancel={() => {
                setEditingId(null);
                setError(null);
              }}
              pending={pending}
              // The startHour is the unique-key portion; show it but
              // don't let it change inline — the upsert would then
              // overwrite a row at the new key, leaking state.
              lockedStartHour={c.startHour}
            />
          ) : (
            <div
              key={c.id}
              className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-sm"
            >
              <div className="flex items-center gap-3">
                <span className="text-zinc-400">
                  {c.dayType} • {formatHourCompact(c.startHour)} -{" "}
                  {formatHourCompact(c.endHour)}
                </span>
                <span
                  className={`rounded-full border px-2 py-0.5 text-xs ${
                    c.timeType === "PEAK"
                      ? "border-red-500/30 bg-red-500/10 text-red-400"
                      : "border-blue-500/30 bg-blue-500/10 text-blue-400"
                  }`}
                >
                  {c.timeType.replace("_", " ")}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => startEdit(c)}
                  disabled={pending}
                  className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-50"
                  aria-label="Edit band"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => remove(c)}
                  disabled={pending}
                  className="rounded-md p-1.5 text-red-400 hover:bg-red-500/10 hover:text-red-300 disabled:opacity-50"
                  aria-label="Delete band"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ),
        )}
      </div>

      {adding && (
        <EditRow
          value={addForm}
          onChange={setAddForm}
          onSave={saveNew}
          onCancel={() => {
            setAdding(false);
            setError(null);
          }}
          pending={pending}
          // New band — startHour is editable.
          lockedStartHour={null}
        />
      )}
    </div>
  );
}

function EditRow({
  value,
  onChange,
  onSave,
  onCancel,
  pending,
  lockedStartHour,
}: {
  value: {
    startHour: number;
    endHour: number;
    dayType: DayType;
    timeType: TimeType;
  };
  onChange: (v: typeof value) => void;
  onSave: () => void;
  onCancel: () => void;
  pending: boolean;
  lockedStartHour: number | null;
}) {
  return (
    <div className="grid grid-cols-1 gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 sm:grid-cols-[1fr_1fr_1fr_1fr_auto]">
      <LabelledSelect
        label="Day"
        value={value.dayType}
        onChange={(v) => onChange({ ...value, dayType: v as DayType })}
        options={[
          { value: "WEEKDAY", label: "Weekday" },
          { value: "WEEKEND", label: "Weekend" },
        ]}
        disabled={pending}
      />
      <LabelledNumber
        label="Start hour (0–24)"
        value={value.startHour}
        onChange={(n) => onChange({ ...value, startHour: n })}
        min={0}
        max={24}
        disabled={pending || lockedStartHour !== null}
        helper={
          lockedStartHour !== null
            ? "Locked — delete + add a new band to change."
            : undefined
        }
      />
      <LabelledNumber
        label="End hour (0–24)"
        value={value.endHour}
        onChange={(n) => onChange({ ...value, endHour: n })}
        min={1}
        max={24}
        disabled={pending}
      />
      <LabelledSelect
        label="Type"
        value={value.timeType}
        onChange={(v) => onChange({ ...value, timeType: v as TimeType })}
        options={[
          { value: "PEAK", label: "PEAK" },
          { value: "OFF_PEAK", label: "OFF PEAK" },
        ]}
        disabled={pending}
      />
      <div className="flex items-end gap-1">
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="inline-flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-2 text-xs font-medium text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
        >
          <X className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={pending}
          className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {pending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Save className="h-3.5 w-3.5" />
          )}
        </button>
      </div>
    </div>
  );
}

function LabelledSelect({
  label,
  value,
  onChange,
  options,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  disabled?: boolean;
}) {
  return (
    <label className="block text-xs">
      <span className="block text-zinc-500 mb-1">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-white focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500/30 disabled:opacity-50"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function LabelledNumber({
  label,
  value,
  onChange,
  min,
  max,
  disabled,
  helper,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min: number;
  max: number;
  disabled?: boolean;
  helper?: string;
}) {
  return (
    <label className="block text-xs">
      <span className="block text-zinc-500 mb-1">{label}</span>
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number.parseInt(e.target.value, 10) || 0)}
        disabled={disabled}
        className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-white focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500/30 disabled:opacity-50"
      />
      {helper && <span className="block text-[10px] text-zinc-600 mt-0.5">{helper}</span>}
    </label>
  );
}
