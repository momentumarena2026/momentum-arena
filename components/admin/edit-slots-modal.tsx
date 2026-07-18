"use client";

import { useState, useEffect, useCallback } from "react";
import {
  adminEditBookingSlots,
  getAvailableBowlingSlots,
  getAvailableSlots,
} from "@/actions/admin-booking";
import { formatHourRangeCompact } from "@/lib/court-config";

interface EditSlotsModalProps {
  bookingId: string;
  courtConfigId: string;
  date: string;
  /**
   * Hour-only summary of the booking's current slots — used to
   * pre-select hourly courts and to highlight "this was already
   * yours" cells on the original date even after a refetch.
   *
   * Bowling-machine bookings ALSO pass their current 30-min
   * picks via `currentBowlingSlots` so the half-hour grid can
   * render the same affordance at slot-granularity.
   */
  currentSlots: number[];
  currentBowlingSlots?: Array<{ hour: number; minute: 0 | 30 }>;
  /**
   * Per-court slot duration in minutes. Bowling-machine courts
   * report 30; everything else 60. Drives the grid mode + which
   * server action gets called.
   */
  slotDurationMinutes?: number;
  /** Customer's eligible pass for covering ADDED time (name + balance).
   *  Null hides the option; the server re-validates on save. */
  deltaPass?: { name: string; remainingMinutes: number } | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

interface HourSlot {
  hour: number;
  price: number;
  available: boolean;
  blocked: boolean;
}

interface BowlingSlot {
  hour: number;
  minute: 0 | 30;
  price: number;
  available: boolean;
  blocked: boolean;
}

function keyOf(h: number, m: number) {
  return `${h}:${m}`;
}

function formatBowlingRange(hour: number, minute: 0 | 30): string {
  const endTotal = hour * 60 + minute + 30;
  const endH = Math.floor(endTotal / 60) % 24;
  const endM = endTotal % 60;
  const fmt = (h: number, m: number) => {
    const ampm = h < 12 || h === 24 ? "am" : "pm";
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return m === 0 ? `${h12}${ampm}` : `${h12}:${m.toString().padStart(2, "0")}${ampm}`;
  };
  return `${fmt(hour, minute)} - ${fmt(endH, endM)}`;
}

export function EditSlotsModal({
  deltaPass,
  bookingId,
  courtConfigId,
  date,
  currentSlots,
  currentBowlingSlots,
  slotDurationMinutes = 60,
  isOpen,
  onClose,
  onSuccess,
}: EditSlotsModalProps) {
  const isBowlingMode = slotDurationMinutes === 30;

  const [hourSlots, setHourSlots] = useState<HourSlot[]>([]);
  const [bowlingSlots, setBowlingSlots] = useState<BowlingSlot[]>([]);
  const [selectedDate, setSelectedDate] = useState(date);
  const [selectedHours, setSelectedHours] = useState<Set<number>>(
    new Set(currentSlots),
  );
  const [selectedBowling, setSelectedBowling] = useState<Set<string>>(
    new Set((currentBowlingSlots ?? []).map((s) => keyOf(s.hour, s.minute))),
  );
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [coverWithPass, setCoverWithPass] = useState(false);

  const fetchSlots = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (isBowlingMode) {
        const result = await getAvailableBowlingSlots(
          courtConfigId,
          selectedDate,
          bookingId,
        );
        if (result.success) {
          setBowlingSlots(result.slots);
        } else {
          setError(result.error);
        }
      } else {
        const result = await getAvailableSlots(
          courtConfigId,
          selectedDate,
          bookingId,
        );
        if (result.success) {
          setHourSlots(result.slots);
        } else {
          setError(result.error);
        }
      }
    } catch {
      setError("Failed to load available slots");
    } finally {
      setLoading(false);
    }
  }, [courtConfigId, selectedDate, bookingId, isBowlingMode]);

  // Reset modal-local state whenever it's reopened. Without this, a second
  // open after the admin had changed the date would keep the stale selection.
  useEffect(() => {
    if (isOpen) {
      setSelectedDate(date);
      setSelectedHours(new Set(currentSlots));
      setSelectedBowling(
        new Set((currentBowlingSlots ?? []).map((s) => keyOf(s.hour, s.minute))),
      );
    }
  }, [isOpen, date, currentSlots, currentBowlingSlots]);

  useEffect(() => {
    if (isOpen) {
      fetchSlots();
    }
  }, [isOpen, fetchSlots]);

  const handleDateChange = (newDate: string) => {
    setSelectedDate(newDate);
    setSelectedHours(new Set());
    setSelectedBowling(new Set());
  };

  const toggleHour = (hour: number) => {
    setSelectedHours((prev) => {
      const next = new Set(prev);
      if (next.has(hour)) next.delete(hour);
      else next.add(hour);
      return next;
    });
  };

  const toggleBowling = (h: number, m: 0 | 30) => {
    const k = keyOf(h, m);
    setSelectedBowling((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  const totalPrice = isBowlingMode
    ? bowlingSlots
        .filter((s) => selectedBowling.has(keyOf(s.hour, s.minute)))
        .reduce((sum, s) => sum + s.price, 0)
    : hourSlots
        .filter((s) => selectedHours.has(s.hour))
        .reduce((sum, s) => sum + s.price, 0);

  const handleSave = async () => {
    const selectionCount = isBowlingMode
      ? selectedBowling.size
      : selectedHours.size;
    if (selectionCount === 0) {
      setError("Select at least one slot");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      // Only pass a newDate when it actually changed — otherwise the action
      // would write an identical date value and emit a no-op history entry.
      const newDate = selectedDate !== date ? selectedDate : undefined;
      let result;
      if (isBowlingMode) {
        const picks = Array.from(selectedBowling)
          .map((k) => {
            const [h, m] = k.split(":").map(Number);
            return { hour: h, minute: (m === 30 ? 30 : 0) as 0 | 30 };
          })
          .sort(
            (a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute),
          );
        result = await adminEditBookingSlots(
          bookingId,
          [],
          newDate,
          undefined,
          picks,
          coverWithPass,
        );
      } else {
        const hours = Array.from(selectedHours).sort((a, b) => a - b);
        result = await adminEditBookingSlots(
          bookingId,
          hours,
          newDate,
          undefined,
          undefined,
          coverWithPass,
        );
      }
      if (result.success) {
        onSuccess();
        onClose();
      } else {
        setError(result.error);
      }
    } catch {
      setError("Failed to save changes");
    } finally {
      setSaving(false);
    }
  };

  const isOriginalDate = selectedDate === date;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative z-10 w-full max-w-lg rounded-xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">
            {isBowlingMode ? "Edit 30-min Slots" : "Edit Time Slots"}
          </h2>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-white transition-colors"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-lg bg-red-900/30 border border-red-800 px-4 py-2 text-sm text-red-300">
            {error}
          </div>
        )}

        <div className="mb-4">
          <label className="mb-1.5 block text-sm font-medium text-zinc-300">
            Date
          </label>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => handleDateChange(e.target.value)}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 focus:border-emerald-500 focus:outline-none"
          />
          {!isOriginalDate && (
            <p className="mt-1 text-xs text-amber-300">
              Moving from {date} to {selectedDate} — re-select slots below.
            </p>
          )}
        </div>

        <p className="mb-3 text-xs text-zinc-500">
          {isBowlingMode
            ? "Select 30-minute slots — multiple selections allowed."
            : "Select the time slots for this booking."}
        </p>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-600 border-t-emerald-500" />
            <span className="ml-3 text-sm text-zinc-400">
              Loading slots...
            </span>
          </div>
        ) : (
          <>
            {isBowlingMode ? (
              <div className="grid grid-cols-3 gap-2 mb-4 max-h-64 overflow-y-auto pr-1">
                {bowlingSlots.length === 0 ? (
                  <div className="col-span-3 rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-6 text-center text-sm text-zinc-500">
                    No bowling-machine slots configured for this day.
                  </div>
                ) : (
                  bowlingSlots.map((slot) => {
                    const k = keyOf(slot.hour, slot.minute);
                    const isSelected = selectedBowling.has(k);
                    const isCurrent =
                      isOriginalDate &&
                      (currentBowlingSlots ?? []).some(
                        (s) => s.hour === slot.hour && s.minute === slot.minute,
                      );
                    const canToggle = slot.available || isCurrent;
                    return (
                      <button
                        key={k}
                        disabled={!canToggle}
                        onClick={() => toggleBowling(slot.hour, slot.minute)}
                        className={`flex flex-col items-center rounded-lg border px-2 py-2 text-[11px] transition-all ${
                          isSelected
                            ? "border-emerald-500 bg-emerald-500/20 text-emerald-300"
                            : canToggle
                              ? "border-zinc-700 bg-zinc-800 text-zinc-300 hover:border-zinc-500"
                              : "border-zinc-800 bg-zinc-800/50 text-zinc-600 cursor-not-allowed"
                        }`}
                      >
                        <span className="font-medium">
                          {formatBowlingRange(slot.hour, slot.minute)}
                        </span>
                        <span
                          className={`mt-0.5 ${
                            isSelected ? "text-emerald-400" : "text-zinc-500"
                          }`}
                        >
                          ₹{slot.price}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            ) : (
              <div className="grid grid-cols-4 gap-2 mb-4 max-h-64 overflow-y-auto pr-1">
                {hourSlots.map((slot) => {
                  const isSelected = selectedHours.has(slot.hour);
                  // Only let the admin keep a "currently booked" slot active
                  // when they're still on the original date; on a new date,
                  // the current-slot exception doesn't apply.
                  const isCurrent =
                    isOriginalDate && currentSlots.includes(slot.hour);
                  const canToggle = slot.available || isCurrent;

                  return (
                    <button
                      key={slot.hour}
                      disabled={!canToggle}
                      onClick={() => toggleHour(slot.hour)}
                      className={`flex flex-col items-center rounded-lg border px-2 py-2 text-xs transition-all ${
                        isSelected
                          ? "border-emerald-500 bg-emerald-500/20 text-emerald-300"
                          : canToggle
                            ? "border-zinc-700 bg-zinc-800 text-zinc-300 hover:border-zinc-500"
                            : "border-zinc-800 bg-zinc-800/50 text-zinc-600 cursor-not-allowed"
                      }`}
                    >
                      <span className="font-medium">{formatHourRangeCompact(slot.hour)}</span>
                      <span
                        className={`mt-0.5 ${isSelected ? "text-emerald-400" : "text-zinc-500"}`}
                      >
                        ₹{slot.price}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            <div className="flex items-center justify-between border-t border-zinc-700 pt-4">
              <div className="text-sm text-zinc-400">
                {deltaPass &&
                  (() => {
                    const dur = isBowlingMode ? 30 : slotDurationMinutes ?? 60;
                    const newMin =
                      (isBowlingMode ? selectedBowling.size : selectedHours.size) * dur;
                    const oldMin =
                      (currentBowlingSlots?.length ?? currentSlots.length) *
                      (isBowlingMode ? 30 : slotDurationMinutes ?? 60);
                    const added = newMin - oldMin;
                    if (added <= 0) return null;
                    const enough = deltaPass.remainingMinutes >= added;
                    return (
                      <label className="mb-2 flex cursor-pointer items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-300">
                        <input
                          type="checkbox"
                          checked={coverWithPass}
                          onChange={(e) => setCoverWithPass(e.target.checked)}
                          disabled={!enough}
                          className="h-4 w-4 rounded border-zinc-600 bg-zinc-800 text-emerald-600"
                        />
                        Cover the added {added / 60}h from {deltaPass.name} (
                        {(deltaPass.remainingMinutes / 60).toFixed(1).replace(/\.0$/, "")}
                        h left)
                        {!enough && (
                          <span className="text-amber-400">— not enough balance</span>
                        )}
                      </label>
                    );
                  })()}
                {isBowlingMode ? selectedBowling.size : selectedHours.size} slot
                {(isBowlingMode ? selectedBowling.size : selectedHours.size) !== 1
                  ? "s"
                  : ""}{" "}
                selected &middot;{" "}
                <span className="font-semibold text-white">
                  ₹{totalPrice.toLocaleString("en-IN")}
                </span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={onClose}
                  className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={
                    saving ||
                    (isBowlingMode
                      ? selectedBowling.size === 0
                      : selectedHours.size === 0)
                  }
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {saving ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
