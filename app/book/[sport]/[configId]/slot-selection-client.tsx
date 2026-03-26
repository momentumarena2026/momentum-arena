"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { DatePicker } from "@/components/booking/date-picker";
import { SlotGrid } from "@/components/booking/slot-grid";
import { CheckoutAuth } from "@/components/checkout-auth";
import { formatPrice } from "@/lib/pricing";
import { formatHour } from "@/lib/court-config";
import type { SlotAvailability } from "@/lib/availability";
import { Loader2 } from "lucide-react";

interface SlotSelectionClientProps {
  configId: string;
  sport: string;
  sportName: string;
  courtLabel: string;
  courtSize: string;
}

export function SlotSelectionClient({
  configId,
}: SlotSelectionClientProps) {
  const router = useRouter();
  const { data: session, status } = useSession();
  const [selectedDate, setSelectedDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [slots, setSlots] = useState<SlotAvailability[]>([]);
  const [selectedHours, setSelectedHours] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [booking, setBooking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAuth, setShowAuth] = useState(false);
  const pendingAuthRef = useRef(false);
  const storageKey = `slot_selection_${configId}`;

  // Save selection to sessionStorage whenever it changes
  useEffect(() => {
    if (selectedHours.length > 0) {
      sessionStorage.setItem(storageKey, JSON.stringify({ date: selectedDate, hours: selectedHours }));
    }
  }, [selectedHours, selectedDate, storageKey]);

  // Restore selection from sessionStorage on mount (e.g. after Google OAuth redirect)
  useEffect(() => {
    const saved = sessionStorage.getItem(storageKey);
    if (saved) {
      try {
        const { date, hours } = JSON.parse(saved);
        if (date === selectedDate && Array.isArray(hours) && hours.length > 0) {
          setSelectedHours(hours);
        }
      } catch { /* ignore */ }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    async function fetchSlots() {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/availability?configId=${configId}&date=${selectedDate}`
        );
        const data = await res.json();
        setSlots(data.slots || []);
      } catch {
        setSlots([]);
      } finally {
        setLoading(false);
      }
    }
    fetchSlots();
    // Only clear selection when date actually changes, not on re-render
  }, [configId, selectedDate]);

  // After auth completes and session is available, auto-proceed to lock
  useEffect(() => {
    if (pendingAuthRef.current && session?.user && selectedHours.length > 0) {
      pendingAuthRef.current = false;
      setShowAuth(false);
      // Small delay to let session cookie propagate
      setTimeout(() => lockAndCheckout(), 500);
    }
  }, [session]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedSlotPrices = slots.filter((s) =>
    selectedHours.includes(s.hour)
  );
  const total = selectedSlotPrices.reduce((sum, s) => sum + s.price, 0);

  const handleProceed = async () => {
    if (selectedHours.length === 0) return;

    // If not logged in, show inline auth
    if (!session?.user) {
      setShowAuth(true);
      return;
    }

    await lockAndCheckout();
  };

  const lockAndCheckout = async () => {
    setBooking(true);
    setError(null);
    setShowAuth(false);

    try {
      const formData = new FormData();
      formData.set("courtConfigId", configId);
      formData.set("date", selectedDate);
      formData.set("hours", JSON.stringify(selectedHours));

      const res = await fetch("/api/booking/lock", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();

      if (data.success && data.bookingId) {
        sessionStorage.removeItem(storageKey);
        router.push(`/book/checkout?bookingId=${data.bookingId}`);
      } else {
        setError(data.error || "Failed to lock slots");
        if (data.conflicts) {
          setSelectedHours((prev) =>
            prev.filter((h) => !data.conflicts.includes(h))
          );
        }
      }
    } catch {
      setError("Something went wrong");
    } finally {
      setBooking(false);
    }
  };

  const handleAuthenticated = () => {
    // User just logged in — mark pending so useEffect picks it up when session updates
    pendingAuthRef.current = true;
    // Also try directly in case session is already updated
    setTimeout(() => {
      if (pendingAuthRef.current) {
        pendingAuthRef.current = false;
        setShowAuth(false);
        lockAndCheckout();
      }
    }, 1000);
  };

  return (
    <div className="space-y-6">
      <DatePicker selectedDate={selectedDate} onDateChange={(date) => {
        setSelectedDate(date);
        setSelectedHours([]);
        sessionStorage.removeItem(storageKey);
      }} />

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
          <span className="ml-2 text-zinc-400">Loading slots...</span>
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-center text-red-400">
          {error}
        </div>
      ) : (
        <SlotGrid
          slots={slots}
          selectedHours={selectedHours}
          onSelectionChange={setSelectedHours}
        />
      )}

      {/* Inline auth for guests */}
      {showAuth && !session?.user && (
        <CheckoutAuth onAuthenticated={handleAuthenticated} />
      )}

      {/* Bottom spacer for mobile fixed bar */}
      {selectedHours.length > 0 && !showAuth && (
        <div className="h-36 md:h-0" />
      )}

      {selectedHours.length > 0 && !showAuth && (
        <div className="fixed bottom-0 left-0 right-0 z-40 md:relative md:bottom-auto md:left-auto md:right-auto md:z-auto bg-black/95 backdrop-blur-md border-t border-zinc-800 md:border-0 md:bg-transparent md:backdrop-blur-none p-4 md:p-0">
          {/* Slot summary */}
          <div className="flex items-center justify-between mb-2 md:mb-3 text-sm">
            <div className="flex items-center gap-2 text-zinc-400 overflow-hidden">
              <span className="font-medium text-white flex-shrink-0">{selectedHours.length} slot{selectedHours.length > 1 ? "s" : ""}</span>
              <span className="truncate text-xs">
                {selectedHours.sort((a, b) => a - b).map((h) => formatHour(h)).join(", ")}
              </span>
            </div>
            <span className="text-emerald-400 font-bold flex-shrink-0">{formatPrice(total)}</span>
          </div>
          <button
            onClick={handleProceed}
            disabled={booking || status === "loading"}
            className="w-full rounded-xl bg-emerald-600 px-6 py-3.5 font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
          >
            {booking ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Locking slots...
              </span>
            ) : (
              "Pay Now"
            )}
          </button>
        </div>
      )}
    </div>
  );
}
