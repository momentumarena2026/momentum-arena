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
      const result = await getAvailableSlots(courtConfigId, date, bookingId);
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
  }, [courtConfigId, date, bookingId]);

  useEffect(() => {
    if (isOpen) {
      setSelectedHours(new Set(currentSlots));
      fetchSlots();
    }
  }, [isOpen, fetchSlots, currentSlots]);

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
      const result = await adminEditBookingSlots(bookingId, hours);
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

        <p className="mb-4 text-sm text-zinc-400">
          {date} &middot; Select the time slots for this booking
        </p>

        {error && (
          <div className="mb-4 rounded-lg bg-red-900/30 border border-red-800 px-4 py-2 text-sm text-red-300">
            {error}
          </div>
        )}

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
                const isCurrent = currentSlots.includes(slot.hour);
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
