"use client";

import { useCallback } from "react";
import { formatHourRangeCompact, formatHoursAsRanges } from "@/lib/court-config";
import { formatPrice } from "@/lib/pricing";
import type { SlotAvailability } from "@/lib/availability";
import { Bell, Clock, Check } from "lucide-react";

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
   * The current IST hour, ONLY when the selected date is today.
   * `undefined` means the selected date is in the future (no slots
   * are past). Slots with `hour <= pastHourCutoff` are treated as
   * past — see `joinWaitlist` server-side check for the matching
   * cutoff semantics.
   */
  pastHourCutoff?: number;
}

export function SlotGrid({
  slots,
  selectedHours,
  onSelectionChange,
  onUnavailableClick,
  pastHourCutoff,
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

  const total = slots
    .filter((s) => selectedHours.includes(s.hour))
    .reduce((sum, s) => sum + s.price, 0);

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
          // Booked AND in the future AND a waitlist handler is wired.
          // Only these tiles get the RED + Bell + "Notify me" treatment.
          const bookedFutureInteractive =
            !isAvailable && !isPast && Boolean(onUnavailableClick);

          return (
            <button
              key={slot.hour}
              onClick={() => {
                if (isAvailable) {
                  toggleSlot(slot.hour);
                } else if (bookedFutureInteractive && onUnavailableClick) {
                  onUnavailableClick(slot.hour);
                }
              }}
              disabled={!isAvailable && !bookedFutureInteractive}
              className={`relative rounded-xl border p-3 text-left transition-all duration-200 ${
                isSelected
                  ? "border-emerald-400 bg-emerald-500/20 ring-1 ring-emerald-400/50"
                  : isAvailable
                    ? "bg-emerald-500/10 hover:bg-emerald-500/20 border-emerald-500/30"
                    : bookedFutureInteractive
                      ? "bg-red-500/10 border-red-500/40 hover:bg-red-500/15 hover:border-red-500/60 cursor-pointer"
                      : "bg-zinc-800/50 border-zinc-700 cursor-not-allowed opacity-50"
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 text-zinc-500" />
                  <span className="text-sm font-medium text-white">
                    {formatHourRangeCompact(slot.hour)}
                  </span>
                </div>
                {isSelected && <Check className="h-4 w-4 text-emerald-400" />}
                {bookedFutureInteractive && (
                  <Bell className="h-3.5 w-3.5 text-red-400" />
                )}
              </div>
              <div
                className={`mt-1 text-xs ${
                  isAvailable
                    ? "text-zinc-400"
                    : bookedFutureInteractive
                      ? "text-red-300/90"
                      : "text-zinc-500"
                }`}
              >
                {isAvailable
                  ? formatPrice(slot.price)
                  : bookedFutureInteractive
                    ? "Booked · Notify me"
                    : isPast
                      ? "Past"
                      : "Unavailable"}
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
              <p className="text-lg font-bold text-emerald-400">
                {formatPrice(total)}
              </p>
              <p className="text-xs text-zinc-500">Total</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
