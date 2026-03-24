"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { DatePicker } from "@/components/booking/date-picker";
import { SlotGrid } from "@/components/booking/slot-grid";
import { formatPrice } from "@/lib/pricing";
import { useCart } from "@/lib/cart-context";
import type { SlotAvailability } from "@/lib/availability";
import { Loader2, ShoppingBag, Check } from "lucide-react";
import { toast } from "sonner";

interface SlotSelectionClientProps {
  configId: string;
  sport: string;
  sportName: string;
  courtLabel: string;
  courtSize: string;
}

export function SlotSelectionClient({
  configId,
  sport,
  sportName,
  courtLabel,
  courtSize,
}: SlotSelectionClientProps) {
  const router = useRouter();
  const { addItem, setIsOpen } = useCart();
  const [selectedDate, setSelectedDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [slots, setSlots] = useState<SlotAvailability[]>([]);
  const [selectedHours, setSelectedHours] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [booking, setBooking] = useState(false);
  const [addedToCart, setAddedToCart] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch availability when date changes
  useEffect(() => {
    setLoading(true);
    setSelectedHours([]);
    setError(null);
    setAddedToCart(false);

    fetch(`/api/availability?configId=${configId}&date=${selectedDate}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.error) {
          setError(data.error);
        } else {
          setSlots(data.slots);
        }
      })
      .catch(() => setError("Failed to load availability"))
      .finally(() => setLoading(false));
  }, [configId, selectedDate]);

  const selectedSlotPrices = slots
    .filter((s) => selectedHours.includes(s.hour))
    .map((s) => ({ startHour: s.hour, price: s.price }));

  const total = selectedSlotPrices.reduce((sum, s) => sum + s.price, 0);

  const handleProceed = async () => {
    if (selectedHours.length === 0) return;
    setBooking(true);
    setError(null);

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

  const handleAddToCart = () => {
    if (selectedHours.length === 0) return;

    addItem({
      sport: sport.toUpperCase(),
      sportName,
      configId,
      courtLabel,
      courtSize,
      date: selectedDate,
      slots: selectedHours,
      slotPrices: selectedSlotPrices,
      totalAmount: total,
    });

    setAddedToCart(true);
    toast.success("Added to Play Cart", {
      description: `${sportName} — ${courtLabel} on ${new Date(selectedDate + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`,
      action: {
        label: "View Cart",
        onClick: () => setIsOpen(true),
      },
    });

    // Reset selection after a short delay
    setTimeout(() => {
      setSelectedHours([]);
      setAddedToCart(false);
    }, 1500);
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

      {/* Action Buttons */}
      {selectedHours.length > 0 && (
        <div className="space-y-3">
          {/* Add to Cart */}
          <button
            onClick={handleAddToCart}
            disabled={addedToCart}
            className="w-full rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-6 py-3 font-semibold text-emerald-400 transition-colors hover:bg-emerald-500/20 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {addedToCart ? (
              <>
                <Check className="h-4 w-4" />
                Added to Play Cart
              </>
            ) : (
              <>
                <ShoppingBag className="h-4 w-4" />
                Add to Play Cart — {formatPrice(total)}
              </>
            )}
          </button>

          {/* Direct Checkout */}
          <button
            onClick={handleProceed}
            disabled={booking}
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
        </div>
      )}
    </div>
  );
}
