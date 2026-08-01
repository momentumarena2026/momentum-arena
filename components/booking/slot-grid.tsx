"use client";

import { useCallback } from "react";
import {
  formatHourRangeCompact,
  formatHoursAsRanges,
  summarizeAvailability,
  summarizeBlockers,
} from "@/lib/court-config";
import { formatPrice } from "@/lib/pricing";
import type { SlotAvailability } from "@/lib/availability";
import {
  type ActiveSportPromo,
  computeAutoApplyDiscount,
} from "@/lib/auto-apply-promo";
import { Bell, Clock, Check, ArrowRightLeft } from "lucide-react";

interface SlotGridProps {
  slots: SlotAvailability[];
  selectedHours: number[];
  onSelectionChange: (hours: number[]) => void;
  /**
   * Called when a user taps an unavailable (but still future) slot.
   * If provided, future-booked tiles become interactive with a RED
   * highlight + Bell + "Notify me" label so users can join the
   * waitlist. Past slots (`hour <= pastHourCutoff`) ignore this
   * callback — they're rendered as plain disabled grey since you
   * can't waitlist for a slot that's already started.
   */
  onUnavailableClick?: (hour: number) => void;
  /**
   * Called when a user taps a SOFT-blocked tile — one that's
   * unavailable on this exact court but where the same hour is
   * still bookable on a sibling court (e.g. Full Field is booked
   * but Right Half is free). Tile renders AMBER + reason tag
   * ("Right half booked · See alternatives") instead of the red
   * notify-me treatment, and tap fires this callback so the
   * parent can pop an alternatives sheet listing the sibling
   * configs that are still free at that hour.
   *
   * Falls through to `onUnavailableClick` when the slot has no
   * alternatives (true hard-block, e.g. Full Field genuinely full).
   */
  onShowAlternatives?: (slot: SlotAvailability) => void;
  /**
   * The current IST hour, ONLY when the selected date is today.
   * `undefined` means the selected date is in the future (no slots
   * are past). Slots with `hour <= pastHourCutoff` are treated as
   * past — see `joinWaitlist` server-side check for the matching
   * cutoff semantics.
   */
  pastHourCutoff?: number;
  /**
   * Active auto-apply promo for this sport. When `promo.percentOff` is
   * non-null we render each available tile with strike-through original
   * + amber discounted price, and the selection-summary total mirrors
   * the same treatment. Per-slot math uses computeAutoApplyDiscount,
   * which mirrors the validator's Math.floor formula exactly so the
   * displayed total = the amount the user pays at checkout.
   */
  promo?: ActiveSportPromo | null;
}

export function SlotGrid({
  slots,
  selectedHours,
  onSelectionChange,
  onUnavailableClick,
  onShowAlternatives,
  pastHourCutoff,
  promo,
}: SlotGridProps) {
  const toggleSlot = useCallback(
    (hour: number) => {
      if (selectedHours.includes(hour)) {
        onSelectionChange(selectedHours.filter((h) => h !== hour));
      } else {
        onSelectionChange([...selectedHours, hour].sort((a, b) => a - b));
      }
    },
    [selectedHours, onSelectionChange]
  );

  // Per-slot decoration only kicks in for an uncapped PERCENTAGE promo
  // (promo.percentOff !== null). FLAT promos like FLAT100 apply once to
  // the whole order so we don't try to slice them per slot — the tiles
  // render at their list price and the FLAT100 fallback still fires at
  // checkout via the existing useEffect there.
  const showDiscount = promo?.percentOff != null;
  const discountedPrice = (rupees: number) =>
    promo ? rupees - computeAutoApplyDiscount(rupees, promo) : rupees;

  const totalOriginal = slots
    .filter((s) => selectedHours.includes(s.hour))
    .reduce((sum, s) => sum + s.price, 0);
  // PERCENTAGE promos slice per slot (sum of per-slot floors = the
  // whole-order discount); FLAT promos apply ONCE to the selection
  // total — per-tile decoration stays off for them, but the selection
  // summary still strikes the total, which is exactly what checkout
  // will charge.
  const totalDiscounted = showDiscount
    ? slots
        .filter((s) => selectedHours.includes(s.hour))
        .reduce((sum, s) => sum + discountedPrice(s.price), 0)
    : promo && totalOriginal > 0
      ? Math.max(0, totalOriginal - computeAutoApplyDiscount(totalOriginal, promo))
      : totalOriginal;

  return (
    <div className="space-y-4">
      {/* Slot Grid */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
        {slots.map((slot) => {
          const isSelected = selectedHours.includes(slot.hour);
          const isAvailable = slot.status === "available";

          // A slot is "past" when the selected date is today and the
          // slot's start hour has already arrived. Matches the server's
          // joinWaitlist cutoff (expiresAt <= now). Past slots get the
          // plain disabled treatment — no Bell, no waitlist option.
          const isPast =
            pastHourCutoff !== undefined && slot.hour <= pastHourCutoff;

          // Soft block — unavailable on THIS court, but the same hour
          // is still bookable on a sibling court (e.g. Full Field is
          // taken but Right Half is free). Renders AMBER and the tap
          // opens the alternatives sheet via the parent. Takes priority
          // over the red notify-me treatment because pivoting to an
          // available alternative is a better outcome than waitlisting.
          const altCount = slot.blockedReason?.alternativesAtThisHour.length ?? 0;
          const softBlockInteractive =
            !isAvailable &&
            !isPast &&
            altCount > 0 &&
            Boolean(onShowAlternatives);

          // Booked AND in the future AND a waitlist handler is wired —
          // ONLY when the slot has no available alternatives. Once we
          // surface an amber-pivot path, the red notify-me would
          // crowd the tile.
          const bookedFutureInteractive =
            !isAvailable &&
            !isPast &&
            !softBlockInteractive &&
            Boolean(onUnavailableClick);

          // Amber tile (soft block) tag — positive framing, derived
          // from what's STILL bookable. Customer reads "Half
          // Available" whether a half-court or the bowling machine
          // triggered the block. Only meaningful when alternatives
          // exist, i.e. when softBlockInteractive is true.
          const availabilityTag = slot.blockedReason
            ? summarizeAvailability(slot.blockedReason.alternativesAtThisHour)
            : null;
          // Red tile (hard block / notify-me) tag — keeps the
          // specific blocker info ("Full court booked") so the
          // user who joins the waitlist understands what they're
          // queuing on.
          const blockedReasonTag = slot.blockedReason
            ? summarizeBlockers(slot.blockedReason.blockedBy)
            : null;

          return (
            <button
              key={slot.hour}
              onClick={() => {
                if (isAvailable) {
                  toggleSlot(slot.hour);
                } else if (softBlockInteractive && onShowAlternatives) {
                  onShowAlternatives(slot);
                } else if (bookedFutureInteractive && onUnavailableClick) {
                  onUnavailableClick(slot.hour);
                }
              }}
              disabled={
                !isAvailable && !softBlockInteractive && !bookedFutureInteractive
              }
              className={`relative rounded-xl border p-3 text-left transition-all duration-200 ${
                isSelected
                  ? "border-emerald-400 bg-emerald-500/20 ring-1 ring-emerald-400/50"
                  : isAvailable
                    ? "bg-emerald-500/10 hover:bg-emerald-500/20 border-emerald-500/30"
                    : softBlockInteractive
                      ? "bg-amber-500/10 border-amber-500/40 hover:bg-amber-500/15 hover:border-amber-500/60 cursor-pointer"
                      : bookedFutureInteractive
                        ? "bg-red-500/10 border-red-500/40 hover:bg-red-500/15 hover:border-red-500/60 cursor-pointer"
                        : "bg-zinc-800/50 border-zinc-700 cursor-not-allowed opacity-50"
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex min-w-0 items-center gap-1.5">
                  <Clock className="h-3 w-3 shrink-0 text-zinc-500" />
                  {/* `whitespace-nowrap` keeps the time on one line so the
                      tile height stays uniform across all sports (bowling's
                      "9:30am - 10am" was wrapping at text-sm). `text-xs`
                      matches what the bowling format needs to fit the
                      mobile 2-col grid; hourly cricket/football/pickleball
                      shrink in lockstep so the grid looks consistent. */}
                  <span className="whitespace-nowrap text-xs font-medium text-white">
                    {formatHourRangeCompact(slot.hour)}
                  </span>
                </div>
                {isSelected && <Check className="h-4 w-4 text-emerald-400" />}
                {softBlockInteractive && (
                  <ArrowRightLeft className="h-3.5 w-3.5 text-amber-400" />
                )}
                {bookedFutureInteractive && (
                  <Bell className="h-3.5 w-3.5 text-red-400" />
                )}
              </div>
              <div
                className={`mt-1 text-xs ${
                  isAvailable
                    ? "text-zinc-400"
                    : softBlockInteractive
                      ? "text-amber-300/90"
                      : bookedFutureInteractive
                        ? "text-red-300/90"
                        : "text-zinc-500"
                }`}
              >
                {isAvailable ? (
                  showDiscount ? (
                    <span className="inline-flex items-baseline gap-1.5">
                      <span className="text-zinc-500 line-through">
                        {formatPrice(slot.price)}
                      </span>
                      <span className="font-semibold text-yellow-300">
                        {formatPrice(discountedPrice(slot.price))}
                      </span>
                    </span>
                  ) : (
                    formatPrice(slot.price)
                  )
                ) : softBlockInteractive ? (
                  // Soft block — positive framing on what's still
                  // bookable ("Half Available") rather than what's
                  // blocked. The arrow icon at the top right signals
                  // the pivot affordance.
                  <span className="block">
                    {availabilityTag ?? "Available"}
                    <span className="block text-[10px] text-amber-400/80">
                      Tap to see options
                    </span>
                  </span>
                ) : bookedFutureInteractive ? (
                  // Hard block — render the reason where we have one
                  // so the user knows what's specifically full, then
                  // the existing Notify-me affordance.
                  blockedReasonTag
                    ? `${blockedReasonTag} · Notify me`
                    : "Booked · Notify me"
                ) : isPast ? (
                  "Past"
                ) : (
                  "Unavailable"
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Selection Summary */}
      {selectedHours.length > 0 && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-zinc-400">
                {selectedHours.length} slot{selectedHours.length > 1 ? "s" : ""} selected
              </p>
              <p className="text-xs text-zinc-500">
                {formatHoursAsRanges(selectedHours)}
              </p>
            </div>
            <div className="text-right">
              {totalDiscounted < totalOriginal ? (
                <p className="text-lg font-bold">
                  <span className="mr-2 text-sm text-zinc-500 line-through">
                    {formatPrice(totalOriginal)}
                  </span>
                  <span className="text-yellow-300">
                    {formatPrice(totalDiscounted)}
                  </span>
                </p>
              ) : (
                <p className="text-lg font-bold text-emerald-400">
                  {formatPrice(totalOriginal)}
                </p>
              )}
              <p className="text-xs text-zinc-500">Total</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
