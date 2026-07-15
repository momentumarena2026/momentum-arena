"use client";

import type { PassConfigOption } from "@/actions/admin-passes";
import {
  bandKey,
  bandLabel,
  type Band,
  type DayType,
  type TimeType,
} from "@/lib/pass-bands";

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

/** Per-slot price of a band on a config, or undefined. */
export function bandPrice(config: PassConfigOption, band: Band): number | undefined {
  return config.rates.find(
    (r) => r.dayType === band.dayType && r.timeType === band.timeType,
  )?.pricePerSlot;
}

/** Derived per-hour anchor from the selected bands (they all share one
 *  per-slot price). 0 when nothing is selected. */
export function anchorPerHour(
  config: PassConfigOption | undefined,
  bands: Band[],
): number {
  if (!config || bands.length === 0) return 0;
  const slot = bandPrice(config, bands[0]) ?? 0;
  const perHour = config.slotDurationMinutes === 30 ? 2 : 1;
  return slot * perHour;
}

/**
 * Pricing-band checkboxes. A pass binds to ONE price tier: checking a
 * band at ₹X disables every band priced differently, so only same-price
 * bands can be combined. Selecting nothing means "all hours" — callers
 * that require a tier (paid plans) enforce a non-empty selection.
 */
export function BandPicker({
  config,
  selected,
  onChange,
  accent = "emerald",
}: {
  config: PassConfigOption | undefined;
  selected: Band[];
  onChange: (bands: Band[]) => void;
  accent?: "emerald" | "fuchsia";
}) {
  if (!config) {
    return (
      <p className="text-xs text-zinc-500">
        Pick a court to choose pricing bands.
      </p>
    );
  }
  const selKeys = new Set(selected.map(bandKey));
  const lockedPrice = selected.length ? bandPrice(config, selected[0]) ?? null : null;
  const perHourMult = config.slotDurationMinutes === 30 ? 2 : 1;
  const onCls =
    accent === "fuchsia"
      ? "border-fuchsia-500 bg-fuchsia-500/10"
      : "border-emerald-500 bg-emerald-500/10";
  const accentInput = accent === "fuchsia" ? "accent-fuchsia-500" : "accent-emerald-500";

  return (
    <div className="space-y-1.5">
      {config.rates.map((r) => {
        const band: Band = {
          dayType: r.dayType as DayType,
          timeType: r.timeType as TimeType,
        };
        const key = bandKey(band);
        const checked = selKeys.has(key);
        const disabled = lockedPrice != null && r.pricePerSlot !== lockedPrice && !checked;
        return (
          <label
            key={key}
            className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm ${
              checked ? onCls : "border-zinc-700"
            } ${disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer hover:bg-zinc-800/40"}`}
          >
            <span className="flex items-center gap-2">
              <input
                type="checkbox"
                disabled={disabled}
                checked={checked}
                onChange={(e) => {
                  if (e.target.checked) onChange([...selected, band]);
                  else onChange(selected.filter((b) => bandKey(b) !== key));
                }}
                className={`h-4 w-4 ${accentInput}`}
              />
              <span className="text-zinc-200">{bandLabel(band)}</span>
            </span>
            <span className="text-zinc-400">
              {inr(r.pricePerSlot)}
              {perHourMult === 2 ? " /30m" : " /hr"}
            </span>
          </label>
        );
      })}
      {lockedPrice != null && (
        <p className="text-[11px] text-zinc-500">
          Anchor {inr(lockedPrice * perHourMult)}/hr · only bands at this price
          can be combined.
        </p>
      )}
    </div>
  );
}
