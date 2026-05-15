"use client";

import { useState, useTransition } from "react";
import { Loader2, Minus, Plus, Trash2, Wrench } from "lucide-react";
import { formatPrice } from "@/lib/pricing";
import {
  addBookingEquipment,
  removeBookingEquipment,
  updateBookingEquipmentQuantity,
} from "@/actions/admin-equipment-rental";

interface RentalRow {
  id: string;
  equipmentId: string;
  name: string;
  quantity: number;
  pricePerUnitPaise: number;
  totalPricePaise: number;
}

interface CatalogItem {
  id: string;
  name: string;
  pricePerUnitPaise: number;
  category: string | null;
}

interface Props {
  bookingId: string;
  initialRentals: RentalRow[];
  catalog: CatalogItem[];
  initialEquipmentTotalRupees: number;
  initialBookingTotalRupees: number;
  /** Sum of payments captured (paise/₹? — already in rupees). Used
   *  to surface the "outstanding · collect at venue" delta when the
   *  admin adds rentals to an already-paid booking. */
  paymentAmountRupees: number | null;
}

/**
 * Client-side editor for the admin booking detail page. Manages
 * EquipmentRental rows for a booking — add from the catalog, remove
 * any row, bump quantity in either direction. Each mutation goes
 * through a server action that recomputes Booking.totalAmount + the
 * equipmentTotalAmount column so this surface and the rest of the
 * detail page stay aligned without a manual refresh.
 */
export function EquipmentEditor({
  bookingId,
  initialRentals,
  catalog,
  initialEquipmentTotalRupees,
  initialBookingTotalRupees,
  paymentAmountRupees,
}: Props) {
  const [rentals, setRentals] = useState<RentalRow[]>(initialRentals);
  const [equipmentTotalRupees, setEquipmentTotalRupees] = useState(
    initialEquipmentTotalRupees,
  );
  const [bookingTotalRupees, setBookingTotalRupees] = useState(
    initialBookingTotalRupees,
  );
  const [selectedAdd, setSelectedAdd] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function applyResult(res: {
    success: boolean;
    error?: string;
    rentals?: RentalRow[];
    equipmentTotalRupees?: number;
    bookingTotalRupees?: number;
  }) {
    if (!res.success) {
      setError(res.error ?? "Couldn't update equipment");
      return;
    }
    setError(null);
    if (res.rentals) setRentals(res.rentals);
    if (typeof res.equipmentTotalRupees === "number") {
      setEquipmentTotalRupees(res.equipmentTotalRupees);
    }
    if (typeof res.bookingTotalRupees === "number") {
      setBookingTotalRupees(res.bookingTotalRupees);
    }
  }

  function handleAdd() {
    const equipmentId = selectedAdd;
    if (!equipmentId) return;
    startTransition(async () => {
      const res = await addBookingEquipment(bookingId, equipmentId, 1);
      applyResult(res);
      setSelectedAdd("");
    });
  }

  function handleIncrement(rentalId: string, currentQty: number) {
    startTransition(async () => {
      const res = await updateBookingEquipmentQuantity(
        bookingId,
        rentalId,
        currentQty + 1,
      );
      applyResult(res);
    });
  }

  function handleDecrement(rentalId: string, currentQty: number) {
    startTransition(async () => {
      const res = await updateBookingEquipmentQuantity(
        bookingId,
        rentalId,
        Math.max(0, currentQty - 1),
      );
      applyResult(res);
    });
  }

  function handleRemove(rentalId: string) {
    startTransition(async () => {
      const res = await removeBookingEquipment(bookingId, rentalId);
      applyResult(res);
    });
  }

  // Outstanding = what the customer still owes after admin edits.
  // Positive number means "collect at venue"; negative means "refund
  // due" (we surface only the positive case here so we don't double
  // up on the refund-due pill the page renders for payment.amount >
  // booking.totalAmount).
  const outstandingRupees =
    paymentAmountRupees !== null
      ? Math.max(0, bookingTotalRupees - paymentAmountRupees)
      : 0;

  return (
    <section
      id="equipment-rentals"
      className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 space-y-3"
    >
      <h2 className="flex items-center gap-2 text-sm font-medium text-zinc-500">
        <Wrench className="h-4 w-4" />
        Equipment Rentals
      </h2>

      {rentals.length === 0 ? (
        <p className="text-sm text-zinc-500">No equipment rented yet.</p>
      ) : (
        <ul className="space-y-2">
          {rentals.map((r) => (
            <li
              key={r.id}
              className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5"
            >
              <span className="flex-1 text-sm text-white">{r.name}</span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => handleDecrement(r.id, r.quantity)}
                  disabled={isPending}
                  className="rounded-md border border-zinc-800 bg-zinc-900 p-1.5 text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200 disabled:opacity-60"
                  aria-label="Decrease quantity"
                >
                  <Minus className="h-3.5 w-3.5" />
                </button>
                <span className="w-8 text-center text-sm font-semibold text-zinc-200">
                  {r.quantity}
                </span>
                <button
                  type="button"
                  onClick={() => handleIncrement(r.id, r.quantity)}
                  disabled={isPending}
                  className="rounded-md border border-zinc-800 bg-zinc-900 p-1.5 text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200 disabled:opacity-60"
                  aria-label="Increase quantity"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
              <span className="w-20 text-right text-sm font-semibold text-emerald-300">
                {formatPrice(Math.round(r.totalPricePaise / 100))}
              </span>
              <button
                type="button"
                onClick={() => handleRemove(r.id)}
                disabled={isPending}
                className="rounded-md border border-red-500/30 bg-red-500/10 p-1.5 text-red-400 transition-colors hover:border-red-500/50 hover:bg-red-500/20 disabled:opacity-60"
                aria-label="Remove"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {catalog.length > 0 ? (
        // `min-w-0` + `w-full` on the row so `flex-1` on the select
        // actually shrinks below its option-text intrinsic width on
        // narrow viewports. Without these the long item names spill
        // past the card's right edge on mobile.
        <div className="flex w-full min-w-0 items-center gap-2 pt-1">
          <select
            value={selectedAdd}
            onChange={(e) => setSelectedAdd(e.target.value)}
            disabled={isPending}
            className="min-w-0 flex-1 truncate rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
          >
            <option value="">Add an item…</option>
            {catalog.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} (+{formatPrice(Math.round(c.pricePerUnitPaise / 100))})
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleAdd}
            disabled={!selectedAdd || isPending}
            className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-60"
          >
            {isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Plus className="h-3.5 w-3.5" />
            )}
            Add
          </button>
        </div>
      ) : (
        <p className="text-xs text-zinc-500">
          No equipment available for this sport/category.
        </p>
      )}

      {error ? (
        <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
          {error}
        </p>
      ) : null}

      {/* Totals block: rental subtotal + (when payment exists) the
          delta the customer now owes / has overpaid. */}
      <div className="space-y-1.5 border-t border-zinc-800 pt-3 text-sm">
        <div className="flex justify-between">
          <span className="text-zinc-400">Rental total</span>
          <span className="font-semibold text-emerald-300">
            {formatPrice(equipmentTotalRupees)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-zinc-400">Booking total (now)</span>
          <span className="text-white">{formatPrice(bookingTotalRupees)}</span>
        </div>
        {outstandingRupees > 0 ? (
          <div className="flex justify-between rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-xs">
            <span className="text-amber-200">Collect at venue</span>
            <span className="font-bold text-amber-300">
              +{formatPrice(outstandingRupees)}
            </span>
          </div>
        ) : null}
      </div>
    </section>
  );
}
