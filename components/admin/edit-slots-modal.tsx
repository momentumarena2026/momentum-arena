"use client";

import { useState, useEffect, useCallback } from "react";
import { getAvailableSlots, adminEditBookingSlots } from "@/actions/admin-booking";
import { formatHourRangeCompact } from "@/lib/court-config";

interface EditSlotsModalProps {
  bookingId: string;
  courtConfigId: string;
  date: string;
  currentSlots: number[];
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function EditSlotsModal({
  bookingId,
  courtConfigId,
  date,
  currentSlots,
  isOpen,
  onClose,
  onSuccess,
}: EditSlotsModalProps) {
  const [slots, setSlots] = useState<
    { hour: number; price: number; available: boolean; blocked: boolean }[]
  >([]);
  const [selectedDate, setSelectedDate] = useState(date);
  const [selectedHours, setSelectedHours] = useState<Set<number>>(
    new Set(currentSlots)
  );
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSlots = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getAvailableSlots(
        courtConfigId,
        selectedDate,
        bookingId
      );
      if (result.success) {
        setSlots(result.slots);
      } else {
        setError(result.error);
      }
    } catch {
      setError("Failed to load available slots");
    } finally {
      setLoading(false);
    }
  }, [courtConfigId, selectedDate, bookingId]);

  // Reset modal-local state whenever it's reopened. Without this, a second
  // open after the admin had changed the date would keep the stale selection.
  useEffect(() => {
    if (isOpen) {
      setSelectedDate(date);
      setSelectedHours(new Set(currentSlots));
    }
  }, [isOpen, date, currentSlots]);

  useEffect(() => {
    if (isOpen) {
      fetchSlots();
    }
  }, [isOpen, fetchSlots]);

  const handleDateChange = (newDate: string) => {
    setSelectedDate(newDate);
    // The old hour selection is almost never the right answer on a new
    // date (different availability, holds, blocks), so clear it.
    setSelectedHours(new Set());
  };

  const toggleHour = (hour: number) => {
    setSelectedHours((prev) => {
      const next = new Set(prev);
      if (next.has(hour)) {
        next.delete(hour);
      } else {
        next.add(hour);
      }
      return next;
    });
  };

  const totalPrice = slots
    .filter((s) => selectedHours.has(s.hour))
    .reduce((sum, s) => sum + s.price, 0);

  const handleSave = async () => {
    const hours = Array.from(selectedHours).sort((a, b) => a - b);
    if (hours.length === 0) {
      setError("Select at least one slot");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      // Only pass a newDate when it actually changed — otherwise the action
      // would write an identical date value and emit a no-op history entry.
      const newDate = selectedDate !== date ? selectedDate : undefined;
      const result = await adminEditBookingSlots(bookingId, hours, newDate);
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

  // When the date changes, disable the "keep original" affordance for
  // conflicting hours — the `isCurrent` logic below only makes sense on
  // the booking's original date.
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
          <h2 className="text-lg font-semibold text-white">Edit Time Slots</h2>
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

        {/* Date picker — lets admins move a booking to a different day
            without having to cancel + recreate. Changing the date
            refetches availability against the new day. */}
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
          Select the time slots for this booking.
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
            <div className="grid grid-cols-4 gap-2 mb-4 max-h-64 overflow-y-auto pr-1">
              {slots.map((slot) => {
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

            <div className="flex items-center justify-between border-t border-zinc-700 pt-4">
              <div className="text-sm text-zinc-400">
                {selectedHours.size} slot{selectedHours.size !== 1 ? "s" : ""}{" "}
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
                  disabled={saving || selectedHours.size === 0}
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
