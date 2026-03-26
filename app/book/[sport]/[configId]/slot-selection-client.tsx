"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { DatePicker } from "@/components/booking/date-picker";
import { SlotGrid } from "@/components/booking/slot-grid";
import { CheckoutAuth } from "@/components/checkout-auth";
import { formatPrice } from "@/lib/pricing";
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
    setSelectedHours([]);
  }, [configId, selectedDate]);

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
    // User just logged in via inline auth — proceed with lock
    lockAndCheckout();
  };

  return (
    <div className="space-y-6">
      <DatePicker selectedDate={selectedDate} onDateChange={setSelectedDate} />

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

      {selectedHours.length > 0 && !showAuth && (
        <button
          onClick={handleProceed}
          disabled={booking || status === "loading"}
          className="w-full rounded-xl bg-emerald-600 px-6 py-3 font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
        >
          {booking ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Locking slots...
            </span>
          ) : (
            `Pay Now — ${formatPrice(total)}`
          )}
        </button>
      )}
    </div>
  );
}
