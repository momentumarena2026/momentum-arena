"use client";

import { useState } from "react";
import { ChevronUp, Check, ShoppingBag } from "lucide-react";
import type { EquipmentOption } from "@/lib/equipment";

/**
 * Inline gear picker that lives above the "Continue" CTA on the slot
 * selection page. Replaces the standalone "Rent gear" card that used
 * to live on the checkout page.
 *
 * Behaviour:
 *   - Always starts collapsed. Customer taps the header to expand.
 *   - The instant the parent reports a slot has been picked
 *     (`shouldExpand` flips false→true), the picker plays a short
 *     horizontal shake to draw attention to it — but does NOT open.
 *     The customer is then in charge of expanding when they want.
 *   - When collapsed AND something is selected, the header chip shows
 *     count + names + price delta ("2 rentals · Bat, Batting kit · +₹2").
 *
 * Pricing math is per-slot: `priceEach × quantity × slotCount`. The
 * label here mirrors the slot-page rate, but the eventual hold/booking
 * total is re-derived server-side in `snapshotEquipmentForHold` so the
 * client can't smuggle a cheaper price.
 *
 * @param options       — fetched on the slot page (RSC, see page.tsx)
 * @param selectedIds   — controlled by the parent so the lockAndCheckout
 *                        path can include the picks in the POST body
 * @param onChange      — fires every toggle with the new Set
 * @param slotCount     — used purely for the rendered "+₹X" preview
 * @param shouldExpand  — flips to true once the user picks their first
 *                        slot; we play a one-shot shake on that
 *                        transition. We do NOT auto-open.
 */
interface Props {
  options: EquipmentOption[];
  selectedIds: Set<string>;
  onChange: (next: Set<string>) => void;
  slotCount: number;
  shouldExpand: boolean;
}

export function GearPicker({
  options,
  selectedIds,
  onChange,
  slotCount,
  shouldExpand,
}: Props) {
  // Always start collapsed. The customer expands when they want — we
  // just nudge their attention with a one-shot shake when the parent
  // signals "they've picked a slot".
  const [expanded, setExpanded] = useState(false);

  // shakeKey bumps each time shouldExpand transitions to true. It's
  // used as React's `key` on the outer wrapper so the animation
  // class is freshly applied (re-mounting the element restarts the
  // keyframe). React docs call this the "previous-render info in
  // state" pattern — prevShouldExpand starts at false so the first
  // mount with shouldExpand=true triggers a shake too (the slot
  // screens gate the picker on `slots > 0`, so the component remounts
  // on every empty→1+ transition).
  const [prevShouldExpand, setPrevShouldExpand] = useState(false);
  const [shakeKey, setShakeKey] = useState(0);
  if (prevShouldExpand !== shouldExpand) {
    setPrevShouldExpand(shouldExpand);
    if (shouldExpand) setShakeKey((k) => k + 1);
  }

  function toggleExpanded() {
    setExpanded((v) => !v);
  }

  if (options.length === 0) return null;

  const safeSlotCount = Math.max(1, slotCount);
  const selected = options.filter((o) => selectedIds.has(o.id));
  const totalPaise = selected.reduce(
    (sum, o) => sum + o.pricePaise * safeSlotCount,
    0,
  );
  const totalRupees = Math.round(totalPaise / 100);
  const cheapestPaise =
    options.reduce(
      (min, o) => (o.pricePaise < min ? o.pricePaise : min),
      options[0].pricePaise,
    ) ?? 0;
  const cheapestRupees = Math.round(cheapestPaise / 100);

  function toggle(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  }

  // Header is always a clickable expand/collapse strip. Its content
  // shifts based on selection state — empty header is a soft prompt,
  // populated header acts like a chip + price tag.
  const hasSelection = selected.length > 0;

  return (
    <div
      key={shakeKey}
      className={`rounded-xl border border-zinc-800 bg-zinc-900/60 ${
        shakeKey > 0 ? "animate-gear-shake" : ""
      }`}
    >
      <button
        type="button"
        onClick={toggleExpanded}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <ShoppingBag
            className={`h-4 w-4 shrink-0 ${
              hasSelection ? "text-emerald-400" : "text-zinc-500"
            }`}
          />
          {hasSelection ? (
            <div className="flex items-center gap-2 min-w-0 flex-1 text-sm">
              <span className="font-medium text-white shrink-0">
                {selected.length} rental{selected.length > 1 ? "s" : ""}
              </span>
              <span className="text-zinc-500 truncate">
                {selected.map((s) => s.name).join(", ")}
              </span>
              <span className="ml-auto font-semibold text-emerald-400 shrink-0">
                +₹{totalRupees}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2 min-w-0 flex-1 text-sm">
              <span className="text-white font-medium shrink-0">Rent gear</span>
              <span className="text-zinc-500 truncate">
                {options.map((o) => o.name).join(", ")}
                {cheapestRupees > 0 ? ` · from ₹${cheapestRupees}` : ""}
              </span>
            </div>
          )}
        </div>
        {/* Chevron — closed=up, open=down (rotates 180° on expand).
            Matches the customer's expected affordance: the arrow
            visually pulls the panel downward when expanded. */}
        <ChevronUp
          className={`h-4 w-4 shrink-0 text-zinc-500 transition-transform ${
            expanded ? "rotate-180" : ""
          }`}
        />
      </button>

      {expanded && (
        <div className="border-t border-zinc-800">
          {/* Cap at 4 rows visible — anything past that becomes a
              scrolling viewport. The max-height is sized to ~4 rows
              of py-2 button + space-y-1.5 gap; the 5th row peeks at
              the bottom so the scroll cue is obvious. overscroll-
              contain keeps trackpad momentum from leaking through to
              the page once the user scrolls past either edge. */}
          <div
            className={`px-3 py-2 space-y-1.5 ${
              options.length > 4
                ? "max-h-[11.5rem] overflow-y-auto overscroll-contain pr-1"
                : ""
            }`}
          >
            {options.map((opt) => {
              const on = selectedIds.has(opt.id);
              const perSlotRupees = Math.round(opt.pricePaise / 100);
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => toggle(opt.id)}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors ${
                    on
                      ? "bg-emerald-500/10 ring-1 ring-emerald-500/30"
                      : "hover:bg-zinc-800/60"
                  }`}
                >
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 ${
                      on
                        ? "border-emerald-500 bg-emerald-500"
                        : "border-zinc-600 bg-zinc-950"
                    }`}
                  >
                    {on && <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />}
                  </span>
                  <span className="flex-1 text-sm text-white">{opt.name}</span>
                  <span className="text-xs font-medium text-zinc-400">
                    +₹{perSlotRupees}
                    <span className="ml-0.5 text-zinc-600">/slot</span>
                  </span>
                </button>
              );
            })}
          </div>
          {safeSlotCount > 1 && hasSelection && (
            <p className="px-6 py-2 text-[11px] text-zinc-500 border-t border-zinc-800/60">
              {selected.length} item{selected.length > 1 ? "s" : ""} × {safeSlotCount}{" "}
              slot{safeSlotCount > 1 ? "s" : ""} = ₹{totalRupees}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
