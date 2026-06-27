"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { DatePicker } from "@/components/booking/date-picker";
import { CheckoutAuth } from "@/components/checkout-auth";
import { AlertCircle, Clock, Check } from "lucide-react";
import { formatPrice } from "@/lib/pricing";
import { getTodayIST } from "@/lib/ist-date";
import { formatHourMinuteCompact } from "@/lib/court-config";
import { GearPicker } from "@/components/booking/gear-picker";
import type { EquipmentOption } from "@/lib/equipment";

interface BowlingSlot {
  hour: number;
  minute: number;
  status: "available" | "booked" | "locked" | "blocked" | "closed";
  price: number;
}

interface Props {
  configId: string;
  sport: string;
  userId?: string;
  /** Rental equipment options for this sport/category. Empty array
   *  hides the gear picker entirely. */
  equipmentOptions: EquipmentOption[];
}

/**
 * Half-hour slot picker for the Bowling-Machine practice court.
 * Parallel to SlotSelectionClient so the existing cricket / football
 * flows stay on their hour-based path; this one knows about
 * `startMinute` end-to-end:
 *
 *   - GET /api/availability/bowling-machine to populate the grid
 *   - POST /api/booking/lock with mode=bowling-machine + an array of
 *     {hour, minute} picks
 *   - Selected slots must be CONSECUTIVE for a single hold (matches
 *     the existing cricket UX where you can't book 9am + 11am as
 *     one booking)
 */
export function BowlingSlotPickerClient({
  configId,
  sport,
  userId,
  equipmentOptions,
}: Props) {
  const router = useRouter();
  const { status: sessionStatus } = useSession();
  const [selectedDate, setSelectedDate] = useState(getTodayIST());
  const [slots, setSlots] = useState<BowlingSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [selectedEquipmentIds, setSelectedEquipmentIds] = useState<Set<string>>(
    new Set(),
  );
  const [booking, setBooking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAuth, setShowAuth] = useState(false);

  const fetchAvailability = useCallback(
    async (date: string) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/availability/bowling-machine?configId=${configId}&date=${date}`,
          { cache: "no-store" },
        );
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "Failed to load");
          setSlots([]);
        } else {
          setSlots(data.slots ?? []);
        }
      } catch {
        setError("Network error");
      } finally {
        setLoading(false);
      }
    },
    [configId],
  );

  useEffect(() => {
    void fetchAvailability(selectedDate);
    setSelectedKeys(new Set());
  }, [fetchAvailability, selectedDate]);

  function keyOf(h: number, m: number) {
    return `${h}:${m}`;
  }

  function toggleSlot(slot: BowlingSlot) {
    if (slot.status !== "available") return;
    const k = keyOf(slot.hour, slot.minute);
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(k)) {
        next.delete(k);
        return next;
      }
      // Enforce consecutive selection — same UX as the hour grid.
      // Build the picked set then check the resulting set's range is
      // dense.
      next.add(k);
      const indices = Array.from(next)
        .map((s) => {
          const [h, m] = s.split(":").map(Number);
          return h * 2 + (m === 30 ? 1 : 0);
        })
        .sort((a, b) => a - b);
      const isContiguous = indices.every((v, i) => i === 0 || v === indices[i - 1] + 1);
      if (!isContiguous) {
        // Reset to just this slot — friendlier than refusing the click
        return new Set([k]);
      }
      return next;
    });
  }

  const sortedSelected = Array.from(selectedKeys)
    .map((k) => {
      const [h, m] = k.split(":").map(Number);
      return { hour: h, minute: m };
    })
    .sort((a, b) => a.hour * 2 + a.minute / 30 - (b.hour * 2 + b.minute / 30));

  const slotTotal = sortedSelected.reduce((sum, s) => {
    const found = slots.find((x) => x.hour === s.hour && x.minute === s.minute);
    return sum + (found?.price ?? 0);
  }, 0);

  // Rental gear add-on — per-slot rate × slot count. Folded into
  // the sticky-CTA total so what the customer sees on this screen
  // matches the eventual checkout payable.
  const rentalTotal = Array.from(selectedEquipmentIds).reduce((sum, id) => {
    const opt = equipmentOptions.find((o) => o.id === id);
    if (!opt) return sum;
    return sum + Math.round(opt.pricePaise / 100) * sortedSelected.length;
  }, 0);

  const total = slotTotal + rentalTotal;

  async function handleProceed() {
    if (sessionStatus === "unauthenticated" || !userId) {
      setShowAuth(true);
      return;
    }
    if (sortedSelected.length === 0) return;
    setBooking(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("mode", "bowling-machine");
      fd.append("courtConfigId", configId);
      fd.append("date", selectedDate);
      fd.append("slots", JSON.stringify(sortedSelected));
      // Equipment picks captured upstream replace the old checkout-
      // side "Rent gear" card. Soft-fails server-side if a row is
      // stale (see app/api/booking/lock — `equipmentApplied`).
      if (selectedEquipmentIds.size > 0) {
        fd.append(
          "equipmentSelection",
          JSON.stringify(
            Array.from(selectedEquipmentIds).map((id) => ({
              equipmentId: id,
              quantity: 1,
            })),
          ),
        );
      }
      const res = await fetch("/api/booking/lock", {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.error ?? "Couldn't reserve slots");
        // Refresh to show what conflicted
        void fetchAvailability(selectedDate);
        setBooking(false);
        return;
      }
      router.push(`/book/checkout?holdId=${data.holdId}`);
    } catch {
      setError("Network error — please try again");
      setBooking(false);
    }
  }

  // Renders the 30-min range using the same compact AM/PM helper the
  // hour-based tiles use ("5pm - 5:30pm"). That keeps the bowling and
  // cricket / football grids visually identical — only the granularity
  // is different.
  function fmtTime(h: number, m: number) {
    const start = h * 60 + m;
    return `${formatHourMinuteCompact(start)} - ${formatHourMinuteCompact(start + 30)}`;
  }

  return (
    <>
      {showAuth && (
        <CheckoutAuth
          onAuthenticated={() => {
            setShowAuth(false);
            // useSession will refresh; the user clicks Proceed again.
          }}
        />
      )}

      <div className="space-y-5">
        {/* Sticky on scroll so the date strip stays in reach while
            the customer is browsing 30-min slot tiles below. Same
            treatment as the regular slot-selection screen so the
            two flows feel identical. z-20 sits above the tiles.
            DatePicker renders its own "Select Date" label (calendar
            icon + heading), so we don't wrap it in an extra <h2> —
            doing so produced the duplicate "Pick a date" / "Select
            Date" headers that customers were seeing on bowling. */}
        <div className="sticky top-0 z-20 -mt-2 bg-black/95 pb-3 pt-2 backdrop-blur supports-[backdrop-filter]:bg-black/70">
          <DatePicker
            selectedDate={selectedDate}
            onDateChange={(d: string) => setSelectedDate(d)}
          />
        </div>

        <div>
          <h2 className="mb-3 text-sm font-medium text-zinc-400">
            Pick consecutive 30-min slots
          </h2>

          {loading ? (
            // Skeleton grid mirrors the live tile grid columns
            // (grid-cols-2 sm:grid-cols-3 md:grid-cols-4) so the page
            // layout doesn't shift when data lands.
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
              {Array.from({ length: 12 }).map((_, i) => (
                <div
                  key={i}
                  className="h-16 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/60"
                />
              ))}
            </div>
          ) : slots.length === 0 ? (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 text-center text-sm text-zinc-500">
              The bowling machine isn&apos;t operating in this window. Please
              try another date.
            </div>
          ) : (
            // Grid columns + tile classNames below mirror SlotGrid
            // exactly so the bowling-machine picker is visually
            // identical to the cricket / football flow. Only the data
            // layer differs: slots here carry a minute field and a
            // status enum instead of an isAvailable boolean. Status
            // mapping: available → emerald tile, closed → grey Past,
            // blocked → grey Unavailable, booked/locked → red Booked.
            // No waitlist on bowling, so no Bell or Notify-me label.
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
              {slots.map((slot) => {
                const k = keyOf(slot.hour, slot.minute);
                const isSelected = selectedKeys.has(k);
                const isAvail = slot.status === "available";
                const isPast = slot.status === "closed";
                const isBooked =
                  slot.status === "booked" || slot.status === "locked";
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => toggleSlot(slot)}
                    disabled={!isAvail}
                    className={`relative rounded-xl border p-3 text-left transition-all duration-200 ${
                      isSelected
                        ? "border-emerald-400 bg-emerald-500/20 ring-1 ring-emerald-400/50"
                        : isAvail
                          ? "bg-emerald-500/10 hover:bg-emerald-500/20 border-emerald-500/30"
                          : isBooked
                            ? "bg-red-500/10 border-red-500/40 cursor-not-allowed"
                            : "bg-zinc-800/50 border-zinc-700 cursor-not-allowed opacity-50"
                    }`}
                    title={
                      slot.status === "booked"
                        ? "Already booked"
                        : slot.status === "locked"
                          ? "Someone's booking this right now"
                          : slot.status === "blocked"
                            ? "Blocked"
                            : slot.status === "closed"
                              ? "Past or closed"
                              : undefined
                    }
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <Clock className="h-3 w-3 shrink-0 text-zinc-500" />
                        {/* Same compact sizing as the hourly SlotGrid so
                            "9:30am - 10am" stays on one line and the grid
                            looks identical across sports. */}
                        <span className="whitespace-nowrap text-xs font-medium text-white">
                          {fmtTime(slot.hour, slot.minute)}
                        </span>
                      </div>
                      {isSelected && (
                        <Check className="h-4 w-4 text-emerald-400" />
                      )}
                    </div>
                    <div
                      className={`mt-1 text-xs ${
                        isAvail
                          ? "text-zinc-400"
                          : isBooked
                            ? "text-red-300/90"
                            : "text-zinc-500"
                      }`}
                    >
                      {isAvail
                        ? formatPrice(slot.price)
                        : isBooked
                          ? "Booked"
                          : isPast
                            ? "Past"
                            : "Unavailable"}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {sortedSelected.length > 0 && (
          <div className="sticky bottom-0 -mx-1 rounded-xl border border-emerald-500/30 bg-zinc-900/95 backdrop-blur p-4 shadow-lg">
            {/* Gear picker — sits inside the sticky CTA tile so the
                rental total stacks with the slot total directly above
                the Proceed button. Per the chosen UX, it appears (and
                auto-expands once) the moment a slot is picked. */}
            {equipmentOptions.length > 0 && (
              <div className="mb-3">
                <GearPicker
                  options={equipmentOptions}
                  selectedIds={selectedEquipmentIds}
                  onChange={setSelectedEquipmentIds}
                  slotCount={sortedSelected.length}
                />
              </div>
            )}
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="text-zinc-400">
                {sortedSelected.length} × 30 min
                <span className="ml-1 text-zinc-600">
                  ({sortedSelected.length * 30} min total)
                </span>
              </span>
              <span className="text-lg font-bold text-emerald-400">
                {formatPrice(total)}
              </span>
            </div>
            <button
              type="button"
              onClick={handleProceed}
              disabled={booking}
              className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-60"
            >
              {booking ? "Reserving…" : "Continue"}
            </button>
          </div>
        )}
        {/* hold a placeholder so layout doesn't jump when selection clears */}
      </div>
      {/* No-op reference to `sport` to keep the prop documented; the
          server uses it for navigation context but the picker itself
          doesn't need it at runtime. */}
      <span hidden>{sport}</span>
    </>
  );
}
