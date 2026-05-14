"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { DatePicker } from "@/components/booking/date-picker";
import { CheckoutAuth } from "@/components/checkout-auth";
import { Loader2, Calendar, AlertCircle } from "lucide-react";
import { formatPrice } from "@/lib/pricing";
import { getTodayIST } from "@/lib/ist-date";

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
export function BowlingSlotPickerClient({ configId, sport, userId }: Props) {
  const router = useRouter();
  const { status: sessionStatus } = useSession();
  const [selectedDate, setSelectedDate] = useState(getTodayIST());
  const [slots, setSlots] = useState<BowlingSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
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

  const total = sortedSelected.reduce((sum, s) => {
    const found = slots.find((x) => x.hour === s.hour && x.minute === s.minute);
    return sum + (found?.price ?? 0);
  }, 0);

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

  // Render the slot as a 30-min range (e.g. "6:00 - 6:30 AM") to mirror
  // the cricket/football tiles which show "5pm - 6pm". When the slot
  // straddles noon/midnight the two halves carry different meridiems
  // so we surface both ("11:30 AM - 12:00 PM").
  function fmtTime(h: number, m: number) {
    const endTotalMin = h * 60 + m + 30;
    const endH = Math.floor(endTotalMin / 60);
    const endM = endTotalMin % 60;
    const clock = (hr: number, min: number) => {
      const hh = hr % 24;
      const display = hh % 12 === 0 ? 12 : hh % 12;
      return `${display}:${min.toString().padStart(2, "0")}`;
    };
    const meridiem = (hr: number) => ((hr % 24) < 12 ? "AM" : "PM");
    const startMer = meridiem(h);
    const endMer = meridiem(endH);
    return startMer === endMer
      ? `${clock(h, m)} - ${clock(endH, endM)} ${endMer}`
      : `${clock(h, m)} ${startMer} - ${clock(endH, endM)} ${endMer}`;
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
        <div>
          <h2 className="mb-3 text-sm font-medium text-zinc-400">
            <Calendar className="mr-1 inline h-3.5 w-3.5" />
            Pick a date
          </h2>
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
            <div className="flex items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900 py-12">
              <Loader2 className="h-5 w-5 animate-spin text-zinc-500" />
            </div>
          ) : slots.length === 0 ? (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 text-center text-sm text-zinc-500">
              No bowling slots configured for this day. Admin can enable
              windows from <span className="text-zinc-300">/admin/sports/bowling-machine</span>.
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
              {slots.map((slot) => {
                const k = keyOf(slot.hour, slot.minute);
                const isSelected = selectedKeys.has(k);
                const isAvail = slot.status === "available";
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => toggleSlot(slot)}
                    disabled={!isAvail}
                    className={`rounded-lg border p-2 text-xs transition-colors ${
                      isSelected
                        ? "border-emerald-500 bg-emerald-500/15 text-emerald-300"
                        : isAvail
                          ? "border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-700"
                          : slot.status === "blocked" || slot.status === "closed"
                            ? "border-zinc-900 bg-zinc-950 text-zinc-700"
                            : "border-red-500/30 bg-red-500/5 text-red-400/60"
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
                    <div className="font-semibold">
                      {fmtTime(slot.hour, slot.minute)}
                    </div>
                    {isAvail && (
                      <div className="mt-0.5 text-[10px] text-zinc-500">
                        {formatPrice(slot.price)}
                      </div>
                    )}
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
              {booking ? "Reserving…" : "Proceed to checkout"}
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
