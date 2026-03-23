"use client";

import { useState, useEffect, useCallback } from "react";
import { formatHour } from "@/lib/court-config";
import { formatPrice } from "@/lib/pricing";
import type { SlotAvailability } from "@/lib/availability";
import { Clock, Lock, Ban, Check } from "lucide-react";

interface SlotGridProps {
  slots: SlotAvailability[];
  selectedHours: number[];
  onSelectionChange: (hours: number[]) => void;
}

const statusConfig = {
  available: {
    bg: "bg-emerald-500/10 hover:bg-emerald-500/20 border-emerald-500/30",
    text: "text-emerald-400",
    icon: null,
    label: "Available",
  },
  booked: {
    bg: "bg-red-500/10 border-red-500/20",
    text: "text-red-400",
    icon: Ban,
    label: "Booked",
  },
  locked: {
    bg: "bg-yellow-500/10 border-yellow-500/20",
    text: "text-yellow-400",
    icon: Lock,
    label: "Reserved",
  },
  blocked: {
    bg: "bg-zinc-800/50 border-zinc-700",
    text: "text-zinc-500",
    icon: Ban,
    label: "Blocked",
  },
};

export function SlotGrid({ slots, selectedHours, onSelectionChange }: SlotGridProps) {
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
      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-xs">
        {Object.entries(statusConfig).map(([key, config]) => (
          <div key={key} className="flex items-center gap-1.5">
            <div className={`h-3 w-3 rounded border ${config.bg}`} />
            <span className="text-zinc-400">{config.label}</span>
          </div>
        ))}
        <div className="flex items-center gap-1.5">
          <div className="h-3 w-3 rounded border border-emerald-400 bg-emerald-500/30" />
          <span className="text-zinc-400">Selected</span>
        </div>
      </div>

      {/* Slot Grid */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
        {slots.map((slot) => {
          const isSelected = selectedHours.includes(slot.hour);
          const isAvailable = slot.status === "available";
          const config = statusConfig[slot.status];
          const StatusIcon = config.icon;

          return (
            <button
              key={slot.hour}
              onClick={() => isAvailable && toggleSlot(slot.hour)}
              disabled={!isAvailable}
              className={`relative rounded-xl border p-3 text-left transition-all duration-200 ${
                isSelected
                  ? "border-emerald-400 bg-emerald-500/20 ring-1 ring-emerald-400/50"
                  : config.bg
              } ${isAvailable ? "cursor-pointer" : "cursor-not-allowed opacity-60"}`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 text-zinc-500" />
                  <span className="text-sm font-medium text-white">
                    {formatHour(slot.hour)}
                  </span>
                </div>
                {isSelected && <Check className="h-4 w-4 text-emerald-400" />}
                {StatusIcon && !isSelected && (
                  <StatusIcon className={`h-3.5 w-3.5 ${config.text}`} />
                )}
              </div>
              <div className={`mt-1 text-xs ${isAvailable ? "text-zinc-400" : config.text}`}>
                {isAvailable ? formatPrice(slot.price) : config.label}
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
                {selectedHours.map((h) => formatHour(h)).join(", ")}
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
