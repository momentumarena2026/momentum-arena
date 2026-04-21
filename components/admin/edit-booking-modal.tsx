"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { getAvailableSlots, adminEditBookingFull } from "@/actions/admin-booking";
import { formatHourRangeCompact, SPORT_INFO } from "@/lib/court-config";
import type { Sport } from "@prisma/client";

interface EditBookingModalProps {
  bookingId: string;
  currentCourtConfigId: string;
  currentDate: string;
  currentSlots: number[];
  sport: string;
  courtConfigs: {
    id: string;
    label: string;
    size: string;
    position: string;
    sport: Sport;
  }[];
  // Payment context — when the booking is a partial payment that hasn't had
  // its remainder collected yet, the modal also exposes advance-amount and
  // advance-method fields.
  isPartialPayment: boolean;
  currentAdvanceAmount: number | null;
  currentAdvanceMethod: string | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function EditBookingModal({
  bookingId,
  currentCourtConfigId,
  currentDate,
  currentSlots,
  sport,
  courtConfigs,
  isPartialPayment,
  currentAdvanceAmount,
  currentAdvanceMethod,
  isOpen,
  onClose,
  onSuccess,
}: EditBookingModalProps) {
  const [selectedConfigId, setSelectedConfigId] = useState(currentCourtConfigId);
  const [selectedDate, setSelectedDate] = useState(currentDate);
  const [selectedHours, setSelectedHours] = useState<Set<number>>(
    new Set(currentSlots)
  );
  const initialAdvanceStr =
    currentAdvanceAmount !== null ? String(currentAdvanceAmount) : "";
  const initialAdvanceMethod: "CASH" | "UPI_QR" =
    currentAdvanceMethod === "UPI_QR" ? "UPI_QR" : "CASH";
  const [advanceAmountStr, setAdvanceAmountStr] = useState(initialAdvanceStr);
  const [advanceMethod, setAdvanceMethod] = useState<"CASH" | "UPI_QR">(
    initialAdvanceMethod
  );
  const [slots, setSlots] = useState<
    { hour: number; price: number; available: boolean; blocked: boolean }[]
  >([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSlots = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getAvailableSlots(
        selectedConfigId,
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
  }, [selectedConfigId, selectedDate, bookingId]);

  useEffect(() => {
    if (isOpen) {
      setSelectedConfigId(currentCourtConfigId);
      setSelectedDate(currentDate);
      setSelectedHours(new Set(currentSlots));
      setAdvanceAmountStr(
        currentAdvanceAmount !== null ? String(currentAdvanceAmount) : ""
      );
      setAdvanceMethod(currentAdvanceMethod === "UPI_QR" ? "UPI_QR" : "CASH");
    }
  }, [
    isOpen,
    currentCourtConfigId,
    currentDate,
    currentSlots,
    currentAdvanceAmount,
    currentAdvanceMethod,
  ]);

  useEffect(() => {
    if (isOpen) {
      fetchSlots();
    }
  }, [isOpen, fetchSlots]);

  const handleConfigChange = (configId: string) => {
    setSelectedConfigId(configId);
    setSelectedHours(new Set());
  };

  // Group configs by sport so the dropdown can render <optgroup>s, and
  // surface the selected/original sports to drive the warning banner
  // when the admin moves a booking across sports (e.g. mistyped cricket
  // when it should have been football).
  const configsBySport = useMemo(() => {
    const groups = new Map<Sport, typeof courtConfigs>();
    for (const config of courtConfigs) {
      const existing = groups.get(config.sport);
      if (existing) {
        existing.push(config);
      } else {
        groups.set(config.sport, [config]);
      }
    }
    return groups;
  }, [courtConfigs]);

  const originalConfig = courtConfigs.find(
    (c) => c.id === currentCourtConfigId
  );
  const selectedConfig = courtConfigs.find((c) => c.id === selectedConfigId);
  const originalSport = originalConfig?.sport ?? (sport as Sport);
  const selectedSport = selectedConfig?.sport ?? originalSport;
  const sportChanged = originalSport !== selectedSport;

  const handleDateChange = (date: string) => {
    setSelectedDate(date);
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

  const parsedAdvance = parseInt(advanceAmountStr, 10);
  const advanceAmountNum = Number.isFinite(parsedAdvance) ? parsedAdvance : null;
  const advanceAmountChanged =
    isPartialPayment &&
    advanceAmountNum !== null &&
    advanceAmountNum !== currentAdvanceAmount;
  const advanceMethodChanged =
    isPartialPayment &&
    (currentAdvanceMethod === "UPI_QR" ? "UPI_QR" : "CASH") !== advanceMethod;
  const advanceValid =
    !isPartialPayment ||
    (advanceAmountNum !== null &&
      advanceAmountNum > 0 &&
      advanceAmountNum < totalPrice);

  const hasChanges =
    selectedConfigId !== currentCourtConfigId ||
    selectedDate !== currentDate ||
    selectedHours.size !== currentSlots.length ||
    !currentSlots.every((h) => selectedHours.has(h)) ||
    advanceAmountChanged ||
    advanceMethodChanged;

  const handleSave = async () => {
    const hours = Array.from(selectedHours).sort((a, b) => a - b);
    if (hours.length === 0) {
      setError("Select at least one slot");
      return;
    }
    setSaving(true);
    setError(null);

    if (!advanceValid) {
      setError(`Advance must be between ₹1 and ₹${(totalPrice - 1).toLocaleString("en-IN")}`);
      return;
    }
    try {
      const payload: {
        newDate?: string;
        newCourtConfigId?: string;
        newHours?: number[];
        newAdvanceAmount?: number;
        newAdvanceMethod?: "CASH" | "UPI_QR";
      } = {};

      if (selectedDate !== currentDate) {
        payload.newDate = selectedDate;
      }
      if (selectedConfigId !== currentCourtConfigId) {
        payload.newCourtConfigId = selectedConfigId;
      }
      const sortedCurrent = [...currentSlots].sort((a, b) => a - b);
      const slotsChanged =
        hours.length !== sortedCurrent.length ||
        hours.some((h, i) => h !== sortedCurrent[i]);
      if (slotsChanged) {
        payload.newHours = hours;
      }
      if (advanceAmountChanged && advanceAmountNum !== null) {
        payload.newAdvanceAmount = advanceAmountNum;
      }
      if (advanceMethodChanged) {
        payload.newAdvanceMethod = advanceMethod;
      }

      const result = await adminEditBookingFull(bookingId, payload);
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

  const isOriginalContext =
    selectedConfigId === currentCourtConfigId &&
    selectedDate === currentDate;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative z-10 w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Edit Booking</h2>
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

        {/* Court Config Selector. Grouped by sport so the admin can also
            correct a booking that was logged under the wrong sport —
            picking a config from a different sport group swaps the
            booking's sport via its courtConfigId. */}
        <div className="mb-4">
          <label className="mb-1.5 block text-sm font-medium text-zinc-300">
            Court Configuration
          </label>
          <select
            value={selectedConfigId}
            onChange={(e) => handleConfigChange(e.target.value)}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 focus:border-emerald-500 focus:outline-none"
          >
            {Array.from(configsBySport.entries()).map(
              ([sportKey, configs]) => (
                <optgroup
                  key={sportKey}
                  label={SPORT_INFO[sportKey]?.name ?? sportKey}
                >
                  {configs.map((config) => (
                    <option key={config.id} value={config.id}>
                      {config.label} ({config.size}) &mdash; {config.position}
                    </option>
                  ))}
                </optgroup>
              )
            )}
          </select>
          {sportChanged ? (
            <p className="mt-1 text-xs text-amber-300">
              Sport changing: {SPORT_INFO[originalSport]?.name ?? originalSport}{" "}
              → {SPORT_INFO[selectedSport]?.name ?? selectedSport}. Slot prices
              will be recomputed for the new sport.
            </p>
          ) : (
            <p className="mt-1 text-xs text-zinc-500">
              Sport: {SPORT_INFO[selectedSport]?.name ?? selectedSport}
            </p>
          )}
        </div>

        {/* Date Picker */}
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
        </div>

        {/* Slot Grid */}
        <div className="mb-4">
          <label className="mb-1.5 block text-sm font-medium text-zinc-300">
            Time Slots
          </label>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-600 border-t-emerald-500" />
              <span className="ml-3 text-sm text-zinc-400">
                Loading slots...
              </span>
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-2 max-h-56 overflow-y-auto pr-1">
              {slots.map((slot) => {
                const isSelected = selectedHours.has(slot.hour);
                const isCurrent =
                  isOriginalContext && currentSlots.includes(slot.hour);
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
                    <span className="font-medium">
                      {formatHourRangeCompact(slot.hour)}
                    </span>
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
        </div>

        {/* Advance payment (partial bookings only) */}
        {isPartialPayment && (
          <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-amber-300">
                Advance Payment
              </label>
              <span className="text-xs text-amber-400/70">
                Remainder: ₹
                {Math.max(totalPrice - (advanceAmountNum ?? 0), 0).toLocaleString("en-IN")}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-zinc-400">₹</span>
              <input
                type="number"
                min={1}
                max={Math.max(totalPrice - 1, 1)}
                step={1}
                value={advanceAmountStr}
                onChange={(e) => setAdvanceAmountStr(e.target.value)}
                className="w-32 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-white placeholder-zinc-600 focus:border-amber-400 focus:outline-none"
              />
              <span className="text-xs text-zinc-500">via</span>
              <select
                value={advanceMethod}
                onChange={(e) =>
                  setAdvanceMethod(e.target.value as "CASH" | "UPI_QR")
                }
                className="rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-white focus:border-amber-400 focus:outline-none"
              >
                <option value="CASH">Cash</option>
                <option value="UPI_QR">Static QR</option>
              </select>
            </div>
            {advanceAmountStr && !advanceValid && (
              <p className="text-xs text-red-400">
                Advance must be between ₹1 and ₹
                {(totalPrice - 1).toLocaleString("en-IN")}
              </p>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-zinc-700 pt-4">
          <div className="text-sm text-zinc-400">
            {selectedHours.size} slot{selectedHours.size !== 1 ? "s" : ""}{" "}
            &middot;{" "}
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
              disabled={saving || selectedHours.size === 0 || !hasChanges}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
