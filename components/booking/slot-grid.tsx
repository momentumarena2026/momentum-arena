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
   * Called when a user taps an unavailable slot. If provided, the
   * tile becomes interactive (no `disabled` attribute) and shows a
   * subtle "Notify me" hint. Wire this to open a waitlist dialog.
   */
  onUnavailableClick?: (hour: number) => void;
}

export function SlotGrid({
  slots,
  selectedHours,
  onSelectionChange,
  onUnavailableClick,
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

          // Unavailable tiles stay clickable when a waitlist handler is
          // wired so the user can recover from the dead-end with a single
          // tap. Without the handler we keep the original disabled UX.
          const unavailableInteractive =
            !isAvailable && Boolean(onUnavailableClick);

          return (
            <button
              key={slot.hour}
              onClick={() => {
                if (isAvailable) {
                  toggleSlot(slot.hour);
                } else if (onUnavailableClick) {
                  onUnavailableClick(slot.hour);
                }
              }}
              disabled={!isAvailable && !onUnavailableClick}
              className={`relative rounded-xl border p-3 text-left transition-all duration-200 ${
                isSelected
                  ? "border-emerald-400 bg-emerald-500/20 ring-1 ring-emerald-400/50"
                  : isAvailable
                    ? "bg-emerald-500/10 hover:bg-emerald-500/20 border-emerald-500/30"
                    : unavailableInteractive
                      ? "bg-zinc-800/50 border-zinc-700 hover:bg-amber-500/5 hover:border-amber-500/30 cursor-pointer opacity-70"
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
                {unavailableInteractive && (
                  <Bell className="h-3.5 w-3.5 text-amber-400/70" />
                )}
              </div>
              <div className={`mt-1 text-xs ${isAvailable ? "text-zinc-400" : "text-zinc-500"}`}>
                {isAvailable
                  ? formatPrice(slot.price)
                  : unavailableInteractive
                    ? "Notify me"
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
